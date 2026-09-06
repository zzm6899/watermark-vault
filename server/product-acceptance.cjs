// Isolated product workflow checks. No external services or production data.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const dataDir = fs.mkdtempSync(path.join(root, 'artifacts', 'product-'));
let child;
async function main() {
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const event = { id: 'portrait', title: 'Portrait session', description: 'A relaxed portrait session.', active: true, durations: [30, 60], price: 100.5, prices: { 60: 180 }, questions: [], depositEnabled: true, depositType: 'percentage', depositAmount: 25, depositMethods: ['bank'], extras: [{ id: 'composite', name: 'Composite image', description: 'Combine multiple photos into one finished artwork, with a custom background and detailed finishing.', price: 35.25, maxQuantity: 10 }], availability: { recurring: [], specificDates: [{ date, startTime: '09:00', endTime: '17:00' }], blockedDates: [] } };
  const request = { id: 'request-one', sessionKey: 'visitor-one', photoIds: ['photo-one'], amount: 20, method: 'bank-transfer', status: 'pending', email: 'alex@example.test', clientNote: 'Portrait extras', requestedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    wv_profile: { name: 'Preview Studio', businessName: 'Preview Studio', timezone: 'Australia/Sydney', bio: 'Local product preview' },
    wv_event_types: [event],
    wv_settings: { stripeEnabled: false, bankTransfer: { enabled: true, bankName: 'Preview bank', accountName: 'Preview Studio', bsb: '000000', accountNumber: '00000000' } },
    wv_albums: Array.from({ length: 30 }, (_, i) => ({ id: `album-${i}`, slug: `preview-${i}`, title: i === 0 ? 'Portraits — Alex Example' : `Portrait collection ${i + 1}`, clientName: i === 0 ? 'Alex Example' : `Preview Client ${i + 1}`, date, enabled: true, status: i % 2 ? 'delivered' : 'editing', photos: [{ id: 'photo-one', src: '', originalName: 'portrait-001.jpg' }], photoCount: 1, freeDownloads: 0, pricePerPhoto: 20, priceFullAlbum: 20, downloadRequests: i === 0 ? [request] : i === 1 ? [{ ...request, id: 'request-two', email: 'client-two@example.test' }] : [] })),
  }));
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|HOME|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key)));
  Object.assign(env, { PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, APP_BASE_URL: base, APP_HOSTS: '127.0.0.1', PUBLIC_SITE_HOSTS: 'portfolio.invalid', SESSION_SECRET: crypto.randomBytes(48).toString('hex'), SUPER_ADMIN_USERNAME: 'preview-admin', SUPER_ADMIN_PASSWORD: 'local-product-preview-only' });
  const log = fs.openSync(path.join(dataDir, 'server.log'), 'a');
  child = spawn(process.execPath, ['index.js'], { cwd: __dirname, env, windowsHide: true, stdio: ['ignore', log, log] }); fs.closeSync(log);
  let ready = false;
  for (let i = 0; i < 300; i++) {
    try { if ((await fetch(base + '/api/public/config')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'isolated server started');
  let cookie = '';
  async function call(url, body, authenticated = false) {
    const response = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...(authenticated ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (url === '/api/auth/verify') cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    return { status: response.status, body: await response.json() };
  }
  assert.equal((await call('/api/public/config')).body.eventTypes[0].extras[0].name, 'Composite image');
  assert.equal((await call('/api/public/config')).body.eventTypes[0].extras[0].description, event.extras[0].description);
  const input = { clientName: 'Preview Booker', clientEmail: 'booker@example.test', eventTypeId: 'portrait', date, time: '09:00', duration: 30, answers: {}, paymentMethod: 'bank', payInFull: false, extras: [{ id: 'composite', quantity: 2, price: 0 }], bookingAttemptId: crypto.randomUUID() };
  const created = await call('/api/booking', input);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.booking.paymentAmount, 171);
  assert.equal(created.body.booking.depositAmount, 42.75);
  assert.equal(created.body.booking.lineItems[0].quantity, 2);
  const retry = await call('/api/booking', input);
  assert.equal(retry.body.booking.id, created.body.booking.id);
  assert.equal((await call('/api/booking', { ...input, extras: [{ id: 'composite', quantity: 3 }] })).status, 409);
  assert.equal((await call('/api/booking', { ...input, time: '10:00', bookingAttemptId: crypto.randomUUID(), extras: [{ id: 'composite', quantity: 11 }] })).status, 400);
  const full = await call('/api/booking', { ...input, time: '10:00', bookingAttemptId: crypto.randomUUID(), payInFull: true });
  assert.equal(full.body.booking.depositRequired, false);
  assert.equal(full.body.booking.paymentAmount, 171);
  console.log('PASS public extras, deposit, full payment, bounds, persistence and retries');
  const endpoint = '/api/albums/album-0/download-requests/request-one/approve';
  assert.equal((await call(endpoint, request)).status, 401);
  assert.equal((await call('/api/auth/verify', { username: 'preview-admin', passwordHash: crypto.createHash('sha256').update(env.SUPER_ADMIN_PASSWORD).digest('hex') })).body.ok, true);
  assert.equal((await call(endpoint, { ...request, photoIds: ['other-photo'] }, true)).status, 409);
  const approved = await call(endpoint, request, true);
  assert.equal(approved.status, 200);
  assert.equal(approved.body.downloadRequests[0].status, 'approved');
  assert.equal((await call(endpoint, request, true)).body.downloadRequests[0].approvedAt, approved.body.downloadRequests[0].approvedAt);
  const albums = await call('/api/albums/stubs', undefined, true);
  assert.equal(albums.body[0].paidPhotoIds, undefined);
  assert.equal(albums.body[0].photoCount, 1);
  console.log('PASS authenticated request approval, stale-request protection, retry and album preservation');
  assert.equal((await call('/api/admin/finance/events')).status, 401);
  const report = await call('/api/admin/finance/events', undefined, true);
  assert.equal(report.status, 200);
  const eventRevenue = report.body.rows.find(row => row.eventId === 'portrait');
  assert.equal(eventRevenue.bookings, 2);
  assert.equal(eventRevenue.booked, 342);
  assert.equal(eventRevenue.collected, 0);
  assert.equal(eventRevenue.outstanding, 342);
  assert.equal((await call('/api/admin/finance/events?from=2026-09-20&to=2026-09-01', undefined, true)).status, 400);
  const auto = await call('/api/email-automations/preview', { rule: { id: 'preview-only', enabled: false, trigger: 'after_booking', delayHours: 0, eventTypeId: 'different-event' } }, true);
  assert.equal(auto.status, 200);
  assert.equal(auto.body.summary.due, 0);
  console.log('PASS event finance authentication, stored totals, filters and automation preview');
  console.log('Preview: ' + base + '/admin/albums');
  console.log('Booking: ' + base + '/');
  fs.writeFileSync(path.join(dataDir, 'result.json'), JSON.stringify({ base, date, status: 'passed' }, null, 2));
  if (process.argv.includes('--serve')) await new Promise(() => {});
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => child?.kill());
process.on('SIGINT', () => { child?.kill(); process.exit(); });
process.on('SIGTERM', () => { child?.kill(); process.exit(); });
