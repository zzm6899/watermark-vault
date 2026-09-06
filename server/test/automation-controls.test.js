const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAutomationRule, getAutomationDecision, buildAutomationPreview } = require('../email-automation-core');
const booking = { id: 'b1', eventTypeId: 'e1', type: 'Portrait', clientName: 'A $& B', clientEmail: 'test@example.test', date: '2026-09-12', time: '10:00', status: 'confirmed', paymentStatus: 'paid', paymentAmount: 100, paidAt: '2026-09-11T02:00:00Z', createdAt: '2026-09-10T00:00:00Z' };

test('zero delay and bounds survive saving; payment follow-up requires a full payment timestamp', () => {
  const rule = normalizeAutomationRule({ trigger: 'after_payment', delayHours: 0 });
  assert.equal(rule.delayHours, 0);
  const now = Date.parse(booking.paidAt) + 1000;
  assert.equal(getAutomationDecision(rule, booking, now).status, 'due');
  assert.equal(getAutomationDecision(rule, { ...booking, paymentStatus: 'deposit-paid' }, now).status, 'skipped');
  assert.equal(getAutomationDecision(rule, { ...booking, paidAt: undefined }, now).status, 'skipped');
  assert.equal(normalizeAutomationRule({ delayHours: -99 }).delayHours, 0);
});

test('event, booking status and start-date filters apply to the actual scheduler decision', () => {
  const rule = normalizeAutomationRule({ trigger: 'after_payment', delayHours: 0, eventTypeId: 'e1', bookingStatus: 'confirmed', createdAfter: '2026-09-10' });
  const now = Date.parse(booking.paidAt) + 1000;
  assert.equal(getAutomationDecision(rule, booking, now).status, 'due');
  for (const patch of [{ eventTypeId: 'e2' }, { status: 'pending' }, { createdAt: '2026-09-09T00:00:00Z' }]) assert.equal(getAutomationDecision(rule, { ...booking, ...patch }, now).status, 'skipped');
});

test('reminders use studio timezone and never send after session start', () => {
  const rule = normalizeAutomationRule({ trigger: 'before_event', delayHours: 2 });
  const options = { timezone: 'Australia/Sydney' };
  assert.equal(getAutomationDecision(rule, booking, Date.parse('2026-09-11T22:30:00Z'), options).status, 'due');
  assert.equal(getAutomationDecision(rule, booking, Date.parse('2026-09-12T00:01:00Z'), options).status, 'skipped');
});

test('preview renders the same personalised body and preserves literal replacement characters', () => {
  const preview = buildAutomationPreview({ trigger: 'after_payment', delayHours: 0, templateSubject: '{name}: {time}', templateBody: '{event} · {balance} · {total}' }, [booking], Date.parse(booking.paidAt) + 1000);
  assert.equal(preview.matches[0].subject, 'A $& B: 10:00');
  assert.equal(preview.matches[0].body, 'Portrait · $0.00 · $100.00');
});
