const crypto = require("crypto");

const DOWNLOAD_EMAIL_POLICIES = new Set(["off", "optional", "required"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeDownloadEmailPolicy(value) {
  const normalized = String(value || "off").trim().toLowerCase();
  return DOWNLOAD_EMAIL_POLICIES.has(normalized) ? normalized : "off";
}

function normalizeDownloadEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return null;
  const [local, domain] = email.split("@");
  if (!local || local.length > 64 || !domain || domain.length > 253) return null;
  return email;
}

function hashDownloadIdentifier(value, secret) {
  if (!value) return null;
  return crypto
    .createHmac("sha256", String(secret || "download-capture"))
    .update(String(value))
    .digest("hex");
}

function freeAccessRequiresCapture(policy, usesFreeAccess, hasValidCapture) {
  return normalizeDownloadEmailPolicy(policy) === "required" && usesFreeAccess && !hasValidCapture;
}

function buildDownloadCaptureRecord({
  email,
  album,
  tenantSlug = null,
  sessionKey,
  ip,
  userAgent,
  secret,
  now = new Date(),
}) {
  const normalizedEmail = normalizeDownloadEmail(email);
  if (!normalizedEmail) throw new Error("A valid email address is required");
  const timestamp = now.toISOString();
  return {
    id: `download-email-${crypto.randomBytes(12).toString("hex")}`,
    email: normalizedEmail,
    albumId: String(album?.id || "").slice(0, 240),
    albumSlug: String(album?.slug || "").slice(0, 240) || null,
    albumTitle: String(album?.title || "").slice(0, 240) || null,
    tenantSlug: tenantSlug ? String(tenantSlug).slice(0, 120) : null,
    sessionHash: hashDownloadIdentifier(sessionKey, secret),
    ipHash: hashDownloadIdentifier(ip, secret),
    userAgent: String(userAgent || "").slice(0, 300) || null,
    createdAt: timestamp,
    updatedAt: timestamp,
    firstDownloadedAt: null,
    lastDownloadedAt: null,
    downloadCount: 0,
    requestedPhotos: 0,
    includedPhotos: 0,
    watermarkedPhotos: 0,
    cleanPhotos: 0,
    lastQuality: null,
  };
}

function recordMatchesRequest(record, albumId, sessionKey, secret) {
  if (!record || record.albumId !== String(albumId || "")) return false;
  const sessionHash = hashDownloadIdentifier(sessionKey, secret);
  if (!sessionHash || record.sessionHash !== sessionHash) return false;
  return true;
}

module.exports = {
  buildDownloadCaptureRecord,
  freeAccessRequiresCapture,
  hashDownloadIdentifier,
  normalizeDownloadEmail,
  normalizeDownloadEmailPolicy,
  recordMatchesRequest,
};
