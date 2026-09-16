const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGalleryPayments } = require('../gallery-payments');
test('saved purchase amount survives price changes and recovery does not duplicate it', () => {
 const album = { id: 'a', title: 'Animaga - Cari', clientName: 'Cari', pricePerPhoto: 99, sessionPurchases: { original: { photoIds: ['p'], stripeSessionId: 'cs' }, recovery: { photoIds: ['p'], stripeSessionId: 'cs' } } };
 const order = { id: 'o', albumId: 'a', status: 'fulfilled', fulfilledStripeSessionId: 'cs', expectedAmountCents: 500, currency: 'aud', photoIds: ['p'], clientEmail: 'client@example.com', fulfilledAt: '2026-09-15T00:00:00Z' };
 const rows = buildGalleryPayments({ albums: [album], orders: { first: order, duplicate: order, pending: { ...order, status: 'open', fulfilledStripeSessionId: 'pending' }, tenant: { ...order, tenantSlug: 'other', fulfilledStripeSessionId: 'tenant' } } });
 assert.equal(rows.length, 1); assert.equal(rows[0].amount, 5); assert.equal(rows[0].clientName, 'Cari'); assert.equal(rows[0].date, order.fulfilledAt); assert.deepEqual(rows[0].photoIds, ['p']);
});
test('legacy access never invents historical prices and is deduplicated', () => {
 const purchase = { photoIds: ['p'], stripeSessionId: 'old', paidAt: '2026-09-01' };
 const rows = buildGalleryPayments({ albums: [{ id: 'a', pricePerPhoto: 99, sessionPurchases: { one: purchase, recovery: purchase } }] });
 assert.equal(rows.length, 1); assert.equal(rows[0].amount, 0); assert.equal(rows[0].amountUnknown, true);
});
test('foreign amounts are not counted as AUD and deleted albums retain transactions', () => {
 const rows = buildGalleryPayments({ orders: { o: { id: 'o', albumId: 'deleted', status: 'fulfilled', fulfilledStripeSessionId: 'cs', expectedAmountCents: 500, currency: 'usd' } } });
 assert.equal(rows.length, 1); assert.equal(rows[0].amountUnknown, true); assert.equal(rows[0].amount, 0);
});
