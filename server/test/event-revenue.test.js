const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEventRevenue } = require('../event-revenue');
const booking = { id: 'b1', eventTypeId: 'e1', type: 'Convention', date: '2026-09-12', paymentAmount: 171, depositAmount: 42.75, paymentStatus: 'deposit-paid', lineItems: [{ total: 70.5 }] };

test('purchased extras identify clients and preserve agreed descriptions under event filters', () => {
  const item = { id: 'composite', name: 'Composite', description: 'Original artwork', quantity: 2, unitPrice: 35.25, total: 70.5 };
  const purchased = { ...booking, clientName: 'Cari', lineItems: [item], modifyToken: 'private-capability' };
  const { rows } = buildEventRevenue({ bookings: [purchased, { ...purchased, id: 'cancelled', status: 'cancelled' }, { ...purchased, id: 'tenant', tenantSlug: 'another' }, { ...purchased, id: 'later', date: '2026-10-01' }], eventTypes: [{ id: 'e1', title: 'Convention', extras: [{ ...item, description: 'New artwork' }] }], to: '2026-09-12' });
  assert.equal(rows[0].extraPurchases.length, 1);
  assert.deepEqual(rows[0].extraPurchases[0], { bookingId: 'b1', clientName: 'Cari', date: '2026-09-12', time: '', status: 'pending', paymentStatus: 'deposit-paid', items: [item] });
  assert.equal(rows[0].extras, 70.5);
  assert.equal(rows[0].collected, 85.5);
  const legacy = buildEventRevenue({ bookings: [booking], eventTypes: [{ id: 'e1', extras: [item] }] });
  assert.equal(legacy.rows[0].extraPurchases[0].items[0].description, undefined);
});

test('event totals count deposits once, extras inside total, and outstanding balance', () => {
  const { rows } = buildEventRevenue({ bookings: [booking, { ...booking, id: 'cancelled', status: 'cancelled' }, { ...booking, id: 'tenant', tenantSlug: 'another' }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].bookings, 1);
  assert.equal(rows[0].booked, 171);
  assert.equal(rows[0].collected, 85.5);
  assert.equal(rows[0].outstanding, 128.25);
  assert.equal(rows[0].extras, 70.5);
});

test('gallery sales use fulfilled order amounts and dedupe recovered visitor entitlements', () => {
  const order = { albumId: 'a1', status: 'fulfilled', fulfilledStripeSessionId: 'cs1', currency: 'aud', expectedAmountCents: 1250 };
  const { rows } = buildEventRevenue({ bookings: [booking], albums: [{ id: 'a1', bookingId: 'b1', pricePerPhoto: 999, sessionPurchases: { original: { photoIds: ['p1'], stripeSessionId: 'cs1' }, recovery: { photoIds: ['p1'], stripeSessionId: 'cs1' } }, downloadRequests: [{ method: 'bank-transfer', status: 'pending', amount: 20 }, { method: 'bank-transfer', status: 'approved', amount: 5 }, { method: 'bank-transfer', status: 'pending' }] }], orders: { o1: order, duplicate: order, unpaid: { ...order, fulfilledStripeSessionId: 'cs2', status: 'open' } } });
  assert.equal(rows[0].galleryCollected, 17.5);
  assert.equal(rows[0].collected, 60.25);
  assert.equal(rows[0].pendingTransfers, 20);
  assert.equal(rows[0].unpricedRequests, 1);
  assert.equal(rows[0].unpricedPurchases, 0);
});

test('filters use shoot date, separate same-name event IDs, and preserve standalone galleries', () => {
  const data = { bookings: [booking, { ...booking, id: 'b2', eventTypeId: 'e2', date: '2026-09-13' }], albums: [{ id: 'standalone', date: '2026-09-12', downloadRequests: [{ method: 'bank-transfer', status: 'approved', amount: 10 }] }] };
  assert.equal(buildEventRevenue(data).rows.length, 3);
  const { rows } = buildEventRevenue({ ...data, groupBy: 'date', from: '2026-09-13', to: '2026-09-13' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].eventId, 'e2');
  assert.equal(rows[0].date, '2026-09-13');
});

test('foreign currency and legacy entitlements without recorded prices never inflate AUD totals', () => {
  const { rows } = buildEventRevenue({ albums: [{ id: 'a', sessionPurchases: { one: { fullAlbum: true, stripeSessionId: 'legacy' }, two: { fullAlbum: true, stripeSessionId: 'legacy' } } }], orders: { o: { albumId: 'a', status: 'fulfilled', fulfilledStripeSessionId: 'eur1', currency: 'eur', expectedAmountCents: 10000 } } });
  assert.equal(rows[0].collected, 0);
  assert.equal(rows[0].unpricedPurchases, 2);
});


test('cancelled shoots retain received deposits without booked value or debt; full refunds remove them', () => {
  const cancelled = { ...booking, status: 'cancelled' };
  const { rows } = buildEventRevenue({ bookings: [cancelled] });
  assert.equal(rows[0].collected, 42.75);
  assert.equal(rows[0].bookings, 0);
  assert.equal(rows[0].booked, 0);
  assert.equal(rows[0].outstanding, 0);
  assert.equal(rows[0].extras, 0);
  assert.deepEqual(buildEventRevenue({ bookings: [{ ...cancelled, paymentStatus: 'unpaid' }] }).rows, []);
  assert.deepEqual(buildEventRevenue({ bookings: [{ ...cancelled, paymentRefundStatus: 'full' }] }).rows, []);
});
