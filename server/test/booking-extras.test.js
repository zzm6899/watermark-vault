const test = require("node:test");
const assert = require("node:assert/strict");
const { priceBookingExtras } = require("../booking-extras");
const { validateBookingRequest, hashBookingAttemptIdentity } = require("../security-core");
const extras = [{ id: "composite", name: "Composite image", price: 35.25, maxQuantity: 10 }];
const event = { id: "session", title: "Portrait", durations: [30], active: true, price: 100.5, extras, depositEnabled: true, depositType: "percentage", depositAmount: 25, availability: { specificDates: [{ date: "2030-01-10", startTime: "09:00", endTime: "17:00" }] } };
const input = { eventTypeId: event.id, date: "2030-01-10", time: "09:00", duration: 30, extras: [{ id: "composite", quantity: 2, price: 0, total: 0 }] };
const context = { eventTypes: [event], bookings: [], timezone: "UTC", now: new Date("2030-01-01") };

test("description snapshots come from the catalog and survive later event edits", () => {
  const catalog = { ...event, extras: [{ ...extras[0], description: "  Original composite artwork  " }] };
  const result = validateBookingRequest({ ...input, extras: [{ id: "composite", quantity: 2, description: "Client supplied replacement" }] }, { ...context, eventTypes: [catalog] });
  assert.equal(result.ok, true);
  assert.equal(result.normalized.lineItems[0].description, "Original composite artwork");
  catalog.extras[0].description = "Changed service";
  assert.equal(result.normalized.lineItems[0].description, "Original composite artwork");
  assert.equal(result.normalized.paymentAmount, 171);
});

test("optional extra descriptions do not change pricing; invalid descriptions are rejected", () => {
  const selections = [{ id: "composite", quantity: 2 }];
  for (const description of [undefined, "", "Combine photos into one finished artwork.", "x".repeat(300)]) {
    const priced = priceBookingExtras([{ ...extras[0], description }], selections);
    assert.equal(priced.total, priceBookingExtras(extras, selections).total);
    assert.equal(priced.lineItems[0].description, description || undefined);
  }
  for (const description of [null, 42, {}, "x".repeat(301)]) {
    assert.throws(() => priceBookingExtras([{ ...extras[0], description }], selections));
  }
});

test("server snapshots extras at catalog prices and includes them in percentage deposits", () => {
  const result = validateBookingRequest(input, context);
  assert.equal(result.ok, true);
  assert.equal(result.normalized.sessionPrice, 100.5);
  assert.equal(result.normalized.paymentAmount, 171);
  assert.equal(result.normalized.depositAmount, 42.75);
  assert.deepEqual(result.normalized.lineItems, [{ id: "composite", name: "Composite image", quantity: 2, unitPrice: 35.25, total: 70.5 }]);
  extras[0].price = 99;
  assert.equal(result.normalized.lineItems[0].unitPrice, 35.25);
  extras[0].price = 35.25;
});
test("zero extras preserve base price; fixed deposits cap at total", () => {
  const fixed = { ...event, depositType: "fixed", depositAmount: 500 };
  const result = validateBookingRequest({ ...input, extras: [{ id: "composite", quantity: 0 }] }, { ...context, eventTypes: [fixed] });
  assert.equal(result.normalized.paymentAmount, 100.5);
  assert.equal(result.normalized.depositAmount, 100.5);
  assert.deepEqual(result.normalized.lineItems, []);
  assert.deepEqual(priceBookingExtras(), { lineItems: [], total: 0 });
});
test("invalid, duplicate, unknown and fractional quantities fail closed", () => {
  for (const quantity of [-1, 1.5, 11, Infinity, NaN, "2", null]) assert.throws(() => priceBookingExtras(extras, [{ id: "composite", quantity }]));
  for (const selections of [null, {}, [{ id: "fake", quantity: 1 }], [{ id: "composite", quantity: 1 }, { id: "composite", quantity: 1 }]]) assert.throws(() => priceBookingExtras(extras, selections));
  assert.throws(() => priceBookingExtras([{ ...extras[0], price: -1 }], []));
  assert.equal(priceBookingExtras([{ ...extras[0], price: 0.1 }], [{ id: "composite", quantity: 3 }]).total, 0.3);
});
test("booking retries detect quantity changes without invalidating legacy identities", () => {
  assert.notEqual(hashBookingAttemptIdentity(input), hashBookingAttemptIdentity({ ...input, extras: [{ id: "composite", quantity: 3 }] }));
  assert.equal(hashBookingAttemptIdentity({ duration: 30 }), hashBookingAttemptIdentity({ duration: 30, extras: [] }));
});

test("booking emails include the agreed extras in HTML and plain text", () => {
  const { buildBookingEmailHtml, buildBookingEmailText } = require("../email");
  const params = { clientName: "Client", eventTitle: "Portrait", date: "2030-01-10", time: "09:00", duration: 30, price: 171, sessionPrice: 100.5, depositAmount: 42.75, paymentMethod: "bank", lineItems: priceBookingExtras(extras, [{ id: "composite", quantity: 2 }]).lineItems };
  assert.match(buildBookingEmailHtml(params), /Composite image × 2/);
  assert.match(buildBookingEmailText(params), /Composite image × 2/);
  assert.match(buildBookingEmailText(params), /171/);
});
