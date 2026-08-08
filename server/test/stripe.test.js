"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  albumCheckoutSnapshot,
  applyBookingStripePayment,
  bookingCheckoutSnapshot,
  bookingStripeCheckoutStage,
  calculateAlbumCheckout,
  calculateAlbumSelectionPricing,
  checkoutExpirySeconds,
  checkoutSessionMatches,
  evaluateAlbumStripePayment,
  evaluateBookingStripePayment,
  evaluateInvoiceStripePayment,
  getMainBookingPaymentStatus,
  invoiceCheckoutSnapshot,
  mainStripeReady,
  manualBankHoldExpiresAt,
  recordLegacyLicensePlanPaymentReview,
  safeCheckoutReturnUrl,
  switchMainBookingToManualBank,
  tenantStripeReady,
} = require("../stripe");

const BANK_TEST_NOW = Date.parse("2026-08-08T00:00:00.000Z");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mainBooking(overrides = {}) {
  return {
    id: "booking-bank",
    modifyToken: "mod-capability",
    clientName: "Private Client",
    clientEmail: "private@example.test",
    eventTypeId: "event-bank",
    type: "Portrait",
    date: "2026-08-09",
    time: "15:10",
    duration: 20,
    status: "pending",
    requiresConfirmation: true,
    paymentStatus: "unpaid",
    paymentAmount: 30,
    depositRequired: true,
    depositAmount: 15,
    paymentMethod: "stripe",
    depositMethod: "stripe",
    stripeCheckoutSessionId: "cs_bank_open",
    stripeCheckoutSnapshotHash: "snapshot-bank",
    holdExpiresAt: new Date(BANK_TEST_NOW + 60 * 60_000).toISOString(),
    ...overrides,
  };
}

function bankDbHarness({ booking = mainBooking(), settings, eventTypes } = {}) {
  let db = {
    wv_settings: settings || {
      stripeEnabled: true,
      unconfirmedBookingHoldHours: 48,
      bankTransfer: { enabled: true },
    },
    wv_event_types: eventTypes || [{ id: "event-bank", depositMethods: ["stripe", "bank"] }],
    wv_bookings: JSON.stringify([booking]),
  };
  return {
    readDb: () => clone(db),
    writeDb: next => { db = clone(next); },
    current: () => clone(db),
    replace: next => { db = clone(next); },
  };
}

function stripeCheckoutClient({ retrieve, expire } = {}) {
  const calls = { retrieve: [], expire: [] };
  const client = {
    checkout: {
      sessions: {
        retrieve: async id => {
          calls.retrieve.push(id);
          return retrieve ? retrieve(id, calls.retrieve.length) : {
            id,
            status: "open",
            payment_status: "unpaid",
          };
        },
        expire: async id => {
          calls.expire.push(id);
          return expire ? expire(id, calls.expire.length) : {
            id,
            status: "expired",
            payment_status: "unpaid",
          };
        },
      },
    },
  };
  return { client, calls };
}

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

test("manual bank selection requires an exact non-empty main-booking capability", async () => {
  const harness = bankDbHarness();
  let stripeLookups = 0;
  const dependencies = {
    readDb: harness.readDb,
    writeDb: harness.writeDb,
    getStripeClient: () => { stripeLookups++; return stripeCheckoutClient().client; },
    nowMs: BANK_TEST_NOW,
  };
  for (const modifyToken of [undefined, "", "wrong-capability"]) {
    const result = await switchMainBookingToManualBank({ ...dependencies, modifyToken });
    assert.equal(result.status, 404);
    assert.equal(result.body.code, "BOOKING_NOT_FOUND");
  }

  const emptyStored = bankDbHarness({ booking: mainBooking({ modifyToken: undefined }) });
  const missingBoth = await switchMainBookingToManualBank({
    modifyToken: "",
    readDb: emptyStored.readDb,
    writeDb: emptyStored.writeDb,
    getStripeClient: () => { stripeLookups++; return stripeCheckoutClient().client; },
    nowMs: BANK_TEST_NOW,
  });
  assert.equal(missingBoth.status, 404);

  const tenantOnly = bankDbHarness({ booking: mainBooking({ tenantSlug: "studio" }) });
  const tenantResult = await switchMainBookingToManualBank({
    ...dependencies,
    readDb: tenantOnly.readDb,
    writeDb: tenantOnly.writeDb,
    modifyToken: "mod-capability",
  });
  assert.equal(tenantResult.status, 404);
  assert.equal(stripeLookups, 0);
});

test("manual bank selection enforces canonical global, event, and live-hold state", async () => {
  const noBank = bankDbHarness({ settings: { bankTransfer: { enabled: false } } });
  const bankDisabled = await switchMainBookingToManualBank({
    modifyToken: "mod-capability",
    readDb: noBank.readDb,
    writeDb: noBank.writeDb,
    getStripeClient: () => { throw new Error("Stripe must not be called"); },
    nowMs: BANK_TEST_NOW,
  });
  assert.equal(bankDisabled.status, 403);
  assert.equal(bankDisabled.body.code, "BANK_TRANSFER_UNAVAILABLE");

  for (const eventTypes of [[], [{ id: "event-bank", depositMethods: ["stripe"] }]]) {
    const harness = bankDbHarness({ eventTypes });
    const result = await switchMainBookingToManualBank({
      modifyToken: "mod-capability",
      readDb: harness.readDb,
      writeDb: harness.writeDb,
      getStripeClient: () => { throw new Error("Stripe must not be called"); },
      nowMs: BANK_TEST_NOW,
    });
    assert.equal(result.status, 403);
    assert.equal(result.body.code, "EVENT_BANK_TRANSFER_UNAVAILABLE");
  }

  const expired = bankDbHarness({ booking: mainBooking({ holdExpiresAt: new Date(BANK_TEST_NOW - 1).toISOString() }) });
  const expiredResult = await switchMainBookingToManualBank({
    modifyToken: "mod-capability",
    readDb: expired.readDb,
    writeDb: expired.writeDb,
    getStripeClient: () => { throw new Error("Stripe must not be called"); },
    nowMs: BANK_TEST_NOW,
  });
  assert.equal(expiredResult.status, 409);
  assert.equal(expiredResult.body.code, "BOOKING_HOLD_EXPIRED");
});

test("open Stripe checkout is expired before a manual bank-pending transition", async () => {
  const harness = bankDbHarness({
    settings: {
      stripeEnabled: true,
      unconfirmedBookingHoldHours: 999,
      bankTransfer: { enabled: true },
    },
  });
  const stripe = stripeCheckoutClient();
  const result = await switchMainBookingToManualBank({
    modifyToken: "mod-capability",
    action: "select-bank",
    readDb: harness.readDb,
    writeDb: harness.writeDb,
    getStripeClient: () => stripe.client,
    nowMs: BANK_TEST_NOW,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.changed, true);
  assert.deepEqual(stripe.calls.retrieve, ["cs_bank_open"]);
  assert.deepEqual(stripe.calls.expire, ["cs_bank_open"]);

  const stored = JSON.parse(harness.current().wv_bookings)[0];
  assert.equal(stored.status, "pending", "selecting a manual transfer must not confirm the booking");
  assert.equal(stored.requiresConfirmation, true);
  assert.equal(stored.paymentStatus, "pending-confirmation");
  assert.equal(stored.paymentMethod, "bank");
  assert.equal(stored.depositMethod, "bank");
  assert.equal(stored.paymentPath, "bank");
  assert.equal(stored.bankTransferVerificationStatus, "pending-admin-verification");
  assert.equal(stored.paidAt, undefined);
  assert.equal(stored.depositPaidAt, undefined);
  assert.equal(stored.stripeCheckoutSessionId, undefined);
  assert.equal(stored.stripeCheckoutStatus, "expired-for-bank-transfer");
  assert.equal(stored.holdExpiresAt, new Date(BANK_TEST_NOW + 168 * 60 * 60_000).toISOString());
  assert.equal(stored.paymentHistory.length, 1);
  assert.equal(stored.paymentHistory[0].verification, "pending-admin-verification");
  assert.equal(stored.stripeCheckoutHistory[0].stripeSessionId, "cs_bank_open");
  assert.equal(result.body.booking.stripeCheckoutHistory, undefined, "internal Stripe audit IDs must not enter the DTO");
  assert.equal(result.body.booking.paymentHistory, undefined, "internal payment audit must not enter the DTO");
});

test("duplicate manual-bank selection is idempotent and never renews its hold", async () => {
  const harness = bankDbHarness();
  const stripe = stripeCheckoutClient();
  const first = await switchMainBookingToManualBank({
    modifyToken: "mod-capability",
    readDb: harness.readDb,
    writeDb: harness.writeDb,
    getStripeClient: () => stripe.client,
    nowMs: BANK_TEST_NOW,
  });
  assert.equal(first.status, 200);
  const afterFirst = JSON.parse(harness.current().wv_bookings)[0];

  const dbWithBankLaterDisabled = harness.current();
  dbWithBankLaterDisabled.wv_settings.bankTransfer.enabled = false;
  dbWithBankLaterDisabled.wv_event_types = [];
  harness.replace(dbWithBankLaterDisabled);
  const second = await switchMainBookingToManualBank({
    modifyToken: "mod-capability",
    readDb: harness.readDb,
    writeDb: harness.writeDb,
    getStripeClient: () => stripe.client,
    nowMs: BANK_TEST_NOW + 24 * 60 * 60_000,
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.changed, false);
  const afterSecond = JSON.parse(harness.current().wv_bookings)[0];
  assert.equal(afterSecond.holdExpiresAt, afterFirst.holdExpiresAt);
  assert.deepEqual(afterSecond.paymentHistory, afterFirst.paymentHistory);
  assert.equal(stripe.calls.expire.length, 1);

  const expiredDb = harness.current();
  const expiredBookings = JSON.parse(expiredDb.wv_bookings);
  expiredBookings[0].holdExpiresAt = new Date(BANK_TEST_NOW - 1).toISOString();
  expiredDb.wv_bookings = JSON.stringify(expiredBookings);
  harness.replace(expiredDb);
  const afterExpiry = await switchMainBookingToManualBank({
    modifyToken: "mod-capability",
    readDb: harness.readDb,
    writeDb: harness.writeDb,
    getStripeClient: () => stripe.client,
    nowMs: BANK_TEST_NOW,
  });
  assert.equal(afterExpiry.status, 409);
  assert.equal(afterExpiry.body.code, "BOOKING_HOLD_EXPIRED");
  assert.equal(JSON.parse(harness.current().wv_bookings)[0].holdExpiresAt, new Date(BANK_TEST_NOW - 1).toISOString());
});

test("manual bank selection rejects settled, terminal, and conflicting payment states", async () => {
  const cases = [
    [{ paymentStatus: "paid" }, "BOOKING_ALREADY_SETTLED"],
    [{ paymentStatus: "deposit-paid" }, "BOOKING_ALREADY_SETTLED"],
    [{ paymentStatus: "cash", paymentMethod: "cash", depositMethod: undefined }, "BOOKING_ALREADY_SETTLED"],
    [{ status: "cancelled" }, "BOOKING_NOT_PAYABLE"],
    [{ status: "completed" }, "BOOKING_NOT_PAYABLE"],
    [{ archived: true }, "BOOKING_NOT_PAYABLE"],
    [{ paymentStatus: "pending-confirmation", paymentMethod: "stripe", depositMethod: "stripe" }, "PAYMENT_STATE_CONFLICT"],
    [{ paymentAmount: 0 }, "BOOKING_NOT_PAYABLE"],
  ];
  for (const [overrides, code] of cases) {
    const harness = bankDbHarness({ booking: mainBooking(overrides) });
    const result = await switchMainBookingToManualBank({
      modifyToken: "mod-capability",
      readDb: harness.readDb,
      writeDb: harness.writeDb,
      getStripeClient: () => { throw new Error("Stripe must not be called"); },
      nowMs: BANK_TEST_NOW,
    });
    assert.equal(result.status, 409, JSON.stringify(overrides));
    assert.equal(result.body.code, code, JSON.stringify(overrides));
  }
});

test("card checkout stages reject bank-pending and cash while preserving a real deposit balance", async () => {
  assert.equal(bookingStripeCheckoutStage(mainBooking({ paymentStatus: "unpaid" })).ok, true);
  assert.equal(bookingStripeCheckoutStage(mainBooking({
    paymentStatus: "deposit-paid",
    paymentAmount: 30,
    depositAmount: 15,
  })).ok, true);
  assert.deepEqual(bookingStripeCheckoutStage(mainBooking({
    paymentStatus: "deposit-paid",
    paymentAmount: 15,
    depositAmount: 15,
  })), {
    ok: false,
    code: "BOOKING_ALREADY_SETTLED",
    error: "No balance remains on this booking",
  });
  assert.equal(bookingStripeCheckoutStage(mainBooking({
    paymentStatus: "pending-confirmation",
    paymentMethod: "bank",
    depositMethod: "bank",
  })).code, "PAYMENT_STATE_CONFLICT");
  assert.equal(bookingStripeCheckoutStage(mainBooking({
    paymentStatus: "cash",
    paymentMethod: "cash",
  })).code, "BOOKING_ALREADY_SETTLED");

  const harness = bankDbHarness();
  const stripe = stripeCheckoutClient();
  await switchMainBookingToManualBank({
    modifyToken: "mod-capability",
    readDb: harness.readDb,
    writeDb: harness.writeDb,
    getStripeClient: () => stripe.client,
    nowMs: BANK_TEST_NOW,
  });
  const bankWon = JSON.parse(harness.current().wv_bookings)[0];
  assert.equal(bookingStripeCheckoutStage(bankWon).code, "PAYMENT_STATE_CONFLICT", "a later direct card request cannot reopen checkout");
});

test("completed or concurrently completing Stripe checkout wins over bank selection", async () => {
  for (const session of [
    { id: "cs_bank_open", status: "complete", payment_status: "paid" },
    { id: "cs_bank_open", status: "complete", payment_status: "unpaid" },
  ]) {
    const harness = bankDbHarness();
    const stripe = stripeCheckoutClient({ retrieve: () => session });
    const result = await switchMainBookingToManualBank({
      modifyToken: "mod-capability",
      readDb: harness.readDb,
      writeDb: harness.writeDb,
      getStripeClient: () => stripe.client,
      nowMs: BANK_TEST_NOW,
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "STRIPE_PAYMENT_PROCESSING");
    assert.equal(stripe.calls.expire.length, 0);
    assert.equal(JSON.parse(harness.current().wv_bookings)[0].paymentStatus, "unpaid");
  }

  const raceHarness = bankDbHarness();
  const raceStripe = stripeCheckoutClient({
    retrieve: (_id, count) => count === 1
      ? { id: "cs_bank_open", status: "open", payment_status: "unpaid" }
      : { id: "cs_bank_open", status: "complete", payment_status: "paid" },
    expire: () => { throw Object.assign(new Error("Checkout Session is in status complete"), { code: "checkout_session_not_expirable" }); },
  });
  const raced = await switchMainBookingToManualBank({
    modifyToken: "mod-capability",
    readDb: raceHarness.readDb,
    writeDb: raceHarness.writeDb,
    getStripeClient: () => raceStripe.client,
    nowMs: BANK_TEST_NOW,
  });
  assert.equal(raced.status, 409);
  assert.equal(raced.body.code, "STRIPE_PAYMENT_PROCESSING");
  assert.equal(JSON.parse(raceHarness.current().wv_bookings)[0].paymentStatus, "unpaid");

  // Simulate the webhook committing while the bank request awaits Stripe's
  // expire call. The post-network canonical re-read must observe that payment
  // and refuse to downgrade it to manual-bank pending.
  const webhookRaceHarness = bankDbHarness();
  const webhookRaceStripe = stripeCheckoutClient({
    expire: id => {
      const webhookDb = webhookRaceHarness.current();
      const bookings = JSON.parse(webhookDb.wv_bookings);
      bookings[0] = {
        ...bookings[0],
        paymentStatus: "deposit-paid",
        depositPaidAt: new Date(BANK_TEST_NOW).toISOString(),
        stripeCheckoutStatus: "completed",
      };
      webhookDb.wv_bookings = JSON.stringify(bookings);
      webhookRaceHarness.replace(webhookDb);
      return { id, status: "expired", payment_status: "unpaid" };
    },
  });
  const webhookWon = await switchMainBookingToManualBank({
    modifyToken: "mod-capability",
    readDb: webhookRaceHarness.readDb,
    writeDb: webhookRaceHarness.writeDb,
    getStripeClient: () => webhookRaceStripe.client,
    nowMs: BANK_TEST_NOW,
  });
  assert.equal(webhookWon.status, 409);
  assert.equal(webhookWon.body.code, "BOOKING_ALREADY_SETTLED");
  const webhookBooking = JSON.parse(webhookRaceHarness.current().wv_bookings)[0];
  assert.equal(webhookBooking.paymentStatus, "deposit-paid");
  assert.equal(webhookBooking.paymentMethod, "stripe");
});

test("a late paid webhook after bank selection is quarantined by canonical checkout validation", async () => {
  const original = mainBooking();
  const checkout = bookingCheckoutSnapshot(original, "main", "deposit", 1500, "aud");
  const harness = bankDbHarness({ booking: { ...original, stripeCheckoutSnapshotHash: checkout.snapshotHash } });
  const stripe = stripeCheckoutClient();
  const switched = await switchMainBookingToManualBank({
    modifyToken: "mod-capability",
    readDb: harness.readDb,
    writeDb: harness.writeDb,
    getStripeClient: () => stripe.client,
    nowMs: BANK_TEST_NOW,
  });
  assert.equal(switched.status, 200);
  const bankPending = JSON.parse(harness.current().wv_bookings)[0];
  const validation = evaluateBookingStripePayment(bankPending, {
    bookingId: bankPending.id,
    type: "booking-payment",
    paymentKind: "deposit",
    expectedAmountCents: "1500",
    expectedCurrency: "aud",
    checkoutSnapshotHash: checkout.snapshotHash,
  }, {
    id: "cs_bank_open",
    client_reference_id: bankPending.id,
    amount_total: 1500,
    currency: "aud",
    payment_status: "paid",
  }, "main", "aud");
  assert.equal(validation.valid, false);
  assert.match(validation.reason, /superseded/i);
  assert.equal(bankPending.paymentStatus, "pending-confirmation");
});

test("payment status endpoint returns normalized capabilities without Stripe IDs or PII", async () => {
  const originalEnv = {
    key: process.env.STRIPE_SECRET_KEY,
    webhook: process.env.STRIPE_WEBHOOK_SECRET,
  };
  process.env.STRIPE_SECRET_KEY = "sk_test_status";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_status";
  try {
    const harness = bankDbHarness();
    const stripe = stripeCheckoutClient();
    const open = await getMainBookingPaymentStatus({
      modifyToken: "mod-capability",
      readDb: harness.readDb,
      getStripeClient: () => stripe.client,
      nowMs: BANK_TEST_NOW,
    });
    assert.equal(open.status, 200);
    assert.deepEqual(open.body.payment, {
      state: "checkout-open",
      paymentStatus: "unpaid",
      paymentMethod: "stripe",
      canRetryCard: true,
      canSubmitBank: true,
      bankTransferIsManual: true,
      requiresAdminVerification: false,
      holdExpiresAt: new Date(BANK_TEST_NOW + 60 * 60_000).toISOString(),
    });
    const serialized = JSON.stringify(open.body);
    assert.doesNotMatch(serialized, /cs_bank_open|Private Client|private@example\.test/);

    const processingStripe = stripeCheckoutClient({
      retrieve: id => ({ id, status: "complete", payment_status: "unpaid" }),
    });
    const processing = await getMainBookingPaymentStatus({
      modifyToken: "mod-capability",
      readDb: harness.readDb,
      getStripeClient: () => processingStripe.client,
      nowMs: BANK_TEST_NOW,
    });
    assert.equal(processing.body.payment.state, "checkout-processing");
    assert.equal(processing.body.payment.canRetryCard, false);
    assert.equal(processing.body.payment.canSubmitBank, false);

    const pendingHarness = bankDbHarness({ booking: mainBooking({
      paymentStatus: "pending-confirmation",
      paymentMethod: "bank",
      depositMethod: "bank",
      paymentPath: "bank",
      stripeCheckoutSessionId: undefined,
    }) });
    const bankPending = await getMainBookingPaymentStatus({
      modifyToken: "mod-capability",
      readDb: pendingHarness.readDb,
      getStripeClient: () => { throw new Error("Bank pending must not query Stripe"); },
      nowMs: BANK_TEST_NOW,
    });
    assert.equal(bankPending.body.payment.state, "bank-pending");
    assert.equal(bankPending.body.payment.requiresAdminVerification, true);
    assert.equal(bankPending.body.payment.canSubmitBank, false);

    const expiredPendingDb = pendingHarness.current();
    const expiredPendingBookings = JSON.parse(expiredPendingDb.wv_bookings);
    expiredPendingBookings[0].holdExpiresAt = new Date(BANK_TEST_NOW - 1).toISOString();
    expiredPendingDb.wv_bookings = JSON.stringify(expiredPendingBookings);
    pendingHarness.replace(expiredPendingDb);
    const expiredPending = await getMainBookingPaymentStatus({
      modifyToken: "mod-capability",
      readDb: pendingHarness.readDb,
      getStripeClient: () => { throw new Error("Bank pending must not query Stripe"); },
      nowMs: BANK_TEST_NOW,
    });
    assert.equal(expiredPending.body.payment.state, "hold-expired");
    assert.equal(expiredPending.body.payment.requiresAdminVerification, false);

    const depositHarness = bankDbHarness({ booking: mainBooking({
      paymentStatus: "deposit-paid",
      stripeCheckoutSessionId: undefined,
      stripeCheckoutStatus: "completed",
      stripeCheckoutPaymentKind: "deposit",
      depositPaidAt: new Date(BANK_TEST_NOW).toISOString(),
    }) });
    const depositBalance = await getMainBookingPaymentStatus({
      modifyToken: "mod-capability",
      readDb: depositHarness.readDb,
      getStripeClient: () => { throw new Error("A fulfilled deposit session is not an active balance checkout"); },
      nowMs: BANK_TEST_NOW,
    });
    assert.equal(depositBalance.body.payment.state, "deposit-paid");
    assert.equal(depositBalance.body.payment.canRetryCard, true);
    assert.equal(depositBalance.body.payment.canSubmitBank, false);

    const cashHarness = bankDbHarness({ booking: mainBooking({
      paymentStatus: "cash",
      paymentMethod: "cash",
      depositMethod: undefined,
      stripeCheckoutSessionId: undefined,
    }) });
    const cash = await getMainBookingPaymentStatus({
      modifyToken: "mod-capability",
      readDb: cashHarness.readDb,
      getStripeClient: () => { throw new Error("Cash must not query Stripe"); },
      nowMs: BANK_TEST_NOW,
    });
    assert.equal(cash.body.payment.state, "not-payable");
    assert.equal(cash.body.payment.paymentStatus, "cash");
    assert.equal(cash.body.payment.paymentMethod, "cash");
    assert.equal(cash.body.payment.canRetryCard, false);
    assert.equal(cash.body.payment.canSubmitBank, false);

    const settledReviewHarness = bankDbHarness({ booking: mainBooking({
      paymentStatus: "paid",
      paymentNeedsReview: true,
      paidAt: new Date(BANK_TEST_NOW).toISOString(),
      stripeCheckoutSessionId: undefined,
    }) });
    const settledReview = await getMainBookingPaymentStatus({
      modifyToken: "mod-capability",
      readDb: settledReviewHarness.readDb,
      getStripeClient: () => { throw new Error("Settled payment must not query Stripe"); },
      nowMs: BANK_TEST_NOW,
    });
    assert.equal(settledReview.body.payment.state, "paid", "manual settlement must win over a stale review flag");

    const expiredHarness = bankDbHarness({ booking: mainBooking({
      stripeCheckoutSessionId: undefined,
      holdExpiresAt: new Date(BANK_TEST_NOW - 1).toISOString(),
    }) });
    const expired = await getMainBookingPaymentStatus({
      modifyToken: "mod-capability",
      readDb: expiredHarness.readDb,
      getStripeClient: () => { throw new Error("No session must not query Stripe"); },
      nowMs: BANK_TEST_NOW,
    });
    assert.equal(expired.body.payment.state, "hold-expired");
    assert.equal(expired.body.payment.canRetryCard, false);
    assert.equal(expired.body.payment.canSubmitBank, false);
  } finally {
    if (originalEnv.key === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = originalEnv.key;
    if (originalEnv.webhook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = originalEnv.webhook;
  }
});

test("manual bank hold is bounded from one hour to seven days", () => {
  assert.equal(manualBankHoldExpiresAt({ unconfirmedBookingHoldHours: -5 }, BANK_TEST_NOW), new Date(BANK_TEST_NOW + 60 * 60_000).toISOString());
  assert.equal(manualBankHoldExpiresAt({ unconfirmedBookingHoldHours: 999 }, BANK_TEST_NOW), new Date(BANK_TEST_NOW + 168 * 60 * 60_000).toISOString());
});
