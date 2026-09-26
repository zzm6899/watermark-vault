const crypto = require("node:crypto");
const stripe = require("stripe");
const read = (db, key, fallback = []) => typeof db[key] === "string" ? JSON.parse(db[key]) : db[key] ?? fallback;
const cents = value => Math.round(Number(value || 0) * 100);
const scope = value => value || null;
const same = (a, b) => scope(a) === scope(b);
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

function paidBeforePlan(booking) {
  if (booking.instalmentBasePaid !== undefined) return cents(booking.instalmentBasePaid);
  return ["paid", "cash"].includes(booking.paymentStatus) ? cents(booking.paymentAmount) : booking.paymentStatus === "deposit-paid" ? cents(booking.depositAmount) : 0;
}
function planRemaining(booking, rows) {
  return cents(booking.paymentAmount) - paidBeforePlan(booking) - rows.filter(row => row.bookingId === booking.id && same(row.tenantSlug, booking.tenantSlug) && row.status === "paid").reduce((sum, row) => sum + cents(row.amount), 0);
}
function settleInstalment(db, row, booking, method, session) {
  const rows = read(db, "wv_instalments");
  if (row.status === "paid") return { duplicate: true, booking };
  if (!["pending", "overdue"].includes(row.status) || booking.archived || booking.status === "cancelled" || booking.paymentNeedsReview || cents(row.amount) > planRemaining(booking, rows)) throw new Error("Instalment no longer payable");
  const now = new Date().toISOString();
  row.status = "paid"; row.paidAt = now; row.method = method;
  if (session) row.paidSessionId = session.id;
  const index = rows.findIndex(item => item.id === row.id && same(item.tenantSlug, row.tenantSlug));
  rows[index] = row;
  db.wv_instalments = rows;
  const remaining = planRemaining(booking, rows);
  booking.originalDepositAmount ??= booking.depositAmount || 0;
  booking.depositAmount = (cents(booking.paymentAmount) - remaining) / 100;
  booking.depositPaidAt ||= now;
  booking.paymentStatus = remaining === 0 ? "paid" : "deposit-paid";
  booking.paymentMethod = method;
  booking.depositMethod = method;
  if (remaining === 0) { booking.paidAt = now; booking.instalmentPlanActive = false; }
  booking.instalmentPayments = [...(booking.instalmentPayments || []), { id: row.id, sessionId: session?.id, amount: row.amount, method, paidAt: now }];
  booking.paymentHistory = [...(booking.paymentHistory || []), { action: "instalment-paid", instalmentId: row.id, amount: row.amount, method, changedAt: now }];
  if (session) booking.stripePayments = [...(booking.stripePayments || []), { sessionId: session.id, paymentIntentId: session.payment_intent, kind: "instalment", amount: row.amount, paidAt: now }];
  db.wv_bookings = read(db, "wv_bookings").map(item => item.id === booking.id && same(item.tenantSlug, booking.tenantSlug) ? booking : item);
  return { booking };
}

function applyInstalmentPayment(db, session, tenantSlug) {
  const rows = read(db, "wv_instalments");
  const row = rows.find(item => item.id === session.metadata?.instalmentId && same(item.tenantSlug, tenantSlug));
  const booking = row && read(db, "wv_bookings").find(item => item.id === row.bookingId && same(item.tenantSlug, tenantSlug));
  if (!row || !booking) throw new Error("Instalment or booking not found in this studio");
  if (row.status === "paid" && row.paidSessionId === session.id) return { duplicate: true, booking };
  try {
    if (session.payment_status !== "paid" || row.checkoutSessionId !== session.id || cents(row.amount) !== session.amount_total || row.currency !== session.currency || session.metadata?.bookingId !== booking.id || !same(session.metadata?.tenantSlug, tenantSlug) || session.metadata?.amountHash !== hash([row.id, row.amount, row.currency, booking.paymentAmount])) throw new Error("Instalment payment does not match its saved checkout");
    if (row.status === "paid") throw new Error("Another payment already settled this instalment");
    return settleInstalment(db, row, booking, "stripe", session);
  } catch (error) {
    row.reviewReason = error.message;
    booking.paymentNeedsReview = true;
    booking.paymentReviewReason = error.message;
    booking.paymentReviews = [...(booking.paymentReviews || []).filter(item => item.stripeSessionId !== session.id), { stripeSessionId: session.id, amountTotal: session.amount_total, currency: session.currency, reason: error.message, receivedAt: new Date().toISOString(), status: "manual-review" }];
    db.wv_instalments = rows;
    db.wv_bookings = read(db, "wv_bookings").map(item => item.id === booking.id && same(item.tenantSlug, tenantSlug) ? booking : item);
    return { review: true };
  }
}

function registerInstalments(app, { readDb, writeDb, requireAdminOrScopedTenant, studioScope, withCheckoutResourceLock, bookingCheckoutResourceLockKey, licensedTenantBySlug, safeCheckoutReturnUrl, createStripeClient = stripe }) {
  const clientFor = (db, slug) => {
    const settings = slug ? read(db, `t_${slug}_wv_tenant_settings`, {}) : null;
    const key = slug ? settings.stripeEnabled !== false && settings.stripeSecretKey : process.env.STRIPE_SECRET_KEY;
    const secret = slug ? settings.stripeWebhookSecret : process.env.STRIPE_WEBHOOK_SECRET;
    return key && secret ? { client: createStripeClient(key), account: hash(key), currency: String(settings?.stripeCurrency || "aud").toLowerCase() } : null;
  };
  const findBooking = (db, id, slug) => read(db, "wv_bookings").find(item => item.id === id && same(item.tenantSlug, slug));
  const byToken = (db, token) => {
    if (typeof token !== "string" || token.length < 16) return null;
    return read(db, "wv_bookings").find(item => item.modifyToken === token && !item.archived && (!item.tenantSlug || licensedTenantBySlug(item.tenantSlug)));
  };
  const locked = (slug, id, work, res) => withCheckoutResourceLock(bookingCheckoutResourceLockKey(slug ? `tenant:${slug}` : "main", id), work).catch(error => { if (!res.headersSent) res.status(409).json({ error: error.message }); });
  const list = (db, booking) => read(db, "wv_instalments").filter(row => row.bookingId === booking.id && same(row.tenantSlug, booking.tenantSlug));
  const publicRows = rows => rows.map(({ id, dueDate, amount, status, note, currency, paidAt }) => ({ id, dueDate, amount, status: status === "pending" && dueDate < new Date().toISOString().slice(0, 10) ? "overdue" : status, note, currency, paidAt }));

  app.get("/api/bookings/:id/instalments", requireAdminOrScopedTenant, (req, res) => {
    const db = readDb(), booking = findBooking(db, req.params.id, studioScope(req));
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    res.json(publicRows(list(db, booking)));
  });
  app.post("/api/bookings/:id/instalments", requireAdminOrScopedTenant, (req, res) => locked(studioScope(req), req.params.id, async () => {
    const db = readDb(), slug = studioScope(req), booking = findBooking(db, req.params.id, slug);
    if (!booking || booking.archived || !["confirmed", "completed"].includes(booking.status)) throw new Error("Confirm the booking before creating its payment schedule");
    if (["paid", "cash"].includes(booking.paymentStatus)) throw new Error("This booking is already paid");
    if (booking.paymentNeedsReview || ["open", "processing"].includes(booking.stripeCheckoutStatus) || booking.bankTransferPendingAt) throw new Error("Resolve the existing payment before creating a schedule");
    const { id, dueDate, note } = req.body;
    const amount = Number(req.body.amount);
    if (!/^[\w-]{16,100}$/.test(id || "") || !Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - cents(amount)) > 0.000001 || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate || "") || !Number.isFinite(Date.parse(dueDate)) || new Date(dueDate).toISOString().slice(0, 10) !== dueDate) throw new Error("Provide a positive amount in cents and a valid due date");
    const rows = read(db, "wv_instalments"), existing = rows.find(row => row.id === id);
    if (existing) {
      if (!same(existing.tenantSlug, slug) || existing.bookingId !== booking.id || existing.amount !== amount || existing.dueDate !== dueDate) throw new Error("This request identity is already in use");
      return res.json(publicRows([existing])[0]);
    }
    const allocated = list(db, booking).filter(row => row.status !== "waived").reduce((sum, row) => sum + cents(row.amount), 0);
    if (allocated + cents(amount) > cents(booking.paymentAmount) - paidBeforePlan(booking)) throw new Error("Schedule exceeds the unpaid booking balance");
    booking.instalmentBaseMethod ??= booking.paymentMethod || booking.depositMethod || "bank";
    booking.instalmentBasePaid ??= paidBeforePlan(booking) / 100;
    booking.instalmentPlanActive = true;
    const currency = String(slug ? read(db, `t_${slug}_wv_tenant_settings`, {}).stripeCurrency || "aud" : "aud").toLowerCase();
    const row = { id, bookingId: booking.id, tenantSlug: slug, amount, currency, dueDate, status: "pending", note: String(note || "").slice(0, 1000) };
    rows.push(row); db.wv_instalments = rows;
    db.wv_bookings = read(db, "wv_bookings").map(item => item.id === booking.id && same(item.tenantSlug, slug) ? booking : item);
    writeDb(db, { durable: true });
    res.status(201).json(publicRows([row])[0]);
  }, res));
  app.put("/api/instalments/:id", requireAdminOrScopedTenant, (req, res) => {
    const slug = studioScope(req), initial = read(readDb(), "wv_instalments").find(row => row.id === req.params.id && same(row.tenantSlug, slug));
    if (!initial) return res.status(404).json({ error: "Instalment not found" });
    return locked(slug, initial.bookingId, async () => {
      let db = readDb(), rows = read(db, "wv_instalments"), row = rows.find(item => item.id === initial.id && same(item.tenantSlug, slug));
      if (!row) throw new Error("Instalment not found");
      if (!["paid", "waived"].includes(req.body.status) || (req.body.status === "paid" && !["bank", "cash"].includes(req.body.method))) throw new Error("Choose a bank/cash settlement or waive the instalment");
      if (row.status === req.body.status) return res.json(publicRows([row])[0]);
      if (!["pending", "overdue"].includes(row.status)) throw new Error("A settled instalment cannot be changed");
      if (row.checkoutSessionId) {
        const provider = clientFor(db, slug);
        if (!provider || provider.account !== row.accountHash) throw new Error("Restore the original Stripe connection before changing this checkout");
        const session = await provider.client.checkout.sessions.retrieve(row.checkoutSessionId);
        if (session.status === "complete" || session.payment_status === "paid") throw new Error("Card payment is processing; wait for confirmation");
        if (session.status === "open") await provider.client.checkout.sessions.expire(session.id);
      }
      db = readDb(); rows = read(db, "wv_instalments"); row = rows.find(item => item.id === initial.id && same(item.tenantSlug, slug));
      const booking = findBooking(db, row.bookingId, slug);
      if (!booking) throw new Error("Booking not found");
      if (req.body.status === "paid") settleInstalment(db, row, booking, req.body.method);
      else { row.status = "waived"; db.wv_instalments = rows;
        if (!list(db, booking).some(item => ["pending", "overdue"].includes(item.status))) booking.instalmentPlanActive = false;
        db.wv_bookings = read(db, "wv_bookings").map(item => item.id === booking.id && same(item.tenantSlug, slug) ? booking : item);
      }
      writeDb(db, { durable: true }); res.json(publicRows([row])[0]);
    }, res);
  });
  app.get("/api/booking/:token/instalments", (req, res) => {
    const db = readDb(), booking = byToken(db, req.params.token);
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    res.setHeader("Cache-Control", "private, no-store");
    const slug = booking.tenantSlug, settings = read(db, slug ? `t_${slug}_wv_tenant_settings` : "wv_settings", {});
    res.json({ booking: Object.fromEntries(["id", "paymentStatus", "paymentAmount", "depositAmount", "instalmentPlanActive", "paidAt", "depositPaidAt", "status"].filter(key => booking[key] !== undefined).map(key => [key, booking[key]])), unallocatedAmount: Math.max(0, cents(booking.paymentAmount) - paidBeforePlan(booking) - list(db, booking).filter(row => row.status !== "waived").reduce((sum, row) => sum + cents(row.amount), 0)) / 100, instalments: publicRows(list(db, booking)), cardAvailable: booking.status !== "cancelled" && !booking.paymentNeedsReview && !!clientFor(db, slug), bankTransfer: booking.status === "cancelled" ? null : slug ? settings.bankTransferEnabled ? { enabled: true, accountName: settings.bankAccountName, bsb: settings.bankBsb, accountNumber: settings.bankAccountNumber, payId: settings.bankPayId } : null : settings.bankTransfer || null });
  });
  app.post("/api/booking/:token/instalments/:id/checkout", (req, res) => {
    const initial = byToken(readDb(), req.params.token);
    if (!initial) return res.status(404).json({ error: "Booking not found" });
    return locked(initial.tenantSlug, initial.id, async () => {
      let db = readDb(); const booking = byToken(db, req.params.token), slug = initial.tenantSlug;
      const row = booking && list(db, booking).find(item => item.id === req.params.id);
      if (!row || !["pending", "overdue"].includes(row.status) || booking.status === "cancelled" || booking.paymentNeedsReview || row.reviewReason || cents(row.amount) > planRemaining(booking, read(db, "wv_instalments"))) throw new Error("Instalment is not payable");
      const provider = clientFor(db, slug);
      if (!provider || provider.currency !== row.currency) throw new Error("Card payments are unavailable for this schedule");
      if (row.checkoutSessionId) {
        if (row.accountHash !== provider.account) throw new Error("Stripe account changed; contact your photographer");
        const existing = await provider.client.checkout.sessions.retrieve(row.checkoutSessionId);
        if (existing.status === "open" && existing.payment_status === "unpaid") {
          if (existing.metadata?.amountHash !== hash([row.id, row.amount, row.currency, booking.paymentAmount])) throw new Error("Booking amount changed; contact your photographer to replace this checkout");
          return res.json({ url: existing.url });
        }
        if (existing.status !== "expired") throw new Error("Payment is processing; refresh shortly");
        row.checkoutRevision = (row.checkoutRevision || 0) + 1;
      }
      const session = await provider.client.checkout.sessions.create({ mode: "payment", payment_method_types: ["card"], customer_email: booking.clientEmail,
        line_items: [{ price_data: { currency: row.currency, unit_amount: cents(row.amount), product_data: { name: `Instalment — ${booking.type || "Photography"}`, description: `Due ${row.dueDate}` } }, quantity: 1 }],
        success_url: safeCheckoutReturnUrl(req, null, `/booking/modify/${encodeURIComponent(req.params.token)}?instalment_paid=1`), cancel_url: safeCheckoutReturnUrl(req, null, `/booking/modify/${encodeURIComponent(req.params.token)}`),
        metadata: { type: "instalment", instalmentId: row.id, bookingId: booking.id, tenantSlug: slug || "", amountHash: hash([row.id, row.amount, row.currency, booking.paymentAmount]) },
      }, { idempotencyKey: `instalment:${slug || "main"}:${row.id}:${row.checkoutRevision || 0}` });
      db = readDb();
      const rows = read(db, "wv_instalments");
      const index = rows.findIndex(item => item.id === row.id && same(item.tenantSlug, slug));
      rows[index] = { ...row, checkoutSessionId: session.id, accountHash: provider.account };
      db.wv_instalments = rows; writeDb(db, { durable: true });
      res.json({ url: session.url });
    }, res);
  });
}
module.exports = { registerInstalments, applyInstalmentPayment, settleInstalment, planRemaining };
