const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { selectClientPortalAlbumGroups } = require('../security-core');
const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');

function setup() {
  let db = { albums: JSON.stringify([{ id: 'a', slug: 'a', enabled: true, clientEmail: 'alex@example.test' }]) };
  let smtp = 'fail';
  const messages = [];
  const routes = new Map();
  const auth = () => {};
  const transport = { async sendMail(message) { if (smtp === 'fail') throw new Error('secret SMTP password'); messages.push(message); } };
  const context = {
    crypto, Date, DB_KEYS: { PROFILE: 'profile', ALBUMS: 'albums', BOOKINGS: 'bookings' },
    readDb: () => structuredClone(db), writeDb: value => { db = structuredClone(value); },
    dbGet: (value, key, fallback) => value[key] ? JSON.parse(value[key]) : fallback,
    readTenants: () => [], tenantIsLicensed: () => true,
    galleryTimezone: () => 'Australia/Sydney', selectClientPortalAlbumGroups,
    findAlbumBySlugOrId: (value, id) => ({ album: JSON.parse(value.albums).find(album => album.id === id), tenantSlug: null }),
    getTransporter: () => smtp === 'unconfigured' ? null : transport,
    getFromAddress: () => 'studio@example.test',
    buildClientPortalEmail: value => ({ html: JSON.stringify(value) }),
    clientPortalGalleryLink: (_base, album) => `fresh:${album.id}`,
    galleryRecoveryLink: (_base, album) => `fresh-purchase:${album.id}`,
    safeCheckoutReturnUrl: () => 'https://studio.example.test/',
    withCheckoutResourceLock: async (_key, run) => run(),
    superLimiter: () => {}, requireAuth: auth,
    app: { get: (path, ...handlers) => routes.set(path, handlers), post: (path, ...handlers) => routes.set(path, handlers) },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function clientPortalGroups('), source.indexOf('app.post("/api/client-portal/request"')), context);
  return { context, routes, auth, messages, setSmtp: value => { smtp = value; }, getDb: () => db, setDb: value => { db = value; }, failures: () => JSON.parse(db.wv_client_portal_failures || '[]') };
}
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, setHeader() {} }; }

test('delivery failures persist privately, redact SMTP details and clear after success', async () => {
  const fixture = setup();
  const args = { email: 'alex@example.test', groups: [{ tenantSlug: null, albums: [{ id: 'a' }] }], db: fixture.getDb(), tenants: [], trustedBaseUrl: 'https://studio.example.test/' };
  assert.equal((await fixture.context.sendClientPortalAlbumGroups(args)).failed, 1);
  assert.equal(fixture.failures()[0].attempts, 1);
  assert.equal(fixture.failures()[0].errorCode, 'DELIVERY_FAILED');
  assert.doesNotMatch(JSON.stringify(fixture.failures()), /password|fresh:/);
  fixture.setSmtp('unconfigured');
  await fixture.context.sendClientPortalAlbumGroups(args);
  assert.equal(fixture.failures()[0].attempts, 2);
  assert.equal(fixture.failures()[0].errorCode, 'EMAIL_NOT_CONFIGURED');
  fixture.setSmtp('ok');
  await fixture.context.sendClientPortalAlbumGroups(args);
  assert.equal(fixture.messages.length, 1);
  assert.deepEqual(fixture.failures(), []);
});

test('admin retry requires authentication and rechecks current recipient access', async () => {
  const fixture = setup();
  const route = fixture.routes.get('/api/admin/client-portal/failures/:id/retry');
  assert.ok(route.includes(fixture.auth));
  assert.ok(fixture.routes.get('/api/admin/client-portal/failures').includes(fixture.auth));
  fixture.context.recordClientPortalDelivery('alex@example.test', { tenantSlug: null, albums: [{ id: 'a' }] }, 'DELIVERY_FAILED');
  const id = fixture.failures()[0].id;
  fixture.setSmtp('ok');
  const db = fixture.getDb();
  db.albums = JSON.stringify([{ id: 'a', slug: 'a', enabled: true, clientEmail: 'someone-else@example.test' }]);
  fixture.setDb(db);
  const rejected = response();
  await route.at(-1)({ params: { id } }, rejected);
  assert.equal(rejected.statusCode, 409);
  assert.equal(fixture.messages.length, 0);
  db.albums = JSON.stringify([{ id: 'a', slug: 'a', enabled: true, clientEmail: 'alex@example.test' }]);
  fixture.setDb(db);
  const accepted = response();
  await route.at(-1)({ params: { id } }, accepted);
  assert.equal(accepted.statusCode, 200);
  assert.equal(fixture.messages[0].to, 'alex@example.test');
  assert.match(fixture.messages[0].html, /fresh:a/);
  assert.equal(fixture.failures().length, 0);
});

test('repeating an invoice creation returns the saved invoice without overwriting a payment', async () => {
  let handler;
  let db = { invoices: '[]' };
  const context = {
    app: { post: (_route, ...handlers) => { handler = handlers.at(-1); } }, superLimiter() {}, requireAuth() {}, authenticatedLargeJson() {},
    validInvoiceInput: value => !!value.id,
    withCheckoutResourceLock: async (_key, run) => run(),
    readDb: () => db, writeDb: value => { db = value; },
    DB_KEYS: { INVOICES: 'invoices' }, getStoredArray: (value, key) => JSON.parse(value[key]),
    allocateInvoiceNumber: () => 'INV-0002',
  };
  const start = source.indexOf('app.post("/api/admin/invoices"');
  vm.runInNewContext(source.slice(start, source.indexOf('app.put("/api/admin/invoices/:id"', start)), context);
  const invoice = { id: 'invoice', shareToken: 'capability', status: 'draft' };
  await handler({ body: { invoice } }, response());
  db.invoices = JSON.stringify(JSON.parse(db.invoices).map(item => ({ ...item, status: 'paid' })));
  const replay = response();
  await handler({ body: { invoice } }, replay);
  assert.equal(JSON.parse(db.invoices).length, 1);
  assert.equal(replay.body.invoice.status, 'paid');
  const conflict = response();
  await handler({ body: { invoice: { ...invoice, shareToken: 'different' } } }, conflict);
  assert.equal(conflict.statusCode, 409);
});
