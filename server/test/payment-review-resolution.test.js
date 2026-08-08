"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  bookingNeedsPaymentReview,
  resolveBookingPaymentReview,
} = require("../security-core");
const {
  bookingCheckoutResourceLockKey,
  withCheckoutResourceLock,
} = require("../stripe");

const RESOLVED_AT_MS = Date.parse("2026-08-08T12:34:56.000Z");

function reviewBooking(overrides = {}) {
  return {
    id: "bk-review",
    clientName: "Private Client",
    clientEmail: "private@example.test",
    paymentStatus: "pending-confirmation",
    paymentNeedsReview: true,
    paymentReviewStatus: "paid-unallocated",
    paymentReviewReason: "Paid Stripe session arrived after switching to bank transfer",
    paymentReceivedAt: "2026-08-08T11:00:00.000Z",
    stripeSessionId: "cs_paid",
    stripePaymentIntentId: "pi_paid",
    stripeReceiptUrl: "https://pay.stripe.com/receipts/private",
    stripeCheckoutSessionId: "cs_checkout",
    stripeCheckoutSnapshotHash: "snapshot-secret-hash",
    bookingAttemptIdHash: "attempt-secret-hash",
    paymentReviews: [{
      status: "manual-review",
      stripeSessionId: "cs_paid",
      stripePaymentIntentId: "pi_paid",
      paymentKind: "full",
      amountTotal: 12500,
      currency: "aud",
      reason: "Paid Stripe session arrived after switching to bank transfer",
      receivedAt: "2026-08-08T11:00:00.000Z",
    }],
    ...overrides,
  };
}

test("payment review resolution accepts only the three intentional settlement states", () => {
  for (const paymentStatus of ["paid", "cash", "deposit-paid"]) {
    const result = resolveBookingPaymentReview(reviewBooking(), paymentStatus, {
      actor: "owner",
      nowMs: RESOLVED_AT_MS,
    });
    assert.equal(result.ok, true);
    assert.equal(result.booking.paymentStatus, paymentStatus);
  }

  for (const paymentStatus of [undefined, "", "unpaid", "pending-confirmation", "refunded", "PAID IN FULL"]) {
    const result = resolveBookingPaymentReview(reviewBooking(), paymentStatus);
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.code, "INVALID_PAYMENT_REVIEW_RESOLUTION");
  }
});

test("inactive or already resolved payment reviews fail closed", () => {
  for (const booking of [
    reviewBooking({ paymentNeedsReview: false, paymentReviewStatus: "resolved", paymentReviewReason: undefined }),
    reviewBooking({ paymentNeedsReview: false, paymentReviewStatus: undefined, paymentReviewReason: undefined }),
    null,
  ]) {
    assert.equal(bookingNeedsPaymentReview(booking), false);
    const result = resolveBookingPaymentReview(booking, "paid");
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.code, "PAYMENT_REVIEW_NOT_ACTIVE");
  }
});

test("resolution preserves canonical Stripe fields and every prior audit entry", () => {
  const original = reviewBooking();
  const before = structuredClone(original);
  const result = resolveBookingPaymentReview(original, "deposit-paid", {
    actor: "studio-owner",
    nowMs: RESOLVED_AT_MS,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(original, before, "the canonical input object must not be mutated in place");
  for (const field of [
    "stripeSessionId",
    "stripePaymentIntentId",
    "stripeReceiptUrl",
    "stripeCheckoutSessionId",
    "stripeCheckoutSnapshotHash",
    "bookingAttemptIdHash",
    "paymentReceivedAt",
  ]) {
    assert.equal(result.booking[field], original[field], `${field} must be preserved`);
  }
  assert.deepEqual(result.booking.paymentReviews.slice(0, original.paymentReviews.length), original.paymentReviews);
  assert.equal(result.booking.paymentReviews.length, original.paymentReviews.length + 1);
  assert.deepEqual(result.booking.paymentReviews.at(-1), {
    status: "resolved",
    reason: "Payment review resolved by marking payment deposit-paid.",
    resolvedAt: "2026-08-08T12:34:56.000Z",
    resolvedBy: "studio-owner",
    resolutionPaymentStatus: "deposit-paid",
  });
  assert.equal(result.booking.paymentNeedsReview, false);
  assert.equal(result.booking.paymentReviewStatus, "resolved");
  assert.equal(result.booking.paymentReviewResolvedAt, "2026-08-08T12:34:56.000Z");
  assert.equal(result.booking.paymentReviewResolvedBy, "studio-owner");
  assert.equal(Object.hasOwn(result.booking, "paymentReviewReason"), false);
});

test("legacy top-level review reasons are retained in the append-only audit", () => {
  const result = resolveBookingPaymentReview(reviewBooking({ paymentReviews: undefined }), "paid", {
    actor: "owner",
    nowMs: RESOLVED_AT_MS,
  });
  assert.equal(result.ok, true);
  assert.equal(result.booking.paymentReviews.length, 2);
  assert.deepEqual(result.booking.paymentReviews[0], {
    status: "manual-review",
    reason: "Paid Stripe session arrived after switching to bank transfer",
    receivedAt: "2026-08-08T11:00:00.000Z",
  });
  assert.equal(result.booking.paymentReviews[1].status, "resolved");
});

test("all canonical booking mutations share one serial lock key", async () => {
  assert.equal(bookingCheckoutResourceLockKey("main", "bk-review"), "checkout:main:booking:bk-review");
  assert.equal(bookingCheckoutResourceLockKey("tenant:studio", "bk-review"), "checkout:tenant:studio:booking:bk-review");

  const events = [];
  let releaseFirst;
  const firstCanFinish = new Promise(resolve => { releaseFirst = resolve; });
  const first = withCheckoutResourceLock(bookingCheckoutResourceLockKey("main", "bk-review"), async () => {
    events.push("first-start");
    await firstCanFinish;
    events.push("first-end");
  });
  await new Promise(resolve => setImmediate(resolve));
  const second = withCheckoutResourceLock(bookingCheckoutResourceLockKey("main", "bk-review"), async () => {
    events.push("second-start");
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ["first-start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first-start", "first-end", "second-start"]);
});

test("the authenticated endpoint re-reads and writes only the canonical booking inside the shared lock", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const start = source.indexOf('app.patch("/api/admin/bookings/:id/payment-review"');
  const end = source.indexOf("// Archive/unarchive one or more retained bookings", start);
  const route = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(route.slice(0, route.indexOf("=>") + 2), /superLimiter, requireAuth/);
  assert.ok(route.indexOf("withCheckoutResourceLock") < route.indexOf("const db = readDb()"));
  assert.ok(route.indexOf("const db = readDb()") < route.indexOf("resolveBookingPaymentReview"));
  assert.match(route, /db\[DB_KEYS\.BOOKINGS\] = JSON\.stringify\(bookings\)/);
  assert.match(route, /writeDb\(db\)/);
  assert.match(route, /booking: resolution\.booking/);
  assert.doesNotMatch(route, /req\.body\?\.booking|req\.body\.bookings/);

  const stripeSource = fs.readFileSync(path.join(__dirname, "..", "stripe.js"), "utf8");
  const lockKeyStart = stripeSource.indexOf("function webhookResourceLockKey");
  const lockKeyEnd = stripeSource.indexOf("function stripeEventKey", lockKeyStart);
  assert.match(stripeSource.slice(lockKeyStart, lockKeyEnd), /bookingCheckoutResourceLockKey\(scope, metadata\.bookingId\)/);
});
