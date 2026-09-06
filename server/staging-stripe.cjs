// Explicit test-only bridge. Keys stay in memory and are never written to logs.
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Stripe = require('stripe');

async function connectTestStripe(base) {
  const route = '/' + crypto.randomBytes(24).toString('hex');
  let resolveKey;
  const received = new Promise(resolve => { resolveKey = resolve; });
  const setup = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'");
    if (req.url !== route) { res.writeHead(404); return res.end(); }
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<h1>Connect isolated Stripe staging</h1><p>Test key only. Kept in memory for this run.</p><form method="POST"><label>Stripe test secret key <input name="key" type="password" autocomplete="off" required></label><button>Connect test mode</button></form>');
    }
    if (req.method !== 'POST' || req.headers.origin !== `http://127.0.0.1:${setup.address().port}`) { res.writeHead(403); return res.end(); }
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      const key = new URLSearchParams(body).get('key')?.trim();
      if (!/^sk_test_[A-Za-z0-9]+$/.test(key || '')) { res.writeHead(400); return res.end('A Stripe test secret key is required. Live keys are rejected.'); }
      res.end('Test connection received. You may close this tab.'); resolveKey(key);
    });
  });
  await new Promise(resolve => setup.listen(0, '127.0.0.1', resolve));
  console.log('Stripe setup: http://127.0.0.1:' + setup.address().port + route);
  const key = await received;
  setup.close();
  const cli = spawn(path.resolve(__dirname, '../artifacts/stripe-cli/stripe.exe'), ['listen', '--events', 'checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed', '--forward-to', base + '/api/stripe/webhook'],
    { windowsHide: true, env: { ...process.env, STRIPE_API_KEY: key }, stdio: ['ignore', 'pipe', 'pipe'] });
  const secret = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Stripe listener did not become ready')), 30000);
    const inspect = bytes => {
      const text = bytes.toString();
      const match = text.match(/whsec_[A-Za-z0-9]+/);
      if (match) { clearTimeout(timeout); resolve(match[0]); }
      if (/checkout\.session|POST.*api\/stripe\/webhook/.test(text)) console.log(text.replace(/whsec_[A-Za-z0-9]+/g, '[REDACTED]'));
    };
    cli.stdout.on('data', inspect); cli.stderr.on('data', inspect);
    cli.on('error', reject);
    cli.on('exit', code => { if (code) reject(new Error('Stripe listener exited')); });
  });
  console.log('Stripe test event forwarding connected.');
  return { env: { STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: secret }, stripe: new Stripe(key), close: () => cli.kill() };
}
module.exports = { connectTestStripe };
