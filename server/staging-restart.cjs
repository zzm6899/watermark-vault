// Verify durable data from a completed staging run using a restarted real server.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { signSession } = require('./security-core');
async function main() {
  const dir = path.resolve(process.argv[2] || '');
  assert.ok(path.basename(dir).startsWith('staging-') && fs.existsSync(path.join(dir, 'results.json')), 'Supply a completed synthetic staging directory');
  const db = new Database(path.join(dir, 'photoflow.sqlite'), { readonly: true });
  const raw = JSON.parse(db.prepare('SELECT value_json FROM app_store WHERE key = ?').get('wv_albums').value_json);
  const albums = typeof raw === 'string' ? JSON.parse(raw) : raw;
  db.close();
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const seed = crypto.randomBytes(48).toString('hex');
  const secret = crypto.createHash('sha256').update(seed).digest('base64url');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|HOME|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key)));
  Object.assign(env, { DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1', APP_BASE_URL: base, APP_HOSTS: '127.0.0.1', PUBLIC_SITE_HOSTS: 'portfolio.invalid', SESSION_SECRET: seed });
  const log = fs.openSync(path.join(dir, 'restart.log'), 'a');
  const child = spawn(process.execPath, ['index.js'], { cwd: __dirname, env, windowsHide: true, stdio: ['ignore', log, log] }); fs.closeSync(log);
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { ready = (await fetch(base + '/api/public-album/staging-proof')).status === 401; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready);
    const proof = await (await fetch(base + '/api/public-album/staging-proof/access', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{}' })).json();
    assert.equal(proof.album.proofingStage, 'selections-submitted');
    assert.ok(proof.album.proofingRounds.some(round => round.submissionId));
    for (const id of ['single-id', 'full-id']) {
      const album = albums.find(a => a.id === id);
      const paid = Object.values(album.sessionPurchases).find(p => p.source === 'stripe' && p.purchaserEmail?.startsWith('stripe-'));
      assert.ok(paid?.purchaserEmailVerified);
      // A fresh test-signed recovery credential isolates durable entitlement from old cookies.
      const token = signSession({ purpose: 'gallery-recovery', albumId: id, tenantSlug: null, email: paid.purchaserEmail }, secret, { ttlSeconds: 60 });
      const response = await fetch(base + `/api/public-album/${album.slug}/recover`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ recoveryToken: token }) });
      assert.equal(response.status, 200);
      const restored = await response.json();
      const purchase = restored.album.sessionPurchases[restored.sessionKey];
      assert.equal(purchase.fullAlbum === true, id === 'full-id');
      if (id === 'single-id') assert.deepEqual(purchase.photoIds, ['one']);
      console.log('PASS restarted server restores paid access for ' + id);
    }
    console.log('PASS proofing receipt survives server restart');
    const resultFile = path.join(dir, 'results.json');
    const result = JSON.parse(fs.readFileSync(resultFile));
    result.checks.push('restarted server retains proofing receipt and actual Stripe purchase entitlements');
    fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
  } finally { child.kill(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
