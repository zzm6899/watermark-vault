"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  albumCheckoutSnapshot,
  applyBookingStripePayment,
  bookingCheckoutSnapshot,
  calculateAlbumCheckout,
  calculateAlbumSelectionPricing,
  checkoutExpirySeconds,
  checkoutSessionMatches,
  evaluateAlbumStripePayment,
  evaluateBookingStripePayment,
  evaluateInvoiceStripePayment,
  invoiceCheckoutSnapshot,
  mainStripeReady,
  recordLegacyLicensePlanPaymentReview,
  safeCheckoutReturnUrl,
  tenantStripeReady,
} = require("../stripe");

test("Stripe checkout expiry never outlives or undercuts the server hold bounds", () => {
  const now = Date.UTC(2026, 7, 8, 0, 0, 0);
  assert.equal(checkoutExpirySeconds(new Date(now + 5 * 60_000).toISOString(), now), Math.floor((now + 31 * 60_000) / 1000));
  assert.equal(checkoutExpirySeconds(new Date(now + 2 * 60 * 60_000).toISOString(), now), Math.floor((now + 2 * 60 * 60_000) / 1000));
  assert.equal(checkoutExpirySeconds(new Date(now + 48 * 60 * 60_000).toISOString(), now), Math.floor((now + 23 * 60 * 60_000) / 1000));
});

test("Stripe checkout return URLs are restricted to the receiving origin", () => {
  const original = process.env.APP_BASE_URL;
  try {
    process.env.APP_BASE_URL = "https://book.example";
    const req = { protocol: "https", headers: { host: "evil.example" }, get: name => name === "host" ? "evil.example" : undefined };
    assert.equal(safeCheckoutReturnUrl(req, "/booking/done?ok=1", "/fallback"), "https://book.example/booking/done?ok=1");
    assert.equal(safeCheckoutReturnUrl(req, "https://book.example/gallery/one", "/fallback"), "https://book.example/gallery/one");
    assert.equal(safeCheckoutReturnUrl(req, "https://evil.example/phish", "/fallback"), "https://book.example/fallback");
    assert.equal(safeCheckoutReturnUrl(req, "javascript:alert(1)", "/fallback"), "https://book.example/fallback");
  } finally {
    if (original === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = original;
  }
});

test("Stripe is payment-ready only when webhook verification is configured", () => {
  const original = {
    key: process.env.STRIPE_SECRET_KEY,
    webhook: process.env.STRIPE_WEBHOOK_SECRET,
    unsigned: process.env.ALLOW_UNSIGNED_STRIPE_WEBHOOKS,
  };
  try {
    process.env.STRIPE_SECRET_KEY = "sk_test_example";
    delete process.env.STRIPE_WEBHOOK_SECRET;
    process.env.ALLOW_UNSIGNED_STRIPE_WEBHOOKS = "false";
    assert.equal(mainStripeReady(), false);
    assert.equal(tenantStripeReady({ stripeSecretKey: "sk_test_tenant", stripeEnabled: true }), false);
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_example";
    assert.equal(mainStripeReady(), true);
    assert.equal(tenantStripeReady({}), false);
    assert.equal(tenantStripeReady({ stripeSecretKey: "sk_test_tenant", stripeEnabled: true, stripeWebhookSecret: "whsec_tenant" }), true);
  } finally {
    for (const [name, value] of [["STRIPE_SECRET_KEY", original.key], ["STRIPE_WEBHOOK_SECRET", original.webhook], ["ALLOW_UNSIGNED_STRIPE_WEBHOOKS", original.unsigned]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test("album checkout excludes admin and approved bank entitlements and respects download expiry", () => {
  const base = {
    id: "album",
    title: "Gallery",
    enabled: true,
    photos: [{ id: "a" }, { id: "b" }],
    freeDownloads: 0,
    pricePerPhoto: 10,
    priceFullAlbum: 15,
  };
  assert.match(calculateAlbumCheckout({ ...base, allUnlocked: true }, { sessionKey: "s", isFullAlbum: true }).error, /already unlocked/i);
  const bank = calculateAlbumCheckout({ ...base, downloadRequests: [{ sessionKey: "s", status: "approved", photoIds: ["a"] }] }, { sessionKey: "s", photoIds: ["a", "b"] });
  assert.equal(bank.amount, 10);
  assert.deepEqual(bank.photoIds, ["b"]);
  const nowMs = Date.parse("2026-08-08T00:00:00Z");
  assert.match(calculateAlbumCheckout({ ...base, downloadExpiresAt: new Date(nowMs + 20 * 60_000).toISOString() }, { sessionKey: "s", photoIds: ["a"], nowMs }).error, /too soon/i);
  const bounded = calculateAlbumCheckout({ ...base, downloadExpiresAt: new Date(nowMs + 2 * 60 * 60_000).toISOString() }, { sessionKey: "s", photoIds: ["a"], nowMs });
  assert.equal(bounded.expiresAtSeconds, Math.floor((nowMs + 2 * 60 * 60_000) / 1000));
});

test("album pricing excludes claimed free IDs and applies the canonical legacy quota", () => {
  const pricing = calculateAlbumSelectionPricing({
    requestedPhotoIds: ["claimed", "free-2", "free-3", "free-4", "free-5", "paid-1"],
    unlockedPhotoIds: ["claimed"],
    usedFreeDownloads: 0,
    freeDownloads: undefined,
    pricePerPhoto: 10,
  });
  assert.equal(pricing.freeDownloadsQuota, 5);
  assert.equal(pricing.freeDownloadsUsed, 1);
  assert.equal(pricing.freeDownloadsRemaining, 4);
  assert.deepEqual(pricing.freePhotoIds, ["free-2", "free-3", "free-4", "free-5"]);
  assert.deepEqual(pricing.billablePhotoIds, ["paid-1"]);
  assert.equal(pricing.amount, 10);

  const album = {
    id: "legacy-free-album",
    enabled: true,
    photos: ["claimed", "free-2", "free-3", "free-4", "free-5", "paid-1"].map(id => ({ id })),
    pricePerPhoto: 10,
    priceFullAlbum: 50,
    usedFreeDownloads: { session: 0 },
  };
  const checkout = calculateAlbumCheckout(album, {
    sessionKey: "session",
    unlockedPhotoIds: ["claimed"],
    photoIds: album.photos.map(photo => photo.id),
  });
  assert.equal(checkout.amount, 10);
  assert.deepEqual(checkout.photoIds, ["paid-1"]);
  assert.equal(checkout.freeDownloadsQuota, 5);
  assert.equal(checkout.freeDownloadsUsed, 1);
});

test("late main and tenant payments remain unallocated and never revive a slot", () => {
  const nowMs = Date.parse("2026-08-08T01:00:00Z");
  for (const metadata of [
    { type: "booking-payment", paymentKind: "full" },
    { type: "tenant-booking-payment", paymentKind: "full" },
  ]) {
    const result = applyBookingStripePayment({
      id: "booking",
      status: "pending",
      paymentStatus: "unpaid",
      holdExpiresAt: "2026-08-08T00:00:00Z",
      requiresConfirmation: false,
    }, metadata, { id: "cs_paid", payment_intent: "pi_paid" }, nowMs);
    assert.equal(result.needsReview, true);
    assert.equal(result.booking.status, "pending");
    assert.equal(result.booking.paymentStatus, "unpaid");
    assert.equal(result.booking.paymentReviewStatus, "paid-unallocated");
    assert.equal(result.booking.holdExpiresAt, "2026-08-08T00:00:00Z");
  }
  const cancelled = applyBookingStripePayment({ status: "cancelled", paymentStatus: "unpaid" }, { type: "booking-payment" }, { id: "cs_cancelled" }, nowMs);
  assert.equal(cancelled.booking.status, "cancelled");
  assert.equal(cancelled.booking.paymentStatus, "unpaid");
});

test("only a still-open checkout with the exact server snapshot is reusable", () => {
  const nowMs = Date.parse("2026-08-08T00:00:00Z");
  const session = {
    id: "cs_open",
    status: "open",
    payment_status: "unpaid",
    url: "https://checkout.stripe.test/cs_open",
    expires_at: Math.floor((nowMs + 60 * 60_000) / 1000),
    amount_total: 12500,
    currency: "aud",
    metadata: { checkoutSnapshotHash: "snapshot" },
  };
  const expected = { amountCents: 12500, currency: "aud", snapshotHash: "snapshot" };
  assert.equal(checkoutSessionMatches(session, expected, nowMs), true);
  assert.equal(checkoutSessionMatches({ ...session, amount_total: 12499 }, expected, nowMs), false);
  assert.equal(checkoutSessionMatches({ ...session, status: "expired" }, expected, nowMs), false);
  assert.equal(checkoutSessionMatches({ ...session, payment_status: "paid" }, expected, nowMs), false);
  assert.equal(checkoutSessionMatches({ ...session, metadata: { checkoutSnapshotHash: "changed" } }, expected, nowMs), false);
});

test("booking fulfilment is idempotent by resource payment stage, not only webhook event", () => {
  const booking = {
    id: "booking-stage",
    status: "pending",
    paymentStatus: "unpaid",
    requiresConfirmation: false,
  };
  const metadata = { type: "booking-payment", paymentKind: "full" };
  const first = applyBookingStripePayment(booking, metadata, { id: "cs_first", amount_total: 10000 }, Date.parse("2026-08-08T00:00:00Z"));
  assert.equal(first.needsReview, false);
  assert.equal(first.booking.stripeFulfilments.full.stripeSessionId, "cs_first");
  const replay = applyBookingStripePayment(first.booking, metadata, { id: "cs_first", amount_total: 10000 }, Date.parse("2026-08-08T00:01:00Z"));
  assert.equal(replay.alreadyFulfilled, true);
  const secondCharge = applyBookingStripePayment(first.booking, metadata, { id: "cs_second", amount_total: 10000 }, Date.parse("2026-08-08T00:02:00Z"));
  assert.equal(secondCharge.needsReview, true);
  assert.equal(secondCharge.booking.paymentReviewStatus, "paid-unallocated");
  assert.equal(secondCharge.booking.stripeFulfilments.full.stripeSessionId, "cs_first");
});

test("tenant booking webhook snapshot rejects changed ownership, stage, or amount", () => {
  const booking = {
    id: "tenant-booking",
    tenantSlug: "studio",
    status: "pending",
    paymentStatus: "unpaid",
    paymentAmount: 200,
    depositRequired: true,
    depositAmount: 50,
    stripeCheckoutSessionId: "cs_tenant",
  };
  const snapshot = bookingCheckoutSnapshot(booking, "tenant:studio", "deposit", 5000, "nzd");
  booking.stripeCheckoutSnapshotHash = snapshot.snapshotHash;
  const metadata = {
    type: "tenant-booking-payment",
    tenantSlug: "studio",
    bookingId: booking.id,
    paymentKind: "deposit",
    expectedAmountCents: "5000",
    expectedCurrency: "nzd",
    checkoutSnapshotHash: snapshot.snapshotHash,
  };
  const session = { id: "cs_tenant", client_reference_id: booking.id, amount_total: 5000, currency: "nzd" };
  assert.equal(evaluateBookingStripePayment(booking, metadata, session, "tenant:studio", "nzd").valid, true);
  assert.equal(evaluateBookingStripePayment({ ...booking, tenantSlug: "other" }, metadata, session, "tenant:studio", "nzd").valid, false);
  assert.equal(evaluateBookingStripePayment({ ...booking, depositAmount: 60 }, metadata, session, "tenant:studio", "nzd").valid, false);
  assert.equal(evaluateBookingStripePayment({ ...booking, paymentStatus: "deposit-paid" }, metadata, session, "tenant:studio", "nzd").valid, false);
});

test("tenant album webhook snapshot is canonical and detects an already-satisfied selection", () => {
  const album = {
    id: "tenant-album",
    enabled: true,
    photos: [{ id: "one" }, { id: "two" }],
    freeDownloads: 0,
    pricePerPhoto: 12,
    priceFullAlbum: 20,
  };
  const checkout = calculateAlbumCheckout(album, { sessionKey: "gallery-session", photoIds: ["one"] });
  checkout.currency = "nzd";
  const intent = albumCheckoutSnapshot(album, checkout, "studio");
  const order = {
    id: "order-tenant",
    albumId: album.id,
    tenantSlug: "studio",
    sessionKey: "gallery-session",
    isFullAlbum: false,
    photoIds: ["one"],
    checkoutSessionId: "cs_album",
    intentHash: intent.snapshotHash,
  };
  const metadata = {
    albumId: album.id,
    orderId: order.id,
    tenantSlug: "studio",
    expectedAmountCents: "1200",
    expectedCurrency: "nzd",
    checkoutSnapshotHash: intent.snapshotHash,
  };
  const session = { id: "cs_album", client_reference_id: album.id, amount_total: 1200, currency: "nzd" };
  assert.equal(evaluateAlbumStripePayment(album, order, metadata, session, "studio", "Australia/Sydney", "nzd").valid, true);
  const alreadySatisfied = {
    ...album,
    sessionPurchases: { "gallery-session": { fullAlbum: false, photoIds: ["one"], stripeSessionId: "cs_other" } },
  };
  assert.equal(evaluateAlbumStripePayment(alreadySatisfied, order, metadata, session, "studio", "Australia/Sydney", "nzd").valid, false);
});

test("invoice payment requires the unchanged canonical payable snapshot", () => {
  const invoice = {
    id: "invoice-1",
    status: "sent",
    shareToken: "share-secret",
    currency: "AUD",
    items: [{ quantity: 2, unitPrice: 75 }],
    discount: 10,
    tax: 10,
    amountPaid: 4,
  };
  const checkout = invoiceCheckoutSnapshot(invoice);
  const order = {
    id: "invoice-order",
    resourceType: "invoice",
    scope: "main",
    invoiceId: invoice.id,
    tenantSlug: null,
    shareTokenHash: checkout.snapshot.shareTokenHash,
    statusAtCheckout: checkout.snapshot.status,
    expectedAmountCents: checkout.amountCents,
    expectedCurrency: checkout.currency,
    snapshotHash: checkout.snapshotHash,
    checkoutSessionId: "cs_invoice",
  };
  const metadata = {
    invoiceId: invoice.id,
    invoiceCheckoutId: order.id,
    expectedAmountCents: String(checkout.amountCents),
    expectedCurrency: checkout.currency,
    checkoutSnapshotHash: checkout.snapshotHash,
  };
  const session = { id: "cs_invoice", client_reference_id: invoice.id, amount_total: checkout.amountCents, currency: checkout.currency };
  assert.equal(evaluateInvoiceStripePayment(invoice, order, metadata, session).valid, true);
  for (const changed of [
    { ...invoice, status: "cancelled" },
    { ...invoice, discount: 0 },
    { ...invoice, currency: "NZD" },
    { ...invoice, shareToken: "rotated" },
    { ...invoice, tenantSlug: "studio" },
  ]) {
    assert.equal(evaluateInvoiceStripePayment(changed, order, metadata, session).valid, false);
  }
});

test("legacy license-plan payments are idempotently quarantined without issuing a key", () => {
  const db = {};
  const metadata = {
    type: "license-plan",
    planId: "plan-legacy",
    planName: "Legacy annual plan",
    buyerEmail: "Buyer@Example.test",
    buyerName: "Buyer",
    expectedAmountCents: "9900",
    expectedCurrency: "aud",
  };
  const session = {
    id: "cs_legacy_plan",
    amount_total: 9900,
    currency: "aud",
    customer_email: "buyer@example.test",
  };
  const first = recordLegacyLicensePlanPaymentReview(db, metadata, session);
  assert.equal(first.duplicate, false);
  assert.equal(first.purchase.status, "paid-unallocated");
  assert.equal(first.purchase.paymentNeedsReview, true);
  assert.equal(first.purchase.licenseKey, undefined);
  assert.equal(first.purchase.buyerEmail, "buyer@example.test");
  assert.equal(db.wv_license_keys, undefined);

  const replay = recordLegacyLicensePlanPaymentReview(db, metadata, session);
  assert.equal(replay.duplicate, true);
  const purchases = JSON.parse(db.wv_license_purchases);
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0].licenseKey, undefined);
  assert.equal(db.wv_stripe_payment_reviews.length, 1);
});
