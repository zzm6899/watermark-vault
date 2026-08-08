const stripe = require("stripe");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const { notifyInvoice, notifyAlbumPurchase, notifyPayment } = require("./discord");
const { sendBookingConfirmationEmail, sendInvoicePaidEmail } = require("./email");
const { albumAccessWindow, bookingBlocksAvailability } = require("./security-core");

let stripeClient = null;

function getStripe() {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripeClient = stripe(key);
  return stripeClient;
}

function parseStored(value, fallback = []) {
  if (value == null) return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

const STRIPE_EVENTS_KEY = "wv_stripe_processed_events";
const STRIPE_FULFILMENTS_KEY = "wv_stripe_resource_fulfilments";
const INVOICE_CHECKOUT_ORDERS_KEY = "wv_invoice_checkout_orders";
const STRIPE_EVENT_RETENTION_MS = 45 * 24 * 60 * 60 * 1000;
const checkoutResourceLocks = new Map();

async function withCheckoutResourceLock(key, operation) {
  const lockKey = String(key || "stripe:unknown");
  const previous = checkoutResourceLocks.get(lockKey) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  checkoutResourceLocks.set(lockKey, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (checkoutResourceLocks.get(lockKey) === current) checkoutResourceLocks.delete(lockKey);
  }
}

function bookingCheckoutResourceLockKey(scope, bookingId) {
  return `checkout:${String(scope || "main")}:booking:${String(bookingId || "unknown")}`;
}

function checkoutSnapshotHash(snapshot) {
  return crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function stripeAccountHash(secretKey) {
  return checkoutSnapshotHash({ stripeAccountKey: String(secretKey || "") });
}

function normaliseCurrency(value, fallback = "aud") {
  return String(value || fallback).trim().toLowerCase();
}

function invoicePaymentDetails(invoice) {
  const subtotal = (invoice?.items || []).reduce((sum, item) => {
    const quantity = Number(item?.quantity || 0);
    const unitPrice = Number(item?.unitPrice || 0);
    return sum + quantity * unitPrice;
  }, 0);
  const discount = Number(invoice?.discount || 0);
  const tax = Number(invoice?.tax || 0);
  const amountPaid = Number(invoice?.amountPaid || 0);
  const total = Math.max(0, (subtotal - discount) * (1 + tax / 100));
  const amount = Math.max(0, total - amountPaid);
  const amountCents = Math.round(amount * 100);
  const currency = normaliseCurrency(invoice?.currency, "aud");
  if (![subtotal, discount, tax, amountPaid, total, amount].every(Number.isFinite) || amountCents <= 0) {
    return { error: "No balance remains on this invoice" };
  }
  if (!new Set(["aud", "eur", "usd", "gbp", "nzd"]).has(currency)) {
    return { error: "Unsupported invoice currency" };
  }
  return { amount, amountCents, currency };
}

function invoiceIsPayable(invoice) {
  return !!invoice && !["paid", "cancelled", "canceled", "void", "refunded"].includes(String(invoice.status || "").toLowerCase());
}

function invoiceCheckoutSnapshot(invoice) {
  const payment = invoicePaymentDetails(invoice);
  if (payment.error) return payment;
  const snapshot = {
    resourceType: "invoice",
    scope: "main",
    invoiceId: String(invoice?.id || ""),
    tenantSlug: invoice?.tenantSlug == null ? null : String(invoice.tenantSlug),
    status: String(invoice?.status || "").toLowerCase(),
    shareTokenHash: checkoutSnapshotHash({ shareToken: String(invoice?.shareToken || "") }),
    amountCents: payment.amountCents,
    currency: payment.currency,
  };
  return { ...payment, snapshot, snapshotHash: checkoutSnapshotHash(snapshot) };
}

function evaluateInvoiceStripePayment(invoice, order, metadata, session) {
  if (!invoice) return { valid: false, reason: "Canonical invoice no longer exists" };
  if (!order || order.resourceType !== "invoice" || order.scope !== "main") return { valid: false, reason: "Invoice checkout snapshot is missing" };
  if (String(order.invoiceId || "") !== String(invoice.id || "") || String(metadata?.invoiceId || "") !== String(invoice.id || "")) {
    return { valid: false, reason: "Invoice checkout ownership does not match the canonical invoice" };
  }
  if (invoice.tenantSlug != null || order.tenantSlug != null) return { valid: false, reason: "Invoice checkout ownership changed" };
  if (!timingSafeTextEqual(metadata?.invoiceCheckoutId, order.id) || !timingSafeTextEqual(order.checkoutSessionId, session?.id)) {
    return { valid: false, reason: "Invoice checkout session does not match its server snapshot" };
  }
  if (String(session?.client_reference_id || "") !== String(invoice.id || "")) {
    return { valid: false, reason: "Invoice checkout client reference does not match" };
  }
  if (!invoiceIsPayable(invoice)) return { valid: false, reason: `Invoice is no longer payable (${invoice.status || "unknown"})` };
  const current = invoiceCheckoutSnapshot(invoice);
  if (current.error) return { valid: false, reason: current.error };
  if (!timingSafeTextEqual(current.snapshot.shareTokenHash, order.shareTokenHash)) {
    return { valid: false, reason: "Invoice share capability changed after checkout" };
  }
  if (current.snapshot.status !== order.statusAtCheckout) return { valid: false, reason: "Invoice status changed after checkout" };
  if (current.amountCents !== Number(order.expectedAmountCents) || current.currency !== normaliseCurrency(order.expectedCurrency)) {
    return { valid: false, reason: "Invoice amount or currency changed after checkout" };
  }
  if (!timingSafeTextEqual(current.snapshotHash, order.snapshotHash) || !timingSafeTextEqual(metadata?.checkoutSnapshotHash, order.snapshotHash)) {
    return { valid: false, reason: "Invoice checkout snapshot changed" };
  }
  if (Number(metadata?.expectedAmountCents) !== current.amountCents || normaliseCurrency(metadata?.expectedCurrency) !== current.currency) {
    return { valid: false, reason: "Invoice checkout metadata does not match the canonical balance" };
  }
  if (Number(session?.amount_total) !== current.amountCents || normaliseCurrency(session?.currency) !== current.currency) {
    return { valid: false, reason: "Paid amount or currency does not match the canonical invoice" };
  }
  return { valid: true, current };
}

function albumCheckoutSnapshot(album, checkout, tenantSlug) {
  const snapshot = {
    resourceType: "album",
    scope: tenantSlug ? `tenant:${tenantSlug}` : "main",
    albumId: String(album?.id || ""),
    tenantSlug: tenantSlug || null,
    sessionKey: String(checkout?.sessionKey || ""),
    isFullAlbum: checkout?.isFullAlbum === true,
    photoIds: [...new Set(Array.isArray(checkout?.photoIds) ? checkout.photoIds.map(String) : [])].sort(),
    amountCents: Math.round(Number(checkout?.amount || 0) * 100),
    currency: normaliseCurrency(checkout?.currency, "aud"),
  };
  return { snapshot, snapshotHash: checkoutSnapshotHash(snapshot) };
}

function albumFulfilmentKey(scope, order) {
  return `${scope}:album:${order?.albumId || "unknown"}:${order?.sessionKey || "unknown"}:${order?.intentHash || order?.id || "legacy"}`;
}

function evaluateAlbumStripePayment(album, order, metadata, session, tenantSlug, timezone, currency, unlockedPhotoIds = []) {
  if (!order) return { valid: false, reason: "Album checkout snapshot is missing" };
  if (String(order.albumId || "") !== String(album?.id || "") || String(metadata?.albumId || "") !== String(album?.id || "")) {
    return { valid: false, reason: "Album checkout ownership does not match" };
  }
  if ((order.tenantSlug || null) !== (tenantSlug || null)) return { valid: false, reason: "Album checkout tenant ownership changed" };
  if (!timingSafeTextEqual(order.checkoutSessionId, session?.id) || !timingSafeTextEqual(metadata?.orderId, order.id)) {
    return { valid: false, reason: "Album checkout session does not match its server order" };
  }
  if (String(session?.client_reference_id || "") !== String(album?.id || "")) return { valid: false, reason: "Album checkout client reference does not match" };
  const canonical = calculateAlbumCheckout(album, {
    sessionKey: order.sessionKey,
    isFullAlbum: order.isFullAlbum === true,
    photoIds: order.photoIds,
    unlockedPhotoIds,
    timezone,
  });
  if (canonical.error) return { valid: false, reason: canonical.error };
  canonical.currency = normaliseCurrency(currency);
  const current = albumCheckoutSnapshot(album, canonical, tenantSlug);
  if (!timingSafeTextEqual(current.snapshotHash, order.intentHash) || !timingSafeTextEqual(current.snapshotHash, metadata?.checkoutSnapshotHash)) {
    return { valid: false, reason: "Album price or selection changed after checkout" };
  }
  if (Number(session?.amount_total) !== current.snapshot.amountCents || Number(metadata?.expectedAmountCents) !== current.snapshot.amountCents) {
    return { valid: false, reason: "Album paid amount does not match the canonical selection" };
  }
  if (normaliseCurrency(session?.currency) !== canonical.currency || normaliseCurrency(metadata?.expectedCurrency) !== canonical.currency) {
    return { valid: false, reason: "Album paid currency does not match" };
  }
  return { valid: true, canonical, current };
}

function bookingCheckoutSnapshot(booking, scope, paymentKind, amountCents, currency) {
  const snapshot = {
    resourceType: "booking",
    scope,
    bookingId: String(booking?.id || ""),
    tenantSlug: booking?.tenantSlug || null,
    paymentKind: String(paymentKind || "full"),
    amountCents: Number(amountCents),
    currency: normaliseCurrency(currency, "aud"),
  };
  return { snapshot, snapshotHash: checkoutSnapshotHash(snapshot) };
}

function bookingPaymentDetails(booking) {
  if (["paid", "cash"].includes(String(booking?.paymentStatus || "").toLowerCase())) {
    return { error: "No balance remains on this booking" };
  }
  const total = Number(booking?.paymentAmount);
  const deposit = Number(booking?.depositAmount) || 0;
  if (!Number.isFinite(total) || total <= 0) return { error: "This booking does not require payment" };
  let paymentKind = "full";
  let amount = total;
  if (booking?.paymentStatus === "deposit-paid" && deposit > 0) {
    paymentKind = "balance";
    amount = Math.max(0, total - deposit);
  } else if (booking?.depositRequired && deposit > 0) {
    paymentKind = "deposit";
    amount = deposit;
  }
  if (!Number.isFinite(amount) || amount <= 0) return { error: "No balance remains on this booking" };
  return { paymentKind, amount, amountCents: Math.round(amount * 100) };
}

function bookingStripeCheckoutStage(booking) {
  const status = String(booking?.paymentStatus || "").toLowerCase();
  if (status === "unpaid") return { ok: true };
  if (status === "deposit-paid") {
    const payment = bookingPaymentDetails(booking);
    if (!payment.error && payment.paymentKind === "balance") return { ok: true };
    return { ok: false, code: "BOOKING_ALREADY_SETTLED", error: payment.error || "No balance remains on this booking" };
  }
  if (["paid", "cash"].includes(status)) {
    return { ok: false, code: "BOOKING_ALREADY_SETTLED", error: "A payment has already been recorded for this booking" };
  }
  return { ok: false, code: "PAYMENT_STATE_CONFLICT", error: "The current payment state cannot start a card checkout" };
}

function evaluateBookingStripePayment(booking, metadata, session, scope, currency) {
  const expectedTenant = scope.startsWith("tenant:") ? scope.slice("tenant:".length) : null;
  if ((booking?.tenantSlug || null) !== expectedTenant) return { valid: false, reason: "Booking payment ownership changed" };
  if (!timingSafeTextEqual(booking?.stripeCheckoutSessionId, session?.id)) return { valid: false, reason: "Booking checkout was superseded" };
  if (String(session?.client_reference_id || "") !== String(booking?.id || "")) return { valid: false, reason: "Booking checkout client reference does not match" };
  const payment = bookingPaymentDetails(booking);
  if (payment.error) return { valid: false, reason: payment.error };
  if (payment.paymentKind !== String(metadata?.paymentKind || "full")) return { valid: false, reason: "Booking payment stage changed after checkout" };
  const snapshot = bookingCheckoutSnapshot(booking, scope, payment.paymentKind, payment.amountCents, currency);
  if (!timingSafeTextEqual(snapshot.snapshotHash, booking?.stripeCheckoutSnapshotHash) || !timingSafeTextEqual(snapshot.snapshotHash, metadata?.checkoutSnapshotHash)) {
    return { valid: false, reason: "Booking payable details changed after checkout" };
  }
  if (Number(metadata?.expectedAmountCents) !== payment.amountCents || Number(session?.amount_total) !== payment.amountCents) {
    return { valid: false, reason: "Booking paid amount does not match the canonical balance" };
  }
  if (normaliseCurrency(metadata?.expectedCurrency, currency) !== normaliseCurrency(currency) || normaliseCurrency(session?.currency) !== normaliseCurrency(currency)) {
    return { valid: false, reason: "Booking paid currency does not match" };
  }
  return { valid: true, payment, snapshot };
}

function reviewBookingStripePayment(booking, metadata, session, reason, nowMs = Date.now()) {
  const receivedAt = new Date(nowMs).toISOString();
  const paymentKind = String(metadata?.paymentKind || "full");
  const stripePaymentIntentId = typeof session?.payment_intent === "string" ? session.payment_intent : session?.payment_intent?.id;
  const reviews = Array.isArray(booking?.paymentReviews) ? booking.paymentReviews : [];
  return {
    ...booking,
    paymentNeedsReview: true,
    paymentReviewStatus: "paid-unallocated",
    paymentReviewReason: reason,
    paymentReceivedAt: receivedAt,
    paymentReviews: reviews.some(review => review?.stripeSessionId === session?.id) ? reviews : [...reviews, {
      stripeSessionId: session?.id,
      stripePaymentIntentId,
      paymentKind,
      amountTotal: session?.amount_total,
      currency: session?.currency,
      reason,
      receivedAt,
      status: "manual-review",
    }],
  };
}

function checkoutSessionMatches(session, expected, nowMs = Date.now()) {
  if (!session || session.status !== "open" || !session.url || checkoutIsPaid(session)) return false;
  const expiresAtMs = Number(session.expires_at || 0) * 1000;
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs + 5_000) return false;
  if (Number(session.amount_total) !== Number(expected.amountCents)) return false;
  if (normaliseCurrency(session.currency) !== normaliseCurrency(expected.currency)) return false;
  return timingSafeTextEqual(session.metadata?.checkoutSnapshotHash, expected.snapshotHash);
}

async function inspectExistingCheckout(client, sessionId, expected, nowMs = Date.now()) {
  if (!client || !sessionId) return { action: "replace" };
  let session;
  try {
    session = await client.checkout.sessions.retrieve(sessionId);
  } catch (error) {
    if (String(error?.code || "") === "resource_missing") return { action: "replace" };
    throw error;
  }
  if (checkoutIsPaid(session)) return { action: "processing", session };
  if (checkoutSessionMatches(session, expected, nowMs)) return { action: "reuse", session };
  if (session?.status === "open") {
    try {
      await client.checkout.sessions.expire(session.id);
    } catch (error) {
      const message = String(error?.message || "");
      if (String(error?.code || "") !== "resource_missing" && !/already (?:expired|complete)/i.test(message)) throw error;
    }
  }
  return { action: "replace", session };
}

function stripeFulfilment(db, key) {
  return parseStored(db[STRIPE_FULFILMENTS_KEY], {})[key] || null;
}

function markStripeResourceFulfilled(db, key, session, extra = {}) {
  const fulfilments = parseStored(db[STRIPE_FULFILMENTS_KEY], {});
  const cutoff = Date.now() - STRIPE_EVENT_RETENTION_MS;
  for (const [existingKey, value] of Object.entries(fulfilments)) {
    if (!value?.fulfilledAt || Date.parse(value.fulfilledAt) < cutoff) delete fulfilments[existingKey];
  }
  fulfilments[key] = {
    stripeSessionId: session.id,
    fulfilledAt: new Date().toISOString(),
    ...extra,
  };
  db[STRIPE_FULFILMENTS_KEY] = fulfilments;
}

function webhookResourceLockKey(scope, metadata) {
  const type = String(metadata?.type || "unknown");
  // Checkout creation, bank switching, webhook fulfilment, and administrator
  // reconciliation all mutate the same canonical booking. Use one lock key so
  // none can commit a stale snapshot over another operation.
  if (metadata?.bookingId) return bookingCheckoutResourceLockKey(scope, metadata.bookingId);
  if (metadata?.albumId) return `fulfil:${scope}:album:${metadata.albumId}:${metadata.sessionKey || "unknown"}`;
  if (metadata?.invoiceId) return `fulfil:${scope}:invoice:${metadata.invoiceId}`;
  if (metadata?.requestId) return `fulfil:${scope}:event-slot:${metadata.requestId}`;
  if (metadata?.planId) return `fulfil:${scope}:plan:${metadata.planId}:${metadata.buyerEmail || "unknown"}`;
  return `fulfil:${scope}:${type}`;
}

function stripeEventKey(scope, eventId) {
  return `${scope}:${eventId}`;
}

function isStripeEventProcessed(db, scope, eventId) {
  if (!eventId) return false;
  const events = parseStored(db[STRIPE_EVENTS_KEY], {});
  return !!events[stripeEventKey(scope, eventId)]?.processedAt;
}

function markStripeEventProcessed(db, scope, event) {
  const events = parseStored(db[STRIPE_EVENTS_KEY], {});
  const cutoff = Date.now() - STRIPE_EVENT_RETENTION_MS;
  for (const [key, value] of Object.entries(events)) {
    if (!value?.processedAt || new Date(value.processedAt).getTime() < cutoff) delete events[key];
  }
  events[stripeEventKey(scope, event.id)] = { type: event.type, processedAt: new Date().toISOString() };
  db[STRIPE_EVENTS_KEY] = events;
}

function unsignedWebhookAllowed() {
  return process.env.ALLOW_UNSIGNED_STRIPE_WEBHOOKS === "true";
}

function mainStripeReady() {
  return !!process.env.STRIPE_SECRET_KEY && (!!process.env.STRIPE_WEBHOOK_SECRET || unsignedWebhookAllowed());
}

function checkoutIsPaid(session) {
  return session?.payment_status === "paid" || session?.payment_status === "no_payment_required";
}

function timingSafeTextEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Resolve a Stripe return URL against the origin that actually received the
 * request.  Public callers may choose a path on this app, but can never turn a
 * checkout into an open redirect to another origin (or a non-http scheme).
 */
function safeCheckoutReturnUrl(req, candidate, fallbackPath = "/") {
  let origin;
  try {
    const configured = new URL(String(process.env.APP_BASE_URL || ""));
    if (configured.username || configured.password || !["http:", "https:"].includes(configured.protocol)) throw new Error("invalid configured origin");
    origin = configured.origin;
  } catch {
    const forwardedProtocol = String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
    const requestProtocol = forwardedProtocol || String(req?.protocol || "https").toLowerCase();
    const protocol = requestProtocol === "http" || requestProtocol === "https" ? requestProtocol : "https";
    const host = String(req?.get?.("host") || req?.headers?.host || "").trim();
    const allowedHosts = new Set(String(process.env.APP_HOSTS || "localhost,127.0.0.1")
      .split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
    try {
      const parsedOrigin = new URL(`${protocol}://${host}`);
      const allowed = allowedHosts.has(parsedOrigin.hostname.toLowerCase()) || allowedHosts.has(parsedOrigin.host.toLowerCase());
      if (!allowed || parsedOrigin.username || parsedOrigin.password || !["http:", "https:"].includes(parsedOrigin.protocol)) throw new Error("untrusted request host");
      origin = parsedOrigin.origin;
    } catch {
      origin = "http://localhost";
    }
  }
  const fallback = new URL(String(fallbackPath || "/"), `${origin}/`).toString();
  if (candidate == null || String(candidate).trim() === "") return fallback;
  try {
    const resolved = new URL(String(candidate), `${origin}/`);
    if (!["http:", "https:"].includes(resolved.protocol) || resolved.origin !== origin) return fallback;
    return resolved.toString();
  } catch {
    return fallback;
  }
}

function calculateAlbumSelectionPricing({
  requestedPhotoIds,
  entitledPhotoIds = [],
  unlockedPhotoIds = [],
  freeDownloads,
  usedFreeDownloads,
  pricePerPhoto,
} = {}) {
  const requested = [...new Set((Array.isArray(requestedPhotoIds) ? requestedPhotoIds : []).map(String).filter(Boolean))];
  const entitled = new Set((Array.isArray(entitledPhotoIds) ? entitledPhotoIds : []).map(String).filter(Boolean));
  const claimed = new Set((Array.isArray(unlockedPhotoIds) ? unlockedPhotoIds : []).map(String).filter(Boolean));
  const quota = Math.max(0, Number.isFinite(Number(freeDownloads)) ? Math.floor(Number(freeDownloads)) : 5);
  const persistedUsed = Number.isFinite(Number(usedFreeDownloads)) ? Math.floor(Number(usedFreeDownloads)) : 0;
  const used = Math.max(0, claimed.size, persistedUsed);
  const remaining = Math.max(0, quota - used);
  const unpaidPhotoIds = requested.filter(id => !entitled.has(id) && !claimed.has(id));
  const freePhotoIds = unpaidPhotoIds.slice(0, remaining);
  const billablePhotoIds = unpaidPhotoIds.slice(freePhotoIds.length);
  const unitPrice = Number(pricePerPhoto);
  const amount = billablePhotoIds.length * (Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : 0);
  return {
    unpaidPhotoIds,
    freePhotoIds,
    billablePhotoIds,
    freeDownloadsQuota: quota,
    freeDownloadsUsed: used,
    freeDownloadsRemaining: remaining,
    amount,
  };
}

function calculateAlbumCheckout(album, request) {
  if (!album || album.enabled === false) return { error: "Album not found" };
  const nowMs = Number.isFinite(Number(request?.nowMs)) ? Number(request.nowMs) : Date.now();
  const accessWindow = albumAccessWindow(album, nowMs, request?.timezone || album.timezone || process.env.TZ || "Australia/Sydney");
  if (accessWindow.downloadsExpired) return { error: "Gallery downloads have expired" };
  if (accessWindow.downloadExpiry != null && accessWindow.downloadExpiry < nowMs + 31 * 60_000) {
    return { error: "Gallery downloads expire too soon to start a payment" };
  }
  if (album.purchasingDisabled) return { error: "Purchasing is disabled for this gallery" };
  const deliverable = (album.photos || []).filter(photo => !photo.hidden && (album.showCullRejectsToClient || photo.cull?.status !== "reject"));
  const deliverableById = new Map(deliverable.map(photo => [photo.id, photo]));
  const sessionKey = String(request.sessionKey || "").slice(0, 240);
  if (!sessionKey) return { error: "A gallery session is required" };
  const isFullAlbum = request.isFullAlbum === true;
  const requestedIds = [...new Set(Array.isArray(request.photoIds) ? request.photoIds.map(String) : [])];
  if (!isFullAlbum && requestedIds.length === 0) return { error: "Select at least one photo" };
  if (requestedIds.some(id => !deliverableById.has(id))) return { error: "One or more selected photos are unavailable" };

  const currentPurchase = album.sessionPurchases?.[sessionKey] || {};
  if (album.allUnlocked) return { error: "This gallery is already unlocked" };
  const alreadyPaid = new Set([
    ...(currentPurchase.photoIds || []),
    ...(album.paidPhotoIds || []),
    ...(album.photos || []).filter(photo => photo.paid).map(photo => photo.id),
  ]);
  const approvedRequests = (album.downloadRequests || []).filter(item =>
    item?.sessionKey === sessionKey && ["approved", "completed"].includes(item.status)
  );
  if (approvedRequests.some(item => item.fullAlbum === true)) return { error: "This gallery is already unlocked" };
  for (const item of approvedRequests) for (const id of item.photoIds || []) alreadyPaid.add(id);
  if (currentPurchase.fullAlbum) return { error: "This gallery is already unlocked" };
  const expiresAtSeconds = accessWindow.downloadExpiry == null
    ? undefined
    : Math.floor(Math.min(accessWindow.downloadExpiry, nowMs + 23 * 60 * 60_000) / 1000);

  if (isFullAlbum) {
    const amount = Number(album.priceFullAlbum) || 0;
    if (amount <= 0) return { error: "This gallery does not require payment" };
    return { amount, isFullAlbum: true, photoIds: [], photoCount: deliverable.length, sessionKey, albumTitle: album.title || "Photo gallery", expiresAtSeconds };
  }

  const pricing = calculateAlbumSelectionPricing({
    requestedPhotoIds: requestedIds,
    entitledPhotoIds: [...alreadyPaid],
    unlockedPhotoIds: request.unlockedPhotoIds,
    freeDownloads: album.freeDownloads,
    usedFreeDownloads: album.usedFreeDownloads?.[sessionKey],
    pricePerPhoto: album.pricePerPhoto,
  });
  if (pricing.amount <= 0) return { error: "The selected photos do not require payment" };
  return {
    amount: pricing.amount,
    isFullAlbum: false,
    photoIds: pricing.billablePhotoIds,
    photoCount: pricing.billablePhotoIds.length,
    sessionKey,
    albumTitle: album.title || "Photo gallery",
    expiresAtSeconds,
    freeDownloadsQuota: pricing.freeDownloadsQuota,
    freeDownloadsUsed: pricing.freeDownloadsUsed,
    freeDownloadsRemaining: pricing.freeDownloadsRemaining,
  };
}

function pruneCheckoutOrders(orders, nowMs = Date.now()) {
  const openCutoff = nowMs - 2 * 24 * 60 * 60 * 1000;
  const auditCutoff = nowMs - STRIPE_EVENT_RETENTION_MS;
  for (const [id, existing] of Object.entries(orders || {})) {
    const createdAt = Date.parse(existing?.createdAt || "");
    const cutoff = existing?.status === "open" ? openCutoff : auditCutoff;
    if (!Number.isFinite(createdAt) || createdAt < cutoff) delete orders[id];
  }
  return orders;
}

function recordStripePaymentReview(db, details) {
  const reviews = parseStored(db["wv_stripe_payment_reviews"], []);
  if (!reviews.some(review => review?.stripeSessionId === details.stripeSessionId && review?.resourceType === details.resourceType)) {
    reviews.push({
      id: `review-${crypto.randomUUID()}`,
      status: "manual-review",
      receivedAt: new Date().toISOString(),
      ...details,
    });
  }
  db["wv_stripe_payment_reviews"] = reviews.slice(-2000);
}

function recordLegacyLicensePlanPaymentReview(db, metadata, session) {
  const purchases = parseStored(db["wv_license_purchases"], []);
  const existing = purchases.find(purchase => purchase?.stripeSessionId === session?.id);
  if (existing) return { duplicate: true, purchase: existing };
  const expectedAmountCents = Number(metadata?.expectedAmountCents);
  const expectedCurrency = normaliseCurrency(metadata?.expectedCurrency);
  const paidCurrency = normaliseCurrency(session?.currency);
  const snapshotMatches = Number.isFinite(expectedAmountCents) && Number(session?.amount_total) === expectedAmountCents && paidCurrency === expectedCurrency;
  const reason = snapshotMatches
    ? "Legacy license-plan checkout was not bound to an authenticated tenant and cannot be fulfilled automatically"
    : "Legacy license-plan payment did not match its checkout snapshot and was not bound to an authenticated tenant";
  const purchase = {
    id: `purchase-review-${crypto.randomUUID()}`,
    planId: String(metadata?.planId || "").slice(0, 160),
    planName: String(metadata?.planName || "").slice(0, 240),
    buyerEmail: String(metadata?.buyerEmail || session?.customer_email || "").trim().toLowerCase().slice(0, 320),
    buyerName: String(metadata?.buyerName || "").trim().slice(0, 240),
    amount: Number(session?.amount_total || 0) / 100,
    currency: paidCurrency.toUpperCase(),
    method: "stripe",
    status: "paid-unallocated",
    paymentNeedsReview: true,
    paymentReviewReason: reason,
    stripeSessionId: session?.id,
    receivedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  purchases.push(purchase);
  db["wv_license_purchases"] = JSON.stringify(purchases);
  recordStripePaymentReview(db, {
    resourceType: "license-plan",
    resourceId: purchase.planId || "unknown",
    tenantSlug: null,
    stripeSessionId: session?.id,
    amountTotal: session?.amount_total,
    currency: session?.currency,
    reason,
  });
  return { duplicate: false, purchase };
}

function appendAlbumPaymentReview(album, order, session, reason) {
  const existing = Array.isArray(album.paymentReviews) ? album.paymentReviews : [];
  if (existing.some(review => review?.stripeSessionId === session.id)) return;
  album.paymentReviews = [...existing, {
    type: "album-payment",
    reason,
    stripeSessionId: session.id,
    orderId: order?.id || null,
    amountTotal: session.amount_total,
    currency: session.currency,
    receivedAt: new Date().toISOString(),
    status: "manual-review",
  }];
}

function markCheckoutOrderForReview(db, ordersKey, orders, order, session, resourceType, resourceId, reason, tenantSlug = null) {
  if (order) {
    orders[order.id] = {
      ...order,
      status: "manual-review",
      paidStripeSessionId: session.id,
      reviewReason: reason,
      reviewedAt: new Date().toISOString(),
    };
    db[ordersKey] = orders;
  }
  recordStripePaymentReview(db, {
    resourceType,
    resourceId,
    tenantSlug,
    stripeSessionId: session.id,
    amountTotal: session.amount_total,
    currency: session.currency,
    reason,
  });
}

function checkoutExpirySeconds(holdExpiresAt, nowMs = Date.now()) {
  const minimum = nowMs + 31 * 60_000;
  const maximum = nowMs + 23 * 60 * 60_000;
  const requested = Date.parse(holdExpiresAt || "");
  return Math.floor(Math.min(maximum, Math.max(minimum, Number.isFinite(requested) ? requested : minimum)) / 1000);
}

function applyBookingStripePayment(booking, metadata, session, nowMs = Date.now()) {
  const paidAt = new Date(nowMs).toISOString();
  const expiredHold = !!booking.holdExpiresAt && Date.parse(booking.holdExpiresAt) <= nowMs && !bookingBlocksAvailability(booking, nowMs);
  const terminal = ["cancelled", "completed"].includes(booking.status);
  const stripePaymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  const paymentKind = String(metadata?.paymentKind || (metadata?.type?.includes("deposit") ? "deposit" : "full"));
  const fulfilments = booking.stripeFulfilments && typeof booking.stripeFulfilments === "object" ? booking.stripeFulfilments : {};
  const legacyStageFulfilled = booking.stripeSessionId && (
    booking.paymentStatus === "paid" ||
    (paymentKind === "deposit" && booking.paymentStatus === "deposit-paid")
  );
  const existingFulfilment = fulfilments[paymentKind] || (legacyStageFulfilled ? { stripeSessionId: booking.stripeSessionId } : null);
  const legacySameSession = booking.stripeSessionId === session.id && (
    booking.paymentStatus === "paid" ||
    (paymentKind === "deposit" && booking.paymentStatus === "deposit-paid")
  );
  if (existingFulfilment?.stripeSessionId === session.id || legacySameSession) {
    return { needsReview: false, alreadyFulfilled: true, booking };
  }
  if (existingFulfilment?.stripeSessionId && existingFulfilment.stripeSessionId !== session.id) {
    const reason = `Duplicate ${paymentKind} payment completed for an already fulfilled booking stage`;
    const paymentReviews = Array.isArray(booking.paymentReviews) ? booking.paymentReviews : [];
    return {
      needsReview: true,
      booking: {
        ...booking,
        paymentNeedsReview: true,
        paymentReviewStatus: "paid-unallocated",
        paymentReviewReason: reason,
        paymentReceivedAt: paidAt,
        paymentReviews: paymentReviews.some(review => review?.stripeSessionId === session.id) ? paymentReviews : [...paymentReviews, {
          stripeSessionId: session.id,
          stripePaymentIntentId,
          paymentKind,
          reason,
          receivedAt: paidAt,
          status: "manual-review",
        }],
      },
    };
  }
  if (terminal || expiredHold) {
    const reason = terminal ? `Payment completed after booking was ${booking.status}` : "Payment completed after the booking hold expired";
    const paymentReviews = Array.isArray(booking.paymentReviews) ? booking.paymentReviews : [];
    return {
      needsReview: true,
      booking: {
        ...booking,
        paymentNeedsReview: true,
        paymentReviewStatus: "paid-unallocated",
        paymentReviewReason: reason,
        paymentReceivedAt: paidAt,
        stripeSessionId: session.id,
        stripePaymentIntentId,
        paymentMethod: "stripe",
        stripeCheckoutStatus: booking.stripeCheckoutSessionId === session.id ? "completed-review" : booking.stripeCheckoutStatus,
        paymentReviews: paymentReviews.some(review => review?.stripeSessionId === session.id) ? paymentReviews : [...paymentReviews, {
          stripeSessionId: session.id,
          stripePaymentIntentId,
          paymentKind,
          reason,
          receivedAt: paidAt,
          status: "manual-review",
        }],
      },
    };
  }
  const updated = {
    ...booking,
    stripeSessionId: session.id,
    stripePaymentIntentId,
    paymentMethod: "stripe",
    lastPaymentKind: paymentKind,
    lastPaymentAmount: Number(session.amount_total || 0) / 100,
    stripeCheckoutStatus: booking.stripeCheckoutSessionId === session.id ? "completed" : booking.stripeCheckoutStatus,
    stripeFulfilments: {
      ...fulfilments,
      [paymentKind]: { stripeSessionId: session.id, fulfilledAt: paidAt },
    },
  };
  delete updated.holdExpiresAt;
  if (metadata.type === "booking-deposit" || metadata.type === "tenant-booking-deposit" || metadata.paymentKind === "deposit") {
    updated.paymentStatus = "deposit-paid";
    updated.depositPaidAt = paidAt;
  } else {
    updated.paymentStatus = "paid";
    updated.paidAt = paidAt;
    if (metadata.paymentKind === "balance") updated.balancePaidAt = paidAt;
  }
  if (updated.status === "pending" && !updated.requiresConfirmation) updated.status = "confirmed";
  return { needsReview: false, booking: updated };
}

async function expireBookingCheckout(booking, tenantSettings = null) {
  if (!booking?.stripeCheckoutSessionId || booking.paymentStatus !== "unpaid") return false;
  const client = booking.tenantSlug ? resolveTenantStripe(tenantSettings || {})?.client : getStripe();
  if (!client) return false;
  try {
    await client.checkout.sessions.expire(booking.stripeCheckoutSessionId);
  } catch (err) {
    const code = String(err?.code || "");
    if (code !== "resource_missing" && !/already (?:expired|complete)/i.test(String(err?.message || ""))) throw err;
  }
  return true;
}

const SAFE_PAYMENT_BOOKING_FIELDS = [
  "id", "paymentReference", "clientName", "clientEmail", "phone", "date", "time", "eventTypeId", "type",
  "duration", "status", "notes", "answers", "answerLabels", "createdAt", "paymentStatus", "paymentAmount",
  "instagramHandle", "modifyToken", "depositRequired", "depositAmount", "depositMethod", "depositPaidAt", "paidAt",
  "requiresConfirmation", "tenantSlug", "statusHistory", "paymentMethod", "paymentPath", "holdExpiresAt",
  "bankTransferPendingAt", "bankTransferVerificationStatus", "stripeCheckoutStatus", "paymentNeedsReview",
];

function safePaymentBookingDto(booking) {
  return Object.fromEntries(SAFE_PAYMENT_BOOKING_FIELDS
    .filter(key => booking?.[key] !== undefined)
    .map(key => [key, booking[key]]));
}

function paymentRouteError(status, code, error) {
  return { status, body: { ok: false, code, error } };
}

function suppliedBookingCapability(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function storedBookingCapabilityMatches(booking, supplied) {
  return !!supplied
    && typeof booking?.modifyToken === "string"
    && booking.modifyToken.length > 0
    && timingSafeTextEqual(booking.modifyToken, supplied);
}

function mainBookingByCapability(db, modifyToken) {
  const supplied = suppliedBookingCapability(modifyToken);
  if (!supplied) return null;
  const matches = parseStored(db?.wv_bookings, [])
    .filter(booking => !booking?.tenantSlug && storedBookingCapabilityMatches(booking, supplied));
  return matches.length === 1 ? matches[0] : null;
}

function canonicalEventPaymentMethod(db, booking, method) {
  const bookingEventTypeId = String(booking?.eventTypeId || "");
  if (!bookingEventTypeId) return { allowed: false, reason: "missing" };
  const matches = parseStored(db?.wv_event_types, [])
    .filter(eventType => String(eventType?.id || "") === bookingEventTypeId);
  if (matches.length !== 1) return { allowed: false, reason: "missing" };
  const methods = matches[0]?.depositMethods;
  return {
    allowed: !Array.isArray(methods) || methods.length === 0 || methods.includes(method),
    reason: "configured",
  };
}

function canonicalBankPending(booking) {
  if (booking?.paymentStatus !== "pending-confirmation") return false;
  const methods = [booking.paymentMethod, booking.depositMethod, booking.paymentPath]
    .filter(value => value !== undefined && value !== null && value !== "")
    .map(value => String(value).toLowerCase());
  return methods.length > 0 && methods.every(method => method === "bank");
}

function bookingPaymentMethod(booking) {
  if (canonicalBankPending(booking)) return "bank";
  const methods = [booking?.paymentMethod, booking?.depositMethod, booking?.paymentPath]
    .filter(value => value !== undefined && value !== null && value !== "")
    .map(value => String(value).toLowerCase());
  if (methods.includes("stripe")) return "stripe";
  if (methods.includes("bank")) return "bank";
  if (methods.includes("cash")) return "cash";
  return null;
}

function bookingPaymentIsTerminal(booking) {
  return booking?.archived === true || ["cancelled", "completed"].includes(String(booking?.status || "").toLowerCase());
}

function manualBankHoldExpiresAt(settings, nowMs = Date.now()) {
  const hours = Math.max(1, Math.min(168, Number(settings?.unconfirmedBookingHoldHours) || 48));
  return new Date(nowMs + hours * 60 * 60_000).toISOString();
}

function stripeResourceMissing(error) {
  return String(error?.code || "") === "resource_missing";
}

function stripeAlreadyExpired(error) {
  return /already expired/i.test(String(error?.message || ""));
}

function stripeAlreadyComplete(error) {
  return /already complete|status (?:is )?complete|cannot expire.*complete/i.test(String(error?.message || ""));
}

async function retrieveBookingCheckout(client, sessionId) {
  if (!client || !sessionId) return { state: "unavailable" };
  try {
    const session = await client.checkout.sessions.retrieve(sessionId);
    if (checkoutIsPaid(session) || session?.status === "complete") return { state: "processing", session };
    if (session?.status === "open" && session?.payment_status === "unpaid") return { state: "open", session };
    if (session?.status === "expired") return { state: "expired", session };
    return { state: "processing", session };
  } catch (error) {
    if (stripeResourceMissing(error)) return { state: "missing" };
    return { state: "unavailable" };
  }
}

async function revokeBookingCheckoutForBank(client, sessionId) {
  if (!sessionId) return { ok: true, outcome: "none" };
  if (!client) return paymentRouteError(503, "STRIPE_STATUS_UNAVAILABLE", "The card payment status could not be verified; please try again shortly");

  let session;
  try {
    session = await client.checkout.sessions.retrieve(sessionId);
  } catch (error) {
    if (stripeResourceMissing(error)) return { ok: true, outcome: "missing" };
    return paymentRouteError(503, "STRIPE_STATUS_UNAVAILABLE", "The card payment status could not be verified; please try again shortly");
  }

  if (checkoutIsPaid(session) || session?.status === "complete" || session?.payment_status !== "unpaid") {
    return paymentRouteError(409, "STRIPE_PAYMENT_PROCESSING", "The card payment has completed or is processing; bank transfer cannot be selected yet");
  }
  if (session?.status === "expired") return { ok: true, outcome: "already-expired" };
  if (session?.status !== "open") {
    return paymentRouteError(409, "STRIPE_PAYMENT_PROCESSING", "The card payment status is still being resolved; bank transfer cannot be selected yet");
  }

  try {
    const expired = await client.checkout.sessions.expire(sessionId);
    if (expired && (checkoutIsPaid(expired) || expired.status === "complete")) {
      return paymentRouteError(409, "STRIPE_PAYMENT_PROCESSING", "The card payment completed while bank transfer was being selected");
    }
    if (expired?.status && expired.status !== "expired") {
      return paymentRouteError(503, "STRIPE_STATUS_UNAVAILABLE", "The card checkout could not be safely closed; please try again shortly");
    }
    return { ok: true, outcome: "expired" };
  } catch (error) {
    if (stripeResourceMissing(error) || stripeAlreadyExpired(error)) return { ok: true, outcome: "already-expired" };
    if (stripeAlreadyComplete(error)) {
      return paymentRouteError(409, "STRIPE_PAYMENT_PROCESSING", "The card payment completed while bank transfer was being selected");
    }
    const latest = await retrieveBookingCheckout(client, sessionId);
    if (latest.state === "processing") {
      return paymentRouteError(409, "STRIPE_PAYMENT_PROCESSING", "The card payment completed while bank transfer was being selected");
    }
    if (["expired", "missing"].includes(latest.state)) return { ok: true, outcome: "already-expired" };
    // A network or Stripe error is never proof that the session was revoked.
    // Fail closed so two payment paths cannot remain live at once.
    return paymentRouteError(503, "STRIPE_STATUS_UNAVAILABLE", "The card checkout could not be safely closed; please try again shortly");
  }
}

function validateManualBankTransition(db, booking, nowMs) {
  const settings = parseStored(db?.wv_settings, {});
  if (bookingPaymentIsTerminal(booking)) return paymentRouteError(409, "BOOKING_NOT_PAYABLE", "Booking is no longer payable");
  if (["paid", "deposit-paid", "cash"].includes(booking?.paymentStatus)) {
    return paymentRouteError(409, "BOOKING_ALREADY_SETTLED", "A payment has already been recorded for this booking");
  }
  const paymentAmount = Number(booking?.paymentAmount);
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    return paymentRouteError(409, "BOOKING_NOT_PAYABLE", "This booking does not require payment");
  }
  if (!bookingBlocksAvailability(booking, nowMs)) {
    return paymentRouteError(409, "BOOKING_HOLD_EXPIRED", "This booking hold has expired");
  }
  if (canonicalBankPending(booking)) return { ok: true, idempotent: true, settings };
  if (settings?.bankTransfer?.enabled !== true) {
    return paymentRouteError(403, "BANK_TRANSFER_UNAVAILABLE", "Bank transfer is not available");
  }
  const eventBank = canonicalEventPaymentMethod(db, booking, "bank");
  if (!eventBank.allowed) {
    return paymentRouteError(403, "EVENT_BANK_TRANSFER_UNAVAILABLE", eventBank.reason === "missing"
      ? "The booking configuration no longer supports changing payment method"
      : "Bank transfer is not available for this session");
  }
  if (booking?.paymentStatus !== "unpaid") {
    return paymentRouteError(409, "PAYMENT_STATE_CONFLICT", "The booking payment state cannot be changed to bank transfer");
  }
  return { ok: true, idempotent: false, settings };
}

async function switchMainBookingToManualBank({ modifyToken, action, readDb, writeDb, getStripeClient = getStripe, nowMs = Date.now() }) {
  if (action !== undefined && action !== null && !["select-bank", "transfer-sent"].includes(action)) {
    return paymentRouteError(400, "INVALID_ACTION", "Invalid bank transfer action");
  }
  const supplied = suppliedBookingCapability(modifyToken);
  if (!supplied || typeof readDb !== "function" || typeof writeDb !== "function") {
    return paymentRouteError(404, "BOOKING_NOT_FOUND", "Booking not found");
  }
  const initialDb = readDb();
  const initialBooking = mainBookingByCapability(initialDb, supplied);
  if (!initialBooking) return paymentRouteError(404, "BOOKING_NOT_FOUND", "Booking not found");

  return withCheckoutResourceLock(bookingCheckoutResourceLockKey("main", initialBooking.id), async () => {
    const db = readDb();
    const bookings = parseStored(db?.wv_bookings, []);
    const bookingIndex = bookings.findIndex(booking => booking?.id === initialBooking.id
      && !booking?.tenantSlug
      && storedBookingCapabilityMatches(booking, supplied));
    if (bookingIndex < 0) return paymentRouteError(404, "BOOKING_NOT_FOUND", "Booking not found");
    const booking = bookings[bookingIndex];
    const validation = validateManualBankTransition(db, booking, nowMs);
    if (!validation.ok) return validation;

    const priorSessionId = booking.stripeCheckoutSessionId || null;
    let stripeClient = null;
    if (priorSessionId) {
      try { stripeClient = getStripeClient(); }
      catch { return paymentRouteError(503, "STRIPE_STATUS_UNAVAILABLE", "The card payment status could not be verified; please try again shortly"); }
    }
    const revocation = await revokeBookingCheckoutForBank(stripeClient, priorSessionId);
    if (!revocation.ok) return revocation;

    // Stripe and its webhook operate outside this checkout lock. Re-read the
    // canonical booking after the network call so a just-paid booking always
    // beats the bank transition and is never downgraded.
    const commitDb = readDb();
    const commitBookings = parseStored(commitDb?.wv_bookings, []);
    const commitIndex = commitBookings.findIndex(item => item?.id === booking.id
      && !item?.tenantSlug
      && storedBookingCapabilityMatches(item, supplied));
    if (commitIndex < 0) return paymentRouteError(404, "BOOKING_NOT_FOUND", "Booking not found");
    const current = commitBookings[commitIndex];
    const commitValidation = validateManualBankTransition(commitDb, current, nowMs);
    if (!commitValidation.ok) return commitValidation;
    if (canonicalBankPending(current)) {
      return { status: 200, changed: false, bookingRecord: current, body: { ok: true, changed: false, booking: safePaymentBookingDto(current) } };
    }
    if (String(current.stripeCheckoutSessionId || "") !== String(priorSessionId || "")) {
      return paymentRouteError(409, "PAYMENT_STATE_CONFLICT", "The card checkout changed while bank transfer was being selected");
    }

    const changedAt = new Date(nowMs).toISOString();
    const paymentHistory = Array.isArray(current.paymentHistory) ? current.paymentHistory.slice(-99) : [];
    const checkoutHistory = Array.isArray(current.stripeCheckoutHistory) ? current.stripeCheckoutHistory.slice(-19) : [];
    const updated = {
      ...current,
      paymentStatus: "pending-confirmation",
      paymentMethod: "bank",
      depositMethod: "bank",
      paymentPath: "bank",
      holdExpiresAt: manualBankHoldExpiresAt(commitValidation.settings, nowMs),
      bankTransferPendingAt: changedAt,
      bankTransferVerificationStatus: "pending-admin-verification",
      stripeCheckoutStatus: priorSessionId ? "expired-for-bank-transfer" : "superseded-by-bank-transfer",
      stripeCheckoutRevokedAt: priorSessionId ? changedAt : undefined,
      paymentHistory: [...paymentHistory, {
        action: "manual-bank-transfer-selected",
        changedAt,
        source: "client-capability",
        fromPaymentStatus: current.paymentStatus,
        fromPaymentMethod: bookingPaymentMethod(current),
        paymentStatus: "pending-confirmation",
        paymentMethod: "bank",
        verification: "pending-admin-verification",
        note: "Manual bank transfer selected; awaiting admin verification",
      }],
      ...(priorSessionId ? {
        stripeCheckoutHistory: [...checkoutHistory, {
          stripeSessionId: priorSessionId,
          status: "expired-for-bank-transfer",
          changedAt,
          outcome: revocation.outcome,
        }],
      } : {}),
    };
    // Revoking the canonical pointer makes any delayed paid webhook fail the
    // checkout snapshot check and enter paid-unallocated manual review instead
    // of overwriting this manual bank state.
    delete updated.stripeCheckoutSessionId;
    delete updated.stripeCheckoutSnapshotHash;
    delete updated.stripeCheckoutExpectedAmountCents;
    delete updated.stripeCheckoutExpectedCurrency;
    delete updated.stripeCheckoutPaymentKind;
    commitBookings[commitIndex] = updated;
    commitDb.wv_bookings = JSON.stringify(commitBookings);
    try {
      writeDb(commitDb);
    } catch {
      return paymentRouteError(500, "WRITE_FAILED", "The payment method could not be saved; please try again");
    }
    return { status: 200, changed: true, bookingRecord: updated, body: { ok: true, changed: true, booking: safePaymentBookingDto(updated) } };
  });
}

async function getMainBookingPaymentStatus({ modifyToken, readDb, getStripeClient = getStripe, nowMs = Date.now() }) {
  const supplied = suppliedBookingCapability(modifyToken);
  if (!supplied || typeof readDb !== "function") return paymentRouteError(404, "BOOKING_NOT_FOUND", "Booking not found");
  const db = readDb();
  const booking = mainBookingByCapability(db, supplied);
  if (!booking) return paymentRouteError(404, "BOOKING_NOT_FOUND", "Booking not found");
  const settings = parseStored(db?.wv_settings, {});
  const eventBank = canonicalEventPaymentMethod(db, booking, "bank");
  const eventStripe = canonicalEventPaymentMethod(db, booking, "stripe");
  const terminal = bookingPaymentIsTerminal(booking);
  const fullySettled = ["paid", "cash"].includes(booking.paymentStatus);
  const bankPending = canonicalBankPending(booking);
  const holdActive = bookingBlocksAvailability(booking, nowMs);
  let checkoutState = booking.stripeCheckoutSessionId ? "unavailable" : "none";
  const activeBalanceCheckout = booking.paymentStatus === "deposit-paid" && booking.stripeCheckoutPaymentKind === "balance";
  if (!terminal && !fullySettled && !bankPending && booking.stripeCheckoutSessionId
    && (booking.paymentStatus !== "deposit-paid" || activeBalanceCheckout)) {
    checkoutState = (await retrieveBookingCheckout(getStripeClient(), booking.stripeCheckoutSessionId)).state;
  }

  let state;
  if (terminal) state = "not-payable";
  else if (booking.paymentStatus === "paid") state = "paid";
  else if (booking.paymentStatus === "cash") state = "not-payable";
  else if (booking.paymentNeedsReview === true) state = "payment-review";
  else if (bankPending && !holdActive) state = "hold-expired";
  else if (bankPending) state = "bank-pending";
  else if (checkoutState === "processing") state = "checkout-processing";
  else if (!holdActive) state = "hold-expired";
  else if (checkoutState === "open") state = "checkout-open";
  else if (["expired", "missing"].includes(checkoutState)) state = "checkout-expired";
  else if (checkoutState === "unavailable") state = "checkout-status-unavailable";
  else if (booking.paymentStatus === "deposit-paid") state = "deposit-paid";
  else if (booking.paymentStatus !== "unpaid") state = "not-payable";
  else state = "unpaid";

  const retryableState = ["checkout-open", "checkout-expired", "deposit-paid", "unpaid"].includes(state);
  const payment = bookingPaymentDetails(booking);
  const cardPayable = !terminal
    && !fullySettled
    && !payment.error
    && ["unpaid", "deposit-paid"].includes(booking.paymentStatus)
    && holdActive;
  const canRetryCard = cardPayable
    && retryableState
    && settings?.stripeEnabled !== false
    && mainStripeReady()
    && eventStripe.allowed;
  const canSubmitBank = !terminal
    && !fullySettled
    && booking.paymentStatus === "unpaid"
    && holdActive
    && retryableState
    && settings?.bankTransfer?.enabled === true
    && eventBank.allowed;
  const safeHold = Number.isFinite(Date.parse(booking.holdExpiresAt || "")) ? booking.holdExpiresAt : undefined;
  const resolvedPaymentMethod = bookingPaymentMethod(booking);
  return {
    status: 200,
    body: {
      ok: true,
      payment: {
        state,
        paymentStatus: String(booking.paymentStatus || "unpaid"),
        ...(resolvedPaymentMethod ? { paymentMethod: resolvedPaymentMethod } : {}),
        canRetryCard,
        canSubmitBank,
        bankTransferIsManual: true,
        requiresAdminVerification: state === "bank-pending",
        ...(safeHold ? { holdExpiresAt: safeHold } : {}),
      },
    },
  };
}

function registerRoutes(app, { readDb, writeDb, readLicenseKeys, writeLicenseKeys, getGallerySession, onBookingPaid } = {}) {
  const checkoutLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many checkout requests — please wait" } });
  const paymentStatusLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false, message: { ok: false, code: "RATE_LIMITED", error: "Too many payment status requests — please wait" } });
  // ── Status ─────────────────────────────────────────
  app.get("/api/stripe/status", (_req, res) => {
    const configured = mainStripeReady();
    res.json({ configured, publishableKey: configured ? (process.env.STRIPE_PUBLISHABLE_KEY || null) : null });
  });

  // Capability-authenticated booking payment state. This exposes no Stripe
  // identifiers or client PII and never reconciles or mutates payment state.
  app.get("/api/booking/:modifyToken/payment/status", paymentStatusLimiter, async (req, res) => {
    try {
      const result = await getMainBookingPaymentStatus({ modifyToken: req.params.modifyToken, readDb });
      res.setHeader("Cache-Control", "private, no-store");
      return res.status(result.status).json(result.body);
    } catch (error) {
      console.error("Booking payment status error:", error);
      return res.status(500).json({ ok: false, code: "STATUS_CHECK_FAILED", error: "Payment status could not be checked" });
    }
  });

  // Select a manual bank transfer for an existing main booking. This records
  // only pending admin verification; it never confirms payment or the booking.
  app.post("/api/booking/:modifyToken/payment/bank", checkoutLimiter, async (req, res) => {
    try {
      const result = await switchMainBookingToManualBank({
        modifyToken: req.params.modifyToken,
        action: req.body?.action,
        readDb,
        writeDb,
      });
      if (result.status === 200 && result.changed === true && result.bookingRecord) {
        const booking = result.bookingRecord;
        try {
          const profile = parseStored(readDb()?.wv_profile, {});
          const payment = bookingPaymentDetails(booking);
          sendBookingConfirmationEmail({
            to: booking.clientEmail,
            clientName: booking.clientName,
            eventTitle: booking.type,
            date: booking.date,
            time: booking.time,
            duration: booking.duration,
            location: booking.location || "",
            price: booking.paymentAmount || 0,
            depositAmount: booking.depositAmount || 0,
            paymentMethod: "bank",
            paymentStatus: booking.paymentStatus,
            paymentKind: payment.error ? undefined : payment.paymentKind,
            status: booking.status,
            modifyToken: booking.modifyToken,
            bookingId: booking.id,
            appBaseUrl: String(process.env.APP_BASE_URL || `https://${String(process.env.APP_HOSTS || "book.zacmclients.photos").split(",")[0].trim()}`).replace(/\/$/, ""),
            brandName: profile.businessName || profile.brandName || profile.name || "PhotoFlow",
          }).then(emailResult => {
            if (!emailResult.ok && emailResult.reason !== "not_configured") console.error(`Bank-pending booking receipt failed for ${booking.id}:`, emailResult.error || emailResult.reason);
          }).catch(error => console.error(`Bank-pending booking receipt failed for ${booking.id}:`, error?.message || error));
        } catch (error) {
          console.error(`Bank-pending booking receipt failed for ${booking.id}:`, error?.message || error);
        }
        // The callback registered by index.js queues the same initial calendar
        // sync used by a booking that selected bank transfer at creation time.
        if (onBookingPaid) {
          setImmediate(() => Promise.resolve(onBookingPaid(booking)).catch(error => console.error(`Bank-pending booking callback failed for ${booking.id}:`, error?.message || error)));
        }
      }
      return res.status(result.status).json(result.body);
    } catch (error) {
      console.error("Booking bank transfer selection error:", error);
      return res.status(500).json({ ok: false, code: "BANK_TRANSFER_FAILED", error: "Bank transfer could not be selected" });
    }
  });

  // ── Create Checkout Session (booking deposit) ──────
  app.post("/api/stripe/checkout/booking", checkoutLimiter, async (req, res) => {
    const s = getStripe();
    if (!s || !mainStripeReady()) return res.status(503).json({ code: "STRIPE_UNAVAILABLE", error: "Stripe checkout is unavailable until webhook verification is configured" });
    const { bookingId, successUrl, cancelUrl } = req.body || {};
    try {
      await withCheckoutResourceLock(bookingCheckoutResourceLockKey("main", bookingId), async () => {
        const db = readDb();
        const bookings = parseStored(db["wv_bookings"], []);
        const bookingIndex = bookings.findIndex(item => item.id === bookingId && !item.tenantSlug);
        if (bookingIndex < 0) return res.status(404).json({ code: "BOOKING_NOT_FOUND", error: "Booking not found or no longer payable" });
        const booking = bookings[bookingIndex];
        const suppliedCapability = suppliedBookingCapability(req.body?.modifyToken);
        if (!storedBookingCapabilityMatches(booking, suppliedCapability)) return res.status(403).json({ code: "INVALID_BOOKING_CAPABILITY", error: "Invalid booking capability" });
        if (booking.archived === true || ["cancelled", "completed"].includes(booking.status)) return res.status(409).json({ code: "BOOKING_NOT_PAYABLE", error: "Booking is no longer payable" });
        const checkoutStage = bookingStripeCheckoutStage(booking);
        if (!checkoutStage.ok) return res.status(409).json({ code: checkoutStage.code, error: checkoutStage.error });
        if (!bookingBlocksAvailability(booking)) return res.status(409).json({ code: "BOOKING_HOLD_EXPIRED", error: "This booking hold has expired" });
        const total = Number(booking.paymentAmount);
        const deposit = Number(booking.depositAmount) || 0;
        if (!Number.isFinite(total) || total <= 0) return res.status(400).json({ code: "BOOKING_NOT_PAYABLE", error: "This booking does not require payment" });
        let paymentKind = "full";
        let amount = total;
        if (booking.paymentStatus === "deposit-paid" && deposit > 0) {
          paymentKind = "balance";
          amount = Math.max(0, total - deposit);
        } else if (booking.depositRequired && deposit > 0) {
          paymentKind = "deposit";
          amount = deposit;
        }
        if (!Number.isFinite(amount) || amount <= 0) return res.status(409).json({ code: "BOOKING_ALREADY_SETTLED", error: "No balance remains on this booking" });
        const expectedAmountCents = Math.round(amount * 100);
        const checkoutSnapshot = bookingCheckoutSnapshot(booking, "main", paymentKind, expectedAmountCents, "aud");
        const fulfilledDepositCheckout = paymentKind === "balance" && booking.paymentStatus === "deposit-paid" && (
          booking.stripeFulfilments?.deposit?.stripeSessionId === booking.stripeCheckoutSessionId
          || booking.stripeSessionId === booking.stripeCheckoutSessionId
          || (booking.stripeCheckoutPaymentKind === "deposit" && booking.stripeCheckoutStatus === "completed")
        );
        if (booking.stripeCheckoutSessionId && !fulfilledDepositCheckout) {
          const existing = await inspectExistingCheckout(s, booking.stripeCheckoutSessionId, {
            amountCents: expectedAmountCents,
            currency: "aud",
            snapshotHash: checkoutSnapshot.snapshotHash,
          });
          if (existing.action === "reuse") return res.json({ url: existing.session.url, sessionId: existing.session.id, reused: true });
          if (existing.action === "processing") return res.status(409).json({ code: "STRIPE_PAYMENT_PROCESSING", error: "A payment for this booking is already processing", sessionId: existing.session.id });
        }
        const expiresAt = checkoutExpirySeconds(booking.holdExpiresAt);
        const session = await s.checkout.sessions.create({
          payment_method_types: ["card"],
          customer_email: booking.clientEmail || undefined,
          client_reference_id: String(booking.id),
          line_items: [{
            price_data: {
              currency: "aud",
              product_data: {
                name: `${paymentKind === "deposit" ? "Deposit" : paymentKind === "balance" ? "Remaining balance" : "Payment"} — ${booking.type || "Booking"}`,
                description: `Booking for ${booking.clientName || "Client"}`,
              },
              unit_amount: expectedAmountCents,
            },
            quantity: 1,
          }],
          mode: "payment",
          expires_at: expiresAt,
          success_url: safeCheckoutReturnUrl(req, successUrl, `/booking?success=1&bookingId=${encodeURIComponent(bookingId)}`),
          cancel_url: safeCheckoutReturnUrl(req, cancelUrl, `/booking/modify/${encodeURIComponent(booking.modifyToken)}?checkout=cancelled`),
          metadata: {
            bookingId,
            type: "booking-payment",
            paymentKind,
            app: "watermark-vault",
            expectedAmountCents: String(expectedAmountCents),
            expectedCurrency: "aud",
            checkoutSnapshotHash: checkoutSnapshot.snapshotHash,
          },
        });
        bookings[bookingIndex] = {
          ...booking,
          stripeCheckoutSessionId: session.id,
          stripeCheckoutStartedAt: new Date().toISOString(),
          stripeCheckoutStatus: "open",
          stripeCheckoutSnapshotHash: checkoutSnapshot.snapshotHash,
          stripeCheckoutExpectedAmountCents: expectedAmountCents,
          stripeCheckoutExpectedCurrency: "aud",
          stripeCheckoutPaymentKind: paymentKind,
          paymentMethod: "stripe",
          depositMethod: "stripe",
          holdExpiresAt: new Date(Number(session.expires_at || expiresAt) * 1000).toISOString(),
        };
        db["wv_bookings"] = JSON.stringify(bookings);
        try {
          writeDb(db);
        } catch (error) {
          await s.checkout.sessions.expire(session.id).catch(() => {});
          throw error;
        }
        return res.json({ url: session.url, sessionId: session.id });
      });
    } catch (err) {
      console.error("Stripe checkout error:", err);
      if (!res.headersSent) res.status(500).json({ code: "STRIPE_CHECKOUT_FAILED", error: err.message });
    }
  });

  app.post("/api/stripe/checkout/album", checkoutLimiter, async (req, res) => {
    const s = getStripe();
    if (!s || !mainStripeReady()) return res.status(503).json({ error: "Stripe checkout is unavailable until webhook verification is configured" });
    const { albumId, clientEmail, successUrl, cancelUrl } = req.body;
    const initialDb = readDb();
    const initialAlbums = parseStored(initialDb["wv_albums"], []);
    const initialAlbum = initialAlbums.find(item => item.id === albumId || item.slug === albumId);
    const gallerySession = initialAlbum && getGallerySession ? getGallerySession(req, initialAlbum) : null;
    if (!gallerySession || gallerySession.tenantSlug != null) return res.status(401).json({ error: "A valid gallery session is required" });
    try {
      await withCheckoutResourceLock(`checkout:main:album:${initialAlbum?.id || albumId}:${gallerySession.sessionKey}`, async () => {
        const db = readDb();
        const albums = parseStored(db["wv_albums"], []);
        const album = albums.find(item => item.id === initialAlbum?.id && item.tenantSlug == null);
        if (!album) return res.status(404).json({ error: "Album not found" });
        const checkout = calculateAlbumCheckout(album, {
          ...req.body,
          sessionKey: gallerySession.sessionKey,
          unlockedPhotoIds: parseStored(db[`wv_session_${gallerySession.sessionKey}_${album.id}`], {})?.unlockedPhotoIds,
          timezone: parseStored(db["wv_profile"], {})?.timezone,
        });
        if (checkout.error) return res.status(400).json({ error: checkout.error });
        checkout.currency = "aud";
        const intent = albumCheckoutSnapshot(album, checkout, null, clientEmail);
        const orders = pruneCheckoutOrders(parseStored(db["wv_album_checkout_orders"], {}));
        let ordersChanged = false;
        const priorOrders = Object.values(orders)
          .filter(order => order?.albumId === album.id && order?.tenantSlug == null && order?.sessionKey === checkout.sessionKey && order?.status === "open")
          .sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""));
        for (const priorOrder of priorOrders) {
          if (!priorOrder.checkoutSessionId) {
            orders[priorOrder.id] = { ...priorOrder, status: "abandoned" };
            ordersChanged = true;
            continue;
          }
          const existing = await inspectExistingCheckout(s, priorOrder.checkoutSessionId, {
            amountCents: intent.snapshot.amountCents,
            currency: "aud",
            snapshotHash: intent.snapshotHash,
          });
          if (existing.action === "reuse" && priorOrder.intentHash === intent.snapshotHash) {
            if (ordersChanged) {
              db["wv_album_checkout_orders"] = orders;
              writeDb(db);
            }
            return res.json({ url: existing.session.url, sessionId: existing.session.id, reused: true });
          }
          if (existing.action === "processing") return res.status(409).json({ error: "An album payment is already processing", sessionId: existing.session.id });
          orders[priorOrder.id] = { ...priorOrder, status: "expired", expiredAt: new Date().toISOString() };
          ordersChanged = true;
        }
        if (ordersChanged) {
          db["wv_album_checkout_orders"] = orders;
          writeDb(db);
        }
        const orderId = crypto.randomUUID();
        const productName = checkout.isFullAlbum ? checkout.albumTitle : `${checkout.photoCount} Photo(s) — ${checkout.albumTitle}`;
        const session = await s.checkout.sessions.create({
          payment_method_types: ["card"],
          customer_email: clientEmail || undefined,
          client_reference_id: String(album.id),
          line_items: [{
            price_data: {
              currency: "aud",
              product_data: {
                name: productName,
                description: `${checkout.photoCount} photos`,
              },
              unit_amount: intent.snapshot.amountCents,
            },
            quantity: 1,
          }],
          mode: "payment",
          ...(checkout.expiresAtSeconds ? { expires_at: checkout.expiresAtSeconds } : {}),
          success_url: safeCheckoutReturnUrl(req, successUrl, `/gallery/${encodeURIComponent(albumId)}?success=1`),
          cancel_url: safeCheckoutReturnUrl(req, cancelUrl, `/gallery/${encodeURIComponent(albumId)}?cancelled=1`),
          metadata: {
            albumId: album.id,
            type: "album-purchase",
            orderId,
            isFullAlbum: checkout.isFullAlbum ? "true" : "false",
            sessionKey: checkout.sessionKey,
            expectedAmountCents: String(intent.snapshot.amountCents),
            expectedCurrency: "aud",
            checkoutSnapshotHash: intent.snapshotHash,
          },
        });
        orders[orderId] = {
          id: orderId,
          albumId: album.id,
          tenantSlug: null,
          ...checkout,
          expectedAmountCents: intent.snapshot.amountCents,
          currency: "aud",
          intentHash: intent.snapshotHash,
          checkoutSessionId: session.id,
          checkoutExpiresAt: new Date(Number(session.expires_at || 0) * 1000).toISOString(),
          status: "open",
          createdAt: new Date().toISOString(),
        };
        db["wv_album_checkout_orders"] = orders;
        try {
          writeDb(db);
        } catch (error) {
          await s.checkout.sessions.expire(session.id).catch(() => {});
          throw error;
        }
        return res.json({ url: session.url, sessionId: session.id });
      });
    } catch (err) {
      console.error("Stripe checkout error:", err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });

  // ── Create Checkout Session (invoice) ─────────────
  app.post("/api/stripe/checkout/invoice", checkoutLimiter, async (req, res) => {
    const s = getStripe();
    if (!s || !mainStripeReady()) return res.status(503).json({ error: "Stripe checkout is unavailable until webhook verification is configured" });
    const { invoiceId, shareToken, successUrl, cancelUrl } = req.body;
    try {
      await withCheckoutResourceLock(`checkout:main:invoice:${invoiceId}`, async () => {
        const db = readDb();
        const invoices = parseStored(db["wv_invoices"], []);
        const matches = Array.isArray(invoices) ? invoices.filter(inv => inv?.id === invoiceId && inv?.tenantSlug == null) : [];
        const invoice = matches.length === 1 ? matches[0] : null;
        if (!invoice || !timingSafeTextEqual(shareToken, invoice.shareToken)) return res.status(404).json({ error: "Invoice not found" });
        if (!invoiceIsPayable(invoice)) return res.status(409).json({ error: "This invoice is not payable" });
        const checkout = invoiceCheckoutSnapshot(invoice);
        if (checkout.error) {
          const status = /currency/i.test(checkout.error) ? 400 : 409;
          return res.status(status).json({ error: checkout.error });
        }
        const orders = pruneCheckoutOrders(parseStored(db[INVOICE_CHECKOUT_ORDERS_KEY], {}));
        let ordersChanged = false;
        const priorOrders = Object.values(orders)
          .filter(order => order?.invoiceId === invoice.id && order?.tenantSlug == null && order?.status === "open")
          .sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""));
        for (const priorOrder of priorOrders) {
          if (!priorOrder.checkoutSessionId) {
            orders[priorOrder.id] = { ...priorOrder, status: "abandoned" };
            ordersChanged = true;
            continue;
          }
          const existing = await inspectExistingCheckout(s, priorOrder.checkoutSessionId, {
            amountCents: checkout.amountCents,
            currency: checkout.currency,
            snapshotHash: checkout.snapshotHash,
          });
          if (existing.action === "reuse" && priorOrder.snapshotHash === checkout.snapshotHash) {
            if (ordersChanged) {
              db[INVOICE_CHECKOUT_ORDERS_KEY] = orders;
              writeDb(db);
            }
            return res.json({ url: existing.session.url, sessionId: existing.session.id, reused: true });
          }
          if (existing.action === "processing") return res.status(409).json({ error: "An invoice payment is already processing", sessionId: existing.session.id });
          orders[priorOrder.id] = { ...priorOrder, status: "expired", expiredAt: new Date().toISOString() };
          ordersChanged = true;
        }
        if (ordersChanged) {
          db[INVOICE_CHECKOUT_ORDERS_KEY] = orders;
          writeDb(db);
        }
        const checkoutId = crypto.randomUUID();
        const expiresAt = checkoutExpirySeconds(new Date(Date.now() + 23 * 60 * 60_000).toISOString());
        const session = await s.checkout.sessions.create({
          payment_method_types: ["card"],
          customer_email: invoice.to?.email || undefined,
          client_reference_id: String(invoice.id),
          line_items: [{
            price_data: {
              currency: checkout.currency,
              product_data: {
                name: invoice.number ? `Invoice ${invoice.number}` : "Invoice Payment",
                description: `Payment for ${invoice.to?.name || "Client"}`,
              },
              unit_amount: checkout.amountCents,
            },
            quantity: 1,
          }],
          mode: "payment",
          expires_at: expiresAt,
          success_url: safeCheckoutReturnUrl(req, successUrl, `/invoice/${encodeURIComponent(shareToken)}?paid=1`),
          cancel_url: safeCheckoutReturnUrl(req, cancelUrl, `/invoice/${encodeURIComponent(shareToken)}`),
          metadata: {
            invoiceId,
            invoiceNumber: invoice.number || "",
            invoiceCheckoutId: checkoutId,
            type: "invoice-payment",
            expectedAmountCents: String(checkout.amountCents),
            expectedCurrency: checkout.currency,
            checkoutSnapshotHash: checkout.snapshotHash,
          },
        });
        orders[checkoutId] = {
          id: checkoutId,
          resourceType: "invoice",
          scope: "main",
          invoiceId: invoice.id,
          tenantSlug: null,
          shareTokenHash: checkout.snapshot.shareTokenHash,
          statusAtCheckout: checkout.snapshot.status,
          expectedAmountCents: checkout.amountCents,
          expectedCurrency: checkout.currency,
          snapshotHash: checkout.snapshotHash,
          checkoutSessionId: session.id,
          checkoutExpiresAt: new Date(Number(session.expires_at || expiresAt) * 1000).toISOString(),
          status: "open",
          createdAt: new Date().toISOString(),
        };
        const invoiceIndex = invoices.findIndex(item => item === invoice);
        invoices[invoiceIndex] = {
          ...invoice,
          stripeCheckoutOrderId: checkoutId,
          stripeCheckoutSessionId: session.id,
          stripeCheckoutStartedAt: new Date().toISOString(),
          stripeCheckoutStatus: "open",
          stripeCheckoutSnapshotHash: checkout.snapshotHash,
        };
        db["wv_invoices"] = JSON.stringify(invoices);
        db[INVOICE_CHECKOUT_ORDERS_KEY] = orders;
        try {
          writeDb(db);
        } catch (error) {
          await s.checkout.sessions.expire(session.id).catch(() => {});
          throw error;
        }
        return res.json({ url: session.url, sessionId: session.id });
      });
    } catch (err) {
      console.error("Stripe invoice checkout error:", err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });

  // ── Webhook ────────────────────────────────────────
  // Generous rate limit for Stripe webhooks — protects file-system writes while allowing
  // burst retries from Stripe (which retries up to 3× in quick succession on failure).
  const webhookLimiter = rateLimit({ windowMs: 10_000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests" } });
  app.post("/api/stripe/webhook", webhookLimiter, express.raw({ type: "application/json" }), async (req, res) => {
    const s = getStripe();
    if (!s) return res.status(400).json({ error: "Stripe not configured" });
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    let event;
    try {
      if (webhookSecret && sig) {
        event = s.webhooks.constructEvent(req.body, sig, webhookSecret);
      } else if (!webhookSecret && unsignedWebhookAllowed()) {
        event = JSON.parse(req.body.toString());
      } else {
        return res.status(webhookSecret ? 400 : 503).json({ error: webhookSecret ? "Stripe signature is required" : "STRIPE_WEBHOOK_SECRET is not configured" });
      }
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).json({ error: "Webhook verification failed" });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const metadata = session.metadata || {};
      if (!checkoutIsPaid(session)) return res.status(409).json({ error: "Checkout has not been paid" });
      console.log(`✅ Payment completed: ${metadata.type} — ${metadata.bookingId || metadata.albumId}`);
      if (!readDb || !writeDb) return res.status(500).json({ error: "Database helpers are unavailable" });
      try {
        await withCheckoutResourceLock(webhookResourceLockKey("main", metadata), async () => {
          const db = readDb();
          if (isStripeEventProcessed(db, "main", event.id)) return res.json({ received: true, duplicate: true });
          const saveDb = writeDb;
        
        if ((metadata.type === "booking-payment" || metadata.type === "booking-deposit") && metadata.bookingId) {
          const raw = db["wv_bookings"];
          const bookings = raw ? (typeof raw === "string" ? JSON.parse(raw) : (Array.isArray(raw) ? raw : [])) : [];
          const idx = bookings.findIndex(b => b.id === metadata.bookingId);
          if (idx < 0 || bookings[idx].tenantSlug) throw new Error("Main booking was not found for Stripe fulfilment");
          {
            const fulfilmentKey = `main:booking:${metadata.bookingId}:${metadata.paymentKind || "full"}`;
            const priorFulfilment = stripeFulfilment(db, fulfilmentKey);
            const paymentProbe = applyBookingStripePayment(bookings[idx], metadata, session);
            if (priorFulfilment?.stripeSessionId === session.id || paymentProbe.alreadyFulfilled) {
              markStripeEventProcessed(db, "main", event);
              saveDb(db);
              return res.json({ received: true, duplicate: true });
            }
            let reviewReason = priorFulfilment?.stripeSessionId
              ? "Duplicate payment completed for an already fulfilled booking stage"
              : null;
            if (!reviewReason) {
              const validation = evaluateBookingStripePayment(bookings[idx], metadata, session, "main", "aud");
              if (!validation.valid) reviewReason = validation.reason;
            }
            if (reviewReason) {
              bookings[idx] = reviewBookingStripePayment(bookings[idx], metadata, session, reviewReason);
              db["wv_bookings"] = JSON.stringify(bookings);
              recordStripePaymentReview(db, {
                resourceType: "booking",
                resourceId: metadata.bookingId,
                tenantSlug: null,
                stripeSessionId: session.id,
                amountTotal: session.amount_total,
                currency: session.currency,
                reason: reviewReason,
              });
              markStripeEventProcessed(db, "main", event);
              saveDb(db);
              return res.json({ received: true, paymentNeedsReview: true });
            }
            const paymentApplication = applyBookingStripePayment(bookings[idx], metadata, session);
            bookings[idx] = paymentApplication.booking;
            if (paymentApplication.needsReview) {
              db["wv_bookings"] = JSON.stringify(bookings);
              recordStripePaymentReview(db, {
                resourceType: "booking",
                resourceId: metadata.bookingId,
                tenantSlug: null,
                stripeSessionId: session.id,
                amountTotal: session.amount_total,
                currency: session.currency,
                reason: bookings[idx].paymentReviewReason,
              });
              markStripeEventProcessed(db, "main", event);
              saveDb(db);
              console.error(`Stripe payment for booking ${metadata.bookingId} requires manual review: ${bookings[idx].paymentReviewReason}`);
              return res.json({ received: true, paymentNeedsReview: true });
            }
            markStripeResourceFulfilled(db, fulfilmentKey, session, { resourceType: "booking", resourceId: metadata.bookingId, paymentKind: metadata.paymentKind || "full" });
            // Stripe creates the hosted receipt after payment completion. It is
            // optional (for example, for an unusual payment method), so a
            // receipt lookup failure must never prevent fulfilment.
            try {
              const paymentIntentId = bookings[idx].stripePaymentIntentId;
              if (paymentIntentId) {
                const paymentIntent = await s.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
                const latestCharge = paymentIntent.latest_charge;
                const receiptUrl = typeof latestCharge === "object" ? latestCharge?.receipt_url : null;
                if (receiptUrl) bookings[idx].stripeReceiptUrl = receiptUrl;
              }
            } catch (receiptErr) {
              console.warn(`Stripe receipt lookup failed for booking ${metadata.bookingId}:`, receiptErr.message);
            }
            db["wv_bookings"] = JSON.stringify(bookings);
            saveDb(db);
            const emailProfile = parseStored(db["wv_profile"], {});
            sendBookingConfirmationEmail({
              to: bookings[idx].clientEmail,
              clientName: bookings[idx].clientName,
              eventTitle: bookings[idx].type,
              date: bookings[idx].date,
              time: bookings[idx].time,
              duration: bookings[idx].duration,
              location: bookings[idx].location || "",
              price: bookings[idx].paymentAmount || 0,
              depositAmount: bookings[idx].depositAmount || 0,
              paymentMethod: "stripe",
              paymentStatus: bookings[idx].paymentStatus,
              paymentKind: metadata.paymentKind || "full",
              status: bookings[idx].status,
              modifyToken: bookings[idx].modifyToken,
              bookingId: bookings[idx].id,
              appBaseUrl: String(process.env.APP_BASE_URL || `https://${String(process.env.APP_HOSTS || "book.zacmclients.photos").split(",")[0].trim()}`).replace(/\/$/, ""),
              brandName: emailProfile.businessName || emailProfile.brandName || emailProfile.name || "PhotoFlow",
            }).then(result => {
              if (!result.ok && result.reason !== "not_configured") console.error(`Booking receipt email failed for ${metadata.bookingId}:`, result.error || result.reason);
            }).catch(error => console.error(`Booking receipt email failed for ${metadata.bookingId}:`, error?.message || error));
            if (onBookingPaid) {
              const paidBooking = bookings[idx];
              setImmediate(() => Promise.resolve(onBookingPaid(paidBooking)).catch(error => console.error(`Booking paid callback failed for ${metadata.bookingId}:`, error?.message || error)));
            }
            console.log(`📝 Booking ${metadata.bookingId} marked as ${bookings[idx].paymentStatus}`);
            try {
              const settings = parseStored(db["wv_settings"], {});
              if (settings?.discordWebhookUrl && settings?.discordNotifyPayments !== false) {
                notifyPayment(settings.discordWebhookUrl, bookings[idx], bookings[idx].paymentStatus).catch(err => console.error("Discord booking-payment notify error:", err.message));
              }
            } catch (discordErr) { console.error("Discord settings read error:", discordErr.message); }
          }
        }
        
        if (metadata.type === "album-purchase" && metadata.albumId) {
          const albums = parseStored(db["wv_albums"], []);
          const matches = albums.filter(album => album?.id === metadata.albumId && album?.tenantSlug == null);
          const albumIdx = matches.length === 1 ? albums.indexOf(matches[0]) : -1;
          if (albumIdx < 0) throw new Error("Album was not found unambiguously for Stripe fulfilment");
          {
            const album = albums[albumIdx];
            const checkoutOrders = pruneCheckoutOrders(parseStored(db["wv_album_checkout_orders"], {}));
            const order = metadata.orderId ? checkoutOrders[metadata.orderId] : null;
            const existingEntitlement = Object.values(album.sessionPurchases || {}).find(purchase => purchase?.stripeSessionId === session.id);
            if (existingEntitlement || (order?.status === "fulfilled" && order?.fulfilledStripeSessionId === session.id)) {
              markStripeEventProcessed(db, "main", event);
              saveDb(db);
              return res.json({ received: true, duplicate: true });
            }
            if (order?.status === "manual-review" && order?.paidStripeSessionId === session.id) {
              markStripeEventProcessed(db, "main", event);
              saveDb(db);
              return res.json({ received: true, duplicate: true, paymentNeedsReview: true });
            }
            const fulfilmentKey = albumFulfilmentKey("main", order);
            const priorFulfilment = order ? stripeFulfilment(db, fulfilmentKey) : null;
            let reviewReason = !order ? "Album payment has no valid server checkout order" : null;
            if (!reviewReason && priorFulfilment?.stripeSessionId && priorFulfilment.stripeSessionId !== session.id) {
              reviewReason = "Duplicate payment completed for an already fulfilled album selection";
            }
            if (!reviewReason) {
              const timezone = parseStored(db["wv_profile"], {})?.timezone || process.env.TZ || "Australia/Sydney";
              const sessionData = parseStored(db[`wv_session_${order.sessionKey}_${album.id}`], {});
              const validation = evaluateAlbumStripePayment(album, order, metadata, session, null, timezone, "aud", sessionData?.unlockedPhotoIds);
              if (!validation.valid) reviewReason = validation.reason;
            }
            if (reviewReason) {
              appendAlbumPaymentReview(album, order, session, reviewReason);
              markCheckoutOrderForReview(db, "wv_album_checkout_orders", checkoutOrders, order, session, "album", metadata.albumId, reviewReason, null);
              albums[albumIdx] = album;
              db["wv_albums"] = JSON.stringify(albums);
              markStripeEventProcessed(db, "main", event);
              saveDb(db);
              return res.json({ received: true, paymentNeedsReview: true });
            }
            // Record the purchase per-session so other visitors aren't affected
            const sKey = order.sessionKey;
            const sessionPurchases = album.sessionPurchases || {};
            const currentPurchase = sessionPurchases[sKey] || {};
            const stripeSessionIds = [...new Set([...(currentPurchase.stripeSessionIds || []), currentPurchase.stripeSessionId, session.id].filter(Boolean))];
            if (order.isFullAlbum === true) {
              // Full album — unlock for this session only
              sessionPurchases[sKey] = { ...currentPurchase, fullAlbum: true, photoIds: [], paidAt: new Date().toISOString(), stripeSessionId: session.id, stripeSessionIds, purchaserEmail: session.customer_email || currentPurchase.purchaserEmail || "", purchaserEmailVerified: !!session.customer_email || currentPurchase.purchaserEmailVerified === true, emailVerifiedAt: session.customer_email ? new Date().toISOString() : currentPurchase.emailVerifiedAt };
              album.stripePaidAt = new Date().toISOString(); // for finance view
              console.log(`📝 Album ${metadata.albumId} full album unlocked for session ${sKey}`);
            } else {
              // Per-photo — add to this session's purchased set
              const newIds = Array.isArray(order.photoIds) ? order.photoIds : [];
              const existing = currentPurchase.photoIds || [];
              sessionPurchases[sKey] = { ...currentPurchase, fullAlbum: currentPurchase.fullAlbum === true, photoIds: [...new Set([...existing, ...newIds])], paidAt: new Date().toISOString(), stripeSessionId: session.id, stripeSessionIds, purchaserEmail: session.customer_email || currentPurchase.purchaserEmail || "", purchaserEmailVerified: !!session.customer_email || currentPurchase.purchaserEmailVerified === true, emailVerifiedAt: session.customer_email ? new Date().toISOString() : currentPurchase.emailVerifiedAt };
              console.log(`📝 Album ${metadata.albumId}: ${newIds.length} photo(s) unlocked for session ${sKey}`);
            }
            album.sessionPurchases = sessionPurchases;
            checkoutOrders[order.id] = { ...order, status: "fulfilled", fulfilledStripeSessionId: session.id, fulfilledAt: new Date().toISOString() };
            markStripeResourceFulfilled(db, fulfilmentKey, session, { resourceType: "album", resourceId: album.id, sessionKey: sKey });
            db["wv_album_checkout_orders"] = checkoutOrders;
            albums[albumIdx] = album;
            db["wv_albums"] = JSON.stringify(albums);
            saveDb(db);

            // Discord notification for album purchase
            try {
              const rawSettings = db["wv_settings"];
              const settings = typeof rawSettings === "string" ? JSON.parse(rawSettings) : (rawSettings || {});
              const discordUrl = settings?.discordWebhookUrl;
              if (discordUrl && settings?.discordNotifyDownloads !== false) {
                const purchaseType = metadata.isFullAlbum === "true" ? "full" : "individual";
                const purchasedPhotoIds = sessionPurchases[sKey]?.photoIds || [];
                notifyAlbumPurchase(discordUrl, album, purchaseType, (session.amount_total || 0) / 100, session.customer_email || "", purchasedPhotoIds).catch(err => console.error("Discord album-purchase notify error:", err.message));
              }
            } catch (discordErr) {
              console.error("Discord settings read error:", discordErr.message);
            }
          }
        }

        if (metadata.type === "invoice-payment" && metadata.invoiceId) {
          const invoices = parseStored(db["wv_invoices"], []);
          const matches = invoices.filter(invoice => invoice?.id === metadata.invoiceId && invoice?.tenantSlug == null);
          const idx = matches.length === 1 ? invoices.indexOf(matches[0]) : -1;
          {
            const invoice = idx >= 0 ? invoices[idx] : null;
            const orders = pruneCheckoutOrders(parseStored(db[INVOICE_CHECKOUT_ORDERS_KEY], {}));
            const order = metadata.invoiceCheckoutId ? orders[metadata.invoiceCheckoutId] : null;
            const fulfilmentKey = `main:invoice:${metadata.invoiceId}`;
            const priorFulfilment = stripeFulfilment(db, fulfilmentKey);
            if ((invoice?.stripeSessionId === session.id && invoice?.status === "paid") || priorFulfilment?.stripeSessionId === session.id || (order?.status === "fulfilled" && order?.fulfilledStripeSessionId === session.id)) {
              markStripeEventProcessed(db, "main", event);
              saveDb(db);
              return res.json({ received: true, duplicate: true });
            }
            if (order?.status === "manual-review" && order?.paidStripeSessionId === session.id) {
              markStripeEventProcessed(db, "main", event);
              saveDb(db);
              return res.json({ received: true, duplicate: true, paymentNeedsReview: true });
            }
            let reviewReason = priorFulfilment?.stripeSessionId
              ? "Duplicate payment completed for an already paid invoice"
              : null;
            if (!reviewReason) {
              const validation = evaluateInvoiceStripePayment(invoice, order, metadata, session);
              if (!validation.valid) reviewReason = validation.reason;
            }
            if (reviewReason) {
              if (invoice) {
                const reviews = Array.isArray(invoice.paymentReviews) ? invoice.paymentReviews : [];
                invoices[idx] = {
                  ...invoice,
                  paymentNeedsReview: true,
                  paymentReviewStatus: "paid-unallocated",
                  paymentReviewReason: reviewReason,
                  paymentReviews: reviews.some(review => review?.stripeSessionId === session.id) ? reviews : [...reviews, {
                    stripeSessionId: session.id,
                    amountTotal: session.amount_total,
                    currency: session.currency,
                    reason: reviewReason,
                    receivedAt: new Date().toISOString(),
                    status: "manual-review",
                  }],
                };
                db["wv_invoices"] = JSON.stringify(invoices);
              }
              markCheckoutOrderForReview(db, INVOICE_CHECKOUT_ORDERS_KEY, orders, order, session, "invoice", metadata.invoiceId, reviewReason, null);
              markStripeEventProcessed(db, "main", event);
              saveDb(db);
              console.error(`Invoice ${metadata.invoiceId} payment requires manual review: ${reviewReason}`);
              return res.json({ received: true, paymentNeedsReview: true });
            }
            invoices[idx] = {
              ...invoice,
              status: "paid",
              paidAt: new Date().toISOString(),
              stripeSessionId: session.id,
              stripeCheckoutStatus: "completed",
              emailLog: [
                ...(invoice.emailLog || []),
                { sentAt: new Date().toISOString(), type: "custom", to: invoice.to?.email || "", subject: "Payment Received" },
              ],
            };
            orders[order.id] = { ...order, status: "fulfilled", fulfilledStripeSessionId: session.id, fulfilledAt: new Date().toISOString() };
            markStripeResourceFulfilled(db, fulfilmentKey, session, { resourceType: "invoice", resourceId: metadata.invoiceId });
            db["wv_invoices"] = JSON.stringify(invoices);
            db[INVOICE_CHECKOUT_ORDERS_KEY] = orders;
            saveDb(db);
            console.log(`📝 Invoice ${metadata.invoiceId} marked as paid via Stripe`);

            // Discord notification
            try {
              const rawSettings = db["wv_settings"];
              const settings = typeof rawSettings === "string" ? JSON.parse(rawSettings) : (rawSettings || {});
              const discordUrl = settings?.discordWebhookUrl;
              if (discordUrl && settings?.discordNotifyInvoices !== false) {
                notifyInvoice(discordUrl, invoices[idx], "paid").catch(err => console.error("Discord invoice-paid notify error:", err.message));
              }
            } catch (discordErr) {
              console.error("Discord settings read error:", discordErr.message);
            }

            // Email confirmation to client
            try {
              const appBaseUrl = process.env.APP_BASE_URL || "";
              const shareUrl = appBaseUrl && invoices[idx].shareToken ? `${appBaseUrl}/invoice/${invoices[idx].shareToken}` : "";
              sendInvoicePaidEmail(invoices[idx], shareUrl).catch(err => console.error("Invoice paid email error:", err.message));
            } catch (emailErr) {
              console.error("Invoice paid email setup error:", emailErr.message);
            }
          }
        }

        // ── License Plan Purchase ─────────────────────────────
        if (metadata.type === "license-plan" && metadata.planId) {
          const review = recordLegacyLicensePlanPaymentReview(db, metadata, session);
          console.error(`Legacy license-plan payment ${session.id} requires manual review; no license key was issued${review.duplicate ? " (duplicate delivery)" : ""}`);
        }
          markStripeEventProcessed(db, "main", event);
          saveDb(db);
        });
      } catch (dbErr) {
        console.error("Failed to update DB after payment:", dbErr);
        return res.status(500).json({ error: "Payment fulfilment failed; Stripe should retry" });
      }
      if (res.headersSent) return;
    }

    res.json({ received: true });
  });
}

/**
 * Create a Stripe client from per-tenant settings.
 * Returns { client, publishableKey, currency, usingFallback }.
 * @param {object} tenantSettings - TenantSettings object
 */
function getTenantStripe(tenantSettings) {
  const key = tenantSettings?.stripeSecretKey;
  if (!key) return null;
  return stripe(key);
}

/**
 * Resolve the effective Stripe client + metadata for a tenant.
 * A tenant must configure its own account and webhook secret.
 */
function resolveTenantStripe(tenantSettings) {
  const tenantKey = tenantSettings?.stripeSecretKey;
  if (tenantKey && tenantSettings?.stripeEnabled !== false) {
    return {
      client: stripe(tenantKey),
      publishableKey: tenantSettings.stripePublishableKey || null,
      currency: (tenantSettings.stripeCurrency || "aud").toLowerCase(),
      usingFallback: false,
      webhookReady: !!tenantSettings.stripeWebhookSecret || unsignedWebhookAllowed(),
    };
  }
  // Do not silently fall back to the global account: global Stripe webhooks are
  // delivered to /api/stripe/webhook and cannot safely prove which dynamic
  // tenant webhook should fulfil the purchase.
  return null;
}

function tenantStripeReady(tenantSettings) {
  return resolveTenantStripe(tenantSettings)?.webhookReady === true;
}

/**
 * Register per-tenant Stripe routes.
 * Tenants can take deposits/payments using their own Stripe keys.
 */
function registerTenantStripeRoutes(app, { readDb, writeDb, readTenants, requireTenant, getGallerySession, sendTenantBookingReceipt, onBookingPaid, isTenantLicensed }) {
  const tenantCheckoutLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests" } });
  const findLicensedTenant = slug => {
    const tenant = readTenants().find(item => item.slug === slug && item.active !== false);
    return tenant && (!isTenantLicensed || isTenantLicensed(tenant)) ? tenant : null;
  };

  // Status — check if a tenant has Stripe configured (or falls back to superuser)
  app.get("/api/tenant/:slug/stripe/status", tenantCheckoutLimiter, (req, res) => {
    const { slug } = req.params;
    const tenant = findLicensedTenant(slug);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    const db = readDb();
    const raw = db[`t_${slug}_wv_tenant_settings`];
    const ts = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
    const resolved = resolveTenantStripe(ts);
    res.json({
      configured: resolved?.webhookReady === true,
      publishableKey: resolved?.webhookReady ? (resolved.publishableKey || null) : null,
      usingFallback: resolved?.usingFallback || false,
    });
  });

  // Checkout — booking deposit using tenant Stripe keys (falls back to superuser)
  app.post("/api/tenant/:slug/stripe/checkout/booking", tenantCheckoutLimiter, async (req, res) => {
    const { slug } = req.params;
    if (!findLicensedTenant(slug)) return res.status(404).json({ error: "Tenant not found" });
    const { bookingId, successUrl, cancelUrl } = req.body || {};
    try {
      await withCheckoutResourceLock(bookingCheckoutResourceLockKey(`tenant:${slug}`, bookingId), async () => {
        const db = readDb();
        const ts = parseStored(db[`t_${slug}_wv_tenant_settings`], {});
        const resolved = resolveTenantStripe(ts);
        if (!resolved?.webhookReady) return res.status(503).json({ error: "Stripe checkout is unavailable until webhook verification is configured" });
        const bookings = parseStored(db["wv_bookings"], []);
        const bookingIndex = bookings.findIndex(item => item.id === bookingId && item.tenantSlug === slug);
        if (bookingIndex < 0) return res.status(404).json({ code: "BOOKING_NOT_FOUND", error: "Booking not found or no longer payable" });
        const booking = bookings[bookingIndex];
        const suppliedCapability = suppliedBookingCapability(req.body?.modifyToken);
        if (!storedBookingCapabilityMatches(booking, suppliedCapability)) return res.status(403).json({ code: "INVALID_BOOKING_CAPABILITY", error: "Invalid booking capability" });
        if (booking.archived === true || ["cancelled", "completed"].includes(booking.status)) return res.status(409).json({ code: "BOOKING_NOT_PAYABLE", error: "Booking is no longer payable" });
        const checkoutStage = bookingStripeCheckoutStage(booking);
        if (!checkoutStage.ok) return res.status(409).json({ code: checkoutStage.code, error: checkoutStage.error });
        if (!bookingBlocksAvailability(booking)) return res.status(409).json({ code: "BOOKING_HOLD_EXPIRED", error: "This booking hold has expired" });
        const payment = bookingPaymentDetails(booking);
        if (payment.error) return res.status(/does not require/i.test(payment.error) ? 400 : 409).json({ code: "BOOKING_NOT_PAYABLE", error: payment.error });
        const accountHash = stripeAccountHash(ts.stripeSecretKey);
        const checkoutSnapshot = bookingCheckoutSnapshot(booking, `tenant:${slug}`, payment.paymentKind, payment.amountCents, resolved.currency);
        const fulfilledDepositCheckout = payment.paymentKind === "balance" && booking.paymentStatus === "deposit-paid" && (
          booking.stripeFulfilments?.deposit?.stripeSessionId === booking.stripeCheckoutSessionId
          || booking.stripeSessionId === booking.stripeCheckoutSessionId
          || (booking.stripeCheckoutPaymentKind === "deposit" && booking.stripeCheckoutStatus === "completed")
        );
        if (booking.stripeCheckoutSessionId && !fulfilledDepositCheckout) {
          if (booking.stripeCheckoutAccountHash && !timingSafeTextEqual(booking.stripeCheckoutAccountHash, accountHash)) {
            return res.status(409).json({ error: "Stripe account changed while a booking checkout is still open; resolve the previous checkout before retrying" });
          }
          const existing = await inspectExistingCheckout(resolved.client, booking.stripeCheckoutSessionId, {
            amountCents: payment.amountCents,
            currency: resolved.currency,
            snapshotHash: checkoutSnapshot.snapshotHash,
          });
          if (existing.action === "reuse") return res.json({ url: existing.session.url, sessionId: existing.session.id, reused: true });
          if (existing.action === "processing") return res.status(409).json({ code: "STRIPE_PAYMENT_PROCESSING", error: "A payment for this booking is already processing", sessionId: existing.session.id });
        }
        const expiresAt = checkoutExpirySeconds(booking.holdExpiresAt);
        const session = await resolved.client.checkout.sessions.create({
          payment_method_types: ["card"],
          customer_email: booking.clientEmail || undefined,
          client_reference_id: String(booking.id),
          line_items: [{
            price_data: {
              currency: resolved.currency,
              product_data: {
                name: `${payment.paymentKind === "deposit" ? "Deposit" : payment.paymentKind === "balance" ? "Remaining balance" : "Payment"} — ${booking.type || "Booking"}`,
                description: `Booking for ${booking.clientName || "Client"}`,
              },
              unit_amount: payment.amountCents,
            },
            quantity: 1,
          }],
          mode: "payment",
          expires_at: expiresAt,
          success_url: safeCheckoutReturnUrl(req, successUrl, `/book/${encodeURIComponent(slug)}?success=1&bookingId=${encodeURIComponent(bookingId)}`),
          cancel_url: safeCheckoutReturnUrl(req, cancelUrl, `/booking/modify/${encodeURIComponent(booking.modifyToken)}?checkout=cancelled`),
          metadata: {
            bookingId,
            tenantSlug: slug,
            type: "tenant-booking-payment",
            paymentKind: payment.paymentKind,
            expectedAmountCents: String(payment.amountCents),
            expectedCurrency: resolved.currency,
            checkoutSnapshotHash: checkoutSnapshot.snapshotHash,
          },
        });
        bookings[bookingIndex] = {
          ...booking,
          stripeCheckoutSessionId: session.id,
          stripeCheckoutStartedAt: new Date().toISOString(),
          stripeCheckoutStatus: "open",
          stripeCheckoutSnapshotHash: checkoutSnapshot.snapshotHash,
          stripeCheckoutExpectedAmountCents: payment.amountCents,
          stripeCheckoutExpectedCurrency: resolved.currency,
          stripeCheckoutPaymentKind: payment.paymentKind,
          stripeCheckoutAccountHash: accountHash,
          paymentMethod: "stripe",
          depositMethod: "stripe",
          holdExpiresAt: new Date(Number(session.expires_at || expiresAt) * 1000).toISOString(),
        };
        db["wv_bookings"] = JSON.stringify(bookings);
        try {
          writeDb(db);
        } catch (error) {
          await resolved.client.checkout.sessions.expire(session.id).catch(() => {});
          throw error;
        }
        return res.json({ url: session.url, sessionId: session.id });
      });
    } catch (err) {
      console.error("Tenant Stripe checkout error:", err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });

  // Checkout — album purchase using tenant Stripe keys (falls back to superuser)
  app.post("/api/tenant/:slug/stripe/checkout/album", tenantCheckoutLimiter, async (req, res) => {
    const { slug } = req.params;
    const tenant = findLicensedTenant(slug);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    const { albumId, clientEmail, successUrl, cancelUrl } = req.body;
    const initialDb = readDb();
    const initialAlbums = parseStored(initialDb[`t_${slug}_wv_albums`], []);
    const initialAlbum = initialAlbums.find(item => item.id === albumId || item.slug === albumId);
    const gallerySession = initialAlbum && getGallerySession ? getGallerySession(req, initialAlbum) : null;
    if (!gallerySession || gallerySession.tenantSlug !== slug) return res.status(401).json({ error: "A valid gallery session is required" });
    try {
      await withCheckoutResourceLock(`checkout:tenant:${slug}:album:${initialAlbum?.id || albumId}:${gallerySession.sessionKey}`, async () => {
        const db = readDb();
        const currentTenant = findLicensedTenant(slug);
        if (!currentTenant) return res.status(404).json({ error: "Tenant not found" });
        const ts = parseStored(db[`t_${slug}_wv_tenant_settings`], {});
        const resolved = resolveTenantStripe(ts);
        if (!resolved?.webhookReady) return res.status(503).json({ error: "Stripe checkout is unavailable until webhook verification is configured" });
        const albums = parseStored(db[`t_${slug}_wv_albums`], []);
        const album = albums.find(item => item.id === initialAlbum?.id);
        if (!album) return res.status(404).json({ error: "Album not found" });
        const sessionData = parseStored(db[`wv_session_${gallerySession.sessionKey}_${album.id}`], {});
        const checkout = calculateAlbumCheckout(album, { ...req.body, sessionKey: gallerySession.sessionKey, unlockedPhotoIds: sessionData?.unlockedPhotoIds, timezone: currentTenant.timezone });
        if (checkout.error) return res.status(400).json({ error: checkout.error });
        checkout.currency = resolved.currency;
        const intent = albumCheckoutSnapshot(album, checkout, slug);
        const accountHash = stripeAccountHash(ts.stripeSecretKey);
        const orders = pruneCheckoutOrders(parseStored(db["wv_album_checkout_orders"], {}));
        let ordersChanged = false;
        const priorOrders = Object.values(orders)
          .filter(order => order?.albumId === album.id && order?.tenantSlug === slug && order?.sessionKey === checkout.sessionKey && order?.status === "open")
          .sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""));
        for (const priorOrder of priorOrders) {
          if (!priorOrder.checkoutSessionId) {
            orders[priorOrder.id] = { ...priorOrder, status: "abandoned" };
            ordersChanged = true;
            continue;
          }
          if (priorOrder.stripeAccountHash && !timingSafeTextEqual(priorOrder.stripeAccountHash, accountHash)) {
            return res.status(409).json({ error: "Stripe account changed while an album checkout is still open; resolve the previous checkout before retrying" });
          }
          const existing = await inspectExistingCheckout(resolved.client, priorOrder.checkoutSessionId, {
            amountCents: intent.snapshot.amountCents,
            currency: resolved.currency,
            snapshotHash: intent.snapshotHash,
          });
          if (existing.action === "reuse" && priorOrder.intentHash === intent.snapshotHash) {
            if (ordersChanged) {
              db["wv_album_checkout_orders"] = orders;
              writeDb(db);
            }
            return res.json({ url: existing.session.url, sessionId: existing.session.id, reused: true });
          }
          if (existing.action === "processing") return res.status(409).json({ error: "An album payment is already processing", sessionId: existing.session.id });
          orders[priorOrder.id] = { ...priorOrder, status: "expired", expiredAt: new Date().toISOString() };
          ordersChanged = true;
        }
        if (ordersChanged) {
          db["wv_album_checkout_orders"] = orders;
          writeDb(db);
        }
        const orderId = crypto.randomUUID();
        const productName = checkout.isFullAlbum ? checkout.albumTitle : `${checkout.photoCount} Photo(s) — ${checkout.albumTitle}`;
        const session = await resolved.client.checkout.sessions.create({
          payment_method_types: ["card"],
          customer_email: clientEmail || undefined,
          client_reference_id: String(album.id),
          line_items: [{
            price_data: {
              currency: resolved.currency,
              product_data: {
                name: productName,
                description: `${checkout.photoCount} photos`,
              },
              unit_amount: intent.snapshot.amountCents,
            },
            quantity: 1,
          }],
          mode: "payment",
          ...(checkout.expiresAtSeconds ? { expires_at: checkout.expiresAtSeconds } : {}),
          success_url: safeCheckoutReturnUrl(req, successUrl, `/gallery/${encodeURIComponent(albumId)}?success=1`),
          cancel_url: safeCheckoutReturnUrl(req, cancelUrl, `/gallery/${encodeURIComponent(albumId)}?cancelled=1`),
          metadata: {
            albumId: album.id,
            tenantSlug: slug,
            type: "tenant-album-purchase",
            orderId,
            isFullAlbum: checkout.isFullAlbum ? "true" : "false",
            sessionKey: checkout.sessionKey,
            expectedAmountCents: String(intent.snapshot.amountCents),
            expectedCurrency: resolved.currency,
            checkoutSnapshotHash: intent.snapshotHash,
          },
        });
        orders[orderId] = {
          id: orderId,
          albumId: album.id,
          tenantSlug: slug,
          ...checkout,
          expectedAmountCents: intent.snapshot.amountCents,
          currency: resolved.currency,
          intentHash: intent.snapshotHash,
          stripeAccountHash: accountHash,
          checkoutSessionId: session.id,
          checkoutExpiresAt: new Date(Number(session.expires_at || 0) * 1000).toISOString(),
          status: "open",
          createdAt: new Date().toISOString(),
        };
        db["wv_album_checkout_orders"] = orders;
        try {
          writeDb(db);
        } catch (error) {
          await resolved.client.checkout.sessions.expire(session.id).catch(() => {});
          throw error;
        }
        return res.json({ url: session.url, sessionId: session.id });
      });
    } catch (err) {
      console.error("Tenant album Stripe checkout error:", err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });

  // Platform entitlements cannot be purchased through a tenant-controlled
  // Stripe account/webhook. Keep this manual-bank-only until platform Stripe
  // owns an immutable order and exact-session fulfilment flow.
  app.post("/api/tenant/:slug/stripe/checkout/event-slot", tenantCheckoutLimiter, requireTenant, (_req, res) => {
    res.status(410).json({ error: "Stripe payment for platform event slots is disabled; use bank/manual approval" });
  });

  // Webhook — per-tenant Stripe webhook handler
  app.post("/api/tenant/:slug/stripe/webhook", tenantCheckoutLimiter, express.raw({ type: "application/json" }), async (req, res) => {
    const { slug } = req.params;
    if (!findLicensedTenant(slug)) return res.status(404).json({ error: "Tenant not found" });
    const db = readDb();
    const raw = db[`t_${slug}_wv_tenant_settings`];
    const ts = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
    const resolved = resolveTenantStripe(ts);
    if (!resolved) return res.status(400).json({ error: "Stripe not configured for this tenant" });
    const sig = req.headers["stripe-signature"];
    // Use tenant webhook secret; fall back to superuser secret when using fallback Stripe
    const webhookSecret = ts.stripeWebhookSecret || (resolved.usingFallback ? process.env.STRIPE_WEBHOOK_SECRET : null);
    let event;
    try {
      if (webhookSecret && sig) {
        event = resolved.client.webhooks.constructEvent(req.body, sig, webhookSecret);
      } else if (!webhookSecret && unsignedWebhookAllowed()) {
        event = JSON.parse(req.body.toString());
      } else {
        return res.status(webhookSecret ? 400 : 503).json({ error: webhookSecret ? "Stripe signature is required" : "A Stripe webhook secret is not configured" });
      }
    } catch (err) {
      console.error("Tenant webhook signature verification failed:", err.message);
      return res.status(400).json({ error: "Webhook verification failed" });
    }
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const metadata = session.metadata || {};
      if (!checkoutIsPaid(session)) return res.status(409).json({ error: "Checkout has not been paid" });
      if (metadata.tenantSlug && metadata.tenantSlug !== slug) return res.status(400).json({ error: "Tenant payment ownership mismatch" });
      if (metadata.type === "tenant-event-slot") {
        return res.status(410).json({ error: "Tenant-controlled Stripe payments cannot grant platform event slots" });
      }
      try {
        await withCheckoutResourceLock(webhookResourceLockKey(`tenant:${slug}`, metadata), async () => {
          const dbData = readDb();
          if (isStripeEventProcessed(dbData, `tenant:${slug}`, event.id)) return res.json({ received: true, duplicate: true });

        if ((metadata.type === "tenant-booking-payment" || metadata.type === "tenant-booking-deposit") && metadata.bookingId) {
          const bookingsRaw = dbData["wv_bookings"];
          const bookings = bookingsRaw ? (typeof bookingsRaw === "string" ? JSON.parse(bookingsRaw) : bookingsRaw) : [];
          const idx = bookings.findIndex(b => b.id === metadata.bookingId && b.tenantSlug === slug);
          if (idx < 0) throw new Error("Tenant booking was not found for Stripe fulfilment");
          {
            const expectedCurrency = String(metadata.expectedCurrency || resolved.currency).toLowerCase();
            const fulfilmentKey = `tenant:${slug}:booking:${metadata.bookingId}:${metadata.paymentKind || "full"}`;
            const priorFulfilment = stripeFulfilment(dbData, fulfilmentKey);
            const paymentProbe = applyBookingStripePayment(bookings[idx], metadata, session);
            if (priorFulfilment?.stripeSessionId === session.id || paymentProbe.alreadyFulfilled) {
              markStripeEventProcessed(dbData, `tenant:${slug}`, event);
              writeDb(dbData);
              return res.json({ received: true, duplicate: true });
            }
            let reviewReason = priorFulfilment?.stripeSessionId
              ? "Duplicate payment completed for an already fulfilled booking stage"
              : null;
            if (!reviewReason) {
              const validation = evaluateBookingStripePayment(bookings[idx], metadata, session, `tenant:${slug}`, expectedCurrency);
              if (!validation.valid) reviewReason = validation.reason;
            }
            if (reviewReason) {
              bookings[idx] = reviewBookingStripePayment(bookings[idx], metadata, session, reviewReason);
              dbData["wv_bookings"] = JSON.stringify(bookings);
              recordStripePaymentReview(dbData, {
                resourceType: "booking",
                resourceId: metadata.bookingId,
                tenantSlug: slug,
                stripeSessionId: session.id,
                amountTotal: session.amount_total,
                currency: session.currency,
                reason: reviewReason,
              });
              markStripeEventProcessed(dbData, `tenant:${slug}`, event);
              writeDb(dbData);
              return res.json({ received: true, paymentNeedsReview: true });
            }
            const paymentApplication = applyBookingStripePayment(bookings[idx], metadata, session);
            bookings[idx] = paymentApplication.booking;
            if (paymentApplication.needsReview) {
              dbData["wv_bookings"] = JSON.stringify(bookings);
              recordStripePaymentReview(dbData, {
                resourceType: "booking",
                resourceId: metadata.bookingId,
                tenantSlug: slug,
                stripeSessionId: session.id,
                amountTotal: session.amount_total,
                currency: session.currency,
                reason: bookings[idx].paymentReviewReason,
              });
              markStripeEventProcessed(dbData, `tenant:${slug}`, event);
              writeDb(dbData);
              console.error(`Stripe payment for tenant booking ${metadata.bookingId} requires manual review: ${bookings[idx].paymentReviewReason}`);
              return res.json({ received: true, paymentNeedsReview: true });
            }
            markStripeResourceFulfilled(dbData, fulfilmentKey, session, { resourceType: "booking", resourceId: metadata.bookingId, tenantSlug: slug, paymentKind: metadata.paymentKind || "full" });
            dbData["wv_bookings"] = JSON.stringify(bookings);
            writeDb(dbData);
            if (sendTenantBookingReceipt) {
              setImmediate(() => sendTenantBookingReceipt(bookings[idx], `stripe:${session.id}`, { paymentKind: metadata.paymentKind || "full" }).catch(error => console.error(`Tenant booking receipt failed for ${metadata.bookingId}:`, error?.message || error)));
            }
            if (onBookingPaid) {
              const paidBooking = bookings[idx];
              setImmediate(() => Promise.resolve(onBookingPaid(paidBooking)).catch(error => console.error(`Tenant booking paid callback failed for ${metadata.bookingId}:`, error?.message || error)));
            }
            console.log(`📝 Tenant booking ${metadata.bookingId} marked as ${bookings[idx].paymentStatus}`);
          }
        }

        if (metadata.type === "tenant-album-purchase" && metadata.albumId) {
          const albumsKey = `t_${slug}_wv_albums`;
          const albums = parseStored(dbData[albumsKey], []);
          const matches = albums.filter(album => album?.id === metadata.albumId);
          const albumIdx = matches.length === 1 ? albums.indexOf(matches[0]) : -1;
          if (albumIdx < 0) throw new Error("Tenant album was not found unambiguously for Stripe fulfilment");
          {
            const album = albums[albumIdx];
            const checkoutOrders = pruneCheckoutOrders(parseStored(dbData["wv_album_checkout_orders"], {}));
            const order = metadata.orderId ? checkoutOrders[metadata.orderId] : null;
            const existingEntitlement = Object.values(album.sessionPurchases || {}).find(purchase => purchase?.stripeSessionId === session.id);
            if (existingEntitlement || (order?.status === "fulfilled" && order?.fulfilledStripeSessionId === session.id)) {
              markStripeEventProcessed(dbData, `tenant:${slug}`, event);
              writeDb(dbData);
              return res.json({ received: true, duplicate: true });
            }
            if (order?.status === "manual-review" && order?.paidStripeSessionId === session.id) {
              markStripeEventProcessed(dbData, `tenant:${slug}`, event);
              writeDb(dbData);
              return res.json({ received: true, duplicate: true, paymentNeedsReview: true });
            }
            const tenantTimezone = readTenants().find(item => item.slug === slug)?.timezone || ts.timezone || process.env.TZ || "Australia/Sydney";
            const fulfilmentKey = albumFulfilmentKey(`tenant:${slug}`, order);
            const priorFulfilment = order ? stripeFulfilment(dbData, fulfilmentKey) : null;
            let reviewReason = !order ? "Album payment has no valid server checkout order" : null;
            if (!reviewReason && priorFulfilment?.stripeSessionId && priorFulfilment.stripeSessionId !== session.id) {
              reviewReason = "Duplicate payment completed for an already fulfilled album selection";
            }
            if (!reviewReason) {
              const sessionData = parseStored(dbData[`wv_session_${order.sessionKey}_${album.id}`], {});
              const validation = evaluateAlbumStripePayment(album, order, metadata, session, slug, tenantTimezone, resolved.currency, sessionData?.unlockedPhotoIds);
              if (!validation.valid) reviewReason = validation.reason;
            }
            if (reviewReason) {
              appendAlbumPaymentReview(album, order, session, reviewReason);
              markCheckoutOrderForReview(dbData, "wv_album_checkout_orders", checkoutOrders, order, session, "album", metadata.albumId, reviewReason, slug);
              albums[albumIdx] = album;
              dbData[albumsKey] = JSON.stringify(albums);
              markStripeEventProcessed(dbData, `tenant:${slug}`, event);
              writeDb(dbData);
              return res.json({ received: true, paymentNeedsReview: true });
            }
            const sKey = order.sessionKey;
            const sessionPurchases = album.sessionPurchases || {};
            const currentPurchase = sessionPurchases[sKey] || {};
            const stripeSessionIds = [...new Set([...(currentPurchase.stripeSessionIds || []), currentPurchase.stripeSessionId, session.id].filter(Boolean))];
            if (order.isFullAlbum === true) {
              sessionPurchases[sKey] = { ...currentPurchase, fullAlbum: true, photoIds: [], paidAt: new Date().toISOString(), stripeSessionId: session.id, stripeSessionIds, purchaserEmail: session.customer_email || currentPurchase.purchaserEmail || "", purchaserEmailVerified: !!session.customer_email || currentPurchase.purchaserEmailVerified === true, emailVerifiedAt: session.customer_email ? new Date().toISOString() : currentPurchase.emailVerifiedAt };
              album.stripePaidAt = new Date().toISOString();
            } else {
              const newIds = Array.isArray(order.photoIds) ? order.photoIds : [];
              const existing = currentPurchase.photoIds || [];
              sessionPurchases[sKey] = { ...currentPurchase, fullAlbum: currentPurchase.fullAlbum === true, photoIds: [...new Set([...existing, ...newIds])], paidAt: new Date().toISOString(), stripeSessionId: session.id, stripeSessionIds, purchaserEmail: session.customer_email || currentPurchase.purchaserEmail || "", purchaserEmailVerified: !!session.customer_email || currentPurchase.purchaserEmailVerified === true, emailVerifiedAt: session.customer_email ? new Date().toISOString() : currentPurchase.emailVerifiedAt };
            }
            album.sessionPurchases = sessionPurchases;
            checkoutOrders[order.id] = { ...order, status: "fulfilled", fulfilledStripeSessionId: session.id, fulfilledAt: new Date().toISOString() };
            markStripeResourceFulfilled(dbData, fulfilmentKey, session, { resourceType: "album", resourceId: album.id, tenantSlug: slug, sessionKey: sKey });
            dbData["wv_album_checkout_orders"] = checkoutOrders;
            albums[albumIdx] = album;
            dbData[albumsKey] = JSON.stringify(albums);
            writeDb(dbData);
            console.log(`📝 Tenant album ${metadata.albumId} purchase processed for session ${metadata.sessionKey || session.id}`);

            // Discord notification for tenant album purchase
            try {
              const tenantSettingsRaw = dbData[`t_${slug}_wv_tenant_settings`];
              const tenantSettings = tenantSettingsRaw ? (typeof tenantSettingsRaw === "string" ? JSON.parse(tenantSettingsRaw) : tenantSettingsRaw) : {};
              const globalSettingsRaw = dbData["wv_settings"];
              const globalSettings = typeof globalSettingsRaw === "string" ? JSON.parse(globalSettingsRaw) : (globalSettingsRaw || {});
              const activeSettings = tenantSettings?.discordWebhookUrl ? tenantSettings : globalSettings;
              const discordUrl = activeSettings?.discordWebhookUrl;
              if (discordUrl && activeSettings?.discordNotifyDownloads !== false) {
                const purchaseType = metadata.isFullAlbum === "true" ? "full" : "individual";
                const purchasedPhotoIds = sessionPurchases[sKey]?.photoIds || [];
                notifyAlbumPurchase(discordUrl, album, purchaseType, (session.amount_total || 0) / 100, session.customer_email || "", purchasedPhotoIds).catch(err => console.error("Discord tenant album-purchase notify error:", err.message));
              }
            } catch (discordErr) {
              console.error("Discord tenant settings read error:", discordErr.message);
            }
          }
        }
          markStripeEventProcessed(dbData, `tenant:${slug}`, event);
          writeDb(dbData);
        });
      } catch (dbErr) {
        console.error("Failed to update DB after tenant payment:", dbErr);
        return res.status(500).json({ error: "Payment fulfilment failed; Stripe should retry" });
      }
      if (res.headersSent) return;
    }
    res.json({ received: true });
  });
}

// Need express for the raw body parser
const express = require("express");

module.exports = {
  registerRoutes,
  getTenantStripe,
  registerTenantStripeRoutes,
  albumCheckoutSnapshot,
  calculateAlbumCheckout,
  calculateAlbumSelectionPricing,
  applyBookingStripePayment,
  bookingCheckoutResourceLockKey,
  bookingCheckoutSnapshot,
  bookingStripeCheckoutStage,
  checkoutSessionMatches,
  evaluateAlbumStripePayment,
  evaluateBookingStripePayment,
  evaluateInvoiceStripePayment,
  invoiceCheckoutSnapshot,
  recordLegacyLicensePlanPaymentReview,
  checkoutExpirySeconds,
  expireBookingCheckout,
  getMainBookingPaymentStatus,
  mainStripeReady,
  manualBankHoldExpiresAt,
  safePaymentBookingDto,
  safeCheckoutReturnUrl,
  switchMainBookingToManualBank,
  tenantStripeReady,
  withCheckoutResourceLock,
};
