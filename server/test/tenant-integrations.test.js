"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const stripe = require("stripe")("sk_test_local");
const { registerTenantStripeRoutes, tenantStripeReady } = require("../stripe");
const { buildTenantTransporter, getTenantFromAddress, sendBookingConfirmationEmail, sendBookingUpdateEmail } = require("../email");

test("tenant booking capabilities cannot trigger an admin SMTP confirmation", async t => {
  const app = express();
  app.use(express.json());
  require("../email").registerRoutes(app, { get: () => [{ id: "tenant-booking", tenantSlug: "a", modifyToken: "tenant-capability" }] }, {
    requireAuth: (_req, res) => res.sendStatus(401),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/email/booking-confirmation`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ bookingId: "tenant-booking", modifyToken: "tenant-capability" }),
  });
  assert.equal(response.status, 401);
});

test("tenant email credentials and missing transport never inherit the platform sender", async t => {
  const platform = { EMAIL_FROM: "platform@example.test", EMAIL_SERVER_HOST: "127.0.0.1", EMAIL_SERVER_USER: "platform", EMAIL_SERVER_PASSWORD: "platform-password" };
  const previous = Object.fromEntries(Object.keys(platform).map(key => [key, process.env[key]]));
  Object.assign(process.env, platform);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const a = { smtpHost: "a.invalid", smtpUser: "a@example.test", smtpPassword: "password-a" };
  const b = { smtpHost: "b.invalid", smtpUser: "b@example.test", smtpPassword: "password-b", smtpFrom: "Studio B <b@example.test>" };
  assert.equal(buildTenantTransporter(a).options.auth.user, a.smtpUser);
  assert.equal(buildTenantTransporter(b).options.auth.pass, b.smtpPassword);
  assert.equal(buildTenantTransporter({}), null);
  assert.equal(getTenantFromAddress({}), "");
  assert.equal(getTenantFromAddress(b), b.smtpFrom);
  assert.deepEqual(await sendBookingConfirmationEmail({ transport: null }), { ok: false, reason: "not_configured" });
  assert.deepEqual(await sendBookingUpdateEmail({ transport: null }), { ok: false, reason: "not_configured" });
});

test("two tenants verify only their own Stripe signatures and cannot checkout each other's bookings", async t => {
  const settings = slug => ({ stripeSecretKey: `sk_test_${slug}`, stripeWebhookSecret: `whsec_${slug}`, stripeEnabled: true });
  const db = { t_a_wv_tenant_settings: settings("a"), t_b_wv_tenant_settings: settings("b"), wv_bookings: [{ id: "booking-b", tenantSlug: "b" }] };
  const app = express();
  app.use((req, res, next) => req.path.endsWith("/webhook") ? next() : express.json()(req, res, next));
  registerTenantStripeRoutes(app, {
    readDb: () => structuredClone(db), writeDb: () => { throw new Error("Rejected operations must not write"); },
    readTenants: () => [{ slug: "a" }, { slug: "b" }], requireTenant: (_req, _res, next) => next(),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const payload = JSON.stringify({ id: "evt_local", type: "test.noop", data: { object: {} } });
  const signature = slug => stripe.webhooks.generateTestHeaderString({ payload, secret: `whsec_${slug}` });
  const webhook = (slug, signedBy) => fetch(`${base}/api/tenant/${slug}/stripe/webhook`, {
    method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature(signedBy) }, body: payload,
  });
  const results = await Promise.all([webhook("a", "a"), webhook("b", "b"), webhook("a", "b"), webhook("b", "a")]);
  assert.deepEqual(results.map(response => response.status), [200, 200, 400, 400]);
  const crossBooking = await fetch(`${base}/api/tenant/a/stripe/checkout/booking`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: "booking-b", modifyToken: "known" }),
  });
  assert.equal(crossBooking.status, 404);
  const prior = process.env.ALLOW_UNSIGNED_STRIPE_WEBHOOKS;
  try {
    process.env.ALLOW_UNSIGNED_STRIPE_WEBHOOKS = "true";
    db.t_a_wv_tenant_settings.stripeWebhookSecret = "";
    assert.equal(tenantStripeReady(db.t_a_wv_tenant_settings), false);
    assert.equal((await webhook("a", "a")).status, 503);
  } finally {
    if (prior === undefined) delete process.env.ALLOW_UNSIGNED_STRIPE_WEBHOOKS;
    else process.env.ALLOW_UNSIGNED_STRIPE_WEBHOOKS = prior;
  }
});
