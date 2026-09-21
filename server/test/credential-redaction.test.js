const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
const DB_KEYS = { ADMIN: 'wv_admin', SETTINGS: 'wv_settings', PORTFOLIO_SETTINGS: 'wv_portfolio_settings', PORTFOLIO_DRAFT: 'wv_portfolio_draft', PORTFOLIO_PUBLISHED: 'wv_portfolio_published' };
const fields = ['stripeSecretKey', 'stripeWebhookSecret', 'smtpPassword', 'googleApiCredentials', 'discordWebhookUrl', 'ftpPassword'];

test('store responses omit global and tenant OAuth tokens and redact stored credentials', () => {
  const ctx = vm.createContext({ DB_KEYS, stripBakedFields: (_key, value) => value, GLOBAL_FTP_SECRET_FIELDS: ['ftpPassword'], TENANT_SECRET_FIELDS: fields });
  vm.runInContext(source.slice(source.indexOf('const STORE_OMITTED_SECRET_KEYS'), source.indexOf('app.get("/api/store",')), ctx);
  for (const prefix of ['', 't_studio_', 't_studio_with_underscores_']) {
    for (const key of ['wv_gcal_tokens', 'wv_google_sheets_tokens', 'wv_oauth_tokens']) {
      assert.equal(ctx.safeStoreResponseValue(prefix + key, { access_token: 'SECRET', refresh_token: 'SECRET' }), undefined);
    }
  }
  for (const key of ['wv_settings', 't_studio_wv_tenant_settings', 'wv_ftp_settings', ...Object.values(DB_KEYS).filter(key => key.includes('portfolio'))]) {
    const secretFields = key.includes('portfolio') ? ['webhookUrl'] : key === 'wv_ftp_settings' ? ['ftpPassword'] : fields;
    const value = Object.fromEntries(secretFields.map(field => [field, 'SECRET']));
    for (const input of [value, JSON.stringify(value)]) {
      const output = ctx.safeStoreResponseValue(key, input);
      assert.ok(!JSON.stringify(output).includes('SECRET'), key);
      const decoded = typeof output === 'string' ? JSON.parse(output) : output;
      for (const field of secretFields) assert.equal(decoded[field + 'Set'], true);
    }
  }
  assert.equal(ctx.mergePreservingStoreSecrets('wv_portfolio_settings', { webhookUrl: 'SECRET' }, { webhookUrlSet: true }).webhookUrl, 'SECRET');
});

test('portfolio editor never receives saved webhook and unrelated draft saves preserve it', () => {
  const routes = new Map();
  let db = { wv_portfolio_settings: { webhookUrl: 'SECRET' } };
  const auth = () => {};
  const ctx = vm.createContext({ DB_KEYS, DEFAULT_PORTFOLIO: {}, requireAuth: auth, readDb: () => db, writeDb: value => { db = value; }, dbGet: (db, key, fallback) => db[key] || fallback, publicPortfolioContent: ({ webhookUrl, webhookUrlSet, ...rest }) => rest, app: { get: (path, ...handlers) => routes.set(path, handlers), put: (path, ...handlers) => routes.set(path, handlers), post: () => {} } });
  vm.runInContext(source.slice(source.indexOf('app.get("/api/admin/portfolio",'), source.indexOf('const portfolioUpload =')), ctx);
  const response = { json(body) { this.body = body; }, status(code) { this.statusCode = code; return this; } };
  const get = routes.get('/api/admin/portfolio');
  const put = routes.get('/api/admin/portfolio/draft');
  assert.equal(get[0], auth); assert.equal(put[0], auth);
  get.at(-1)({}, response);
  assert.equal(response.body.draft.webhookUrlSet, true);
  assert.ok(!JSON.stringify(response.body).includes('SECRET'));
  put.at(-1)({ body: { draft: { title: 'Changed' } } }, response);
  assert.equal(db.wv_portfolio_settings.webhookUrl, 'SECRET');
  put.at(-1)({ body: { draft: { webhookUrl: 'https://discord.com/api/webhooks/123/replacement' } } }, response);
  assert.ok(db.wv_portfolio_settings.webhookUrl.endsWith('/replacement'));
  put.at(-1)({ body: { draft: { webhookUrl: '' } } }, response);
  assert.equal(db.wv_portfolio_settings.webhookUrl, '');
});

test('saved webhook test uses the server credential and does not echo provider errors', async () => {
  let handler;
  let sentTo;
  const start = source.indexOf('app.post("/api/admin/portfolio/webhook/test",');
  const end = source.indexOf('\n});', start) + 4;
  vm.runInNewContext(source.slice(start, end), {
    DB_KEYS, requireAuth: () => {}, readDb: () => ({}), dbGet: () => ({ webhookUrl: 'https://discord.com/api/webhooks/123/PRIVATE' }),
    app: { post: (_path, _auth, fn) => { handler = fn; } },
    sendDiscordEmbed: async url => { sentTo = url; throw new Error('PRIVATE'); },
  });
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  await handler({ body: {} }, res);
  assert.ok(sentTo.endsWith('/PRIVATE'));
  assert.equal(res.statusCode, 502);
  assert.ok(!JSON.stringify(res.body).includes('PRIVATE'));
});
