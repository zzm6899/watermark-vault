"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  evaluatePublicBookingAttempt,
  hashBookingAttemptId,
  hashBookingAttemptIdentity,
  normalizeBookingAttemptId,
} = require("../security-core");

const ATTEMPT_ID = "550e8400-e29b-41d4-a716-446655440000";
const BASE_INPUT = {
  bookingAttemptId: ATTEMPT_ID,
  clientName: " Example Client ",
  clientEmail: " Client@Example.com ",
  phone: " 0400 000 000 ",
  eventTypeId: "portrait",
  date: "2026-08-10",
  time: "09:00",
  duration: 60,
  paymentMethod: "stripe",
  payInFull: false,
  answers: { second: "two", first: "one" },
};

function bookingFor(decision, overrides = {}) {
  return {
    id: "bk-existing",
    modifyToken: "mod-existing",
    bookingAttemptIdHash: decision.bookingAttemptIdHash,
    bookingAttemptIdentityHash: decision.bookingAttemptIdentityHash,
    ...overrides,
  };
}

test("booking attempt IDs accept strong UUIDv4/base64url values and hash without retaining the secret", () => {
  assert.equal(normalizeBookingAttemptId(ATTEMPT_ID), ATTEMPT_ID);
  assert.equal(normalizeBookingAttemptId("A".repeat(32)), "A".repeat(32));
  for (const invalid of [null, "", "short", ` ${ATTEMPT_ID}`, "!".repeat(32), "A".repeat(129), "550e8400-e29b-11d4-a716-446655440000"]) {
    assert.equal(normalizeBookingAttemptId(invalid), null);
  }
  const digest = hashBookingAttemptId(ATTEMPT_ID);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest.includes(ATTEMPT_ID), false);
});

test("a lost-response retry reuses the one canonical booking and never creates a duplicate", () => {
  const bookings = [];
  const first = evaluatePublicBookingAttempt(bookings, BASE_INPUT);
  assert.equal(first.action, "create");
  bookings.push(bookingFor(first));

  const retry = evaluatePublicBookingAttempt(bookings, {
    ...BASE_INPUT,
    clientName: "Example Client",
    clientEmail: "client@example.com",
    phone: "0400 000 000",
    duration: "60",
    answers: { first: "one", second: "two" },
  });
  assert.equal(retry.action, "reuse");
  assert.equal(retry.booking.id, "bk-existing");
  assert.equal(bookings.length, 1);
  assert.equal(JSON.stringify(bookings).includes(ATTEMPT_ID), false);
});

test("the same attempt ID with different immutable booking details fails closed", () => {
  const creation = evaluatePublicBookingAttempt([], BASE_INPUT);
  const bookings = [bookingFor(creation)];
  for (const changed of [
    { clientEmail: "other@example.com" },
    { date: "2026-08-11" },
    { paymentMethod: "bank" },
    { payInFull: true },
    { answers: { first: "changed", second: "two" } },
  ]) {
    const decision = evaluatePublicBookingAttempt(bookings, { ...BASE_INPUT, ...changed });
    assert.equal(decision.action, "conflict");
    assert.equal(decision.status, 409);
    assert.equal(decision.code, "BOOKING_ATTEMPT_CONFLICT");
  }
});

test("malformed, ambiguous, tenant, and legacy attempt records have deterministic outcomes", () => {
  assert.deepEqual(evaluatePublicBookingAttempt([], { ...BASE_INPUT, bookingAttemptId: undefined }), { action: "legacy" });
  const malformed = evaluatePublicBookingAttempt([], { ...BASE_INPUT, bookingAttemptId: "guessable" });
  assert.equal(malformed.action, "invalid");
  assert.equal(malformed.status, 400);
  assert.equal(malformed.code, "INVALID_BOOKING_ATTEMPT_ID");

  const creation = evaluatePublicBookingAttempt([], BASE_INPUT);
  const tenantOnly = evaluatePublicBookingAttempt([bookingFor(creation, { tenantSlug: "studio" })], BASE_INPUT);
  assert.equal(tenantOnly.action, "create");

  const ambiguous = evaluatePublicBookingAttempt([
    bookingFor(creation, { id: "bk-one" }),
    bookingFor(creation, { id: "bk-two" }),
  ], BASE_INPUT);
  assert.equal(ambiguous.action, "conflict");
  assert.equal(ambiguous.code, "BOOKING_ATTEMPT_CONFLICT");
});

test("canonical request hashing is stable across harmless input representation differences", () => {
  const equivalent = {
    ...BASE_INPUT,
    clientName: "Example Client",
    clientEmail: "client@example.com",
    phone: "0400 000 000",
    duration: "60",
    answers: { first: "one", second: "two" },
  };
  assert.equal(hashBookingAttemptIdentity(BASE_INPUT), hashBookingAttemptIdentity(equivalent));
});

test("the public booking route checks replay before external work and again before commit validation", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const start = source.indexOf('app.post("/api/booking"');
  const end = source.indexOf("// Create a booking on behalf of a tenant", start);
  const route = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(route.indexOf("const initialAttempt = evaluatePublicBookingAttempt") < route.indexOf("getGoogleBusyBookings"));
  assert.ok(route.indexOf("const commitAttempt = evaluatePublicBookingAttempt") > route.indexOf("const commitDb = readDb()"));
  assert.ok(route.indexOf("const commitAttempt = evaluatePublicBookingAttempt") < route.indexOf("const commitValidation = validateBookingRequest"));
  assert.match(route, /bookingAttemptIdHash:\s*commitAttempt\.bookingAttemptIdHash/);
  assert.match(route, /bookingAttemptIdentityHash:\s*commitAttempt\.bookingAttemptIdentityHash/);
  assert.doesNotMatch(route, /\bbookingAttemptId\s*:/);
  assert.equal((route.match(/reused:\s*true/g) || []).length, 2);
});
