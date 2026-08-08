const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

test("admin booking mutations are narrow and share the Stripe booking lock", () => {
  for (const contract of [
    'app.post("/api/admin/bookings"',
    'app.patch("/api/admin/bookings/:id"',
    'app.delete("/api/admin/bookings/:id"',
  ]) assert.equal(source.includes(contract), true, `${contract} must exist`);
  const section = source.slice(source.indexOf("const ADMIN_BOOKING_EDITABLE_FIELDS"), source.indexOf("// Resolve a Stripe payment review"));
  assert.match(section, /withCheckoutResourceLock\(bookingCheckoutResourceLockKey\("main", bookingId\)/);
  assert.doesNotMatch(section.slice(0, section.indexOf("function sanitizeAdminBookingChanges")), /stripeSessionId|modifyToken|paymentNeedsReview|archivedAt/);
  assert.match(section, /const booking = \{ \.\.\.bookings\[index\], \.\.\.changes/);
});

test("archive mutations lock every requested booking before the canonical re-read", () => {
  const section = source.slice(source.indexOf('app.patch("/api/admin/bookings/archive"'), source.indexOf("// ── Super Admin: Event Slot Requests"));
  assert.match(section, /withMainBookingLocks\(normalizedIds/);
  assert.ok(section.indexOf("withMainBookingLocks(normalizedIds") < section.indexOf("const db = readDb()"));
});

test("payment health is an aggregate and never returns credential values", () => {
  const section = source.slice(source.indexOf('app.get("/api/admin/payments/health"'), source.indexOf("const ADMIN_BOOKING_EDITABLE_FIELDS"));
  assert.match(section, /secretKeyConfigured/);
  assert.match(section, /webhookVerificationConfigured/);
  assert.doesNotMatch(section, /secretKey\s*:\s*process\.env/);
  assert.doesNotMatch(section, /webhookSecret\s*:\s*process\.env/);
});

test("reference images are isolated, capability-bound, signed and size limited", () => {
  const section = source.slice(source.indexOf("const BOOKING_REFERENCES_DIR"), source.indexOf('app.patch("/api/booking/:token"'));
  assert.match(section, /path\.join\(DATA_DIR, "booking-references"\)/);
  assert.match(section, /limits: \{ fileSize: 8 \* 1024 \* 1024, files: 5 \}/);
  assert.match(section, /requireBookingReferenceCapability, acceptBookingReferenceImages/);
  assert.match(section, /purpose: "booking-reference"/);
  assert.match(section, /private, no-store/);
  assert.match(section, /bookingCheckoutResourceLockKey\(req\.referenceBookingScope/);
  assert.doesNotMatch(section, /url:.*modifyToken/);
});

test("bank settlement requires canonical bank-pending state under the booking lock", () => {
  const section = source.slice(source.indexOf('app.patch("/api/admin/bookings/:id/bank-payment"'), source.indexOf('// Archive/unarchive'));
  assert.match(section, /withCheckoutResourceLock\(bookingCheckoutResourceLockKey\("main", bookingId\)/);
  assert.match(section, /current\.paymentStatus !== "pending-confirmation"/);
  assert.match(section, /bankTransferVerificationStatus: "confirmed-by-admin"/);
  assert.match(section, /holdExpiresAt: undefined/);
  assert.match(section, /manual-bank-payment-confirmed/);
});
