"use strict";

const crypto = require("crypto");
const path = require("path");

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const BOOKING_ATTEMPT_UUID_SHAPE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOOKING_ATTEMPT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BOOKING_ATTEMPT_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const PAYMENT_REVIEW_RESOLUTION_STATUSES = new Set(["paid", "cash", "deposit-paid"]);

function normalizeOrigin(value) {
  return String(value || "").trim().replace(/\/+$/, "").toLowerCase();
}

function isExplicitNativeOrigin(origin, configuredOrigins) {
  const normalized = normalizeOrigin(origin);
  return !!normalized && (configuredOrigins || []).some(candidate => normalizeOrigin(candidate) === normalized);
}

function uploadPreviewVariant(requestedSize, authenticatedOwner) {
  const normalized = requestedSize === "thumb" || requestedSize === "medium" ? requestedSize : null;
  if (normalized === "thumb") return { sizeLabel: "thumb", targetWidth: 700 };
  if (normalized === "medium" || !authenticatedOwner) return { sizeLabel: "medium", targetWidth: 1400 };
  return { sizeLabel: "full", targetWidth: null };
}

const SAFE_UPLOAD_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".tif", ".tiff", ".heic", ".heif"]);
const TENANT_SELF_SERVICE_STORE_ALLOWLIST = new Set(["wv_event_types", "wv_invoices", "wv_enquiries", "wv_photo_library", "wv_contacts", "wv_email_templates"]);

function safeUploadFilenameFromSrc(src) {
  const value = String(src || "").split(/[?#]/, 1)[0];
  if (!value || value.includes("\\")) return "";
  let filename = value.split("/").pop() || "";
  try { filename = decodeURIComponent(filename); } catch { return ""; }
  if (!filename || filename.includes("/") || filename.includes("\\") || filename !== path.basename(filename)) return "";
  if (filename.startsWith(".") || !SAFE_UPLOAD_EXTENSIONS.has(path.extname(filename).toLowerCase())) return "";
  return filename;
}

function tenantSelfServiceStoreKeyAllowed(key) {
  return TENANT_SELF_SERVICE_STORE_ALLOWLIST.has(String(key || ""));
}

function resolveContainedPath(root, filename) {
  const resolvedRoot = path.resolve(String(root || ""));
  const resolved = path.resolve(resolvedRoot, String(filename || ""));
  return resolved !== resolvedRoot && resolved.startsWith(`${resolvedRoot}${path.sep}`) ? resolved : null;
}

function localDateTimeToUtcMs(parts, timeZone) {
  const targetAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond || 0);
  let candidate = targetAsUtc;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const observedParts = formatter.formatToParts(new Date(candidate));
      const value = type => Number(observedParts.find(part => part.type === type)?.value);
      const observedAsUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"), parts.millisecond || 0);
      candidate += targetAsUtc - observedAsUtc;
    }
    return candidate;
  } catch {
    return targetAsUtc;
  }
}

function expiryTimestamp(value, timeZone = process.env.TZ || "Australia/Sydney") {
  if (!value) return null;
  const text = String(value).trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const parsed = dateOnly
    ? localDateTimeToUtcMs({ year: Number(dateOnly[1]), month: Number(dateOnly[2]), day: Number(dateOnly[3]), hour: 23, minute: 59, second: 59, millisecond: 999 }, timeZone)
    : Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function albumAccessWindow(album, nowMs = Date.now(), timeZone = album?.timezone || process.env.TZ || "Australia/Sydney") {
  const galleryExpiry = expiryTimestamp(album?.expiresAt, timeZone);
  const downloadExpiry = expiryTimestamp(album?.downloadExpiresAt, timeZone);
  const galleryExpired = galleryExpiry != null && galleryExpiry <= nowMs;
  const downloadsExpired = galleryExpired || (downloadExpiry != null && downloadExpiry <= nowMs);
  return { galleryExpired, downloadsExpired, galleryExpiry, downloadExpiry };
}

function albumAllowsFreeFullUnlock(album) {
  return !!album
    && album.purchasingDisabled !== true
    && Object.prototype.hasOwnProperty.call(album, "priceFullAlbum")
    && typeof album.priceFullAlbum === "number"
    && Number.isFinite(album.priceFullAlbum)
    && album.priceFullAlbum === 0;
}

function galleryShareLinkAccess(album, shareLinkId, nowMs = Date.now(), timeZone = album?.timezone || process.env.TZ || "Australia/Sydney") {
  if (!album || album.enabled === false || !shareLinkId) return { active: false, allowDownload: false };
  const link = (Array.isArray(album.shareLinks) ? album.shareLinks : []).find(item => String(item?.id || "") === String(shareLinkId));
  if (!link || albumAccessWindow({ expiresAt: link.expiresAt }, nowMs, timeZone).galleryExpired) return { active: false, allowDownload: false };
  return { active: true, allowDownload: link.allowDownload === true };
}

function normalizeClientPortalEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || email.length > 254 || /[\r\n]/.test(email)) return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

/**
 * Select only albums an email address is already associated with. Booking
 * references are scope-bound so a colliding booking ID in another tenant can
 * never grant discovery of that tenant's gallery.
 */
function selectClientPortalAlbumGroups({
  email,
  mainAlbums = [],
  tenantAlbums = {},
  bookings = [],
  activeTenantSlugs = [],
  timezones = {},
  nowMs = Date.now(),
} = {}) {
  const normalizedEmail = normalizeClientPortalEmail(email);
  if (!normalizedEmail) return [];
  const active = new Set((activeTenantSlugs || []).map(String));
  const bookingEmails = new Map();
  for (const booking of Array.isArray(bookings) ? bookings : []) {
    const id = String(booking?.id || "");
    const bookingEmail = normalizeClientPortalEmail(booking?.clientEmail);
    if (!id || !bookingEmail) continue;
    const tenantSlug = booking?.tenantSlug ? String(booking.tenantSlug) : "";
    bookingEmails.set(`${tenantSlug}\u0000${id}`, bookingEmail);
  }

  const groups = [];
  const collect = (tenantSlug, albums) => {
    const scope = tenantSlug || "";
    const seen = new Set();
    const selected = [];
    for (const album of Array.isArray(albums) ? albums : []) {
      const identifier = String(album?.slug || album?.id || "");
      if (!identifier || album?.enabled === false || seen.has(identifier)) continue;
      if (albumAccessWindow(album, nowMs, timezones[scope] || album?.timezone).galleryExpired) continue;
      const directMatch = normalizeClientPortalEmail(album?.clientEmail) === normalizedEmail;
      const bookingId = String(album?.bookingId || "");
      const bookingMatch = !!bookingId && bookingEmails.get(`${scope}\u0000${bookingId}`) === normalizedEmail;
      if (!directMatch && !bookingMatch) continue;
      seen.add(identifier);
      selected.push({
        id: album?.id ? String(album.id) : undefined,
        slug: album?.slug ? String(album.slug) : undefined,
        title: String(album?.title || "Photo gallery").slice(0, 200),
        clientToken: album?.clientToken ? String(album.clientToken) : undefined,
      });
    }
    if (selected.length) groups.push({ tenantSlug: tenantSlug || null, albums: selected });
  };

  collect(null, mainAlbums);
  for (const [tenantSlug, albums] of Object.entries(tenantAlbums || {})) {
    if (active.has(tenantSlug)) collect(tenantSlug, albums);
  }
  return groups;
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function hmac(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function timingSafeTextEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Accept only an opaque, high-entropy booking-attempt identifier. UUIDv4 is
 * supported for Web Crypto's randomUUID(); longer base64url tokens support
 * clients that generate at least 192 random bits directly.
 */
function normalizeBookingAttemptId(value) {
  if (typeof value !== "string" || value !== value.trim()) return null;
  if (BOOKING_ATTEMPT_UUID_SHAPE_RE.test(value)) return BOOKING_ATTEMPT_UUID_RE.test(value) ? value : null;
  return BOOKING_ATTEMPT_TOKEN_RE.test(value) ? value : null;
}

function hashBookingAttemptId(value) {
  const normalized = normalizeBookingAttemptId(value);
  return normalized ? crypto.createHash("sha256").update(normalized, "utf8").digest("hex") : null;
}

function normalizeBookingAttemptIdentity(input) {
  const answers = input?.answers && typeof input.answers === "object" && !Array.isArray(input.answers)
    ? Object.keys(input.answers)
      .sort()
      .filter(key => input.answers[key] !== undefined && input.answers[key] !== null)
      .map(key => [key, String(input.answers[key]).slice(0, 2000)])
    : [];
  const numericDuration = Number(input?.duration);
  return {
    clientName: String(input?.clientName || "").trim().slice(0, 160),
    clientEmail: String(input?.clientEmail || "").trim().toLowerCase().slice(0, 254),
    phone: String(input?.phone || "").trim().slice(0, 40),
    eventTypeId: String(input?.eventTypeId || "").trim(),
    date: String(input?.date || "").trim(),
    time: String(input?.time || "").trim(),
    duration: Number.isFinite(numericDuration) ? numericDuration : null,
    paymentMethod: String(input?.paymentMethod || "").trim().toLowerCase(),
    payInFull: input?.payInFull === true,
    answers,
  };
}

function hashBookingAttemptIdentity(input) {
  const canonical = JSON.stringify(normalizeBookingAttemptIdentity(input));
  return crypto.createHash("sha256").update(`public-booking-v1\0${canonical}`, "utf8").digest("hex");
}

/**
 * Resolve a public booking creation replay without exposing or storing the raw
 * attempt identifier. Call this both before external availability work and
 * again against the final commit snapshot to close concurrent/lost responses.
 */
function evaluatePublicBookingAttempt(bookings, input) {
  if (input?.bookingAttemptId === undefined) return { action: "legacy" };
  const bookingAttemptIdHash = hashBookingAttemptId(input.bookingAttemptId);
  if (!bookingAttemptIdHash) {
    return {
      action: "invalid",
      status: 400,
      code: "INVALID_BOOKING_ATTEMPT_ID",
      error: "bookingAttemptId must be a UUIDv4 or a 32-128 character base64url token",
    };
  }
  const bookingAttemptIdentityHash = hashBookingAttemptIdentity(input);
  const matches = (Array.isArray(bookings) ? bookings : []).filter(booking =>
    !booking?.tenantSlug && timingSafeTextEqual(booking?.bookingAttemptIdHash, bookingAttemptIdHash));
  if (matches.length === 0) {
    return { action: "create", bookingAttemptIdHash, bookingAttemptIdentityHash };
  }
  if (matches.length === 1
    && SHA256_HEX_RE.test(String(matches[0]?.bookingAttemptIdentityHash || ""))
    && timingSafeTextEqual(matches[0].bookingAttemptIdentityHash, bookingAttemptIdentityHash)) {
    return { action: "reuse", booking: matches[0], bookingAttemptIdHash, bookingAttemptIdentityHash };
  }
  return {
    action: "conflict",
    status: 409,
    code: "BOOKING_ATTEMPT_CONFLICT",
    error: "This booking attempt was already used with different booking details",
  };
}

function bookingNeedsPaymentReview(booking) {
  if (!booking || typeof booking !== "object") return false;
  const reviewStatus = String(booking.paymentReviewStatus || "").trim().toLowerCase();
  if (booking.paymentNeedsReview === true) return true;
  if (reviewStatus && reviewStatus !== "resolved") return true;
  return !!String(booking.paymentReviewReason || "").trim() && reviewStatus !== "resolved";
}

/**
 * Resolve one canonical booking payment review without rebuilding the booking
 * from browser state. All unrelated Stripe fields are preserved while the
 * canonical settlement timestamps and booking status are kept consistent.
 */
function resolveBookingPaymentReview(booking, paymentStatus, options = {}) {
  const normalizedPaymentStatus = String(paymentStatus || "").trim().toLowerCase();
  if (!PAYMENT_REVIEW_RESOLUTION_STATUSES.has(normalizedPaymentStatus)) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_PAYMENT_REVIEW_RESOLUTION",
      error: "paymentStatus must be paid, cash, or deposit-paid",
    };
  }
  if (!bookingNeedsPaymentReview(booking)) {
    return {
      ok: false,
      status: 409,
      code: "PAYMENT_REVIEW_NOT_ACTIVE",
      error: "This booking does not have an active payment review",
    };
  }

  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const resolvedAt = new Date(nowMs).toISOString();
  const resolvedBy = String(options.actor || "admin").trim().slice(0, 160) || "admin";
  const paymentReviews = Array.isArray(booking.paymentReviews) ? [...booking.paymentReviews] : [];

  // Older records may have only the top-level review markers. Preserve their
  // reason in the append-only audit before clearing the active marker.
  if (!paymentReviews.some(review => review?.status && review.status !== "resolved")) {
    const legacyReason = String(booking.paymentReviewReason || "").trim();
    if (legacyReason) {
      paymentReviews.push({
        status: "manual-review",
        reason: legacyReason,
        receivedAt: booking.paymentReceivedAt,
      });
    }
  }
  paymentReviews.push({
    status: "resolved",
    reason: `Payment review resolved by marking payment ${normalizedPaymentStatus}.`,
    resolvedAt,
    resolvedBy,
    resolutionPaymentStatus: normalizedPaymentStatus,
  });

  const confirmsBooking = booking.status === "pending" && booking.requiresConfirmation !== true;
  const paymentHistory = Array.isArray(booking.paymentHistory) ? booking.paymentHistory.slice(-99) : [];
  const updated = {
    ...booking,
    paymentStatus: normalizedPaymentStatus,
    ...(normalizedPaymentStatus === "deposit-paid"
      ? { depositPaidAt: booking.depositPaidAt || resolvedAt }
      : { paidAt: booking.paidAt || resolvedAt }),
    ...(normalizedPaymentStatus === "cash" ? { paymentMethod: "cash" } : {}),
    ...(confirmsBooking ? {
      status: "confirmed",
      statusHistory: [...(Array.isArray(booking.statusHistory) ? booking.statusHistory : []), { status: "confirmed", changedAt: resolvedAt, note: "Payment review resolved" }],
    } : {}),
    paymentNeedsReview: false,
    paymentReviewStatus: "resolved",
    paymentReviewResolvedAt: resolvedAt,
    paymentReviewResolvedBy: resolvedBy,
    paymentReviews,
    paymentHistory: [...paymentHistory, { action: "payment-review-resolved", changedAt: resolvedAt, source: "admin", paymentStatus: normalizedPaymentStatus, resolvedBy }],
  };
  delete updated.paymentReviewReason;
  return { ok: true, booking: updated };
}

/** Sign a small, purpose-bound server session token. */
function signSession(payload, secret, options = {}) {
  if (typeof secret !== "string" || secret.length < 24) {
    throw new Error("A session secret of at least 24 characters is required");
  }
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const ttlSeconds = Math.max(60, Math.min(Number(options.ttlSeconds) || 12 * 60 * 60, 30 * 24 * 60 * 60));
  const encoded = base64urlJson({
    v: 1,
    ...payload,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  });
  return `${encoded}.${hmac(encoded, secret)}`;
}

/** Verify signature, expiry, and optional purpose. Returns null when invalid. */
function verifySession(token, secret, options = {}) {
  try {
    if (typeof token !== "string" || typeof secret !== "string" || secret.length < 24) return null;
    const pieces = token.split(".");
    if (pieces.length !== 2 || !timingSafeTextEqual(hmac(pieces[0], secret), pieces[1])) return null;
    const payload = JSON.parse(Buffer.from(pieces[0], "base64url").toString("utf8"));
    const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
    if (payload?.v !== 1 || !Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) return null;
    if (payload.iat > nowSeconds + 60 || payload.exp <= nowSeconds) return null;
    if (options.purpose && payload.purpose !== options.purpose) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const result = {};
  for (const pair of String(header || "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    try { result[name] = decodeURIComponent(pair.slice(separator + 1).trim()); } catch { /* ignore malformed cookies */ }
  }
  return result;
}

function collectUploadFileNames(value, result = new Set()) {
  if (typeof value === "string") {
    const pattern = /\/uploads\/([^?#\s"'<>]+)/g;
    let match;
    while ((match = pattern.exec(value)) !== null) {
      let filename = match[1].split("/").pop();
      try { filename = decodeURIComponent(filename); } catch { /* keep encoded filename */ }
      if (filename && filename !== "." && filename !== ".." && !filename.includes("\\")) result.add(filename);
    }
    return result;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUploadFileNames(item, result);
    return result;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectUploadFileNames(item, result);
  }
  return result;
}

function uploadsWithoutRemainingReferences(candidateNames, remainingValues) {
  const referenced = collectUploadFileNames(remainingValues);
  return [...new Set(candidateNames || [])].filter(filename => filename && !referenced.has(filename));
}

function resolveUploadOwnerScope(owner, referenceKeys = []) {
  if (owner?.tenantSlug) return { ok: true, tenantSlug: String(owner.tenantSlug) };
  if (owner?.admin === true) return { ok: true, tenantSlug: null };
  const tenantSlugs = new Set();
  let mainReferenced = false;
  for (const key of referenceKeys || []) {
    const value = String(key || "");
    if (!value.startsWith("t_")) {
      mainReferenced = true;
      continue;
    }
    const marker = value.indexOf("_wv_", 2);
    if (marker > 2) tenantSlugs.add(value.slice(2, marker));
  }
  if (tenantSlugs.size > 1 || (mainReferenced && tenantSlugs.size)) return { ok: false, tenantSlug: null };
  return { ok: true, tenantSlug: tenantSlugs.size === 1 ? [...tenantSlugs][0] : null };
}

function uploadBelongsToScope(owner, referenceKeys, tenantSlug) {
  const resolved = resolveUploadOwnerScope(owner, referenceKeys);
  return resolved.ok && resolved.tenantSlug === (tenantSlug || null);
}

function safeTenantPublicDto(tenant) {
  if (!tenant || typeof tenant !== "object") return null;
  return {
    slug: String(tenant.slug || ""),
    displayName: String(tenant.displayName || ""),
    bio: tenant.bio ? String(tenant.bio) : undefined,
    timezone: tenant.timezone ? String(tenant.timezone) : "Australia/Sydney",
    customDomain: tenant.customDomain ? String(tenant.customDomain) : undefined,
    active: tenant.active !== false,
  };
}

function safeTenantPrivateDto(tenant) {
  const publicDto = safeTenantPublicDto(tenant);
  if (!publicDto) return null;
  return {
    ...publicDto,
    email: String(tenant.email || ""),
    createdAt: tenant.createdAt || undefined,
    licenseKeySet: !!tenant.licenseKey,
    extraEventSlotRequestEnabled: tenant.extraEventSlotRequestEnabled === true,
    extraEventPrice: Number.isFinite(Number(tenant.extraEventPrice)) ? Number(tenant.extraEventPrice) : undefined,
    keyPurchaseEnabled: tenant.keyPurchaseEnabled === true,
  };
}

function safeGalleryPurchaseDto(purchase) {
  if (!purchase || typeof purchase !== "object") return null;
  return {
    fullAlbum: purchase.fullAlbum === true,
    photoIds: Array.isArray(purchase.photoIds) ? [...new Set(purchase.photoIds.map(String))] : [],
    paidAt: purchase.paidAt || purchase.unlockedAt || purchase.grantedAt || undefined,
    method: purchase.method || purchase.source || undefined,
  };
}

function safeGalleryPhotoDto(photo) {
  if (!photo || typeof photo !== "object") return null;
  return {
    id: String(photo.id || ""),
    src: String(photo.src || ""),
    thumbnail: photo.thumbnail ? String(photo.thumbnail) : undefined,
    title: String(photo.title || ""),
    width: Number.isFinite(Number(photo.width)) ? Number(photo.width) : undefined,
    height: Number.isFinite(Number(photo.height)) ? Number(photo.height) : undefined,
    starred: photo.starred === true,
    takenAt: photo.takenAt || undefined,
    uploadedAt: photo.uploadedAt || undefined,
    originalName: photo.originalName ? String(photo.originalName) : undefined,
    paid: photo.paid === true || undefined,
    cull: photo.cull?.status ? {
      status: String(photo.cull.status),
    } : undefined,
  };
}

function safeGalleryAlbumDto(album, sessionKey, timeZone = album?.timezone || process.env.TZ || "Australia/Sydney") {
  if (!album || typeof album !== "object" || typeof sessionKey !== "string" || !sessionKey) return null;
  const allowed = [
    "id", "slug", "title", "description", "coverImage", "date", "photoCount",
    "freeDownloads", "pricePerPhoto", "priceFullAlbum", "isPublic", "enabled", "allUnlocked", "displaySize",
    "paidPhotoIds", "proofingEnabled", "proofingStage", "proofingExpiresAt", "expiresAt", "downloadExpiresAt",
    "watermarkDisabled", "purchasingDisabled", "downloadEmailCapture", "lockDownloadsDuringProofing",
    "showCullRejectsToClient",
  ];
  const safe = Object.fromEntries(allowed.filter(key => album[key] !== undefined).map(key => [key, album[key]]));
  for (const field of ["expiresAt", "downloadExpiresAt"]) {
    const resolved = expiryTimestamp(album[field], timeZone);
    if (resolved != null) safe[field] = new Date(resolved).toISOString();
  }
  const purchase = safeGalleryPurchaseDto(album.sessionPurchases?.[sessionKey]);
  safe.sessionPurchases = purchase ? { [sessionKey]: purchase } : {};
  safe.usedFreeDownloads = album.usedFreeDownloads?.[sessionKey] == null ? {} : { [sessionKey]: album.usedFreeDownloads[sessionKey] };
  safe.proofingRounds = (Array.isArray(album.proofingRounds) ? album.proofingRounds : []).map((round, index) => ({
    roundNumber: Number.isFinite(Number(round?.roundNumber)) ? Number(round.roundNumber) : index + 1,
    adminNote: round?.adminNote ? String(round.adminNote) : undefined,
  }));
  safe.photos = (Array.isArray(album.photos) ? album.photos : [])
    .filter(photo => !photo.hidden && (album.showCullRejectsToClient || photo.cull?.status !== "reject"))
    .map(safeGalleryPhotoDto)
    .filter(Boolean);
  return safe;
}

/**
 * Plan an idempotent free-photo entitlement claim.  Callers persist the
 * returned set before issuing any original bytes or a ZIP job.
 */
function planFreePhotoClaims({ requestedPhotoIds, alreadyClaimedPhotoIds, nonQuotaPhotoIds, quota, used }) {
  const requested = [...new Set((Array.isArray(requestedPhotoIds) ? requestedPhotoIds : []).map(String).filter(Boolean))];
  const claimed = new Set((Array.isArray(alreadyClaimedPhotoIds) ? alreadyClaimedPhotoIds : []).map(String).filter(Boolean));
  const nonQuota = new Set((Array.isArray(nonQuotaPhotoIds) ? nonQuotaPhotoIds : []).map(String).filter(Boolean));
  const normalizedQuota = Math.max(0, Number.isFinite(Number(quota)) ? Math.floor(Number(quota)) : 0);
  const normalizedUsed = Math.max(claimed.size, Number.isFinite(Number(used)) ? Math.floor(Number(used)) : 0);
  const newlyClaimedPhotoIds = requested.filter(id => !claimed.has(id) && !nonQuota.has(id));
  const remainingBefore = Math.max(0, normalizedQuota - normalizedUsed);
  if (newlyClaimedPhotoIds.length > remainingBefore) {
    return {
      ok: false,
      error: "Free download quota exceeded",
      used: normalizedUsed,
      remaining: remainingBefore,
      newlyClaimedPhotoIds: [],
      claimedPhotoIds: [...claimed],
    };
  }
  for (const id of newlyClaimedPhotoIds) claimed.add(id);
  const nextUsed = normalizedUsed + newlyClaimedPhotoIds.length;
  return {
    ok: true,
    used: nextUsed,
    remaining: Math.max(0, normalizedQuota - nextUsed),
    newlyClaimedPhotoIds,
    claimedPhotoIds: [...claimed],
  };
}

function galleryPhotoDownloadEntitlement({ album, photo, sessionKey, unlockedPhotoIds = [], nowMs = Date.now(), timeZone }) {
  if (!album || !photo) return { accessible: false, clean: false, reason: "photo-not-found" };
  if (album.enabled === false) return { accessible: false, clean: false, reason: "gallery-disabled", photoId: photo.id };
  const window = albumAccessWindow(album, nowMs, timeZone || album.timezone || process.env.TZ || "Australia/Sydney");
  if (window.galleryExpired) return { accessible: false, clean: false, reason: "gallery-expired", photoId: photo.id };
  if (window.downloadsExpired) return { accessible: false, clean: false, reason: "downloads-expired", photoId: photo.id };
  if (photo.hidden || (!album.showCullRejectsToClient && photo.cull?.status === "reject")) {
    return { accessible: false, clean: false, reason: "photo-unavailable", photoId: photo.id };
  }
  if (album.purchasingDisabled) return { accessible: false, clean: false, reason: "purchasing-disabled" };
  if (album.lockDownloadsDuringProofing && album.proofingEnabled) {
    const stage = album.proofingStage || "not-started";
    if (stage !== "not-started" && stage !== "finals-delivered") return { accessible: false, clean: false, reason: "proofing-locked" };
  }
  const result = (accessible, clean, reason) => ({ accessible, clean, reason, photoId: photo.id });
  if (album.paidPhotoIds?.includes(photo.id) || photo.paid === true) return result(true, true, "admin-photo-grant");
  const sessionPurchase = album.sessionPurchases?.[sessionKey];
  if (sessionPurchase?.fullAlbum === true) return result(true, true, "paid-album");
  if (sessionPurchase?.photoIds?.includes(photo.id)) return result(true, true, "paid-photo");
  const bankApproved = (album.downloadRequests || []).some(request =>
    ["approved", "completed"].includes(request?.status) && request.sessionKey === sessionKey &&
    (request.fullAlbum === true || request.photoIds?.includes(photo.id))
  );
  if (bankApproved) return result(true, true, "approved-request");
  if (album.allUnlocked) return result(true, true, "album-unlock");
  const albumClean = album.watermarkDisabled === true;
  if (unlockedPhotoIds.includes(photo.id)) return result(true, albumClean, "session-unlock");
  const used = Math.max(0, Number(album.usedFreeDownloads?.[sessionKey]) || 0);
  const quota = Math.max(0, Number.isFinite(Number(album.freeDownloads)) ? Number(album.freeDownloads) : 5);
  if (used < quota) return result(true, albumClean, "free-quota");
  return result(false, false, "payment-required");
}

function isValidSlug(value) {
  return SLUG_RE.test(String(value || ""));
}

function parseDate(value) {
  const match = DATE_RE.exec(String(value || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day, value: `${match[1]}-${match[2]}-${match[3]}`, dayOfWeek: date.getUTCDay() };
}

function parseTime(value) {
  const match = TIME_RE.exec(String(value || ""));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute, minutes: hour * 60 + minute, value: `${match[1]}:${match[2]}` };
}

function zonedNowParts(timeZone, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const get = type => Number(parts.find(part => part.type === type)?.value);
    const year = get("year");
    const month = get("month");
    const day = get("day");
    const hour = get("hour");
    const minute = get("minute");
    return {
      date: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      minutes: hour * 60 + minute,
    };
  } catch {
    return zonedNowParts("UTC", now);
  }
}

function availabilityWindows(eventType, dateValue) {
  const parsedDate = parseDate(dateValue);
  if (!parsedDate || !eventType?.availability) return [];
  const availability = eventType.availability;
  if (Array.isArray(availability.blockedDates) && availability.blockedDates.includes(parsedDate.value)) return [];
  const specific = Array.isArray(availability.specificDates)
    ? availability.specificDates.filter(slot => slot?.date === parsedDate.value)
    : [];
  const candidates = specific.length
    ? specific
    : (Array.isArray(availability.recurring) ? availability.recurring.filter(slot => Number(slot?.day) === parsedDate.dayOfWeek) : []);
  return candidates.flatMap(slot => {
    const start = parseTime(slot?.startTime);
    const end = parseTime(slot?.endTime);
    return start && end && start.minutes < end.minutes ? [{ start: start.minutes, end: end.minutes }] : [];
  });
}

function intervalsConflict(leftStart, leftEnd, rightStart, rightEnd) {
  return leftStart < rightEnd && rightStart < leftEnd;
}

function bookingBlocksAvailability(booking, nowMs = Date.now()) {
  if (!booking || booking.status === "cancelled") return false;
  const holdExpiry = Date.parse(booking.holdExpiresAt || "");
  if (!Number.isFinite(holdExpiry) || holdExpiry > nowMs) return true;
  const authoritativelySettled = ["paid", "deposit-paid"].includes(booking.paymentStatus)
    || ["confirmed", "completed"].includes(booking.status);
  return authoritativelySettled;
}

function bookingSessionHasElapsed(booking, nowMs, timeZone) {
  const date = parseDate(booking?.date);
  if (!date) return false;
  const now = zonedNowParts(timeZone || "UTC", new Date(nowMs));
  if (date.value < now.date) return true;
  if (date.value > now.date) return false;
  const time = parseTime(booking?.time);
  if (!time) return false;
  const duration = Math.max(0, Number(booking?.duration) || 0);
  return time.minutes + duration <= now.minutes;
}

/**
 * Archiving is a retention/presentation action, never a way to release a live
 * booking slot. Only terminal, elapsed, or authoritatively expired unpaid
 * holds can be archived. Availability continues to use the canonical booking
 * status/payment fields independently of this flag.
 */
function bookingCanBeArchived(booking, nowMs = Date.now(), timeZone = "UTC") {
  if (!booking || typeof booking !== "object") return false;
  if (booking.archived === true) return true;
  if (["cancelled", "completed"].includes(booking.status)) return true;
  const holdExpiry = Date.parse(booking.holdExpiresAt || "");
  const settled = ["paid", "deposit-paid", "cash"].includes(booking.paymentStatus)
    || ["confirmed", "completed"].includes(booking.status);
  if (!settled && Number.isFinite(holdExpiry) && holdExpiry <= nowMs) return true;
  return bookingSessionHasElapsed(booking, nowMs, timeZone);
}

function bookingAllowsCapabilityMutation(booking) {
  return !!booking && booking.archived !== true;
}

function applyBookingArchiveState(bookings, bookingIds, archived, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const changedAt = new Date(nowMs).toISOString();
  const changedBy = String(options.actor || "admin").slice(0, 128);
  const requestedIds = [...new Set((Array.isArray(bookingIds) ? bookingIds : []).map(id => String(id || "").trim()).filter(Boolean))];
  const requested = new Set(requestedIds);
  const found = new Set();
  const changedIds = [];
  const unchangedIds = [];
  const skipped = [];
  const nextBookings = (Array.isArray(bookings) ? bookings : []).map(booking => {
    if (!booking || !requested.has(String(booking.id || ""))) return booking;
    const id = String(booking.id);
    found.add(id);
    const currentlyArchived = booking.archived === true;
    if (currentlyArchived === archived) {
      unchangedIds.push(id);
      return booking;
    }
    const timeZone = typeof options.timezoneForBooking === "function"
      ? options.timezoneForBooking(booking)
      : options.timezone;
    if (archived && !bookingCanBeArchived(booking, nowMs, timeZone || "UTC")) {
      skipped.push({ id, reason: "active-booking" });
      return booking;
    }
    const history = Array.isArray(booking.archiveHistory) ? booking.archiveHistory.slice(-99) : [];
    const next = {
      ...booking,
      archived,
      archiveHistory: [...history, { archived, changedAt, changedBy }],
    };
    if (archived) {
      next.archivedAt = changedAt;
      next.archivedBy = changedBy;
      delete next.unarchivedAt;
    } else {
      next.unarchivedAt = changedAt;
      delete next.archivedAt;
      delete next.archivedBy;
    }
    changedIds.push(id);
    return next;
  });
  for (const id of requestedIds) {
    if (!found.has(id)) skipped.push({ id, reason: "not-found" });
  }
  return { bookings: nextBookings, changedIds, unchangedIds, skipped };
}

function bookingConflicts(candidate, bookings, eventTypes, options = {}) {
  const start = parseTime(candidate.time)?.minutes;
  const duration = Number(candidate.duration);
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) return true;
  const candidateType = eventTypes.find(type => type.id === candidate.eventTypeId) || {};
  const candidateBuffer = Math.max(0, Number(candidateType.bufferMinutes) || 0);
  const candidateEnd = start + duration + candidateBuffer;
  return (bookings || []).some(existing => {
    if (!existing || existing.id === options.excludeBookingId || existing.date !== candidate.date) return false;
    const nowMs = options.nowMs ?? Date.now();
    if (!bookingBlocksAvailability(existing, nowMs)) return false;
    if (options.tenantSlug !== undefined && String(existing.tenantSlug || "") !== String(options.tenantSlug || "")) return false;
    const existingStart = parseTime(existing.time)?.minutes;
    const existingDuration = Number(existing.duration);
    if (!Number.isFinite(existingStart) || !Number.isFinite(existingDuration) || existingDuration <= 0) return false;
    const existingType = eventTypes.find(type => type.id === existing.eventTypeId) || {};
    const existingBuffer = Math.max(0, Number(existingType.bufferMinutes) || 0);
    return intervalsConflict(start, candidateEnd, existingStart, existingStart + existingDuration + existingBuffer);
  });
}

function tenantLicenseState(tenant, licenseKeys, nowMs = Date.now()) {
  if (!tenant || tenant.active === false) return { active: false, reason: "tenant-inactive", license: null };
  const key = String(tenant.licenseKey || "").trim().toUpperCase();
  if (!key) return { active: false, reason: "license-missing", license: null };
  const license = (Array.isArray(licenseKeys) ? licenseKeys : []).find(item => String(item?.key || "").trim().toUpperCase() === key) || null;
  if (!license) return { active: false, reason: "license-not-found", license: null };
  if (license.revokedAt || license.revoked === true || license.status === "revoked") return { active: false, reason: "license-revoked", license };
  const expiresAt = Date.parse(license.expiresAt || "");
  if (license.expiresAt && !Number.isFinite(expiresAt)) return { active: false, reason: "license-invalid", license };
  if (Number.isFinite(expiresAt) && expiresAt <= nowMs) return { active: false, reason: "license-expired", license };
  if (!license.usedAt || String(license.usedBy || "") !== String(tenant.slug || "")) {
    return { active: false, reason: "license-unclaimed", license };
  }
  return { active: true, reason: null, license };
}

function validateEventTypeIdentityChange(currentTypes, nextTypes) {
  if (!Array.isArray(nextTypes)) return { ok: false, error: "Event types must be an array", introducedIds: [] };
  const ids = nextTypes.map(item => typeof item?.id === "string" ? item.id.trim() : "");
  if (ids.some(id => !id || id.length > 120)) return { ok: false, error: "Every event type requires a stable id", introducedIds: [] };
  if (new Set(ids).size !== ids.length) return { ok: false, error: "Event type ids must be unique", introducedIds: [] };
  const currentIds = new Set((Array.isArray(currentTypes) ? currentTypes : []).map(item => String(item?.id || "")).filter(Boolean));
  return { ok: true, introducedIds: ids.filter(id => !currentIds.has(id)) };
}

function getPriceForDuration(eventType, duration) {
  const key = String(duration);
  const candidates = [eventType?.durationPrices, eventType?.prices];
  for (const prices of candidates) {
    if (prices && Object.prototype.hasOwnProperty.call(prices, key)) {
      const value = Number(prices[key]);
      if (Number.isFinite(value) && value >= 0) return value;
    }
  }
  const base = Number(eventType?.price);
  return Number.isFinite(base) && base >= 0 ? base : 0;
}

function calculateDeposit(eventType, total) {
  if (!eventType?.depositEnabled) return { required: false, amount: 0 };
  const configured = Math.max(0, Number(eventType.depositAmount) || 0);
  const amount = eventType.depositType === "percentage"
    ? Math.round(total * Math.min(100, configured)) / 100
    : Math.min(total, configured);
  return { required: amount > 0, amount };
}

/**
 * Validate a requested booking against the authoritative event type, schedule,
 * timezone, duration, and existing bookings. Returns normalized derived fields.
 */
function validateBookingRequest(input, context) {
  const eventTypes = Array.isArray(context?.eventTypes) ? context.eventTypes : [];
  const eventType = eventTypes.find(type => type?.id === input?.eventTypeId && type.active !== false);
  if (!eventType) return { ok: false, status: 400, error: "Event type is unavailable" };
  const date = parseDate(input?.date);
  const time = parseTime(input?.time);
  const duration = Number(input?.duration);
  if (!date || !time) return { ok: false, status: 400, error: "A valid date and time are required" };
  if (!Number.isInteger(duration) || duration <= 0 || !Array.isArray(eventType.durations) || !eventType.durations.map(Number).includes(duration)) {
    return { ok: false, status: 400, error: "Invalid duration for this event type" };
  }
  const nowParts = zonedNowParts(context?.timezone || "UTC", context?.now || new Date());
  if (date.value < nowParts.date || (date.value === nowParts.date && time.minutes <= nowParts.minutes)) {
    return { ok: false, status: 400, error: "Bookings must be in the future" };
  }
  const windows = availabilityWindows(eventType, date.value);
  const end = time.minutes + duration;
  const slotInterval = Math.max(5, Math.min(60, Number(eventType.slotIntervalMinutes) || 10));
  if (!windows.some(window => time.minutes >= window.start && end <= window.end && (time.minutes - window.start) % slotInterval === 0)) {
    return { ok: false, status: 409, error: "This time is outside the configured availability" };
  }
  const normalized = {
    date: date.value,
    time: time.value,
    duration,
    eventTypeId: eventType.id,
    type: eventType.title,
  };
  if (bookingConflicts(normalized, context?.bookings || [], eventTypes, {
    tenantSlug: context?.tenantSlug,
    excludeBookingId: context?.excludeBookingId,
    nowMs: context?.now?.getTime?.() ?? Date.now(),
  })) {
    return { ok: false, status: 409, error: "This time conflicts with an existing booking" };
  }
  const paymentAmount = getPriceForDuration(eventType, duration);
  const deposit = calculateDeposit(eventType, paymentAmount);
  return {
    ok: true,
    eventType,
    normalized: {
      ...normalized,
      paymentAmount,
      depositRequired: deposit.required,
      depositAmount: deposit.amount,
      requiresConfirmation: eventType.requiresConfirmation === true,
    },
  };
}

function generateAvailableSlots({ eventType, date, duration: requestedDuration, bookings = [], eventTypes = [], timezone = "UTC", tenantSlug, now = new Date() }) {
  const allowedDurations = (eventType?.durations || []).map(Number).filter(value => Number.isInteger(value) && value > 0);
  const duration = requestedDuration == null ? Math.min(...allowedDurations) : Number(requestedDuration);
  if (!allowedDurations.includes(duration)) return [];
  if (!Number.isFinite(duration)) return [];
  const interval = Math.max(5, Math.min(60, Number(eventType?.slotIntervalMinutes) || 10));
  const nowMs = now?.getTime?.() ?? Date.now();
  const nowParts = zonedNowParts(timezone, now);
  const eventTypeById = new Map((eventTypes.length ? eventTypes : [eventType]).map(type => [type.id, type]));
  const blockingIntervals = (bookings || []).flatMap(existing => {
    if (!existing || existing.date !== date || !bookingBlocksAvailability(existing, nowMs)) return [];
    if (tenantSlug !== undefined && String(existing.tenantSlug || "") !== String(tenantSlug || "")) return [];
    const start = parseTime(existing.time)?.minutes;
    const existingDuration = Number(existing.duration);
    if (!Number.isFinite(start) || !Number.isFinite(existingDuration) || existingDuration <= 0) return [];
    const existingBuffer = Math.max(0, Number(eventTypeById.get(existing.eventTypeId)?.bufferMinutes) || 0);
    return [{ start, end: start + existingDuration + existingBuffer }];
  });
  const candidateBuffer = Math.max(0, Number(eventType?.bufferMinutes) || 0);
  const slots = new Set();
  for (const window of availabilityWindows(eventType, date)) {
    for (let minute = window.start; minute + duration <= window.end; minute += interval) {
      const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      if (date < nowParts.date || (date === nowParts.date && minute <= nowParts.minutes)) continue;
      const candidateEnd = minute + duration + candidateBuffer;
      if (blockingIntervals.some(existing => intervalsConflict(minute, candidateEnd, existing.start, existing.end))) continue;
      slots.add(time);
    }
  }
  return [...slots].sort();
}

module.exports = {
  applyBookingArchiveState,
  albumAllowsFreeFullUnlock,
  albumAccessWindow,
  availabilityWindows,
  bookingAllowsCapabilityMutation,
  bookingCanBeArchived,
  bookingBlocksAvailability,
  bookingConflicts,
  bookingNeedsPaymentReview,
  calculateDeposit,
  collectUploadFileNames,
  generateAvailableSlots,
  galleryShareLinkAccess,
  galleryPhotoDownloadEntitlement,
  getPriceForDuration,
  evaluatePublicBookingAttempt,
  hashBookingAttemptId,
  hashBookingAttemptIdentity,
  isValidSlug,
  isExplicitNativeOrigin,
  normalizeBookingAttemptId,
  normalizeBookingAttemptIdentity,
  normalizeClientPortalEmail,
  parseCookies,
  parseDate,
  parseTime,
  planFreePhotoClaims,
  safeTenantPrivateDto,
  safeTenantPublicDto,
  safeGalleryAlbumDto,
  safeGalleryPurchaseDto,
  selectClientPortalAlbumGroups,
  resolveUploadOwnerScope,
  resolveBookingPaymentReview,
  resolveContainedPath,
  safeUploadFilenameFromSrc,
  signSession,
  timingSafeTextEqual,
  tenantLicenseState,
  tenantSelfServiceStoreKeyAllowed,
  uploadBelongsToScope,
  uploadPreviewVariant,
  validateEventTypeIdentityChange,
  validateBookingRequest,
  verifySession,
  uploadsWithoutRemainingReferences,
  zonedNowParts,
};
