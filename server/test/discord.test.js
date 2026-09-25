const test = require("node:test");
const assert = require("node:assert/strict");
const { notifyNewBooking, notifyPayment, notifyBookingUpdate } = require("../discord");

test("booking notifications include slots and saved add-on pricing within embed limits", async (t) => {
  const payloads = [];
  t.mock.method(global, "fetch", async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    return { ok: true };
  });
  const url = "https://discord.com/api/webhooks/12345/test";
  const booking = {
    id: "bk-test", clientName: "Test Client", date: "2030-01-10", time: "23:45", duration: 30,
    status: "pending", paymentStatus: "unpaid", sessionPrice: 100, paymentAmount: 170.5,
    depositRequired: true, depositAmount: 42.63, paymentReference: "PF-TEST",
    lineItems: [{ name: "Composite image", quantity: 2, unitPrice: 35.25, total: 70.5 }],
  };
  await notifyNewBooking(url, booking);
  await notifyPayment(url, booking, "deposit-paid");
  await notifyBookingUpdate(url, booking, "pending", "confirmed");
  for (const payload of payloads) {
    const fields = payload.embeds[0].fields;
    assert.equal(fields.find(f => f.name.includes("Booking Slot")).value, "23:45 – 00:15 (+1 day)");
    assert.equal(fields.find(f => f.name.includes("Add-ons")).value, "2 × Composite image — $35.25 each / $70.50 total");
    assert.equal(fields.find(f => f.name.includes("Booking Total")).value, "$170.50");
  }
  assert.equal(payloads[1].embeds[0].fields.find(f => f.name === "💳 Payment").value, "💰 Deposit Paid");
  assert.equal(payloads[2].embeds[0].fields.find(f => f.name === "📊 Status").value, "✅ confirmed");

  await notifyNewBooking(url, { id: "legacy", paymentAmount: 0 });
  const legacy = payloads.at(-1).embeds[0].fields;
  assert.equal(legacy.find(f => f.name.includes("Add-ons")).value, "None");
  assert.equal(legacy.find(f => f.name.includes("Booking Total")).value, "$0.00");
  assert.equal(legacy.find(f => f.name.includes("Booking Slot")).value, "—");

  await notifyNewBooking(url, { ...booking, time: "09:00", clientName: "x".repeat(2000), lineItems: Array(50).fill({ name: "x".repeat(160), quantity: 1000, unitPrice: 10, total: 10000 }) });
  const embed = payloads.at(-1).embeds[0];
  assert.equal(embed.fields.find(f => f.name.includes("Booking Slot")).value, "09:00 – 09:30");
  assert.ok(embed.fields.find(f => f.name.includes("Add-ons")).value.endsWith("…"));
  assert.ok(embed.fields.every(f => f.value.length <= 1024));
  assert.ok(embed.fields.length <= 25);
  assert.ok(embed.fields.reduce((n, f) => n + f.name.length + f.value.length, embed.title.length + embed.footer.text.length) <= 6000);
  const sent = payloads.length;
  await notifyBookingUpdate(url, booking, "pending", "pending");
  assert.equal(payloads.length, sent);
});
