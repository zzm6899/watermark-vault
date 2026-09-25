const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
const dbGet = (db, key, fallback) => typeof db[key] === 'string' ? JSON.parse(db[key]) : db[key] || fallback;

test('admin SMTP automations exclude tenant bookings from the shared booking store', () => {
  const bookings = [{ id: 'main' }, { id: 'a', tenantSlug: 'a' }, { id: 'b', tenantSlug: 'b' }];
  let raw = bookings;
  const code = source.slice(source.indexOf('function readAutomationBookings('), source.indexOf('function buildAutomationPreview('));
  const read = vm.runInNewContext(code + ';readAutomationBookings', { readDb: () => ({ wv_bookings: raw }) });
  assert.deepEqual(Array.from(read(), booking => booking.id), ['main']);
  raw = JSON.stringify(bookings);
  assert.deepEqual(Array.from(read(), booking => booking.id), ['main']);
});

test('admin Google credentials cannot sync or persist tenant booking events', async () => {
  const calendarSource = fs.readFileSync(require.resolve('../google-calendar.js'), 'utf8');
  const db = { wv_bookings: [{ id: 'main' }, { id: 'tenant', tenantSlug: 'a' }] };
  const code = calendarSource.slice(calendarSource.indexOf('function mainBookings()'), calendarSource.indexOf('// ── Event builder'));
  const context = { sharedReadDb: () => db, sharedWriteDb: () => { throw new Error('Tenant record must not change'); }, console };
  vm.createContext(context);
  vm.runInContext(code, context);
  assert.deepEqual(Array.from(context.mainBookings(), booking => booking.id), ['main']);
  context.saveGcalEventId('tenant', 'admin-event', 'admin-calendar');
  assert.equal(db.wv_bookings[1].gcalEventId, undefined);
  let handler;
  const start = calendarSource.indexOf('  app.post("/api/integrations/googlecalendar/event"');
  const end = calendarSource.indexOf('// ── PUSH: Update existing event', start);
  vm.runInNewContext(calendarSource.slice(start, end), {
    app: { post: (_path, _auth, fn) => { handler = fn; } }, requireAuth: {},
    getAuthenticatedClient: () => ({}), mainBookings: context.mainBookings,
    google: { calendar: () => { throw new Error('Tenant must not contact admin Google'); } },
  });
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ body: { booking: { id: 'tenant' } } }, res);
  assert.equal(res.statusCode, 400);
});

test('admin iCal feed excludes bookings from every tenant', () => {
  const start = source.indexOf('app.get("/api/ical/:token"');
  const end = source.indexOf('// Generate / rotate ical token', start);
  let handler;
  const db = { wv_settings: { icalToken: 'admin-token' }, wv_profile: { name: 'Main' }, wv_bookings: [
    { id: 'main' }, { id: 'studio-a', tenantSlug: 'a' }, { id: 'studio-b', tenantSlug: 'b' },
  ] };
  vm.runInNewContext(source.slice(start, end), {
    app: { get: (_route, fn) => { handler = fn; } }, readDb: () => db,
    buildIcalFeed: bookings => bookings.map(booking => booking.id).join(','),
  });
  let sent;
  handler({ params: { token: 'admin-token' } }, { setHeader() {}, send(value) { sent = value; } });
  assert.equal(sent, 'main');
});

test('event description media only accepts images owned by its studio', () => {
  const start = source.indexOf('function eventDescriptionImagesBelongToScope(');
  const end = source.indexOf('// ── Lightroom Classic integration', start);
  const check = vm.runInNewContext(source.slice(start, end) + ';eventDescriptionImagesBelongToScope', { dbGet });
  const a = '/event-media/a/event-0123456789abcdef01234567.jpg';
  const b = '/event-media/b/event-0123456789abcdef01234568.jpg';
  const db = { wv_upload_owners: {
    'event-0123456789abcdef01234567.jpg': { tenantSlug: 'a' },
    'event-0123456789abcdef01234568.jpg': { tenantSlug: 'b' },
  } };
  assert.equal(check(db, [a], 'a'), true);
  assert.equal(check(db, [b], 'a'), false);
  assert.equal(check(db, [a, a, a, a], 'a'), false);
  assert.equal(check(db, ['/event-media/main/event-0123456789abcdef01234567.jpg'], 'a'), false);
});

test('a tenant event image upload respects the same storage limit as gallery uploads', () => {
  const start = source.indexOf('function checkTenantUploadLimit(');
  const end = source.indexOf('app.post("/api/upload"', start);
  let discarded = false;
  const check = vm.runInNewContext(source.slice(start, end) + ';checkTenantUploadLimit', {
    SLUG_RE: /^[a-z0-9-]+$/,
    fs: { unlinkSync() { discarded = true; } },
    tenantStorageLimitForSlug: () => 100,
    tenantStorageUsage: () => ({ totalBytes: 90 }),
    readDb: () => ({}), UPLOADS_DIR: '/uploads', tenantUploadReservations: new Map(),
  });
  let status;
  check({ query: { tenant: 'a' }, file: { path: '/uploads/event.jpg', size: 20 } }, {
    status(code) { status = code; return this; }, json() {},
  }, () => { throw new Error('Upload must be rejected'); });
  assert.equal(status, 413);
  assert.equal(discarded, true);
});

test('tenant watermarks never inherit another studio or admin watermark', () => {
  const db = { wv_settings: { watermarkText: 'ADMIN', watermarkImage: 'private-admin-image', watermarkOpacity: 90 }, t_a_wv_tenant_settings: { watermarkText: 'Studio A' }, t_b_wv_tenant_settings: { watermarkText: 'Studio B', watermarkOpacity: 0 } };
  const code = source.slice(source.indexOf('function getWatermarkSettings('), source.indexOf('async function buildWatermarkOverlay'));
  const resolve = vm.runInNewContext(code + ';getWatermarkSettings', { readDb: () => db, dbGet });
  assert.equal(resolve('a').text, 'Studio A');
  assert.equal(resolve('a').opacity, .2);
  assert.equal(resolve('a').imageBase64, null);
  assert.equal(resolve('b').text, 'Studio B');
  assert.equal(resolve('b').opacity, 0);
  assert.equal(resolve('missing').imageBase64, null);
  assert.equal(resolve(null).text, 'ADMIN');
});

test('concurrent uploads merge after asynchronous FTP without losing another tenant write', async () => {
  let db = { t_a_wv_tenant_settings: { ftpEnabled: true, ftpHost: 'ftp.test' }, wv_upload_owners: {} };
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const start = source.indexOf('  // ── FTP Upload (if enabled)');
  const end = source.indexOf('  if (req.query.autoEdit', start);
  const upload = vm.runInNewContext('(async function(req, uploadedFiles, res) { const ignoredUploadFiles = []; const rejectedInvalidCount = 0; ' + source.slice(start, end) + '})', {
    readDb: () => structuredClone(db), writeDb: next => { db = structuredClone(next); }, dbGet, path, console,
    uploadFilesToFtp: async () => { await gate; return { ok: true }; },
    _appendUploadedFilesToAlbum: (snapshot, tenant, id, files) => { snapshot['album_' + tenant] = files; return { ok: true }; },
    detectUploadSequenceGaps: () => [],
  });
  const a = upload({ query: { tenant: 'a', albumId: 'album-a' } }, [{ url: '/uploads/a.jpg' }], { json() {} });
  await upload({ query: { tenant: 'b', albumId: 'album-b' } }, [{ url: '/uploads/b.jpg' }], { json() {} });
  db.newerSettings = 'preserve';
  release(); await a;
  assert.equal(db.wv_upload_owners['a.jpg'].tenantSlug, 'a');
  assert.equal(db.wv_upload_owners['b.jpg'].tenantSlug, 'b');
  assert.equal(db.album_a.length, 1); assert.equal(db.album_b.length, 1);
  assert.equal(db.newerSettings, 'preserve');
});

test('Website Studio endpoints require admin authentication, not a tenant session', async () => {
  const code = source.slice(source.indexOf('async function requireAuth('), source.indexOf('// Bookings must never', source.indexOf('async function requireAuth(')));
  let isAdmin = false;
  const auth = vm.runInNewContext(code + ';requireAuth', { authenticatedAdminUsername: async () => isAdmin ? 'admin' : null });
  let status; let allowed = false;
  const req = { authContext: { type: 'tenant', slug: 'a' } };
  const res = { status(value) { status = value; return this; }, json() {} };
  await auth(req, res, () => { allowed = true; });
  assert.equal(status, 401); assert.equal(allowed, false);
  isAdmin = true; await auth(req, res, () => { allowed = true; });
  assert.equal(allowed, true);
  const routes = source.split('\n').filter(line => /app\.(get|put|post|delete)\("\/api\/admin\/portfolio/.test(line));
  assert.ok(routes.length >= 4);
  for (const route of routes) assert.match(route, /requireAuth/);
});

test('tenant calendar sync rejects a different tenant booking before contacting Google', async () => {
  const start = source.indexOf('  app.post("/api/tenant/:slug/integrations/googlecalendar/event"');
  const end = source.indexOf('\n})();', start);
  let handler; let googleCalls = 0;
  vm.runInNewContext(source.slice(start, end), {
    app: { post: (_path, _limit, _auth, fn) => { handler = fn; } }, tenantLimiter: {}, requireTenant: {},
    getAuthenticatedTenantClient: () => ({}), readDb: () => ({}), DB_KEYS: { BOOKINGS: 'wv_bookings' },
    getStoredArray: () => [{ id: 'booking-b', tenantSlug: 'b' }, { id: 'booking-admin' }],
    google: { calendar: () => { googleCalls++; } },
  });
  for (const id of ['booking-b', 'booking-admin', 'missing']) {
    let status;
    await handler({ params: { slug: 'a' }, body: { booking: { id, tenantSlug: 'a' } } }, { status(code) { status = code; return this; }, json() {} });
    assert.equal(status, 404);
  }
  assert.equal(googleCalls, 0);
});

test('culling keeps concurrent uploads, edits and deletions and ignores replaced images', () => {
  const { mergeCullPhotos } = require('../cull-merge');
  const current = [{ id: 'a', src: 'a.jpg', title: 'Edited', starred: true }, { id: 'new', src: 'new.jpg' }, { id: 'replaced', src: 'replacement.jpg' }];
  const result = mergeCullPhotos(current, [{ id: 'a', src: 'a.jpg', title: 'Old', cull: { status: 'pick' } }, { id: 'deleted', src: 'deleted.jpg' }, { id: 'replaced', src: 'old.jpg', cull: { status: 'reject' } }]);
  assert.deepEqual(result.map(photo => photo.id), ['a', 'new', 'replaced']);
  assert.equal(result[0].title, 'Edited'); assert.equal(result[0].starred, true);
  assert.equal(result[0].cull.status, 'pick'); assert.equal(result[2].cull, undefined);
});

test('automatic editing preserves concurrent tenant writes and records derived file ownership', async () => {
  let db = { t_a_wv_albums: [{ id: 'album', title: 'Old', photos: [{ id: 'photo', src: '/uploads/photo.jpg', title: 'Old photo' }] }] };
  let release; const gate = new Promise(resolve => { release = resolve; });
  const start = source.indexOf('async function autoEditAlbumUploads(');
  const end = source.indexOf('\napp.get(', start);
  const edit = vm.runInNewContext(source.slice(start, end) + ';autoEditAlbumUploads', {
    readDb: () => structuredClone(db), writeDb: value => { db = structuredClone(value); }, dbGet,
    _parseAlbumsFromDb: raw => typeof raw === 'string' ? JSON.parse(raw) : raw || [], ALBUMS_KEY: 'wv_albums',
    tenantStorageLimitForSlug: () => null,
    fs: { existsSync: () => true }, computeAdobeAutoParams: async () => ({}),
    applyEditParams: async () => { await gate; }, path, UPLOADS_DIR: '/uploads', console,
  });
  const pending = edit({ albumId: 'album', tenantSlug: 'a', uploadedFiles: [{ id: 'photo', localPath: '/uploads/photo.jpg' }] });
  await Promise.resolve();
  db.t_a_wv_albums[0].title = 'Updated';
  db.t_a_wv_albums[0].photos[0].title = 'Updated photo';
  db.t_a_wv_albums[0].photos.push({ id: 'new', src: '/uploads/new.jpg' });
  db.t_b_wv_albums = [{ id: 'b' }];
  release(); await pending;
  const updated = dbGet(db, 't_a_wv_albums', [])[0];
  assert.equal(updated.title, 'Updated'); assert.equal(updated.photos.length, 2);
  assert.equal(updated.photos[0].title, 'Updated photo');
  assert.equal(updated.photos[0].src, '/uploads/photo-auto.jpg');
  assert.equal(db.wv_upload_owners['photo-auto.jpg'].tenantSlug, 'a');
  assert.equal(db.t_b_wv_albums[0].id, 'b');
});

test('password hashing cannot overwrite a concurrent tenant profile change', async () => {
  let tenants = [{ slug: 'a', displayName: 'A' }, { slug: 'b', displayName: 'B' }];
  let release; const gate = new Promise(resolve => { release = resolve; });
  const start = source.indexOf('app.put("/api/tenant/:slug/profile"');
  const end = source.indexOf('\n});', start) + 4;
  let handler;
  vm.runInNewContext(source.slice(start, end), { app: { put: (_route, _limit, _auth, fn) => { handler = fn; } }, tenantLimiter: {}, requireTenant: {},
    readTenants: () => structuredClone(tenants), writeTenants: value => { tenants = structuredClone(value); },
    bcryptHash: async () => { await gate; return 'new-hash'; }, signSession: () => 'session', credentialVersion: () => 'v', SESSION_SECRET: 'test', TENANT_SESSION_TTL_SECONDS: 10, TENANT_SESSION_COOKIE: 'tenant',
    setHttpOnlyCookie() {}, safeTenantPrivateDto: value => value, isExplicitNativeOrigin: () => false, NATIVE_APP_ORIGINS: [],
  });
  const pending = handler({ params: { slug: 'a' }, body: { passwordHash: 'x'.repeat(64) }, headers: {} }, { json() {}, status() { return this; } });
  tenants[1].displayName = 'B updated'; release(); await pending;
  assert.equal(tenants[0].passwordHash, 'new-hash'); assert.equal(tenants[1].displayName, 'B updated');
});
