const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { registerInstalments, applyInstalmentPayment } = require("../instalments");
const { withCheckoutResourceLock, bookingCheckoutResourceLockKey } = require("../stripe");
const { snapshotConventionDetails, validConventionDetails } = require("../convention-details");
const { buildBookingEmailHtml, buildBookingEmailText, buildReminderEmailHtml, buildReminderEmailText, buildAutomationEmail, buildClientPortalEmail } = require("../email");

test("instalment allocation, checkout retries, scope, verified settlement and double payment protection", async t => {
  let db = { wv_bookings: [{ id: "booking-a", tenantSlug: "a", clientEmail: "a@example.test", paymentAmount: 100, depositAmount: 20, paymentStatus: "deposit-paid", status: "confirmed", modifyToken: "booking-capability-token-a" }], t_a_wv_tenant_settings: { stripeSecretKey: "sk_test_a", stripeWebhookSecret: "whsec_a", stripeCurrency: "aud" }, wv_instalments: [] };
  const sessions = new Map(); let creations = 0;
  const app = express(); app.use(express.json());
  registerInstalments(app, {
    readDb: () => structuredClone(db), writeDb: value => { db = structuredClone(value); },
    studioScope: req => req.query.tenant || null, requireAdminOrScopedTenant: (_req, _res, next) => next(),
    withCheckoutResourceLock, bookingCheckoutResourceLockKey, licensedTenantBySlug: slug => slug === "a",
    safeCheckoutReturnUrl: (_req, _url, path) => `https://studio.example${path}`,
    createStripeClient: () => ({ checkout: { sessions: {
      create: async args => { creations++; const session = { id: `cs_${creations}`, url: "https://checkout.stripe.com/test", status: "open", payment_status: "unpaid", metadata: args.metadata, amount_total: args.line_items[0].price_data.unit_amount, currency: "aud" }; sessions.set(session.id, session); return session; },
      retrieve: async id => sessions.get(id), expire: async id => { sessions.get(id).status = "expired"; },
    } } }),
  });
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const call = async (path, body, method = "POST") => { const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: body ? method : "GET", headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) }); return { status: res.status, data: await res.json() }; };
  const input = { id: "instalment-one-unique", amount: 40, dueDate: "2026-10-01" };
  assert.equal((await call("/api/bookings/booking-a/instalments?tenant=b")).status, 404);
  assert.equal((await call("/api/bookings/booking-a/instalments?tenant=a", input)).status, 201);
  assert.equal((await call("/api/bookings/booking-a/instalments?tenant=a", input)).status, 200);
  assert.equal(db.wv_instalments.length, 1);
  assert.equal((await call("/api/bookings/booking-a/instalments?tenant=a", { ...input, id: "instalment-invalid-date", dueDate: "2026-02-31" })).status, 409);
  assert.equal((await call("/api/bookings/booking-a/instalments?tenant=a", { ...input, id: "instalment-too-large", amount: 41 })).status, 409);
  const url = "/api/booking/booking-capability-token-a/instalments/instalment-one-unique/checkout";
  const results = await Promise.all([call(url, {}), call(url, {})]);
  assert.deepEqual(results.map(result => result.status), [200, 200]); assert.equal(creations, 1);
  assert.equal((await call("/api/instalments/instalment-one-unique?tenant=b", { status: "paid", method: "bank" }, "PUT")).status, 404);
  const session = { ...sessions.get("cs_1"), payment_status: "paid", status: "complete" };
  assert.throws(() => applyInstalmentPayment(db, session, "b"));
  const settled = applyInstalmentPayment(db, session, "a");
  assert.equal(settled.booking.depositAmount, 60); assert.equal(settled.booking.paymentStatus, "deposit-paid");
  assert.equal(applyInstalmentPayment(db, session, "a").duplicate, true);
  assert.equal(db.wv_bookings[0].stripePayments.length, 1);
  assert.equal((await call(url, {})).status, 409);
  assert.equal((await call("/api/bookings/booking-a/instalments?tenant=a", { ...input, id: "instalment-second-unique" })).status, 201);
  assert.equal((await call("/api/instalments/instalment-second-unique?tenant=a", { status: "paid", method: "cash" }, "PUT")).status, 200);
  assert.equal(db.wv_bookings[0].paymentStatus, "paid"); assert.equal(db.wv_bookings[0].depositAmount, 100); assert.equal(db.wv_bookings[0].instalmentPlanActive, false);
  assert.equal((await call("/api/instalments/instalment-second-unique?tenant=a", { status: "paid", method: "cash" }, "PUT")).status, 200);
  assert.equal(db.wv_bookings[0].paymentHistory.length, 2);
  const altered = structuredClone(db); altered.wv_instalments[0].status = "pending";
  assert.equal(applyInstalmentPayment(altered, { ...session, amount_total: 1 }, "a").review, true);
  assert.equal(altered.wv_bookings[0].paymentNeedsReview, true);
});

test("convention details are a booking snapshot and appear in every client message", () => {
  const event = { conventionDetails: { meetingPoint: "North entrance", mapUrl: "https://maps.example/meeting", arrivalInstructions: "Arrive 10 minutes early <script>", deliveryDays: 7 } };
  const details = snapshotConventionDetails(event, "2026-09-26");
  event.conventionDetails.meetingPoint = "Changed venue";
  assert.equal(details.meetingPoint, "North entrance"); assert.equal(details.deliveryDate, "2026-10-03");
  assert.equal(validConventionDetails({ mapUrl: "javascript:alert(1)" }), false);
  assert.equal(validConventionDetails({ deliveryDate: "2026-02-31" }), false);
  const params = { clientName: "Client", eventTitle: "Convention", date: "2026-09-26", time: "09:00", duration: 60, conventionDetails: details };
  const automation = buildAutomationEmail({ booking: { ...params, type: params.eventTitle } });
  const portal = buildClientPortalEmail({ bookings: [{ title: "Convention", url: "https://studio.example/booking/modify/capability", conventionDetails: details }] });
  for (const message of [buildBookingEmailHtml(params), buildBookingEmailText(params), buildReminderEmailHtml(params), buildReminderEmailText(params), automation.html, automation.text, portal.html, portal.text]) {
    assert.match(message, /North entrance/); assert.match(message, /2026-10-03/); assert.match(message, /maps.example/);
  }
  assert.ok(!buildBookingEmailHtml(params).includes("<script>"));
});
