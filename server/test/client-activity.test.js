const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildClientActivity, contactMatches } = require('../client-activity');
const contact = { id: 'c', name: 'Alex', email: 'alex@example.test', albumIds: ['a'] };

test('different clients with the same name are never matched over conflicting email addresses', () => {
  assert.equal(contactMatches(contact, 'Alex', 'other@example.test'), false);
  assert.equal(contactMatches(contact, 'Different', ' ALEX@EXAMPLE.TEST '), true);
  assert.equal(contactMatches(contact, 'Alex', ''), true);
});

test('timeline retains booked extra descriptions, deposit and balance and no fabricated dates', () => {
  const result = buildClientActivity({ contact, bookings: [{ id: 'b', clientEmail: contact.email, type: 'Portrait', date: '2026-09-12', time: '09:00', paymentAmount: 200, paymentStatus: 'paid', depositAmount: 50, depositPaidAt: '2026-09-01T00:00:00Z', balancePaidAt: '2026-09-02T00:00:00Z', lineItems: [{ name: 'Composite', description: 'Agreed custom background', quantity: 2, total: 80 }] }] });
  assert.equal(result.find(item => item.type === 'booking').at, null);
  assert.equal(result.find(item => item.type === 'booking').extras[0].description, 'Agreed custom background');
  assert.match(result.find(item => item.id === 'booking-paid:b').detail, /150\.00/);
  assert.match(result.find(item => item.id === 'deposit:b').detail, /50\.00/);
});

test('shared album activity is scoped by recipient, resolves file numbers, and deduplicates recovered purchases', () => {
  const purchase = { photoIds: ['p'], purchaserEmail: contact.email, paidAt: '2026-09-01', stripeSessionId: 'secret-stripe' };
  const album = { id: 'a', title: 'Portraits', photos: [{ id: 'p', originalName: 'IMG_0042.jpg' }], sessionPurchases: { secretSession: purchase, recoveredSecret: purchase }, downloadRequests: [
    { id: 'own', email: contact.email, photoIds: ['p'], requestedAt: '2026-09-01', status: 'approved', approvedAt: '2026-09-02', method: 'bank-transfer', amount: 5 },
    { id: 'other', email: 'other@example.test', photoIds: ['p'], requestedAt: '2026-09-01', status: 'pending', amount: 999 },
  ], downloadHistory: [{ email: contact.email, photoIds: ['p'], downloadedAt: '2026-09-03', quality: 'original' }, { email: 'other@example.test', photoIds: ['p'], downloadedAt: '2026-09-04' }] };
  const result = buildClientActivity({ contact, albums: [album], orders: { order: { id: 'order', albumId: 'a', sessionKey: 'secretSession', status: 'fulfilled', fulfilledAt: '2026-09-01', fulfilledStripeSessionId: 'secret-stripe', expectedAmountCents: 500, photoIds: ['p'] } } });
  assert.equal(result.filter(item => item.title.includes('Card payment')).length, 1);
  assert.equal(result.filter(item => item.title.includes('Purchased photo access')).length, 0);
  assert.equal(result.filter(item => item.type === 'request').length, 1);
  assert.equal(result.filter(item => item.type === 'download').length, 1);
  assert.deepEqual(result.find(item => item.type === 'download').files, ['IMG_0042.jpg']);
  assert.doesNotMatch(JSON.stringify(result), /secretSession|secret-stripe|recoveredSecret|999/);
});

test('historical entitlements with no ledger amount do not use current album pricing', () => {
  const result = buildClientActivity({ contact, albums: [{ id: 'a', title: 'Gallery', priceFullAlbum: 999, sessionPurchases: { s: { fullAlbum: true, paidAt: '2026-09-01', purchaserEmail: contact.email } } }] });
  assert.match(result.find(item => item.type === 'payment').detail, /not recorded/);
  assert.doesNotMatch(JSON.stringify(result), /999/);
});
