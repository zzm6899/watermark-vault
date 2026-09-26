// Isolated HTTP/SQLite checks; synthetic clients, no external email or payments.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const dataDir = fs.mkdtempSync(path.join(root, 'artifacts', 'business-'));
let child;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
async function main() {
  const event = { id: 'convention', title: 'Convention', active: true, price: 100, durations: [30], conventionDetails: { meetingPoint: 'North gate', mapUrl: 'https://maps.example/north', arrivalInstructions: 'Arrive early', deliveryDays: 7 } };
  const enquiry = { id: 'enquiry', name: 'Synthetic Client', email: 'client@example.test', preferredDate: '2027-10-01', preferredStartTime: '09:00', eventTypeId: event.id, status: 'pending' };
  const booking = { conventionDetails: require('./convention-details').snapshotConventionDetails(event, '2027-10-02'), id: 'existing', modifyToken: 'mod-capability-existing-fixture', status: 'confirmed', paymentStatus: 'unpaid', paymentAmount: 100, clientName: 'Synthetic Client', clientEmail: 'client@example.test', date: '2027-10-02', time: '09:00', duration: 30, eventTypeId: event.id };
  const album = { id: 'capture', slug: 'capture', title: 'Capture', enabled: true, photos: [] };
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ wv_profile: { name: 'Test Studio', timezone: 'Australia/Sydney' }, wv_settings: {}, wv_event_types: [event], wv_enquiries: [enquiry, { ...enquiry, id: "legacy-accepted", status: "accepted", preferredDate: "2027-10-03" }, { ...enquiry, id: "conflicting", preferredDate: booking.date }], wv_bookings: [booking, { ...booking, id: 'tenant-booking', tenantSlug: 'a', modifyToken: 'mod-capability-tenant-fixture' }], wv_albums: [album], t_a_wv_event_types: [event], t_a_wv_enquiries: [enquiry], t_a_wv_albums: [album] }));
  fs.writeFileSync(path.join(dataDir, 'tenants.json'), JSON.stringify([{ slug: 'a', active: true, displayName: 'Studio A', passwordHash: hash('tenant-only'), licenseKey: 'TEST-A' }]));
  fs.writeFileSync(path.join(dataDir, 'license_keys.json'), JSON.stringify([{ key: 'TEST-A', usedBy: 'a', usedAt: new Date().toISOString(), maxBookings: 100 }]));
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|HOME|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key)));
  Object.assign(env, { PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, APP_BASE_URL: base, APP_HOSTS: '127.0.0.1', PUBLIC_SITE_HOSTS: 'portfolio.invalid', SESSION_SECRET: crypto.randomBytes(48).toString('hex'), SUPER_ADMIN_USERNAME: 'test-admin', SUPER_ADMIN_PASSWORD: 'isolated-local-only' });
  async function start() {
    const log = fs.openSync(path.join(dataDir, 'server.log'), 'a');
    child = spawn(process.execPath, ['index.js'], { cwd: __dirname, env, windowsHide: true, stdio: ['ignore', log, log] }); fs.closeSync(log);
    for (let i = 0; i < 300; i++) { try { if ((await fetch(base + '/api/health')).ok) return; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error('Server did not start; ' + dataDir);
  }
  await start();
  const cookies = {};
  async function call(url, body, identity = 'admin', method = body === undefined ? 'GET' : 'POST', extraHeaders = {}) {
    const form = body instanceof FormData;
    const res = await fetch(base + url, { method, headers: { Origin: base, Cookie: cookies[identity] || '', ...(!form ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders }, body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
    if (res.headers.getSetCookie().length) cookies[identity] = res.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    return { status: res.status, data: await res.json() };
  }
  async function login() {
    assert.equal((await call('/api/auth/verify', { username: 'test-admin', passwordHash: hash(env.SUPER_ADMIN_PASSWORD) })).status, 200);
    assert.equal((await call('/api/tenant/a/login', { passwordHash: hash('tenant-only') }, 'tenant')).status, 200);
  }
  await login();
  assert.equal((await call('/api/enquiries/enquiry/accept', {}, 'public')).status, 401);
  const accepted = await Promise.all([call('/api/enquiries/enquiry/accept', {}), call('/api/enquiries/enquiry/accept', {})]);
  assert.deepEqual(accepted.map(item => item.status).sort(), [200, 201]);
  assert.equal(accepted[0].data.booking.id, accepted[1].data.booking.id);
  assert.equal(accepted[0].data.booking.conventionDetails.deliveryDate, '2027-10-08');
  assert.equal((await call('/api/enquiries/conflicting/accept', {})).status, 409);
  const enquiryStore = (await call('/api/store?keys=wv_enquiries')).data.wv_enquiries;
  const enquiryRows = typeof enquiryStore === 'string' ? JSON.parse(enquiryStore) : enquiryStore;
  assert.equal(enquiryRows.find(row => row.id === 'conflicting').status, 'pending');
  assert.equal(enquiryRows.find(row => row.id === 'conflicting').bookingId, undefined);
  assert.equal((await call('/api/enquiries/legacy-accepted/accept', {})).status, 201);
  assert.equal((await call('/api/store/wv_enquiries', { value: [enquiry] }, 'admin', 'PUT')).status, 200);
  assert.equal((await call('/api/enquiries/enquiry/accept', {})).data.booking.id, accepted[0].data.booking.id);
  const tenantAccepted = await call('/api/enquiries/enquiry/accept?tenant=a', {}, 'tenant');
  assert.equal(tenantAccepted.status, 201, JSON.stringify(tenantAccepted));
  assert.equal(tenantAccepted.data.booking.tenantSlug, 'a');
  assert.equal((await call('/api/enquiries/enquiry/accept?tenant=b', {}, 'tenant')).status, 401);
  console.log('PASS atomic enquiry acceptance, concurrent retry, tenant scope and convention snapshot');
  const quoteInput = { to: { name: 'Client', email: 'client@example.test' }, items: [{ description: 'Photography', quantity: 1, unitPrice: 100 }] };
  const quote = (await call('/api/quotes', quoteInput)).data;
  assert.equal((await call(`/api/quotes/${quote.id}`, { status: 'sent' }, 'admin', 'PUT')).status, 200);
  const conversions = await Promise.all([call(`/api/quotes/${quote.id}/convert`, {}), call(`/api/quotes/${quote.id}/convert`, {})]);
  assert.equal(conversions[0].data.invoice.id, conversions[1].data.invoice.id);
  const tenantQuote = (await call('/api/quotes?tenant=a', quoteInput, 'tenant')).data;
  assert.equal((await call(`/api/quotes/${quote.id}/convert?tenant=a`, {}, 'tenant')).status, 404);
  assert.equal((await call(`/api/quotes/${tenantQuote.id}?tenant=a`, { status: 'sent' }, 'tenant', 'PUT')).status, 200);
  const tenantInvoice = await call(`/api/quotes/${tenantQuote.id}/convert?tenant=a`, {}, 'tenant');
  assert.equal(tenantInvoice.status, 200); assert.equal(tenantInvoice.data.invoice.tenantSlug, 'a');
  assert.equal((await call('/api/expenses?tenant=a', { description: 'Travel', amount: 25, date: '2027-10-01', bookingId: booking.id }, 'tenant')).status, 400);
  assert.equal((await call('/api/expenses?tenant=a', { description: 'Travel', amount: 25, date: '2027-10-01', bookingId: 'tenant-booking' }, 'tenant')).status, 200);
  assert.equal((await call('/api/expenses')).data.length, 0);
  console.log('PASS quote conversion retries and scoped quotes, invoices and expenses');
  const contractForm = new FormData(); contractForm.append('bookingId', 'tenant-booking'); contractForm.append('pdf', new Blob(['%PDF-1.4\nSynthetic contract\n%%EOF'], { type: 'application/pdf' }), 'contract.pdf');
  const contract = await call('/api/contracts?tenant=a', contractForm, 'tenant');
  assert.equal(contract.status, 200, JSON.stringify(contract));
  assert.equal((await call('/api/contracts')).data.length, 0);
  assert.equal((await call(`/api/contracts/${contract.data.id}/send?tenant=a`, {}, 'tenant')).status, 502);
  assert.equal((await call(`/api/contracts/sign/${contract.data.token}`, { signedName: 'Synthetic Client' }, 'public')).status, 200);
  assert.equal((await call(`/api/contracts/${contract.data.id}?tenant=a`, undefined, 'tenant', 'DELETE')).status, 409);
  console.log('PASS scoped contracts, signing, signed-record retention and explicit email failure');
  const payment = { id: crypto.randomUUID(), amount: 40, dueDate: '2027-09-01' };
  assert.equal((await call('/api/bookings/existing/instalments', payment)).status, 201);
  assert.equal((await call('/api/bookings/existing/instalments?tenant=a', payment, 'tenant')).status, 409);
  assert.equal((await call(`/api/instalments/${payment.id}`, { status: 'paid', method: 'bank' }, 'admin', 'PUT')).status, 200);
  const publicSchedule = await call(`/api/booking/${booking.modifyToken}/instalments`, undefined, 'public');
  assert.equal(publicSchedule.data.instalments[0].status, 'paid');
  assert.equal(publicSchedule.data.cardAvailable, false);
  console.log('PASS admin payment schedule, manual settlement and public capability access');
  const image = await require('sharp')({ create: { width: 16, height: 16, channels: 3, background: '#aabbcc' } }).jpeg().toBuffer();
  const upload = () => { const form = new FormData(); form.append('photos', new Blob([image], { type: 'image/jpeg' }), 'capture.jpg'); return call('/api/upload?albumId=capture', form, 'admin', 'POST', { 'X-Capture-Id': 'main:capture:synthetic-original-hash' }); };
  const uploads = await Promise.all([upload(), upload()]); assert.deepEqual(uploads[0].data, uploads[1].data);
  const firstUpload = uploads[0]; assert.equal(firstUpload.status, 200, JSON.stringify(firstUpload));
  assert.deepEqual((await upload()).data, firstUpload.data);
  const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill(); await stopped; await start(); await login();
  assert.equal((await call('/api/enquiries/enquiry/accept', {})).data.booking.id, accepted[0].data.booking.id);
  assert.equal((await call(`/api/quotes/${quote.id}/convert`, {})).data.invoice.id, conversions[0].data.invoice.id);
  assert.deepEqual((await upload()).data, firstUpload.data);
  assert.equal((await call(`/api/booking/${booking.modifyToken}/instalments`, undefined, 'public')).data.instalments[0].status, 'paid');
  console.log('PASS durable booking, conversion, capture receipt and payment state after process restart');
  fs.writeFileSync(path.join(dataDir, 'result.json'), JSON.stringify({ status: 'passed', base }));
  if (process.argv.includes('--serve')) { console.log('PREVIEW ' + base); await new Promise(() => {}); }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { child?.kill(); });
