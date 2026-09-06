/* Run after npm run build. Synthetic data, loopback SMTP capture, no Stripe keys. */
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const Database = require('better-sqlite3');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
const dataDir = fs.mkdtempSync(path.join(root, 'artifacts', 'staging-'));
const messages = [];
const checks = [];
let child;
let stripeConnection;
let base;
const smtp = net.createServer(socket => {
  socket.setEncoding('utf8');
  socket.write('220 local-staging ESMTP\r\n');
  let buffer = '', data = false, lines = [];
  socket.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\r\n')) {
      const split = buffer.indexOf('\r\n');
      const line = buffer.slice(0, split); buffer = buffer.slice(split + 2);
      if (data) {
        if (line === '.') {
          messages.push(lines.join('\r\n'));
          fs.writeFileSync(path.join(dataDir, `email-${messages.length}.eml`), messages.at(-1));
          lines = []; data = false; socket.write('250 captured locally\r\n');
        } else lines.push(line);
      } else if (/^EHLO|^HELO/i.test(line)) socket.write('250-local-staging\r\n250 AUTH PLAIN\r\n');
      else if (/^AUTH/i.test(line)) socket.write('235 authenticated\r\n');
      else if (/^DATA/i.test(line)) { data = true; socket.write('354 end with dot\r\n'); }
      else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n');
      else socket.write('250 OK\r\n');
    }
  });
  socket.on('error', () => {});
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, attempts = 100) {
  for (let i = 0; i < attempts; i++) { const value = await fn(); if (value) return value; await pause(100); }
  throw new Error('Timed out waiting for staging result');
}
function client() {
  let cookie = '';
  return async (url, body) => {
    const res = await fetch(base + url, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.headers.getSetCookie().length) cookie = res.headers.getSetCookie().map(s => s.split(';')[0]).join('; ');
    const bytes = Buffer.from(await res.arrayBuffer());
    let value; try { value = JSON.parse(bytes); } catch { value = bytes; }
    return { status: res.status, value, bytes };
  };
}
function ok(name) { checks.push(name); console.log('PASS ' + name); }
async function main() {
  fs.mkdirSync(path.join(dataDir, 'uploads'));
  for (const id of ['one', 'two']) await sharp({ create: { width: 640, height: 480, channels: 3, background: id === 'one' ? '#608ca4' : '#d6ad84' } }).jpeg().toFile(path.join(dataDir, 'uploads', id + '.jpg'));
  const photos = ['one', 'two'].map(id => ({ id, filename: id + '.jpg', src: '/uploads/' + id + '.jpg', width: 640, height: 480 }));
  const common = { enabled: true, photos, pricePerPhoto: 5, priceFullAlbum: 8, freeDownloads: 0 };
  const paid = email => ({ purchaserEmail: email, purchaserEmailVerified: true, source: 'stripe', paidAt: new Date().toISOString() });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    wv_profile: { businessName: 'STAGING ONLY', email: 'photographer@example.test' },
    wv_albums: [
      { ...common, id: 'proof-id', slug: 'staging-proof', title: 'Staging proofing', proofingEnabled: true, proofingStage: 'proofing', lockDownloadsDuringProofing: true, proofingRounds: [{ roundNumber: 1, sentAt: '2026-09-06T00:00:00Z' }] },
      { ...common, id: 'single-id', slug: 'staging-single', title: 'Staging individual purchase', sessionPurchases: { fixture: { ...paid('single@example.test'), photoIds: ['one'] } } },
      { ...common, id: 'full-id', slug: 'staging-album', title: 'Staging full album', sessionPurchases: { fixture: { ...paid('album@example.test'), fullAlbum: true, photoIds: [] } } },
    ],
  }));
  await new Promise(resolve => smtp.listen(0, '127.0.0.1', resolve));
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); base = `http://127.0.0.1:${port}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|HOME|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key)));
  Object.assign(env, { PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, APP_BASE_URL: base, APP_HOSTS: '127.0.0.1', PUBLIC_SITE_HOSTS: 'portfolio.invalid',
    SESSION_SECRET: crypto.randomBytes(48).toString('hex'), SUPER_ADMIN_USERNAME: 'staging-admin', SUPER_ADMIN_PASSWORD: crypto.randomBytes(24).toString('hex'),
    EMAIL_SERVER_HOST: '127.0.0.1', EMAIL_SERVER_PORT: String(smtp.address().port), EMAIL_SERVER_USER: 'staging', EMAIL_SERVER_PASSWORD: 'local-only', EMAIL_FROM: 'staging@example.test', EMAIL_NOTIFY_TO: 'photographer@example.test' });
  if (process.argv.includes('--stripe')) {
    stripeConnection = await require('./staging-stripe.cjs').connectTestStripe(base);
    Object.assign(env, stripeConnection.env);
  }
  const log = fs.openSync(path.join(dataDir, 'server.log'), 'a');
  child = spawn(process.execPath, ['index.js'], { cwd: __dirname, env, windowsHide: true, stdio: ['ignore', log, log] });
  fs.closeSync(log);
  await until(async () => { try { return (await fetch(base + '/api/public-album/staging-proof')).status === 401; } catch { return false; } }, 600);
  const a = client();
  assert.equal((await a('/gallery/staging-proof')).status, 200); ok('built gallery served by real staging server');
  assert.equal((await a('/api/proofing/submit', { albumId: 'proof-id', selectedPhotoIds: ['one'] })).status, 401); ok('proofing rejects unauthenticated submission');
  const access = await a('/api/public-album/staging-proof/access', {}); assert.equal(access.status, 200); assert.ok(access.value.sessionKey);
  const submission = { albumId: 'proof-id', selectedPhotoIds: ['one'], clientNote: 'Staging retouch request', submissionId: crypto.randomUUID(), roundNumber: 1, roundSentAt: '2026-09-06T00:00:00Z' };
  const submitted = await a('/api/proofing/submit', submission); assert.equal(submitted.status, 200); assert.equal(submitted.value.receipt.selectedCount, 1);
  const database = new Database(path.join(dataDir, 'photoflow.sqlite'), { readonly: true });
  const readValue = key => {
    const raw = database.prepare('SELECT value_json FROM app_store WHERE key = ?').get(key)?.value_json;
    const value = raw ? JSON.parse(raw) : null; return typeof value === 'string' ? JSON.parse(value) : value;
  };
  assert.equal(readValue('wv_proofing_notifications')[submission.submissionId].albumId, 'proof-id');
  ok('receipt committed to SQLite before HTTP success response');
  const retry = await a('/api/proofing/submit', submission); assert.equal(retry.value.replayed, true); assert.deepEqual(retry.value.receipt, submitted.value.receipt); ok('slug access, canonical submission, and lost-response retry');
  await until(() => messages.length === 1); ok('proofing notification delivered to local SMTP inbox');
  await until(() => readValue('wv_proofing_notifications')[submission.submissionId]?.status === 'sent');
  assert.equal(Object.keys(readValue('wv_proofing_notifications')).length, 1); ok('submission receipt and sent status persisted once in SQLite');
  database.close();
  for (const [slug, id, email, full] of [['staging-single', 'single-id', 'single@example.test', false], ['staging-album', 'full-id', 'album@example.test', true]]) {
    const fresh = client();
    const opened = await fresh(`/api/public-album/${slug}/access`, {}); assert.equal(opened.status, 200);
    assert.equal((await fresh('/api/album/register-purchaser', { albumId: id, email })).status, 200);
    assert.equal((await fresh('/api/photo/one.jpg/original/access', { albumId: id })).status, 403); ok(`${slug}: typing email alone does not grant downloads`);
    const count = messages.length;
    assert.equal((await fresh('/api/client-portal/request', { albumId: id, email })).status, 202);
    await until(() => messages.length > count);
    const raw = messages.at(-1).replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    const match = raw.match(/#recovery=([^\s"<>]+)/); assert.ok(match, 'recovery link in captured email');
    const recovered = client();
    const restored = await recovered(`/api/public-album/${slug}/recover`, { recoveryToken: decodeURIComponent(match[1]) });
    assert.equal(restored.status, 200); assert.equal(restored.value.recoveredEmail, email);
    const entitlement = restored.value.album.sessionPurchases[restored.value.sessionKey];
    assert.equal(entitlement.fullAlbum === true, full); if (!full) assert.deepEqual(entitlement.photoIds, ['one']);
    const image = await recovered('/api/photo/one.jpg/original/access', { albumId: id }); assert.equal(image.status, 200); assert.deepEqual(image.bytes, fs.readFileSync(path.join(dataDir, 'uploads/one.jpg')));
    assert.equal((await recovered('/api/photo/two.jpg/original/access', { albumId: id })).status, full ? 200 : 403);
    const zip = await recovered('/api/download/zip/start', { albumId: id, files: [{ filename: 'one.jpg', clean: true }, { filename: 'two.jpg', clean: true }] });
    assert.equal(zip.status, 202); assert.equal(zip.value.total, full ? 2 : 1);
    const jobId = zip.value.id || zip.value.jobId;
    await until(async () => (await recovered(`/api/download/zip/${jobId}/status`)).value.status === 'done');
    const archive = await recovered(`/api/download/zip/${jobId}/file`); assert.equal(archive.status, 200); assert.equal(archive.bytes.subarray(0, 2).toString(), 'PK');
    ok(`${slug}: ZIP contains only entitled photos`);
    assert.equal((await recovered('/api/album/register-purchaser', { albumId: id, email: 'different@example.test' })).value.email, email);
    assert.equal((await client()(`/api/public-album/${slug}/recover`, { recoveryToken: match[1] + 'tampered' })).status, 401);
    ok(`${slug}: emailed link restores exact purchases in new session; clean originals; tampering rejected`);
  }
  if (stripeConnection) {
    for (const [slug, id, full] of [['staging-single', 'single-id', false], ['staging-album', 'full-id', true]]) {
      const buyer = client();
      const email = `stripe-${full ? 'album' : 'single'}-${Date.now()}@example.test`;
      const access = await buyer(`/api/public-album/${slug}/access`, {});
      const request = { albumId: id, clientEmail: email, photoIds: full ? [] : ['one'], isFullAlbum: full };
      const checkout = await buyer('/api/stripe/checkout/album', request);
      assert.equal(checkout.status, 200, JSON.stringify(checkout.value));
      assert.ok(checkout.value.sessionId.startsWith('cs_test_'));
      const duplicate = await buyer('/api/stripe/checkout/album', request);
      assert.equal(duplicate.value.sessionId, checkout.value.sessionId);
      ok(`${slug}: repeated checkout request reuses Stripe test session`);
      console.log('Complete Stripe test checkout: ' + checkout.value.url);
      fs.writeFileSync(path.join(dataDir, 'checkout.json'), JSON.stringify({ url: checkout.value.url, sessionId: checkout.value.sessionId, full, email }, null, 2));
      await until(async () => {
        const response = await buyer(`/api/public-album/${slug}`);
        const purchase = response.value.album?.sessionPurchases?.[access.value.sessionKey];
        return full ? purchase?.fullAlbum : purchase?.photoIds?.includes('one');
      }, 18000);
      const session = await stripeConnection.stripe.checkout.sessions.retrieve(checkout.value.sessionId);
      assert.equal(session.livemode, false); assert.equal(session.payment_status, 'paid');
      assert.equal(session.amount_total, full ? 800 : 500);
      assert.equal((await buyer('/api/stripe/checkout/album', request)).status, 400);
      ok(`${slug}: genuine test payment fulfilled by forwarded signed Stripe event; repeat purchase blocked`);
      const count = messages.length;
      await buyer('/api/client-portal/request', { albumId: id, email });
      await until(() => messages.length > count);
      const decoded = messages.at(-1).replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      const token = decoded.match(/#recovery=([^\s"<>]+)/)?.[1]; assert.ok(token);
      const restoredBuyer = client();
      const restored = await restoredBuyer(`/api/public-album/${slug}/recover`, { recoveryToken: decodeURIComponent(token) });
      assert.equal(restored.status, 200); assert.equal(restored.value.recoveredEmail, email);
      assert.equal((await restoredBuyer('/api/photo/one.jpg/original/access', { albumId: id })).status, 200);
      assert.equal((await restoredBuyer('/api/photo/two.jpg/original/access', { albumId: id })).status, full ? 200 : 403);
      assert.equal((await restoredBuyer('/api/stripe/checkout/album', request)).status, 400);
      ok(`${slug}: actual Stripe purchaser email saved; new-session recovery and duplicate-payment prevention passed`);
    }
  }
  fs.writeFileSync(path.join(dataDir, 'results.json'), JSON.stringify({ base, checks, paymentCoverage: stripeConnection ? 'Real Stripe test-mode hosted payments and CLI-forwarded signed webhooks. Local captured email.' : 'Seeded purchase fixtures only. No Stripe checkout or remote SMTP delivery tested.', dataDir }, null, 2));
  console.log('Results: ' + path.join(dataDir, 'results.json'));
  if (process.argv.includes('--serve')) { console.log('Staging preview: ' + base + '/gallery/staging-proof'); await new Promise(() => {}); }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { child?.kill(); stripeConnection?.close(); smtp.close(); });
