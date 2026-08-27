const express = require("express");
const multer = require("multer");
const cors = require("cors");
const compression = require("compression");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { createSqliteStore } = require("./sqlite-store");
const sharp = require("sharp");
const archiver = require("archiver");
const rateLimit = require("express-rate-limit");
const { Client: FtpClient } = require("basic-ftp");
const { uploadFilesToFtp, moveFileOnFtp, testFtpConnection, sanitizeFolderName, sanitizeRemoteFilename } = require("./ftp");
const {
  autoCullGroup,
  bestShotScore,
  rankBestShots,
  scoreReview,
} = require("./auto-cull-engine");
const {
  registerRoutes: registerGoogleCalendarRoutes,
  getAuthenticatedClient: getMainGoogleCalendarClient,
  loadCalSettings: loadMainCalendarSettings,
} = require("./google-calendar");
const {
  registerRoutes: registerEmailRoutes,
  getTransporter,
  getFromAddress,
  buildTenantTransporter,
  getTenantFromAddress,
  buildAdminAlertEmail,
  buildAutomationEmail,
  buildClientPortalEmail,
  buildGalleryDeliveryEmail,
  buildWaitlistEmail,
  prepareCustomEmail,
  sendBookingConfirmationEmail,
  sendBookingUpdateEmail,
} = require("./email");
const {
  DEFAULT_AUTOMATION_GRACE_MS,
  DEFAULT_AUTOMATION_INTERVAL_MS,
  buildAutomationPreview: buildAutomationPreviewCore,
  getAutomationDecision,
  getStarterAutomationRules,
  normalizeAutomationRule: normalizeAutomationRuleCore,
  renderAutomationSubject,
} = require("./email-automation-core");
const {
  registerRoutes: registerStripeRoutes,
  registerTenantStripeRoutes,
  bookingCheckoutResourceLockKey,
  expireBookingCheckout,
  calculateAlbumSelectionPricing,
  mainStripeReady,
  safeCheckoutReturnUrl,
  tenantStripeReady,
  withCheckoutResourceLock,
} = require("./stripe");
const { registerRoutes: registerGoogleSheetsRoutes } = require("./google-sheets");
const {
  buildDownloadCaptureRecord,
  normalizeDownloadEmail,
  normalizeDownloadEmailPolicy,
  recordMatchesRequest,
} = require("./download-email-capture");
const {
  sendDiscordEmbed,
  notifyNewBooking,
  notifyNewEnquiry,
  notifyPayment,
  notifyBookingUpdate,
  notifyAlbumPurchase,
  notifyProofingSubmission,
  notifyInvoice,
} = require("./discord");
const {
  applyBookingArchiveState,
  albumAllowsFreeFullUnlock,
  albumAccessWindow,
  bookingAllowsCapabilityMutation,
  bookingBlocksAvailability,
  bookingConflicts,
  collectUploadFileNames,
  evaluatePublicBookingAttempt,
  galleryPhotoDownloadEntitlement,
  galleryShareLinkAccess,
  generateAvailableSlots,
  isExplicitNativeOrigin,
  isValidSlug,
  normalizeClientPortalEmail,
  parseCookies,
  parseDate,
  parseTime,
  planFreePhotoClaims,
  resolveContainedPath,
  resolveBookingPaymentReview,
  resolveUploadOwnerScope,
  safeUploadFilenameFromSrc,
  safeTenantPrivateDto,
  safeTenantPublicDto,
  safeGalleryAlbumDto,
  safeGalleryPurchaseDto,
  selectClientPortalAlbumGroups,
  signSession,
  timingSafeTextEqual,
  tenantLicenseState,
  tenantSelfServiceStoreKeyAllowed,
  uploadBelongsToScope,
  uploadPreviewVariant,
  validateEventTypeIdentityChange,
  validateBookingRequest,
  verifySession,
} = require("./security-core");

// ── DB key constants ──────────────────────────────────────────────────────────
const DB_KEYS = {
  ADMIN:         "wv_admin",
  SETUP:         "wv_setup_complete",
  SETTINGS:      "wv_settings",
  PROFILE:       "wv_profile",
  ALBUMS:        "wv_albums",
  BOOKINGS:      "wv_bookings",
  EVENT_TYPES:   "wv_event_types",
  INVOICES:      "wv_invoices",
  INSTALMENTS:   "wv_instalments",
  CONTACTS:      "wv_contacts",
  ENQUIRIES:     "wv_enquiries",
  EXPENSES:      "wv_expenses",
  QUOTES:        "wv_quotes",
  TAGS:          "wv_tags",
  TEMPLATES:     "wv_email_templates",
  AUTOMATIONS:   "wv_email_automations",
  PHOTO_LIB:     "wv_photo_library",
  TASK_TMPLS:    "wv_task_templates",
  WAITLIST:      "wv_waitlist",
  PUSH_SUBS:     "wv_push_subscriptions",
  ICAL:          "wv_ical",
  LICENSE_KEYS:  "wv_license_keys",
  LICENSE_PLANS: "wv_license_plans",
  LICENSE_PURCHASES: "wv_license_purchases",
  CALENDAR_SYNC_QUEUE: "wv_calendar_sync_queue",
  SLOT_REQUESTS: "wv_event_slot_requests",
  PORTFOLIO_DRAFT: "wv_portfolio_draft",
  PORTFOLIO_PUBLISHED: "wv_portfolio_published",
  PORTFOLIO_SETTINGS: "wv_portfolio_settings",
  ZIP_STATS: "wv_zip_stats",
  DOWNLOAD_EMAIL_CAPTURES: "wv_download_email_captures",
};

// Lightroom Classic uses these endpoints from a local plug-in.  The key is
// deliberately separate from the regular browser API: the plug-in needs a
// stable, machine-readable manifest rather than an admin-page data dump.

/** Safe HTML entity escaping to prevent XSS when interpolating user data into email HTML. */
function escapeHtml(str) {
  if (typeof str !== "string") return str == null ? "" : String(str);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Read and JSON-parse a DB key, returning `fallback` (default `null`) if missing or unparseable.
 * Eliminates the repeated `typeof raw === "string" ? JSON.parse(raw) : raw` pattern.
 */
function dbGet(db, key, fallback = null) {
  const raw = db[key];
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return fallback; }
  }
  return raw;
}

const app = express();
// Do not trust caller-supplied X-Forwarded-For on directly exposed deployments.
// Operators behind a known proxy can explicitly set a hop count (for example
// TRUST_PROXY=1) or an Express/proxy-addr subnet expression.
function configuredTrustProxy(value) {
  const raw = String(value || "").trim();
  if (!raw || /^(?:false|off|no|0)$/i.test(raw)) return false;
  if (/^[1-9]\d*$/.test(raw)) return Math.min(10, Number(raw));
  if (/^(?:loopback|linklocal|uniquelocal)(?:\s*,\s*(?:loopback|linklocal|uniquelocal))*$/i.test(raw)) return raw;
  if (/^[a-f\d.:/]+(?:\s*,\s*[a-f\d.:/]+)*$/i.test(raw)) return raw;
  return false;
}
app.set("trust proxy", configuredTrustProxy(process.env.TRUST_PROXY));
const PORT = process.env.PORT || 5066;
const DEFAULT_PUBLIC_SITE_HOSTS = "zacmclients.photos,www.zacmclients.photos,zacmorganphotography.com,www.zacmorganphotography.com";
const publicSiteHosts = () => String(process.env.PUBLIC_SITE_HOSTS || DEFAULT_PUBLIC_SITE_HOSTS)
  .split(",")
  .map(value => value.trim().toLowerCase())
  .filter(Boolean);
const CANONICAL_PORTFOLIO_HOST = String(process.env.CANONICAL_PORTFOLIO_HOST || "zacmorganphotography.com")
  .trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
const CANONICAL_PORTFOLIO_ORIGIN = `https://${CANONICAL_PORTFOLIO_HOST}`;
const PORTFOLIO_SEO_ROUTES = {
  "/": {
    title: "Zac Morgan Photography | Sydney Event Photographer",
    description: "Sydney event photographer Zac Morgan captures weddings, concerts, sport, corporate events and hospitality with vivid, candid imagery.",
  },
  "/portfolio": {
    title: "Photography Portfolio | Zac Morgan Photography",
    description: "Explore wedding, live music, sports, cosplay, corporate event and hospitality photography by Sydney photographer Zac Morgan.",
  },
  "/concerts": {
    title: "Concert & Live Music Photography | Zac Morgan",
    description: "Live music and concert photography from Sydney venues, festivals and performances, captured by Zac Morgan.",
  },
  "/about": {
    title: "About Zac Morgan | Sydney Event Photographer",
    description: "Meet Sydney event photographer Zac Morgan and learn about his candid, people-focused approach to weddings, sport, music and events.",
  },
  "/testimonials": {
    title: "Client Testimonials | Zac Morgan Photography",
    description: "Read feedback from wedding, event and commercial photography clients who have worked with Sydney photographer Zac Morgan.",
  },
  "/enquire": {
    title: "Photography Enquiry | Zac Morgan Photography",
    description: "Enquire about wedding, event, concert, sports, corporate or hospitality photography in Sydney and beyond.",
  },
};
const PORTFOLIO_ROUTE_ALIASES = new Map([
  ["/concert", "/concerts"],
  ["/contact", "/enquire"],
  ["/index.html", "/"],
]);
const PORTFOLIO_SOCIAL_IMAGE = `${CANONICAL_PORTFOLIO_ORIGIN}/portfolio/curated/sports-hyrox-leap.jpg`;

function normalizedRequestPath(value) {
  const pathname = String(value || "/");
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : "/";
}

function isPortfolioSiteHost(hostname) {
  return publicSiteHosts().includes(String(hostname || "").toLowerCase());
}

function portfolioCanonicalUrl(routePath) {
  return `${CANONICAL_PORTFOLIO_ORIGIN}${routePath === "/" ? "/" : routePath}`;
}

function portfolioStructuredData(routePath, title) {
  const canonicalUrl = portfolioCanonicalUrl(routePath);
  const graph = [
    {
      "@type": "WebSite",
      "@id": `${CANONICAL_PORTFOLIO_ORIGIN}/#website`,
      url: `${CANONICAL_PORTFOLIO_ORIGIN}/`,
      name: "Zac Morgan Photography",
      inLanguage: "en-AU",
    },
    {
      "@type": ["LocalBusiness", "ProfessionalService"],
      "@id": `${CANONICAL_PORTFOLIO_ORIGIN}/#business`,
      name: "Zac Morgan Photography",
      description: "Sydney event and commercial photography studio",
      url: `${CANONICAL_PORTFOLIO_ORIGIN}/`,
      image: PORTFOLIO_SOCIAL_IMAGE,
      email: "zacmorganphotography@gmail.com",
      areaServed: { "@type": "City", name: "Sydney" },
      founder: { "@id": `${CANONICAL_PORTFOLIO_ORIGIN}/#zac-morgan` },
      sameAs: ["https://www.instagram.com/zacmphotos/", "https://www.linkedin.com/in/zacmorgan1/"],
      knowsAbout: ["Event photography", "Wedding photography", "Concert photography", "Sports photography", "Corporate photography", "Food photography"],
    },
    {
      "@type": "Person",
      "@id": `${CANONICAL_PORTFOLIO_ORIGIN}/#zac-morgan`,
      name: "Zac Morgan",
      jobTitle: "Photographer",
      url: `${CANONICAL_PORTFOLIO_ORIGIN}/about`,
      worksFor: { "@id": `${CANONICAL_PORTFOLIO_ORIGIN}/#business` },
      sameAs: ["https://www.instagram.com/zacmphotos/", "https://www.linkedin.com/in/zacmorgan1/"],
    },
    {
      "@type": "WebPage",
      "@id": `${canonicalUrl}#webpage`,
      url: canonicalUrl,
      name: title,
      isPartOf: { "@id": `${CANONICAL_PORTFOLIO_ORIGIN}/#website` },
      about: { "@id": `${CANONICAL_PORTFOLIO_ORIGIN}/#business` },
      inLanguage: "en-AU",
    },
  ];
  if (routePath !== "/") {
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${CANONICAL_PORTFOLIO_ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: title.split(" | ")[0], item: canonicalUrl },
      ],
    });
  }
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
}

function portfolioSeoBlock(routePath) {
  const meta = PORTFOLIO_SEO_ROUTES[routePath] || PORTFOLIO_SEO_ROUTES["/"];
  const canonicalUrl = portfolioCanonicalUrl(routePath);
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  return `<!-- SEO:START -->
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta name="author" content="Zac Morgan Photography" />
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
    <link rel="canonical" href="${canonicalUrl}" />
    <link rel="icon" href="/portfolio/logo.png" type="image/png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <meta property="og:site_name" content="Zac Morgan Photography" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="en_AU" />
    <meta property="og:url" content="${canonicalUrl}" />
    <meta property="og:image" content="${PORTFOLIO_SOCIAL_IMAGE}" />
    <meta property="og:image:width" content="3000" />
    <meta property="og:image:height" content="2004" />
    <meta property="og:image:alt" content="Athletes in motion photographed by Zac Morgan" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${PORTFOLIO_SOCIAL_IMAGE}" />
    <meta name="twitter:image:alt" content="Athletes in motion photographed by Zac Morgan" />
    <script type="application/ld+json">${portfolioStructuredData(routePath, meta.title)}</script>
    <!-- SEO:END -->`;
}

function platformSeoBlock() {
  return `<!-- SEO:START -->
    <title>PhotoFlow - Booking & Client Galleries</title>
    <meta name="description" content="Photography booking, payments and private client gallery delivery powered by PhotoFlow." />
    <meta name="author" content="PhotoFlow" />
    <meta name="robots" content="noindex, nofollow, noarchive" />
    <meta property="og:title" content="PhotoFlow - Booking & Client Galleries" />
    <meta property="og:description" content="Photography booking, payments and private client gallery delivery powered by PhotoFlow." />
    <meta property="og:type" content="website" />
    <meta name="twitter:card" content="summary" />
    <!-- SEO:END -->`;
}

function gallerySocialImageUrl(req, album) {
  const raw = String(album?.coverImage || album?.photos?.[0]?.thumbnail || album?.photos?.[0]?.src || "").trim();
  if (!raw || raw.startsWith("data:") || raw.startsWith("file:")) return "";
  try {
    const url = new URL(raw, safeCheckoutReturnUrl(req, null, "/"));
    if (!/^https?:$/.test(url.protocol)) return "";
    if (url.pathname.startsWith("/uploads/")) {
      url.searchParams.set("size", "medium");
      url.searchParams.delete("wm");
      url.searchParams.delete("paid");
      url.searchParams.delete("sessionKey");
      url.searchParams.delete("albumId");
    }
    return url.toString();
  } catch {
    return "";
  }
}

function gallerySeoBlock(req, album, tenantSlug) {
  const db = readDb();
  const tenantSettings = tenantSlug ? dbGet(db, `t_${tenantSlug}_wv_tenant_settings`, {}) : {};
  const profile = dbGet(db, DB_KEYS.PROFILE, {});
  const brand = String(tenantSettings?.businessName || tenantSettings?.brandName || profile?.businessName || profile?.name || "PhotoFlow").trim();
  const albumTitle = String(album?.title || "Photo gallery").trim();
  const title = escapeHtml(brand && !albumTitle.toLowerCase().includes(brand.toLowerCase()) ? `${albumTitle} | ${brand}` : albumTitle);
  const plainDescription = String(album?.description || `View ${albumTitle} by ${brand}.`)
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  const description = escapeHtml(plainDescription);
  const canonicalUrl = escapeHtml(safeCheckoutReturnUrl(req, null, `/gallery/${encodeURIComponent(album.slug || album.id)}`));
  const imageUrl = escapeHtml(gallerySocialImageUrl(req, album));
  const imageMeta = imageUrl ? `
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:secure_url" content="${imageUrl}" />
    <meta property="og:image:alt" content="Cover photo for ${escapeHtml(albumTitle)}" />
    <meta name="twitter:image" content="${imageUrl}" />` : "";
  return `<!-- SEO:START -->
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta name="robots" content="noindex, follow, max-image-preview:large" />
    <link rel="canonical" href="${canonicalUrl}" />
    <meta property="og:site_name" content="${escapeHtml(brand)}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${canonicalUrl}" />${imageMeta}
    <meta name="twitter:card" content="${imageUrl ? "summary_large_image" : "summary"}" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <!-- SEO:END -->`;
}
const DATA_DIR = process.env.DATA_DIR || "/data";
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const LEGACY_DB_FILE = path.join(DATA_DIR, "db.json");
const sqliteStore = createSqliteStore({ dataDir: DATA_DIR, legacyFile: LEGACY_DB_FILE });
const DB_FILE = sqliteStore.filePath;
if (sqliteStore.migratedLegacy) console.log("✅ Imported db.json into transactional SQLite storage; a current JSON rollback shadow will be retained.");
const MAX_ZIP_FILES = 1000; // Reasonable upper bound per request to prevent resource abuse
const ZIP_WATERMARK_CONCURRENCY = Math.max(1, Math.min(8,
  Number.parseInt(process.env.ZIP_WATERMARK_CONCURRENCY || "", 10) ||
  Math.min(4, Math.max(2, (os.availableParallelism?.() || os.cpus().length || 2) - 1))
));
const WATERMARK_OVERLAY_CACHE_SIZE = 8;
const ZIP_QUALITY_SETTINGS = {
  "2mb": { width: 2048, jpegQuality: 80 },
  "5mb": { width: 4000, jpegQuality: 88 },
};
// Shared Cache-Control header for short-lived public read endpoints (60 s fresh, 5 min stale)
const SHORT_CACHE = "public, max-age=60, stale-while-revalidate=300";
const ALLOWED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".tif", ".tiff", ".heic", ".heif"]);
const IGNORED_SYSTEM_FILENAMES = new Set(["thumbs.db", ".ds_store", "desktop.ini"]);

function isIgnoredSystemFileName(filename) {
  const base = path.basename(String(filename || "")).toLowerCase();
  return !base || base === "_cache" || base.startsWith("._") || IGNORED_SYSTEM_FILENAMES.has(base);
}

function isSupportedImageFilename(filename) {
  return ALLOWED_IMAGE_EXTENSIONS.has(path.extname(String(filename || "")).toLowerCase());
}

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
// Pre-create the image cache directory once at startup so every image request
// avoids a redundant mkdirSync syscall on the hot path.
const CACHE_DIR = path.join(UPLOADS_DIR, "_cache");
fs.mkdirSync(CACHE_DIR, { recursive: true });
// ZIPs are active job artifacts, not image variants. Keeping them outside the
// image cache prevents a cache-clear request from deleting an in-progress job.
const ZIP_JOBS_DIR = path.join(DATA_DIR, "zip-jobs");
fs.mkdirSync(ZIP_JOBS_DIR, { recursive: true });
const PORTFOLIO_MEDIA_DIR = path.join(DATA_DIR, "portfolio-media");
fs.mkdirSync(PORTFOLIO_MEDIA_DIR, { recursive: true });
const BOOKING_REFERENCES_DIR = path.join(DATA_DIR, "booking-references");
fs.mkdirSync(BOOKING_REFERENCES_DIR, { recursive: true });
const ZIP_READY_TTL_MS = Math.max(60_000, Number(process.env.ZIP_READY_TTL_MS) || 15 * 60 * 1000);
const ZIP_TRANSFERRED_TTL_MS = Math.max(10_000, Number(process.env.ZIP_TRANSFERRED_TTL_MS) || 2 * 60 * 1000);
// Remove artifacts left by a container restart. Active jobs only exist in memory,
// so no ZIP in this directory is reusable after startup.
try {
  const cutoff = Date.now() - ZIP_READY_TTL_MS;
  for (const name of fs.readdirSync(ZIP_JOBS_DIR)) {
    const target = path.join(ZIP_JOBS_DIR, name);
    try { if (fs.statSync(target).mtimeMs < cutoff) fs.unlinkSync(target); } catch {}
  }
} catch {}
function writeJsonFileAtomicSync(targetFile, value) {
  const tempFile = `${targetFile}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(value, null, 2), { encoding: "utf8", flag: "wx" });
    fs.renameSync(tempFile, targetFile);
  } catch (err) {
    try { fs.unlinkSync(tempFile); } catch {}
    throw err;
  }
}

// ── Super Admin Bootstrap ──────────────────────────────────────────────────
// If SUPER_ADMIN_USERNAME + SUPER_ADMIN_PASSWORD are set in the environment
// (e.g. via docker-compose.yml / TrueNAS app YAML), pre-seed the admin account
// so the Setup wizard is skipped on first run.
const crypto = require("crypto");
const configuredSessionSeed = String(process.env.SESSION_SECRET || process.env.SUPER_ADMIN_PASSWORD || "");
const SESSION_SECRET = configuredSessionSeed
  ? crypto.createHash("sha256").update(configuredSessionSeed, "utf8").digest("base64url")
  : crypto.randomBytes(32).toString("base64url");
if (!configuredSessionSeed) {
  console.warn("⚠️  SESSION_SECRET is not configured; login sessions will be invalidated whenever the server restarts.");
}
const ADMIN_SESSION_COOKIE = "wv_admin_session";
const TENANT_SESSION_COOKIE = "wv_tenant_session";
const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60;
// A native capture session must comfortably cover a full event day. The old
// two-hour token could expire mid-shoot while the public health check still
// reported the server as online, causing uploads to be mislabelled "offline".
const ADMIN_NATIVE_TOKEN_TTL_SECONDS = 12 * 60 * 60;
const TENANT_SESSION_TTL_SECONDS = 12 * 60 * 60;
const GALLERY_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const NATIVE_APP_ORIGINS = String(process.env.NATIVE_APP_ORIGINS || "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

function requestUsesHttps(req) {
  return req.secure || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase() === "https";
}

function setHttpOnlyCookie(req, res, name, value, maxAgeSeconds) {
  const nativeCrossSite = isExplicitNativeOrigin(req.headers.origin, NATIVE_APP_ORIGINS);
  const secure = nativeCrossSite || (process.env.COOKIE_SECURE === "false" ? false : (process.env.NODE_ENV === "production" || requestUsesHttps(req)));
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${nativeCrossSite ? "None" : "Lax"}`,
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (secure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

function clearHttpOnlyCookie(req, res, name) {
  setHttpOnlyCookie(req, res, name, "", 0);
}

function galleryCookieName(albumId) {
  return `wv_gallery_${crypto.createHash("sha256").update(String(albumId)).digest("hex").slice(0, 16)}`;
}

let bcrypt;
try {
  bcrypt = require("bcryptjs");
} catch (err) {
  console.error("FATAL: bcryptjs is not installed. Run 'npm install bcryptjs' inside the server directory.");
  process.exit(1);
}
const BCRYPT_ROUNDS = 12;
const DUMMY_TENANT_PASSWORD_HASH = "$2a$12$r49pvUqjm51reqkO/3NYyOVEsKQYBhdavAWIOhXm/ZuFNSQA..1FS";
function sha256(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}
/** Hash a value with bcrypt, storing it as "$2b$..." so we can detect the scheme. */
async function bcryptHash(value) {
  return bcrypt.hash(value, BCRYPT_ROUNDS);
}
function credentialVersion(storedHash) {
  return crypto.createHash("sha256").update(String(storedHash || ""), "utf8").digest("base64url").slice(0, 22);
}
/** Verify an incoming SHA-256 hash against a stored hash (bcrypt or legacy plain sha256). */
async function verifyPasswordHash(incoming, stored) {
  if (!stored) return false;
  if (stored.startsWith("$2")) {
    // bcrypt hash — use constant-time compare
    return bcrypt.compare(incoming, stored);
  }
  // Legacy plain sha256 — timing-safe compare
  try {
    const a = Buffer.from(incoming);
    const b = Buffer.from(stored);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Shared authentication helper used by both requireAuth middleware and /api/storage.
 * Returns true if the Basic auth header contains valid admin credentials, false otherwise.
 */
async function authenticatedAdminUsername(req) {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
      const colonIdx = decoded.indexOf(":");
      if (colonIdx === -1) return null;
      const user = decoded.slice(0, colonIdx);
      const hash = decoded.slice(colonIdx + 1);
      const db = readDb();
      const adminCreds = dbGet(db, DB_KEYS.ADMIN);
      if (!adminCreds || String(adminCreds.username || "").toLowerCase() !== String(user || "").toLowerCase()) return null;
      return await verifyPasswordHash(hash, adminCreds.passwordHash) ? String(adminCreds.username) : null;
    } catch {
      return null;
    }
  }
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : parseCookies(req.headers.cookie)[ADMIN_SESSION_COOKIE];
  const session = verifySession(token, SESSION_SECRET, { purpose: "admin" });
  if (!session?.sub) return null;
  const adminCreds = dbGet(readDb(), DB_KEYS.ADMIN);
  return adminCreds && session.cv === credentialVersion(adminCreds.passwordHash) && String(adminCreds.username || "").toLowerCase() === String(session.sub).toLowerCase()
    ? String(adminCreds.username)
    : null;
}

async function authenticateAdmin(req) {
  return !!(await authenticatedAdminUsername(req));
}
async function seedSuperAdminIfNeeded() {
  const username = (process.env.SUPER_ADMIN_USERNAME || "").trim();
  const password = (process.env.SUPER_ADMIN_PASSWORD || "").trim();
  if (!username || !password) return;
  if (password === "changeme") {
    console.warn("⚠️  SUPER_ADMIN_PASSWORD is set to the default 'changeme' — change it immediately in your docker-compose.yml!");
  }
  const db = readDbDirect(); // read directly to avoid cache bootstrap ordering issues
  if (db["wv_admin"] && db["wv_setup_complete"]) return; // already bootstrapped
  const sha = sha256(password);
  const hash = await bcryptHash(sha);
  db["wv_admin"] = JSON.stringify({ username, passwordHash: hash });
  db["wv_setup_complete"] = "true";
  writeDb(db);
  console.log(`✅ Super admin '${username}' bootstrapped from SUPER_ADMIN_USERNAME env var`);
}
function readDbDirect() {
  try {
    const dbData = sqliteStore.read();
    if (!dbData || typeof dbData !== "object" || Array.isArray(dbData)) throw new Error("Database root must be an object");
    return dbData;
  } catch (err) {
    console.error("Error reading database file:", err);
    throw new Error("Database is unreadable; refusing to replace it with empty data", { cause: err });
  }
}

// ── In-memory DB cache (avoids disk reads on every request) ──
let _dbCache = null;
let _dbCacheTime = 0;
// Cache TTL is long because every writeDb() call updates the in-memory cache immediately,
// so reads only fall back to disk on the very first request or after a long idle period.
const DB_CACHE_TTL = 60000; // 60 seconds

function readDb() {
  const now = Date.now();
  if (_dbCache !== null && (now - _dbCacheTime) < DB_CACHE_TTL) return _dbCache;
  try {
    _dbCache = sqliteStore.read();
    _dbCacheTime = now;
    return _dbCache;
  } catch (err) {
    // Log the full error so administrators are aware of database read issues
    console.error("readDb error:", err);
    throw new Error("Database is unavailable", { cause: err });
  }
}

// ── Debounced async write ─────────────────────────────────────────────────
// Updates in-memory cache immediately (so all reads reflect the new data
// straight away) and schedules a single async disk write after a short idle
// window.  Rapid back-to-back mutations (e.g. bulk photo uploads) therefore
// only result in one or two actual disk writes instead of hundreds, which
// prevents the synchronous I/O from blocking the Node.js event loop.
let _writeDebounceTimer = null;
let _writePending = false;
let _writeGeneration = 0;
let _flushedGeneration = 0;
let _flushInProgress = false;

async function _flushDbToDisk() {
  _writeDebounceTimer = null;
  if (_flushInProgress || !_dbCache) return;
  _flushInProgress = true;
  const generation = _writeGeneration;
  try {
    sqliteStore.write(_dbCache);
    _flushedGeneration = Math.max(_flushedGeneration, generation);
  } catch (err) {
    console.error("writeDb error:", err);
  } finally {
    _flushInProgress = false;
    _writePending = _flushedGeneration < _writeGeneration;
    if (_writePending && !_writeDebounceTimer) _writeDebounceTimer = setTimeout(_flushDbToDisk, 50);
  }
}

function writeDb(data) {
  // Always update the in-memory cache synchronously so subsequent reads are
  // consistent with the mutation that just happened.
  _dbCache = data;
  _dbCacheTime = Date.now();
  _writeGeneration += 1;
  // Schedule (or re-schedule) the debounced async disk write.
  _writePending = true;
  if (_writeDebounceTimer) clearTimeout(_writeDebounceTimer);
  _writeDebounceTimer = setTimeout(_flushDbToDisk, 300);
}

// Flush any pending write on clean shutdown so data is never lost.
function _flushDbSync() {
  if (_writePending && _dbCache) {
    if (_writeDebounceTimer) {
      clearTimeout(_writeDebounceTimer);
      _writeDebounceTimer = null;
    }
    try {
      sqliteStore.write(_dbCache);
      _flushedGeneration = _writeGeneration;
    } catch (e) {
      console.error("Failed to flush database to disk on shutdown:", e);
    }
    _writePending = false;
  }
}
process.on("exit", _flushDbSync);
process.on("SIGTERM", () => { _flushDbSync(); process.exit(0); });
process.on("SIGINT",  () => { _flushDbSync(); process.exit(0); });

// Bootstrap super admin from env vars (runs after writeDb is available)
const bootstrapPromise = seedSuperAdminIfNeeded();

// CORS — restrict to explicitly allowed origins via ALLOWED_ORIGINS env var.
// Defaults to false (no CORS headers) when the variable is unset, which is
// the safe default for a self-hosted app accessed from the same origin.
// Set ALLOWED_ORIGINS=https://yourdomain.com,https://other.com to allow specific origins.
const corsOrigins = [...new Set([
  ...String(process.env.ALLOWED_ORIGINS || "").split(","),
  ...NATIVE_APP_ORIGINS,
].map(origin => origin.trim()).filter(Boolean))];
app.use(cors({ origin: corsOrigins.length ? corsOrigins : false, credentials: true }));
// Compress all responses (JSON, HTML, JS, CSS, etc.) — reduces transfer size by ~70-90%
app.use(compression());
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  if (req.secure || req.headers["x-forwarded-proto"] === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  const requestPath = normalizedRequestPath(req.path);
  if (requestPath.startsWith("/admin") || requestPath.startsWith("/api") || requestPath.startsWith("/portfolio-preview") || requestPath.startsWith("/downloads")) {
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  if (isPortfolioSiteHost(req.hostname)) {
    res.setHeader("Content-Language", "en-AU");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; upgrade-insecure-requests");
  }
  next();
});
app.use((req, res, next) => {
  if (!isPortfolioSiteHost(req.hostname)) return next();
  const requestPath = normalizedRequestPath(req.path);
  if (requestPath === "/api" || requestPath.startsWith("/api/")) return next();
  const canonicalPath = PORTFOLIO_ROUTE_ALIASES.get(requestPath) || requestPath;
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  const requiresHttps = forwardedProto && forwardedProto !== "https";
  const requiresCanonicalHost = String(req.hostname || "").toLowerCase() !== CANONICAL_PORTFOLIO_HOST;
  const requiresCanonicalPath = canonicalPath !== requestPath || (req.path.length > 1 && req.path.endsWith("/"));
  if ((requiresHttps || requiresCanonicalHost || requiresCanonicalPath) && (req.method === "GET" || req.method === "HEAD")) {
    const queryIndex = req.originalUrl.indexOf("?");
    const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";
    return res.redirect(308, `${portfolioCanonicalUrl(canonicalPath)}${query}`);
  }
  next();
});
// Skip JSON body parsing for the Stripe webhook route — it requires the raw Buffer for
// signature verification.  The route itself applies express.raw() instead.
const authenticatedLargeJson = express.json({ limit: "20mb" });
function usesAuthenticatedLargeJson(req) {
  if (req.method !== "PUT") return false;
  return /^\/api\/store\/[^/]+$/.test(req.path)
    || /^\/api\/albums\/[^/]+$/.test(req.path)
    || /^\/api\/tenant\/[^/]+\/albums\/[^/]+$/.test(req.path);
}
app.use((req, res, next) => {
  if (req.path === "/api/stripe/webhook") return next();
  if (req.path.startsWith("/api/tenant/") && req.path.endsWith("/stripe/webhook")) return next();
  if (usesAuthenticatedLargeJson(req)) return next();
  express.json({ limit: "256kb" })(req, res, next);
});

// ── Health check ──────────────────────────────────────
// Intentionally lightweight – just confirms the server is alive.
// Heavy storage stats are available via /api/storage.
app.get("/api/health", (_req, res) => {
  try {
    readDb();
    res.json({ ok: true, uptimeSeconds: Math.floor(process.uptime()) });
  } catch {
    res.status(503).json({ ok: false, error: "Database unavailable" });
  }
});

function getStorageUsage() {
  let totalBytes = 0;
  let photoFiles = [];
  try {
    const dbSize = fs.statSync(DB_FILE).size;
    totalBytes += dbSize;
    const files = fs.readdirSync(UPLOADS_DIR);
    for (const f of files) {
      if (isIgnoredSystemFileName(f) || !isSupportedImageFilename(f)) continue;
      try {
        const stat = fs.statSync(path.join(UPLOADS_DIR, f));
        if (stat.isDirectory()) continue; // skip subdirectories
        totalBytes += stat.size;
        photoFiles.push({ name: f, size: stat.size, modified: stat.mtime });
      } catch {}
    }
  } catch {}
  let diskStats = null;
  try {
    const { execSync } = require("child_process");
    const dfOutput = execSync(`df -B1 ${DATA_DIR} 2>/dev/null || true`, { encoding: "utf-8" });
    const lines = dfOutput.trim().split("\n");
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      if (parts.length >= 6) {
        diskStats = {
          totalBytes: parseInt(parts[1]) || 0,
          usedBytes: parseInt(parts[2]) || 0,
          availableBytes: parseInt(parts[3]) || 0,
          mountPoint: parts[5] || DATA_DIR,
        };
      }
    }
  } catch {}
  return {
    totalBytes,
    photoCount: photoFiles.length,
    dbSizeBytes: fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE).size : 0,
    uploadsSizeBytes: totalBytes - (fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE).size : 0),
    allFileNames: photoFiles.map(f => f.name),
    photoFiles: photoFiles.sort((a, b) => b.size - a.size).slice(0, 50),
    disk: diskStats,
    dataDir: DATA_DIR,
  };
}

// /api/storage returns sensitive disk metadata (file names, sizes, paths).
// Restrict it to callers that include the admin password hash so it cannot be
// scraped by anonymous visitors who know the URL.
app.get("/api/storage", async (req, res) => {
  if (await authenticateAdmin(req)) {
    return res.json(getStorageUsage());
  }
  return res.status(401).json({ error: "Authentication required" });
});

app.get("/api/backup/download", requireAuth, (req, res) => {
  try {
    _flushDbSync();
    sqliteStore.checkpoint();

    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `photoflow-backup-${stamp}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");

    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("warning", (err) => {
      console.warn("backup archive warning:", err);
    });
    archive.on("error", (err) => {
      console.error("backup archive error:", err);
      if (!res.headersSent) res.status(500).json({ error: "Backup failed" });
      else res.destroy(err);
    });

    archive.pipe(res);
    const addFileIfExists = (filePath, archiveName) => {
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        archive.file(filePath, { name: archiveName });
      }
    };
    const addDir = (dirPath, archivePrefix) => {
      if (!fs.existsSync(dirPath)) return;
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = path.join(dirPath, entry.name);
        const archiveName = path.posix.join(archivePrefix, entry.name);
        if (entry.isDirectory()) {
          if (fullPath === CACHE_DIR) continue;
          addDir(fullPath, archiveName);
        } else if (entry.isFile()) {
          archive.file(fullPath, { name: archiveName });
        }
      }
    };

    addFileIfExists(DB_FILE, "photoflow.sqlite");
    addFileIfExists(LEGACY_DB_FILE, "rollback/db.json");
    addFileIfExists(path.join(DATA_DIR, "tenants.json"), "tenants.json");
    addFileIfExists(path.join(DATA_DIR, "license_keys.json"), "license_keys.json");
    addFileIfExists(path.join(DATA_DIR, "event_slot_requests.json"), "event_slot_requests.json");
    addFileIfExists(path.join(DATA_DIR, "google-tokens.json"), "google-tokens.json");
    addFileIfExists(path.join(DATA_DIR, "gcal-settings.json"), "gcal-settings.json");
    addDir(UPLOADS_DIR, "uploads");
    addDir(PORTFOLIO_MEDIA_DIR, "portfolio-media");
    addFileIfExists(path.join(CACHE_DIR, "xmp-presets.json"), "uploads/_cache/xmp-presets.json");
    archive.append(JSON.stringify({
      createdAt: now.toISOString(),
      dataDir: DATA_DIR,
      includes: ["photoflow.sqlite", "uploads/", "portfolio-media/", "sidecar JSON files when present"],
      excluded: ["uploads/_cache generated image variants"],
      app: "PhotoFlow",
    }, null, 2), { name: "backup-manifest.json" });
    archive.finalize();
  } catch (err) {
    console.error("backup download error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Backup failed" });
  }
});

// ── Waitlist ────────────────────────────────────────────────────────────────
app.get("/api/waitlist", requireAuth, (_req, res) => {
  const db = readDb();
  const entries = dbGet(db, DB_KEYS.WAITLIST, []);
  res.json({ entries: Array.isArray(entries) ? entries : [] });
});

const waitlistJoinLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: "Too many waitlist requests" } });
app.post("/api/waitlist/join", waitlistJoinLimiter, (req, res) => {
  const { eventTypeId, date, clientName, clientEmail, note } = req.body || {};
  if (!eventTypeId || !date || !clientName || !clientEmail) {
    return res.status(400).json({ ok: false, error: "eventTypeId, date, clientName and clientEmail are required" });
  }
  const db = readDb();
  const eventType = dbGet(db, DB_KEYS.EVENT_TYPES, []).find?.(item => item.id === eventTypeId && item.active !== false);
  if (!eventType || !parseDate(date)) return res.status(400).json({ ok: false, error: "A valid event type and date are required" });
  const entries = dbGet(db, DB_KEYS.WAITLIST, []);
  const email = String(clientEmail).trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !String(clientName).trim() || String(clientName).trim().length > 160) {
    return res.status(400).json({ ok: false, error: "A valid name and email are required" });
  }
  if (!Array.isArray(entries) || entries.length >= 5000) return res.status(429).json({ ok: false, error: "The waitlist is temporarily full" });
  const duplicate = Array.isArray(entries) && entries.some(e =>
    String(e.eventTypeId || "") === String(eventTypeId) &&
    String(e.date || "") === String(date) &&
    String(e.clientEmail || "").trim().toLowerCase() === email
  );
  if (duplicate) return res.json({ ok: true, duplicate: true });

  const entry = {
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"),
    eventTypeId: String(eventTypeId),
    eventTypeTitle: String(eventType.title || ""),
    date: String(date),
    clientName: String(clientName).trim().slice(0, 160),
    clientEmail: email,
    note: note ? String(note).trim().slice(0, 1000) : undefined,
    createdAt: new Date().toISOString(),
  };
  db[DB_KEYS.WAITLIST] = [...(Array.isArray(entries) ? entries : []), entry];
  writeDb(db);
  res.json({ ok: true, entry });
});

app.delete("/api/waitlist/:id", requireAuth, (req, res) => {
  const db = readDb();
  const entries = dbGet(db, DB_KEYS.WAITLIST, []);
  if (!Array.isArray(entries)) return res.json({ ok: true });
  db[DB_KEYS.WAITLIST] = entries.filter(e => e.id !== req.params.id);
  writeDb(db);
  res.json({ ok: true });
});

// ── Baked-asset stripping ─────────────────────────────────────────────────
// thumbnailWatermarked, mediumWatermarked, and fullWatermarked are base64
// JPEG data-URLs produced client-side by the "Rebuild Watermarked Assets"
// feature (up to ~1.6 MB *per photo*).  In server mode the watermark overlay
// is already applied on the fly by /uploads/:filename, so these pre-baked
// blobs add zero value server-side.  Stripping them on both reads AND writes
// keeps the application database lean and eliminates the primary source of inflated
// /api/store payloads (100 photos × 2.4 MB each = 240 MB before this fix).
const BAKED_PHOTO_FIELDS = ["thumbnailWatermarked", "mediumWatermarked", "fullWatermarked"];
const ALBUMS_KEY        = "wv_albums";
const PHOTO_LIB_KEY     = "wv_photo_library";
const TENANT_ALBUMS_SUFFIX   = "_wv_albums";
const TENANT_PHOTO_LIB_SUFFIX = "_wv_photo_library";

function _stripBakedFromPhotos(photos) {
  if (!Array.isArray(photos)) return photos;
  return photos.filter(_isSupportedPersistedPhotoRecord).map(p => {
    if (!p || typeof p !== "object") return p;
    const out = { ...p };
    for (const f of BAKED_PHOTO_FIELDS) delete out[f];
    return out;
  });
}

function _isUploadPhotoSource(src) {
  if (!src || typeof src !== "string") return false;
  try {
    const pathname = /^https?:\/\//i.test(src) ? new URL(src).pathname : src.split("?")[0];
    return pathname.startsWith("/uploads/");
  } catch {
    return false;
  }
}

function _isSupportedPersistedPhotoRecord(photo) {
  if (!photo || typeof photo !== "object") return false;
  const src = photo.src || photo.url || "";
  if (!_isUploadPhotoSource(src)) return true;
  const filename = uploadFilenameFromSrc(src);
  return !!filename && !isIgnoredSystemFileName(filename) && isSupportedImageFilename(filename);
}

function _mergePhotoArrays(existingPhotos, incomingPhotos) {
  const merged = Array.isArray(existingPhotos) ? [...existingPhotos] : [];
  const findIndex = (photo) => {
    if (!photo || typeof photo !== "object") return -1;
    if (photo.id) {
      const byId = merged.findIndex(p => p?.id === photo.id);
      if (byId >= 0) return byId;
    }
    if (photo.src) {
      return merged.findIndex(p => p?.src === photo.src);
    }
    return -1;
  };

  for (const photo of _stripBakedFromPhotos(incomingPhotos) || []) {
    const idx = findIndex(photo);
    if (idx >= 0) merged[idx] = { ...merged[idx], ...photo };
    else merged.push(photo);
  }
  return merged;
}

function _chooseAlbumStoreMatch(mainMatch, tenantMatches) {
  const matches = [mainMatch, ...(tenantMatches || [])].filter(Boolean);
  // Album IDs/slugs are public capabilities. Never guess between stores when a
  // collision exists, otherwise one tenant can shadow another tenant's gallery.
  return matches.length === 1 ? matches[0] : null;
}

function _ensurePhotoProofIdentity(photo) {
  if (!photo || typeof photo !== "object") return photo;
  const originalName = photo.originalName || photo.title || photo.id || "";
  const baseName = originalName.replace(/\.[^.]+$/, "");
  // The camera-assigned number is the last run of digits (IMG_004217, DSC1234).
  // Keep it as text so leading zeroes remain useful when matching the card/file.
  const originalFileNumber = (baseName.match(/(\d+)(?!.*\d)/) || [])[1];
  return {
    ...photo,
    ...(photo.originalName ? {} : { originalName }),
    ...(originalFileNumber && !photo.originalFileNumber ? { originalFileNumber } : {}),
    ...(photo.proofId ? {} : { proofId: baseName.replace(/^_+/, "") || photo.id }),
  };
}

function _photoRecordFromUpload(file, ftpUploaded) {
  const originalName = file.originalName || file.id;
  const baseName = originalName.replace(/\.[^.]+$/, "");
  const originalFileNumber = (baseName.match(/(\d+)(?!.*\d)/) || [])[1];
  return {
    id: file.id,
    src: file.url,
    thumbnail: `${file.url}?size=thumb&wm=0`,
    title: baseName.replace(/^_+/, ""),
    width: file.width || 800,
    height: file.height || 600,
    uploadedAt: new Date().toISOString(),
    ...(file.takenAt ? { takenAt: file.takenAt } : {}),
    originalName,
    ...(originalFileNumber ? { originalFileNumber } : {}),
    proofId: baseName.replace(/^_+/, "") || file.id,
    fileSize: file.size,
    ...(file.cull ? { cull: file.cull } : {}),
    ...(file.cullMetadata ? { cullMetadata: file.cullMetadata } : {}),
    ...(file.blurScore != null ? { blurScore: file.blurScore } : {}),
    ...(file.duplicateGroupId ? { duplicateGroupId: file.duplicateGroupId } : {}),
    ...(file.duplicateRank != null ? { duplicateRank: file.duplicateRank } : {}),
    ...(ftpUploaded ? { ftpUploaded: true } : {}),
  };
}

function _appendUploadedFilesToAlbum(db, tenantSlug, albumId, uploadedFiles, ftpUploaded) {
  if (!albumId || !uploadedFiles?.length) return { ok: true, skipped: true };

  const storeKey = tenantSlug ? `t_${tenantSlug}_wv_albums` : ALBUMS_KEY;
  const raw = db[storeKey];
  const albums = raw ? (typeof raw === "string" ? JSON.parse(raw) : (Array.isArray(raw) ? raw : [])) : [];
  const idx = albums.findIndex(a => a.id === albumId || a.slug === albumId);
  if (idx < 0) return { ok: false, error: "Album not found" };

  const photos = _mergePhotoArrays(
    albums[idx].photos || [],
    uploadedFiles.map(file => _photoRecordFromUpload(file, ftpUploaded)),
  );

  albums[idx] = {
    ...albums[idx],
    photos,
    photoCount: photos.length,
    coverImage: albums[idx].coverImage || photos[0]?.src || "",
    _photosStripped: false,
  };
  db[storeKey] = JSON.stringify(albums);
  return { ok: true, album: albums[idx] };
}

function uploadFilenameFromSrc(src) {
  const filename = safeUploadFilenameFromSrc(src);
  return filename && !isIgnoredSystemFileName(filename) ? filename : "";
}

function resolveExistingUploadPath(filename) {
  const candidate = resolveContainedPath(UPLOADS_DIR, filename);
  if (!candidate || !fs.existsSync(candidate)) return null;
  try {
    const root = fs.realpathSync(UPLOADS_DIR);
    const real = fs.realpathSync(candidate);
    return real.startsWith(`${root}${path.sep}`) && real !== root ? real : null;
  } catch { return null; }
}

function _resolveAlbumStore(db, tenantSlug, albumId) {
  const storeKey = tenantSlug ? `t_${tenantSlug}_wv_albums` : ALBUMS_KEY;
  const albums = _parseAlbumsFromDb(db[storeKey]);
  const idx = albums.findIndex(a => a.id === albumId || a.slug === albumId);
  return { storeKey, albums, idx, album: idx >= 0 ? albums[idx] : null };
}

function _clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function _mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function _variance(values, meanValue = _mean(values)) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => {
    const delta = value - meanValue;
    return sum + delta * delta;
  }, 0) / values.length;
}

function _hammingHex(a, b) {
  const aa = String(a || "");
  const bb = String(b || "");
  const len = Math.min(aa.length, bb.length);
  let distance = Math.abs(aa.length - bb.length) * 4;
  for (let i = 0; i < len; i += 1) {
    const xor = parseInt(aa[i], 16) ^ parseInt(bb[i], 16);
    distance += xor.toString(2).replace(/0/g, "").length;
  }
  return distance;
}

function _averageHashHex(pixels) {
  const avg = _mean(pixels);
  let bits = "";
  let hex = "";
  for (const px of pixels) bits += px >= avg ? "1" : "0";
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

async function _analysePhotoForCull(photo) {
  const filename = path.basename(uploadFilenameFromSrc(photo?.src || photo?.url || ""));
  if (!filename || isIgnoredSystemFileName(filename) || !isSupportedImageFilename(filename)) {
    return { ok: false, error: "Unsupported or missing image source" };
  }

  const filePath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) return { ok: false, error: "Image file not found" };

  const analysis = await sharp(filePath)
    .rotate()
    .resize(64, 64, { fit: "inside", withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = analysis.info;
  const pixels = Array.from(analysis.data);
  const luminanceMean = _mean(pixels);
  const luminanceStdDev = Math.sqrt(_variance(pixels, luminanceMean));
  const clippedRatio = pixels.filter(v => v <= 8 || v >= 247).length / Math.max(1, pixels.length);
  const exposureScore = _clamp01((1 - Math.abs(luminanceMean - 128) / 118) * (1 - clippedRatio * 0.8));
  const contrastScore = _clamp01(luminanceStdDev / 64);

  const laplacian = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      laplacian.push(Math.abs(
        pixels[i] * 4 -
        pixels[i - 1] -
        pixels[i + 1] -
        pixels[i - width] -
        pixels[i + width]
      ));
    }
  }
  const lapMean = _mean(laplacian);
  const blurVariance = _variance(laplacian, lapMean);
  const blurScore = _clamp01(blurVariance / 950);
  const sharpnessScore = Math.round(blurScore * 220);
  const subjectSharpnessScore = sharpnessScore;

  const hashData = await sharp(filePath)
    .rotate()
    .resize(8, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  const perceptualHash = _averageHashHex(Array.from(hashData));
  const score = _clamp01((blurScore * 0.45) + (exposureScore * 0.3) + (contrastScore * 0.25));

  return {
    ok: true,
    filename,
    cull: {
      score: Number(score.toFixed(4)),
      blur: Number(blurScore.toFixed(4)),
      blurScore: Number(blurScore.toFixed(4)),
      sharpnessScore,
      subjectSharpnessScore,
      exposure: Number(exposureScore.toFixed(4)),
      contrast: Number(contrastScore.toFixed(4)),
      luminanceMean: Number(luminanceMean.toFixed(2)),
      luminanceStdDev: Number(luminanceStdDev.toFixed(2)),
      clippedRatio: Number(clippedRatio.toFixed(4)),
      perceptualHash,
      visualHash: perceptualHash,
    },
  };
}

function _groupCullDuplicates(results, maxDistance) {
  const groups = [];
  for (const result of results) {
    const hash = result.cull?.perceptualHash;
    if (!hash) continue;
    let group = groups.find(g => _hammingHex(hash, g.hash) <= maxDistance);
    if (!group) {
      group = { id: `dup-${groups.length + 1}`, hash, items: [] };
      groups.push(group);
    }
    group.items.push(result);
  }
  return groups.filter(group => group.items.length > 1);
}

function _filenameBurstKey(value) {
  const stem = path.basename(String(value || ""), path.extname(String(value || ""))).toLowerCase();
  const match = stem.match(/^(.*?)(\d{3,})$/);
  if (!match) return null;
  const prefix = match[1].replace(/[-_\s.]+$/, "");
  const number = Number(match[2]);
  if (!Number.isFinite(number)) return null;
  return { prefix, number };
}

function _photoTimeMs(photo) {
  const raw = photo?.takenAt || photo?.capturedAt || null;
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function _sameBurstSequence(a, b, photos, options) {
  const aPhoto = photos[a.index] || {};
  const bPhoto = photos[b.index] || {};
  const aName = aPhoto.originalName || aPhoto.title || a.filename;
  const bName = bPhoto.originalName || bPhoto.title || b.filename;
  const aKey = _filenameBurstKey(aName);
  const bKey = _filenameBurstKey(bName);
  const sameOrientation = !!aPhoto.width && !!aPhoto.height && !!bPhoto.width && !!bPhoto.height
    ? (aPhoto.width >= aPhoto.height) === (bPhoto.width >= bPhoto.height)
    : true;
  if (!sameOrientation) return false;

  const timeGapMs = (() => {
    const aTime = _photoTimeMs(aPhoto);
    const bTime = _photoTimeMs(bPhoto);
    return aTime != null && bTime != null ? Math.abs(bTime - aTime) : null;
  })();
  if (timeGapMs != null && timeGapMs <= options.maxTimeGapMs) return true;

  if (!aKey || !bKey || aKey.prefix !== bKey.prefix) return false;
  const numberGap = Math.abs(bKey.number - aKey.number);
  if (numberGap <= options.maxNumberGap) return true;
  // Phone/camera filenames are sometimes millisecond timestamps with no prefix.
  return !aKey.prefix && !bKey.prefix && numberGap <= options.maxTimestampGap;
}

function _groupCullBursts(results, photos, options = {}) {
  const opts = {
    maxTimeGapMs: Number.isFinite(Number(options.maxTimeGapMs)) ? Number(options.maxTimeGapMs) : 2500,
    maxNumberGap: Number.isFinite(Number(options.maxNumberGap)) ? Number(options.maxNumberGap) : 2,
    maxTimestampGap: Number.isFinite(Number(options.maxTimestampGap)) ? Number(options.maxTimestampGap) : 4000,
    maxGroupSize: Number.isFinite(Number(options.maxGroupSize)) ? Math.max(2, Number(options.maxGroupSize)) : 12,
  };
  const ordered = results.slice().sort((a, b) => a.index - b.index);
  const groups = [];
  let current = [];

  for (const item of ordered) {
    const previous = current[current.length - 1];
    const continues = previous && current.length < opts.maxGroupSize && _sameBurstSequence(previous, item, photos, opts);
    if (!continues) {
      if (current.length > 1) groups.push({ id: `burst-${groups.length + 1}`, type: "burst", items: current });
      current = [item];
    } else {
      current.push(item);
    }
  }
  if (current.length > 1) groups.push({ id: `burst-${groups.length + 1}`, type: "burst", items: current });
  return groups;
}

function _photoCullPath(photo, index) {
  return String(photo?.id || photo?.src || photo?.originalName || index);
}

function _mediaFileFromCullResult(photo, result, visualGroupSize = 1) {
  const filename = photo?.originalName || photo?.title || result?.filename || `photo-${result?.index ?? 0}.jpg`;
  const extension = path.extname(filename || "").toLowerCase().replace(/^\./, "");
  const derivedSharpness = Number(result?.cull?.sharpnessScore);
  const fallbackSharpness = Number(result?.cull?.blurScore ?? result?.cull?.blur ?? 0) * 220;
  const sharpnessScore = Number.isFinite(derivedSharpness) ? derivedSharpness : Math.round(fallbackSharpness);
  const derivedSubjectSharpness = Number(result?.cull?.subjectSharpnessScore);
  const subjectSharpnessScore = Number.isFinite(derivedSubjectSharpness) ? derivedSubjectSharpness : sharpnessScore;
  const baseInput = {
    sharpnessScore,
    subjectSharpnessScore,
    faceCount: photo?.faceCount,
    faceBoxes: photo?.faceBoxes,
    faceDetection: photo?.faceDetection,
    personCount: photo?.personCount,
    personBoxes: photo?.personBoxes,
    rating: photo?.starred ? 5 : photo?.rating,
    isProtected: !!photo?.starred || !!photo?.isProtected,
    exposureValue: result?.cull?.exposure,
    visualGroupSize,
  };
  const review = scoreReview(baseInput);
  return {
    path: _photoCullPath(photo, result?.index ?? 0),
    name: filename,
    size: Number(photo?.fileSize || 0),
    type: "photo",
    extension,
    rating: baseInput.rating,
    isProtected: baseInput.isProtected,
    pick: photo?.cull?.status === "reject" && !photo?.starred ? "rejected" : photo?.starred ? "selected" : undefined,
    sharpnessScore,
    subjectSharpnessScore,
    faceCount: photo?.faceCount,
    faceBoxes: photo?.faceBoxes,
    faceDetection: photo?.faceDetection,
    personCount: photo?.personCount,
    personBoxes: photo?.personBoxes,
    exposureValue: result?.cull?.exposure,
    blurRisk: review.blurRisk,
    visualHash: result?.cull?.visualHash || result?.cull?.perceptualHash,
    visualGroupSize,
    reviewScore: review.score,
    reviewReasons: review.reasons,
  };
}

// Returns true when the db key may contain Photo objects with baked fields.
function _isBulkyPhotoKey(key) {
  if (key === ALBUMS_KEY || key === PHOTO_LIB_KEY) return true;
  if (key.startsWith("t_") && (key.endsWith(TENANT_ALBUMS_SUFFIX) || key.endsWith(TENANT_PHOTO_LIB_SUFFIX))) return true;
  return false;
}

// Parse a db value that may have been stringified before storage.
function _parseDbValue(val) {
  if (typeof val !== "string") return val;
  try { return JSON.parse(val); } catch { return val; }
}

// Return a copy of `value` with baked photo fields removed for any key that
// could contain Photo objects.  Safe to call for any key/value pair.
function stripBakedFields(key, value) {
  if (!_isBulkyPhotoKey(key)) return value;
  const parsed = _parseDbValue(value);
  if (key === ALBUMS_KEY || (key.startsWith("t_") && key.endsWith(TENANT_ALBUMS_SUFFIX))) {
    if (!Array.isArray(parsed)) return value;
    return parsed.map(album => ({ ...album, photos: _stripBakedFromPhotos(album.photos || []) }));
  }
  // photo library keys
  return _stripBakedFromPhotos(Array.isArray(parsed) ? parsed : value);
}

// ── Key-Value Store ────────────────────────────────────
// Supports optional ?keys=key1,key2,... query parameter to return only a
// subset of the database.  The frontend uses this to load critical keys
// (settings, profile, event types) immediately and defer heavy keys
// (albums, bookings, photo library) to a background request, so the app
// becomes interactive much sooner.
// ── Admin password verification endpoint ─────────────────────────────────────
// Returns { ok: true } if the supplied SHA-256 password hash matches the stored
// admin credentials (supports both legacy SHA-256 and bcrypt storage formats).
const authLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many login attempts — please wait" } });
app.post("/api/auth/verify", authLimiter, async (req, res) => {
  const { username, passwordHash } = req.body || {};
  if (!username || !passwordHash || typeof passwordHash !== "string") {
    return res.status(400).json({ ok: false, error: "username and passwordHash are required" });
  }
  const db = readDb();
  const adminRaw = db["wv_admin"];
  const adminCreds = adminRaw ? (typeof adminRaw === "string" ? JSON.parse(adminRaw) : adminRaw) : null;
  if (!adminCreds || String(adminCreds.username || "").toLowerCase() !== String(username || "").toLowerCase()) {
    return res.json({ ok: false });
  }
  const ok = await verifyPasswordHash(passwordHash, adminCreds.passwordHash);
  let nativeSessionToken;
  if (ok) {
    const token = signSession({ purpose: "admin", sub: String(adminCreds.username || username), cv: credentialVersion(adminCreds.passwordHash) }, SESSION_SECRET, { ttlSeconds: ADMIN_SESSION_TTL_SECONDS });
    setHttpOnlyCookie(req, res, ADMIN_SESSION_COOKIE, token, ADMIN_SESSION_TTL_SECONDS);
    if (isExplicitNativeOrigin(req.headers.origin, NATIVE_APP_ORIGINS)) {
      nativeSessionToken = signSession({ purpose: "admin", sub: String(adminCreds.username || username), cv: credentialVersion(adminCreds.passwordHash) }, SESSION_SECRET, { ttlSeconds: ADMIN_NATIVE_TOKEN_TTL_SECONDS });
    }
  }
  res.setHeader("Cache-Control", "no-store");
  res.json(ok && nativeSessionToken ? { ok: true, sessionToken: nativeSessionToken, expiresIn: ADMIN_NATIVE_TOKEN_TTL_SECONDS } : { ok });
});

app.post("/api/auth/logout", (req, res) => {
  clearHttpOnlyCookie(req, res, ADMIN_SESSION_COOKIE);
  res.json({ ok: true });
});

app.get("/api/auth/session", requireAuth, (req, res) => {
  const username = String(req.authContext?.username || "");
  const configuredSuperAdmin = String(process.env.SUPER_ADMIN_USERNAME || "").trim();
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    username,
    isSuperAdmin: !configuredSuperAdmin || username.toLowerCase() === configuredSuperAdmin.toLowerCase(),
  });
});

// ── requireAuth middleware ─────────────────────────────────────────────────
// Validates Basic auth header containing base64(username:passwordHash).
// Used to protect admin-only API routes.
async function requireAuth(req, res, next) {
  const username = await authenticatedAdminUsername(req);
  if (username) {
    req.authContext = { type: "admin", username };
    return next();
  }
  return res.status(401).json({ error: "Authentication required" });
}

// Bookings must never be replaced by an unauthenticated browser's local list.
// Public booking creation uses the dedicated endpoint below, which validates the
// event and checks the live schedule before writing.
function sanitizePublicProfile(profile) {
  if (!profile || typeof profile !== "object") return {};
  const allowed = ["name", "bio", "avatar", "timezone", "logo", "brandName", "website", "email", "phone", "instagram"];
  return Object.fromEntries(allowed.filter(key => profile[key] !== undefined).map(key => [key, profile[key]]));
}

function sanitizePublicSettings(settings, setupComplete) {
  const source = settings && typeof settings === "object" ? settings : {};
  return {
    setupComplete: setupComplete === true,
    stripeEnabled: source.stripeEnabled === true && mainStripeReady(),
    bookingTimerMinutes: Math.max(1, Math.min(120, Number(source.bookingTimerMinutes) || 15)),
    instagramFieldEnabled: source.instagramFieldEnabled === true,
    enquiryEnabled: source.enquiryEnabled !== false,
    enquiryLabel: typeof source.enquiryLabel === "string" ? source.enquiryLabel : undefined,
    brandColor: typeof source.brandColor === "string" ? source.brandColor : undefined,
    bankTransfer: source.bankTransfer && typeof source.bankTransfer === "object" ? {
      enabled: source.bankTransfer.enabled === true,
      accountName: String(source.bankTransfer.accountName || ""),
      bsb: String(source.bankTransfer.bsb || ""),
      accountNumber: String(source.bankTransfer.accountNumber || ""),
      payId: String(source.bankTransfer.payId || ""),
      payIdType: String(source.bankTransfer.payIdType || ""),
      instructions: String(source.bankTransfer.instructions || ""),
    } : { enabled: false },
  };
}

function sanitizePublicEventType(eventType) {
  const allowed = [
    "id", "title", "description", "durations", "color", "price", "active", "requiresConfirmation",
    "questions", "availability", "location", "depositEnabled", "depositAmount", "depositType", "depositMethods",
    "prices", "maxAttendees", "bufferMinutes", "slotIntervalMinutes", "isPackage", "packageEventIds", "durationPrices",
  ];
  return Object.fromEntries(allowed.filter(key => eventType?.[key] !== undefined).map(key => [key, eventType[key]]));
}

app.get("/api/public/config", (_req, res) => {
  const db = readDb();
  const profile = dbGet(db, DB_KEYS.PROFILE, {});
  const eventTypes = dbGet(db, DB_KEYS.EVENT_TYPES, []);
  const settings = dbGet(db, DB_KEYS.SETTINGS, {});
  const setupComplete = dbGet(db, DB_KEYS.SETUP, false) === true;
  res.setHeader("Cache-Control", SHORT_CACHE);
  res.json({
    profile: sanitizePublicProfile(profile),
    eventTypes: (Array.isArray(eventTypes) ? eventTypes : []).filter(item => item?.active !== false).map(sanitizePublicEventType),
    settings: sanitizePublicSettings(settings, setupComplete),
  });
});

function isLoopbackRequest(req) {
  const address = String(req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
  return address === "::1" || address === "127.0.0.1" || address.startsWith("127.");
}

function setupTokenIsRequired(req) {
  return process.env.NODE_ENV === "production" || !isLoopbackRequest(req);
}

app.get("/api/setup/status", authLimiter, (req, res) => {
  const db = readDb();
  const setupComplete = !!dbGet(db, DB_KEYS.ADMIN) || dbGet(db, DB_KEYS.SETUP, false) === true;
  const licenseKeyRequired = !setupComplete && readLicenseKeys().some(key => !key.usedAt && !key.revokedAt && key.revoked !== true && (!key.expiresAt || new Date(key.expiresAt).getTime() > Date.now()));
  res.setHeader("Cache-Control", "no-store");
  res.json({ setupComplete, licenseKeyRequired, setupTokenRequired: setupTokenIsRequired(req) });
});

app.post("/api/setup", authLimiter, async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const passwordHash = String(req.body?.passwordHash || "");
  if (setupTokenIsRequired(req)) {
    const configuredToken = String(process.env.SETUP_TOKEN || "");
    const suppliedToken = String(req.body?.setupToken || req.headers["x-setup-token"] || "");
    if (!configuredToken) return res.status(503).json({ ok: false, error: "SETUP_TOKEN must be configured before remote setup" });
    if (!timingSafeTextEqual(configuredToken, suppliedToken)) return res.status(403).json({ ok: false, error: "Invalid setup token" });
  }
  if (!/^[\w.@+-]{3,64}$/.test(username) || passwordHash.length < 32 || passwordHash.length > 256) {
    return res.status(400).json({ ok: false, error: "A valid username and password hash are required" });
  }
  let db = readDb();
  if (dbGet(db, DB_KEYS.ADMIN) || dbGet(db, DB_KEYS.SETUP, false) === true) {
    return res.status(409).json({ ok: false, error: "Setup has already been completed" });
  }
  let keys = readLicenseKeys();
  const usableKeys = keys.filter(key => !key.usedAt && !key.revokedAt && key.revoked !== true && (!key.expiresAt || new Date(key.expiresAt).getTime() > Date.now()));
  const suppliedLicenseKey = String(req.body?.licenseKey || "").trim().toUpperCase();
  let licenseKeyIndex = -1;
  if (usableKeys.length > 0) {
    licenseKeyIndex = keys.findIndex(key => timingSafeTextEqual(String(key.key || "").toUpperCase(), suppliedLicenseKey));
    if (licenseKeyIndex < 0 || keys[licenseKeyIndex].usedAt || keys[licenseKeyIndex].revokedAt || keys[licenseKeyIndex].revoked === true || (keys[licenseKeyIndex].expiresAt && new Date(keys[licenseKeyIndex].expiresAt).getTime() <= Date.now())) {
      return res.status(403).json({ ok: false, error: "A valid unused license key is required" });
    }
  }
  const storedHash = await bcryptHash(passwordHash);
  db = readDb();
  if (dbGet(db, DB_KEYS.ADMIN) || dbGet(db, DB_KEYS.SETUP, false) === true) {
    return res.status(409).json({ ok: false, error: "Setup has already been completed" });
  }
  if (licenseKeyIndex >= 0) {
    keys = readLicenseKeys();
    licenseKeyIndex = keys.findIndex(key => timingSafeTextEqual(String(key.key || "").toUpperCase(), suppliedLicenseKey));
    if (licenseKeyIndex < 0 || keys[licenseKeyIndex].usedAt || keys[licenseKeyIndex].revokedAt || keys[licenseKeyIndex].revoked === true || (keys[licenseKeyIndex].expiresAt && Date.parse(keys[licenseKeyIndex].expiresAt) <= Date.now())) {
      return res.status(409).json({ ok: false, error: "The licence key was claimed while setup was in progress" });
    }
    keys[licenseKeyIndex] = { ...keys[licenseKeyIndex], usedAt: new Date().toISOString(), usedBy: username, setupToken: undefined };
    writeLicenseKeys(keys);
  }
  db[DB_KEYS.ADMIN] = JSON.stringify({ username, passwordHash: storedHash });
  db[DB_KEYS.SETUP] = "true";
  writeDb(db);
  const token = signSession({ purpose: "admin", sub: username, cv: credentialVersion(storedHash) }, SESSION_SECRET, { ttlSeconds: ADMIN_SESSION_TTL_SECONDS });
  setHttpOnlyCookie(req, res, ADMIN_SESSION_COOKIE, token, ADMIN_SESSION_TTL_SECONDS);
  res.setHeader("Cache-Control", "no-store");
  if (isExplicitNativeOrigin(req.headers.origin, NATIVE_APP_ORIGINS)) {
    const sessionToken = signSession({ purpose: "admin", sub: username, cv: credentialVersion(storedHash) }, SESSION_SECRET, { ttlSeconds: ADMIN_NATIVE_TOKEN_TTL_SECONDS });
    return res.status(201).json({ ok: true, sessionToken, expiresIn: ADMIN_NATIVE_TOKEN_TTL_SECONDS });
  }
  res.status(201).json({ ok: true });
});

const STORE_OMITTED_SECRET_KEYS = new Set([DB_KEYS.ADMIN, "wv_gcal_tokens", "wv_google_sheets_tokens", "wv_oauth_tokens"]);
const GLOBAL_STORE_SECRET_FIELDS = ["discordWebhookUrl", "smtpPassword", "stripeSecretKey", "stripeWebhookSecret", "googleApiCredentials", "ftpPassword"];
function parseStoreObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }
  return null;
}
function withMaskedFields(value, fields) {
  const parsed = parseStoreObject(value);
  if (!parsed) return value;
  const masked = { ...parsed };
  for (const field of fields) {
    masked[`${field}Set`] = !!masked[field];
    delete masked[field];
  }
  return typeof value === "string" ? JSON.stringify(masked) : masked;
}
function safeStoreResponseValue(key, value) {
  if (STORE_OMITTED_SECRET_KEYS.has(key)) return undefined;
  const lean = stripBakedFields(key, value);
  if (key === "wv_ftp_settings") return withMaskedFields(lean, GLOBAL_FTP_SECRET_FIELDS);
  if (key === DB_KEYS.SETTINGS) return withMaskedFields(lean, GLOBAL_STORE_SECRET_FIELDS);
  if (key.startsWith("t_") && key.endsWith("_wv_tenant_settings")) return withMaskedFields(lean, TENANT_SECRET_FIELDS);
  return lean;
}
function mergePreservingStoreSecrets(key, existingValue, incomingValue) {
  const fields = key === "wv_ftp_settings"
    ? GLOBAL_FTP_SECRET_FIELDS
    : key === DB_KEYS.SETTINGS
      ? GLOBAL_STORE_SECRET_FIELDS
      : key.startsWith("t_") && key.endsWith("_wv_tenant_settings")
        ? TENANT_SECRET_FIELDS
        : [];
  if (!fields.length) return incomingValue;
  const existing = parseStoreObject(existingValue) || {};
  const incoming = parseStoreObject(incomingValue);
  if (!incoming) return incomingValue;
  const merged = { ...incoming };
  for (const field of fields) {
    delete merged[`${field}Set`];
    if (merged[field] == null || merged[field] === "") {
      if (existing[field] != null && existing[field] !== "") merged[field] = existing[field];
      else delete merged[field];
    }
  }
  return typeof incomingValue === "string" ? JSON.stringify(merged) : merged;
}

app.get("/api/store", requireAuth, (req, res) => {
  const db = readDb();
  if (req.query.keys) {
    const requested = String(req.query.keys).split(",").map(k => k.trim()).filter(Boolean);
    const subset = {};
    for (const k of requested) {
      if (!Object.prototype.hasOwnProperty.call(db, k)) continue;
      const safeValue = safeStoreResponseValue(k, db[k]);
      if (safeValue !== undefined) subset[k] = safeValue;
    }
    return res.json(subset);
  }
  // Strip baked fields from every key in the full-dump path too, so that
  // any existing inflated databases are immediately lean on the wire.
  const result = {};
  for (const [k, v] of Object.entries(db)) {
    const safeValue = safeStoreResponseValue(k, v);
    if (safeValue !== undefined) result[k] = safeValue;
  }
  res.json(result);
});
app.get("/api/store/:key", requireAuth, (req, res) => {
  const db = readDb();
  const key = req.params.key;
  const safeValue = key in db ? safeStoreResponseValue(key, db[key]) : undefined;
  res.json({ value: safeValue === undefined ? null : safeValue });
});
app.put("/api/store/:key", requireAuth, authenticatedLargeJson, async (req, res) => {
  const db = readDb();
  const key = req.params.key;
  if (key === DB_KEYS.BOOKINGS) {
    return res.status(409).json({ error: "Bookings must be changed through the atomic booking endpoints" });
  }
  let value = stripBakedFields(key, req.body.value);
  value = mergePreservingStoreSecrets(key, db[key], value);
  if (key === DB_KEYS.INVOICES) {
    const asString = typeof value === "string";
    let incoming;
    try { incoming = asString ? JSON.parse(value) : value; } catch { return res.status(400).json({ error: "Invalid invoices payload" }); }
    if (!Array.isArray(incoming) || incoming.some(invoice => !invoice || typeof invoice !== "object" || !String(invoice.id || "").trim())) {
      return res.status(400).json({ error: "Invoices must be an array of identified records" });
    }
    const existing = getStoredArray(db, DB_KEYS.INVOICES);
    const existingIds = new Set(existing.map(invoice => String(invoice.id)));
    const incomingIds = new Set(incoming.map(invoice => String(invoice.id)));
    const hasAdditions = incoming.some(invoice => !existingIds.has(String(invoice.id)));
    // An add/clone based on a stale browser snapshot must not erase invoices
    // another tab committed after that snapshot was loaded.
    if (hasAdditions) incoming = [...existing.filter(invoice => !incomingIds.has(String(invoice.id))), ...incoming];

    const usedNumbers = new Map();
    let nextNumber = Math.max(0, ...incoming.map(invoice => parseInt(String(invoice.number || "").replace(/\D/g, ""), 10) || 0)) + 1;
    incoming = incoming.map(invoice => {
      const id = String(invoice.id);
      let number = String(invoice.number || "").trim();
      const owner = usedNumbers.get(number);
      if (!number || (owner && owner !== id)) {
        do { number = `INV-${String(nextNumber++).padStart(4, "0")}`; } while (usedNumbers.has(number));
      }
      usedNumbers.set(number, id);
      return { ...invoice, number };
    });
    value = asString ? JSON.stringify(incoming) : incoming;
  }
  let calendarCreates = [];
  if (key === DB_KEYS.BOOKINGS) {
    const asString = typeof value === "string";
    let bookings;
    try { bookings = asString ? JSON.parse(value) : value; } catch { return res.status(400).json({ error: "Invalid bookings payload" }); }
    if (!Array.isArray(bookings)) return res.status(400).json({ error: "Bookings must be an array" });
    const settings = dbGet(db, DB_KEYS.SETTINGS, {});
    const previousById = new Map(getStoredArray(db, DB_KEYS.BOOKINGS).map(booking => [booking.id, booking]));
    bookings = bookings.map(booking => {
      if (!booking || typeof booking !== "object") return booking;
      const normalized = { ...booking };
      if (["confirmed", "completed"].includes(normalized.status) || ["paid", "deposit-paid"].includes(normalized.paymentStatus)) {
        delete normalized.holdExpiresAt;
      } else if (Number(normalized.paymentAmount) > 0 && !normalized.holdExpiresAt) {
        normalized.holdExpiresAt = unconfirmedBookingHoldExpiresAt(settings, normalized.paymentPath || normalized.paymentMethod || "contact");
      }
      return normalized;
    });
    calendarCreates = bookings.filter(booking => bookingReadyForCalendar(booking) && !booking.gcalEventId && !bookingReadyForCalendar(previousById.get(booking.id)));
    value = asString ? JSON.stringify(bookings) : bookings;
  }
  let updatedAdminCreds = null;
  // Upgrade super admin password hash to bcrypt on every write to wv_admin
  if (key === DB_KEYS.ADMIN) {
    let creds = value;
    if (typeof creds === "string") {
      try { creds = JSON.parse(creds); } catch { return res.status(400).json({ error: "Invalid admin credentials" }); }
    }
    if (!creds || typeof creds !== "object" || !/^[\w.@+-]{3,64}$/.test(String(creds.username || "")) || typeof creds.passwordHash !== "string" || creds.passwordHash.length < 32 || creds.passwordHash.length > 256) {
      return res.status(400).json({ error: "Invalid admin credentials" });
    }
    if (!creds.passwordHash.startsWith("$2")) creds.passwordHash = await bcryptHash(creds.passwordHash);
    updatedAdminCreds = { username: String(creds.username), passwordHash: creds.passwordHash };
    value = JSON.stringify(updatedAdminCreds);
  }
  db[key] = value;
  writeDb(db);
  for (const booking of calendarCreates) queueInitialBookingCalendarSync(booking);
  if (updatedAdminCreds) {
    const token = signSession({ purpose: "admin", sub: String(updatedAdminCreds.username), cv: credentialVersion(updatedAdminCreds.passwordHash) }, SESSION_SECRET, { ttlSeconds: ADMIN_SESSION_TTL_SECONDS });
    setHttpOnlyCookie(req, res, ADMIN_SESSION_COOKIE, token, ADMIN_SESSION_TTL_SECONDS);
  }
  res.json({ ok: true });
});
app.delete("/api/store/:key", requireAuth, (req, res) => {
  if ([DB_KEYS.ADMIN, DB_KEYS.SETUP].includes(req.params.key)) {
    return res.status(403).json({ error: "Authentication bootstrap keys cannot be deleted through the generic store" });
  }
  const db = readDb();
  delete db[req.params.key];
  writeDb(db);
  res.json({ ok: true });
});

// ── Album stubs (metadata-only, no photos array) ──────────────────────────
// The photos array is the dominant contributor to /api/store payload size.
// Even after baked-field stripping, 200 URL-path photo entries per album still
// add ~50-100 KB per album.  These two endpoints let the admin list view and
// the booking page download only the tiny album metadata, and defer the full
// photos array to a single targeted request when an album is actually opened
// for editing.
//
// A stub album carries `_photosStripped: true` so the frontend knows photos
// have not been loaded yet and should be fetched before editing.
function _makeAlbumStub(album) {
  const { photos: _photos, ...rest } = album;
  return { ...rest, photos: [], _photosStripped: true };
}

function _parseAlbumsFromDb(raw) {
  if (!raw) return [];
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  return Array.isArray(parsed) ? parsed : [];
}

// GET /api/albums/stubs — all main albums without photos
app.get("/api/albums/stubs", requireAuth, (req, res) => {
  const db = readDb();
  const albums = _parseAlbumsFromDb(db[ALBUMS_KEY]);
  res.json(albums.map(_makeAlbumStub));
});

// GET /api/albums/:albumId/photos — photos for a single album, on demand
app.get("/api/albums/:albumId/photos", requireAuth, (req, res) => {
  const db = readDb();
  const albums = _parseAlbumsFromDb(db[ALBUMS_KEY]);
  const album = albums.find(a => a.id === req.params.albumId || a.slug === req.params.albumId);
  if (!album) return res.status(404).json({ photos: [] });
  // Apply baked-field stripping so the response stays lean.
  // Older albums are backfilled on read as well, so proofing references work
  // immediately without a migration job. They are persisted on the next save.
  res.json({ photos: _stripBakedFromPhotos((album.photos || []).map(_ensurePhotoProofIdentity)) });
});

// POST /api/albums/:id/auto-cull?tenant=<slug>
// Server-side analysis only: scores blur/exposure/contrast, groups near-duplicates,
// and writes cull metadata back to the album photo records without deleting files.
app.post("/api/albums/:id/auto-cull", requireAdminOrScopedTenant, async (req, res) => {
  const tenantSlug = req.query.tenant ? String(req.query.tenant).trim() : null;
  if (tenantSlug && !SLUG_RE.test(tenantSlug)) {
    return res.status(400).json({ error: "Invalid tenant slug" });
  }

  const requestedDuplicateDistance = Number(req.body?.duplicateDistance ?? 6);
  const duplicateDistance = Number.isFinite(requestedDuplicateDistance)
    ? Math.max(0, Math.min(16, requestedDuplicateDistance))
    : 6;
  const requestedBurstGroupSize = Number(req.body?.burstGroupSize ?? 12);
  const burstGroupSize = Number.isFinite(requestedBurstGroupSize)
    ? Math.max(2, Math.min(24, requestedBurstGroupSize))
    : 12;
  const minScore = _clamp01(Number(req.body?.minScore ?? 0.42));
  const requestedBestPickRatio = Number(req.body?.bestPickRatio ?? 0.25);
  const bestPickRatio = Number.isFinite(requestedBestPickRatio)
    ? Math.max(0.05, Math.min(0.75, requestedBestPickRatio))
    : 0.25;
  const analysedAt = new Date().toISOString();
  const cullLabels = { pick: "Best picks", bestOf: "Best of", review: "Review", reject: "Held back", unscored: "Unscored" };
  const db = readDb();
  const { storeKey, albums, idx, album } = _resolveAlbumStore(db, tenantSlug, req.params.id);

  if (tenantSlug && !readTenants().find(t => t.slug === tenantSlug)) {
    return res.status(404).json({ error: "Tenant not found" });
  }
  if (idx < 0) return res.status(404).json({ error: "Album not found" });

  const photos = Array.isArray(album.photos) ? album.photos : [];
  if (photos.length === 0) {
    return res.json({
      ok: true,
      albumId: album.id,
      tenant: tenantSlug,
      analysedAt,
      total: 0,
      analysed: 0,
      kept: 0,
      heldBack: 0,
      culled: 0,
      counts: { pick: 0, bestOf: 0, review: 0, reject: 0, unscored: 0 },
      labels: cullLabels,
      duplicateGroups: [],
      errors: [],
      photos: [],
    });
  }

  const analysed = await Promise.all(photos.map(async (photo, index) => {
    try {
      const result = await _analysePhotoForCull(photo);
      return { index, photoId: photo?.id || null, ...result };
    } catch (err) {
      return { index, photoId: photo?.id || null, ok: false, error: err.message || "Analysis failed" };
    }
  }));

  const successful = analysed.filter(result => result.ok);
  const errorsByIndex = new Map(analysed
    .filter(result => !result.ok)
    .map(result => [result.index, result]));
  const duplicateGroups = _groupCullDuplicates(successful, duplicateDistance);
  const duplicateGroupedIndexes = new Set(duplicateGroups.flatMap(group => group.items.map(item => item.index)));
  const burstGroups = _groupCullBursts(
    successful.filter(result => !duplicateGroupedIndexes.has(result.index)),
    photos,
    { maxGroupSize: burstGroupSize },
  );
  const visualGroups = [...duplicateGroups, ...burstGroups];
  const byIndex = new Map(successful.map(result => [result.index, result]));

  for (const group of visualGroups) {
    group.items.sort((a, b) => {
      const aScore = bestShotScore(_mediaFileFromCullResult(photos[a.index], a, group.items.length));
      const bScore = bestShotScore(_mediaFileFromCullResult(photos[b.index], b, group.items.length));
      return bScore - aScore;
    });
    group.items.forEach((item, rank) => {
      item.duplicateGroupId = group.id;
      item.duplicateRank = rank + 1;
      item.duplicateOf = rank === 0 ? null : (group.items[0].photoId || photos[group.items[0].index]?.id || null);
      item.visualGroupSize = group.items.length;
    });
  }

  const duplicateDecisionByPath = new Map();
  const allMediaFiles = successful.map(result => _mediaFileFromCullResult(
    photos[result.index],
    result,
    result.visualGroupSize || 1,
  ));
  const mediaByPath = new Map(allMediaFiles.map(file => [file.path, file]));

  for (const group of visualGroups) {
    const groupMedia = group.items
      .map(item => mediaByPath.get(_photoCullPath(photos[item.index], item.index)))
      .filter(Boolean);
    if (groupMedia.length < 2) continue;
    const decision = autoCullGroup(groupMedia, {
      confidence: req.body?.confidence || "balanced",
      keeperQuota: req.body?.keeperQuota || "best-1",
      groupPhotoEveryoneGood: true,
    });
    const rejectSet = new Set(decision.reject || []);
    const keepSet = new Set(decision.keep || []);
    for (const file of groupMedia) {
      duplicateDecisionByPath.set(file.path, {
        decision,
        isBest: decision.best?.path === file.path,
        isKeep: keepSet.has(file.path),
        isReject: rejectSet.has(file.path),
        reasons: decision.reasons?.[file.path] || [],
      });
    }
  }

  const bestRank = rankBestShots(allMediaFiles);
  const bestPathSet = new Set(bestRank.slice(0, Math.max(1, Math.ceil(bestRank.length * bestPickRatio))).map(file => file.path));
  const reviewScoreFloor = Math.round(minScore * 100);

  const updatedPhotos = photos.map((photo, index) => {
    const result = byIndex.get(index);
    if (!result) {
      const error = errorsByIndex.get(index);
      const cull = {
        status: "unscored",
        analysedAt,
        recommendedAction: "keep",
        reasons: ["unscored", error?.error || "analysis failed"],
        score: 0,
        reviewScore: 0,
        bestShotScore: 0,
        blurScore: 0,
        blurRisk: "unknown",
        confidence: "low",
        duplicateGroupId: null,
        duplicateRank: null,
        duplicateOf: null,
        visualGroupSize: 1,
        bucket: "review",
        bucketLabel: cullLabels.review,
      };
      return _ensurePhotoProofIdentity({
        ...photo,
        blurScore: 0,
        duplicateGroupId: undefined,
        duplicateRank: undefined,
        cull,
        cullMetadata: {
          status: cull.status,
          score: cull.score,
          reasons: cull.reasons,
          blurScore: cull.blurScore,
          duplicateGroupId: cull.duplicateGroupId,
          duplicateRank: cull.duplicateRank,
          bucket: cull.bucket,
          bucketLabel: cull.bucketLabel,
          analysedAt,
        },
      });
    }

    const file = mediaByPath.get(_photoCullPath(photo, index)) || _mediaFileFromCullResult(photo, result, result.visualGroupSize || 1);
    const duplicateDecision = duplicateDecisionByPath.get(file.path);
    const review = scoreReview(file);
    const bestScore = bestShotScore(file);
    const manualPick = !!photo.starred || photo.cull?.status === "pick";
    const manualReject = !manualPick && photo.cull?.status === "reject";
    const reasons = new Set(review.reasons || []);
    const qualityReasons = [];

    if (result.cull?.blur < 0.28 || review.blurRisk === "high") qualityReasons.push("blur");
    if (result.cull?.exposure < 0.35) qualityReasons.push("exposure");
    if (result.cull?.contrast < 0.25) qualityReasons.push("contrast");
    if (review.score < reviewScoreFloor) qualityReasons.push("low-quality-score");
    if (result.duplicateRank && result.duplicateRank > 1) qualityReasons.push("similar-frame");
    for (const reason of qualityReasons) reasons.add(reason);
    for (const reason of duplicateDecision?.reasons || []) reasons.add(reason);

    let status = "review";
    if (manualPick) {
      status = "pick";
      reasons.add("manual pick");
    } else if (manualReject || duplicateDecision?.isReject || review.blurRisk === "high" || review.score < 24) {
      status = "reject";
    } else if (duplicateDecision?.isBest) {
      status = "pick";
      reasons.add("best of similar set");
    } else if (!duplicateDecision && bestPathSet.has(file.path) && review.blurRisk === "low" && review.score >= 52) {
      status = "pick";
      reasons.add("best pick");
    } else if (duplicateDecision?.isKeep) {
      status = "review";
      reasons.add("near-best keeper");
    }

    if (status === "reject" && manualPick) status = "pick";
    const recommendedAction = status === "reject" ? "hold-back" : "keep";
    const bucket = status === "pick" ? "best-of" : status === "reject" ? "held-back" : "review";
    const bucketLabel = status === "pick" ? cullLabels.pick : status === "reject" ? cullLabels.reject : cullLabels.review;
    const cull = {
      ...result.cull,
      status,
      analysedAt,
      recommendedAction,
      reasons: Array.from(reasons),
      score: Number((review.score / 100).toFixed(4)),
      reviewScore: review.score,
      bestShotScore: bestScore,
      blurRisk: review.blurRisk,
      confidence: duplicateDecision?.decision?.confidence || (status === "pick" ? "medium" : "low"),
      duplicateGroupId: result.duplicateGroupId || null,
      duplicateRank: result.duplicateRank || null,
      duplicateOf: result.duplicateOf || null,
      visualGroupSize: result.visualGroupSize || 1,
      bucket,
      bucketLabel,
    };
    return _ensurePhotoProofIdentity({
      ...photo,
      blurScore: result.cull?.blur,
      duplicateGroupId: result.duplicateGroupId || undefined,
      duplicateRank: result.duplicateRank || undefined,
      cull,
      cullMetadata: {
        status: cull.status,
        score: cull.score,
        reasons: cull.reasons,
        blurScore: cull.blurScore,
        duplicateGroupId: cull.duplicateGroupId,
        duplicateRank: cull.duplicateRank,
        bucket: cull.bucket,
        bucketLabel: cull.bucketLabel,
        analysedAt,
      },
    });
  });

  const counts = {
    pick: updatedPhotos.filter(photo => photo?.cull?.status === "pick").length,
    bestOf: updatedPhotos.filter(photo => photo?.cull?.bucket === "best-of").length,
    review: updatedPhotos.filter(photo => photo?.cull?.status === "review").length,
    reject: updatedPhotos.filter(photo => photo?.cull?.status === "reject").length,
    unscored: updatedPhotos.filter(photo => photo?.cull?.status === "unscored" || !photo?.cull?.status).length,
  };
  const kept = counts.pick + counts.review + counts.unscored;
  const heldBack = counts.reject;
  const culled = heldBack;
  const errors = analysed
    .filter(result => !result.ok)
    .map(result => ({ index: result.index, photoId: result.photoId, filename: result.filename, error: result.error }));
  const responseGroups = visualGroups.map(group => ({
    id: group.id,
    type: group.type || "duplicate",
    size: group.items.length,
    keepPhotoId: group.items[0]?.photoId || photos[group.items[0]?.index]?.id || null,
    photoIds: group.items.map(item => item.photoId || photos[item.index]?.id || null).filter(Boolean),
  }));

  albums[idx] = {
    ...album,
    photos: updatedPhotos,
    photoCount: updatedPhotos.length,
    _photosStripped: false,
    autoCull: {
      analysedAt,
      engine: "autophotoimporter-style",
      labels: cullLabels,
      minScore,
      duplicateDistance,
      burstGroupSize,
      bestPickRatio,
      total: photos.length,
      analysed: successful.length,
      kept,
      heldBack,
      culled,
      counts,
      rankedPaths: bestRank.map(file => file.path),
      errorCount: errors.length,
      duplicateGroupCount: responseGroups.length,
      burstGroupCount: responseGroups.filter(group => group.type === "burst").length,
    },
  };

  db[storeKey] = JSON.stringify(albums);
  writeDb(db);

  res.json({
    ok: true,
    albumId: album.id,
    tenant: tenantSlug,
    analysedAt,
    engine: "autophotoimporter-style",
    labels: cullLabels,
    total: photos.length,
    analysed: successful.length,
    kept,
    heldBack,
    culled,
    counts,
    album: albums[idx],
    duplicateGroups: responseGroups,
    errors,
    photos: updatedPhotos.map(photo => ({
      id: photo.id,
      src: photo.src,
      originalName: photo.originalName,
      originalFileNumber: photo.originalFileNumber,
      proofId: photo.proofId,
      status: photo.cull?.status || "unscored",
      score: photo.cull?.score ?? 0,
      reasons: photo.cull?.reasons || [],
      blurScore: photo.blurScore ?? photo.cull?.blurScore ?? 0,
      duplicateGroupId: photo.duplicateGroupId || photo.cull?.duplicateGroupId || null,
      duplicateRank: photo.duplicateRank || photo.cull?.duplicateRank || null,
      cull: photo.cull,
      cullMetadata: photo.cullMetadata,
    })),
  });
});

// PUT /api/albums/:albumId — update a single album without touching other albums.
// This prevents the full-array write via PUT /api/store/wv_albums from overwriting
// other albums' photos with stub (empty) data when only one album's metadata has changed.
app.put("/api/albums/:albumId", requireAuth, authenticatedLargeJson, (req, res) => {
  const { albumId } = req.params;
  const db = readDb();
  const albums = _parseAlbumsFromDb(db[ALBUMS_KEY]);
  const idx = albums.findIndex(a => a.id === albumId);
  const incoming = { ...req.body, id: albumId };
  if (Object.prototype.hasOwnProperty.call(incoming, "downloadEmailCapture")) {
    incoming.downloadEmailCapture = normalizeDownloadEmailPolicy(incoming.downloadEmailCapture);
  }
  // If the client is sending a bandwidth-saving stub (_photosStripped:true, photos:[])
  // don't overwrite the server's real photos array with the empty stub.  Stubs are only
  // used for metadata-only updates (e.g. toggling the enabled flag from the albums list
  // when the full photo array hasn't been loaded into the client yet).
  if (incoming._photosStripped) {
    if (Array.isArray(incoming.photos) && incoming.photos.length > 0) {
      const existingPhotos = idx >= 0 && Array.isArray(albums[idx]?.photos) ? albums[idx].photos : [];
      incoming.photos = _mergePhotoArrays(existingPhotos, incoming.photos);
      incoming.photoCount = incoming.photos.length;
    } else {
      delete incoming.photos;
    }
    delete incoming._photosStripped;
  } else if (incoming.photos) {
    incoming.photos = _stripBakedFromPhotos(incoming.photos).map(_ensurePhotoProofIdentity);
  }
  const candidate = idx >= 0 ? { ...albums[idx], ...incoming } : incoming;
  const invalidUploads = invalidAlbumUploadReferences(db, candidate, null);
  if (invalidUploads.length) return res.status(409).json({ error: "One or more uploads do not belong to this album scope" });
  if (idx >= 0) albums[idx] = candidate;
  else albums.push(candidate);
  db[ALBUMS_KEY] = JSON.stringify(albums);
  writeDb(db);
  res.json({ ok: true });
});

// DELETE /api/albums/:albumId — remove a single album without touching other albums.
// Using a per-album delete avoids the full-array write via PUT /api/store/wv_albums which
// would overwrite other albums' photos with stale stub data.
app.delete("/api/albums/:albumId", requireAuth, (req, res) => {
  const { albumId } = req.params;
  const db = readDb();
  const albums = _parseAlbumsFromDb(db[ALBUMS_KEY]);
  const filtered = albums.filter(a => a.id !== albumId);
  db[ALBUMS_KEY] = JSON.stringify(filtered);
  writeDb(db);
  res.json({ ok: true });
});

// ── Global FTP Settings ───────────────────────────────
// The FTP password is stored server-side only and never returned to the browser.
// The response includes a boolean `ftpPasswordSet` instead of the actual value.
const GLOBAL_FTP_SECRET_FIELDS = ["ftpPassword"];

function maskFtpSettings(settings) {
  const masked = { ...settings };
  for (const field of GLOBAL_FTP_SECRET_FIELDS) {
    masked[`${field}Set`] = !!(masked[field]);
    delete masked[field];
  }
  return masked;
}

app.get("/api/settings/ftp", requireAuth, (req, res) => {
  const db = readDb();
  const raw = db["wv_ftp_settings"];
  const settings = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
  res.json(maskFtpSettings(settings));
});

app.put("/api/settings/ftp", requireAuth, (req, res) => {
  const db = readDb();
  const existing = (() => {
    const raw = db["wv_ftp_settings"];
    return raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
  })();

  const incoming = { ...req.body };
  // Strip client-sent *Set indicators
  for (const field of GLOBAL_FTP_SECRET_FIELDS) {
    delete incoming[`${field}Set`];
  }

  const updated = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (GLOBAL_FTP_SECRET_FIELDS.includes(key)) {
      if (value === "") {
        delete updated[key];
      } else if (value !== undefined && value !== null) {
        updated[key] = value;
      }
    } else {
      updated[key] = value;
    }
  }

  db["wv_ftp_settings"] = JSON.stringify(updated);
  writeDb(db);
  res.json({ ok: true, settings: maskFtpSettings(updated) });
});

app.post("/api/settings/ftp/test", requireAuth, async (req, res) => {
  const db = readDb();
  const raw = db["wv_ftp_settings"];
  const settings = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
  if (!settings.ftpHost) {
    return res.json({ ok: false, error: "FTP host not configured. Save your settings first." });
  }
  const result = await testFtpConnection(settings);
  res.json(result);
});

app.post("/api/tenant/:slug/settings/ftp/test", requireTenant, async (req, res) => {
  const { slug } = req.params;
  const db = readDb();
  const raw = db[`t_${slug}_wv_tenant_settings`];
  const settings = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
  if (!settings.ftpHost) {
    return res.json({ ok: false, error: "FTP host not configured. Save your settings first." });
  }
  const result = await testFtpConnection(settings);
  res.json(result);
});

// ── FTP: Bulk album re-upload with SSE progress ─────────────────────────────
// POST /api/ftp/upload-album/:albumSlug?tenant=<slug>
// Uploads all photos from an album to FTP, streaming progress events to the client.
const ftpUploadAlbumLimiter = rateLimit({ windowMs: 60_000, max: 100, standardHeaders: true, legacyHeaders: false, message: { error: "Too many FTP upload requests — please wait" } });
app.post("/api/ftp/upload-album/:albumSlug", ftpUploadAlbumLimiter, requireAdminOrScopedTenant, async (req, res) => {
  const { albumSlug } = req.params;
  const tenantSlug = req.query.tenant ? String(req.query.tenant) : null;

  const db = readDb();

  // Resolve FTP settings (tenant-specific or global)
  let ftpSettings = null;
  if (tenantSlug) {
    const raw = db[`t_${tenantSlug}_wv_tenant_settings`];
    const ts = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
    if (ts.ftpEnabled && ts.ftpHost) ftpSettings = ts;
  } else {
    const raw = db["wv_ftp_settings"];
    const gs = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
    if (gs.ftpEnabled && gs.ftpHost) ftpSettings = gs;
  }

  if (!ftpSettings) {
    return res.json({ ok: false, error: "FTP is not configured or not enabled." });
  }

  // Resolve album
  const albumsKey = tenantSlug ? `t_${tenantSlug}_wv_albums` : "wv_albums";
  const albumsRaw = db[albumsKey];
  const albums = albumsRaw ? (typeof albumsRaw === "string" ? JSON.parse(albumsRaw) : albumsRaw) : [];
  const album = albums.find((a) => a.slug === albumSlug || a.id === albumSlug);

  if (!album) {
    return res.json({ ok: false, error: "Album not found." });
  }

  const photos = album.photos || [];
  // Include photoIdx so we can mark successfully-uploaded photos in the DB afterward
  const ftpEntries = [];
  for (let photoIdx = 0; photoIdx < photos.length; photoIdx += 1) {
      const p = photos[photoIdx];
      const src = typeof p === "string" ? p : p?.src;
      if (!src) continue;
      const filename = uploadFilenameFromSrc(src);
      const localPath = filename ? resolveExistingUploadPath(filename) : null;
      if (!filename || !localPath || !uploadMatchesAlbumScope(db, filename, tenantSlug)) {
        return res.status(409).json({ ok: false, error: "Album contains an invalid or cross-scope upload reference" });
      }
      // Use stored originalName first, then fall back to reconstructing from title + extension.
      // sanitizeRemoteFilename strips any embedded path separators to prevent STOR from
      // trying to navigate a non-existent sub-directory (which returns 550 on many servers).
      const ext = path.extname(filename);
      const rawName = p?.originalName || ((p?.title && ext) ? `${p.title}${ext}` : filename);
      const remoteFilename = sanitizeRemoteFilename(rawName);
      ftpEntries.push({ localPath, remoteFilename, starred: !!p?.starred, photoIdx });
  }

  if (ftpEntries.length === 0) {
    return res.json({ ok: true, done: 0, total: 0, message: "No local photos to upload." });
  }

  // Set up SSE stream
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const sanitizedAlbumName = sanitizeFolderName(album.title || albumSlug);
  let done = 0;
  let failed = 0;
  const uploadedPhotoIndices = new Set();

  const { ftpHost, ftpPort = 21, ftpUser = "anonymous", ftpPassword = "", ftpRemotePath = "/" } = ftpSettings;
  const client = new FtpClient();
  client.ftp.verbose = false;
  // Force IPv4 passive mode (PASV) instead of EPSV so that FTP servers that
  // don't implement the EPSV extension don't return a 505 error.
  client.ftp.ipFamily = 4;

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await client.access({
      host: ftpHost,
      port: Number(ftpPort) || 21,
      user: ftpUser || "anonymous",
      password: ftpPassword || "",
      secure: false,
    });

    const remotePath = ftpSettings.ftpOrganizeByAlbum
      ? path.posix.join(ftpRemotePath || "/", sanitizedAlbumName)
      : (ftpRemotePath || "/");
    // ensureDir creates the directory if needed and sets the CWD to remotePath.
    await client.ensureDir(remotePath);

    // Starred sub-folder: "{albumName}-starred" always relative to the base remote path
    const starredRemotePath = ftpSettings.ftpStarredFolder
      ? path.posix.join(ftpRemotePath || "/", `${sanitizedAlbumName}-starred`)
      : null;
    let starredDirEnsured = false;
    // Track the directory the FTP client is currently in so we can navigate
    // back when switching between the album folder and the starred folder.
    let currentRemoteDir = remotePath;

    for (const { localPath: localFilePath, remoteFilename, starred, photoIdx } of ftpEntries) {
      let uploadOk = false;
      try {
        const targetDir = (starred && starredRemotePath) ? starredRemotePath : remotePath;

        // Navigate to the target directory when it differs from where we are.
        // Use ensureDir for the starred folder (may not exist yet) and a plain
        // cd for the album folder (already created above).  This avoids passing
        // absolute paths to uploadFrom: many FTP servers treat STOR paths as
        // relative to CWD and would misinterpret them, causing silent failures
        // while ensureDir (which uses cd commands) still succeeds.
        if (targetDir !== currentRemoteDir) {
          if (targetDir === starredRemotePath && !starredDirEnsured) {
            await client.ensureDir(starredRemotePath);
            starredDirEnsured = true;
          } else {
            await client.cd(targetDir);
          }
          currentRemoteDir = targetDir;
        }

        // Upload using just the filename (relative to CWD) rather than a full
        // absolute path, which is what basic-ftp's own uploadFromDir() does.
        await client.uploadFrom(localFilePath, remoteFilename);
        uploadOk = true;
      } catch (err) {
        console.warn(`[FTP] Bulk upload failed for ${remoteFilename}:`, err.message);
        failed++;
      }
      if (uploadOk) uploadedPhotoIndices.add(photoIdx);
      done++;
      sendEvent({ done, total: ftpEntries.length, failed });
    }

    // Persist ftpUploaded=true on photos that were successfully sent so the
    // "Upload to FTP" button disappears after a successful bulk upload.
    if (uploadedPhotoIndices.size > 0) {
      const freshDb = readDb();
      const freshAlbumsRaw = freshDb[albumsKey];
      const freshAlbums = freshAlbumsRaw ? (typeof freshAlbumsRaw === "string" ? JSON.parse(freshAlbumsRaw) : freshAlbumsRaw) : [];
      const updatedAlbums = freshAlbums.map((a) => {
        if (a.slug !== albumSlug && a.id !== albumSlug) return a;
        const updatedPhotos = (a.photos || []).map((p, idx) => {
          if (!uploadedPhotoIndices.has(idx)) return p;
          return typeof p === "string" ? p : { ...p, ftpUploaded: true };
        });
        return { ...a, photos: updatedPhotos };
      });
      freshDb[albumsKey] = JSON.stringify(updatedAlbums);
      writeDb(freshDb);
    }

    sendEvent({ done, total: ftpEntries.length, failed, complete: true });
  } catch (err) {
    // Include the accurate failed count: individual per-file failures already
    // accumulated in `failed`, plus all entries that were never attempted because
    // the connection dropped before they could be processed.
    sendEvent({ error: err.message || "FTP connection failed", done, total: ftpEntries.length, failed: failed + (ftpEntries.length - done), complete: true });
  } finally {
    client.close();
    res.end();
  }
});

// ── FTP: Move a starred photo to the "{albumName}-starred" sub-folder ────────
// POST /api/ftp/move-starred
const ftpMoveStarredLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: "Too many FTP move requests — please wait" } });
app.post("/api/ftp/move-starred", ftpMoveStarredLimiter, requireAdminOrScopedTenant, async (req, res) => {
  const { photoSrc, albumTitle, albumSlug, tenantSlug, originalName, starred = true } = req.body || {};

  if (!photoSrc) return res.json({ ok: false, error: "photoSrc is required" });
  if (!albumTitle && !albumSlug) return res.json({ ok: false, error: "albumTitle or albumSlug is required" });

  const db = readDb();

  // Resolve FTP settings
  let ftpSettings = null;
  if (tenantSlug) {
    const raw = db[`t_${tenantSlug}_wv_tenant_settings`];
    const ts = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
    if (ts.ftpEnabled && ts.ftpHost && ts.ftpStarredFolder) ftpSettings = ts;
  } else {
    const raw = db["wv_ftp_settings"];
    const gs = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
    if (gs.ftpEnabled && gs.ftpHost && gs.ftpStarredFolder) ftpSettings = gs;
  }

  if (!ftpSettings) {
    return res.json({ ok: false, error: "FTP starred folder feature is not enabled or configured." });
  }

  // Derive local file path from photoSrc
  const localFilename = uploadFilenameFromSrc(photoSrc);
  if (!localFilename) return res.json({ ok: false, error: "Could not determine filename from photoSrc." });
  const localFilePath = resolveExistingUploadPath(localFilename);
  if (!localFilePath || !uploadMatchesAlbumScope(db, localFilename, tenantSlug || null)) {
    return res.status(409).json({ ok: false, error: "Photo does not belong to this FTP scope" });
  }

  // The FTP filename is the original name when available, otherwise the local filename
  const ftpFilename = sanitizeRemoteFilename(originalName || localFilename);

  const folderBase = sanitizeFolderName(albumTitle || albumSlug);
  const remotePath = ftpSettings.ftpRemotePath || "/";

  // Regular album folder (if ftpOrganizeByAlbum) or root remote path
  const albumFolder = ftpSettings.ftpOrganizeByAlbum
    ? path.posix.join(remotePath, folderBase)
    : remotePath;
  const albumPath = path.posix.join(albumFolder, ftpFilename);

  // Starred sub-folder: "{albumName}-starred"
  const starredFolder = path.posix.join(remotePath, `${folderBase}-starred`);
  const starredPath = path.posix.join(starredFolder, ftpFilename);

  // Direction: starring moves album→starred, unstarring moves starred→album
  const fromPath = starred ? albumPath : starredPath;
  const toPath = starred ? starredPath : albumPath;

  const result = await moveFileOnFtp(
    localFilePath,
    fromPath,
    toPath,
    ftpSettings
  );
  // Log any errors from the FTP operation for debugging
  if (result.error) {
    console.error("Failed to move file on FTP:", result.error);
    return res.status(500).json({ error: result.error });
  }
  res.json(result);
});

// ── Photo Upload ──────────────────────────────────────
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`;
    cb(null, name);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ignoredFiles = req.ignoredUploadFiles || [];
    req.ignoredUploadFiles = ignoredFiles;
    const originalName = file.originalname || "";
    const mimeType = file.mimetype || "";
    if (isIgnoredSystemFileName(originalName)) {
      ignoredFiles.push({ name: originalName, reason: "system-file" });
      return cb(null, false);
    }
    const hasSupportedExtension = isSupportedImageFilename(originalName);
    const hasImageMime = mimeType.startsWith("image/");
    const hasGenericMime = !mimeType || mimeType === "application/octet-stream";
    if (hasSupportedExtension && (hasImageMime || hasGenericMime)) return cb(null, true);
    ignoredFiles.push({ name: originalName, reason: "unsupported-file" });
    return cb(null, false);
  },
});

/**
 * Parse a raw EXIF buffer to find the DateTimeOriginal (or DateTime) tag and
 * return it as an ISO-8601 string.  Uses a simple text-scan approach that works
 * for standard JFIF/EXIF JPEGs produced by cameras and modern phones.
 * Returns null when no parseable date is found.
 */
function parseExifDate(exifBuf) {
  if (!exifBuf || exifBuf.length < 10) return null;
  try {
    // EXIF date strings are stored as ASCII "YYYY:MM:DD HH:MM:SS" (19 chars).
    // Scan the buffer as a latin-1 string so every byte maps 1-to-1 to a character.
    const str = exifBuf.toString("latin1");
    // Find the first occurrence of the EXIF date-time pattern.
    const m = str.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    const [, yr, mo, dy, hr, min, sec] = m;
    // Validate ranges to avoid corrupted data
    if (Number(mo) < 1 || Number(mo) > 12) return null;
    if (Number(dy) < 1 || Number(dy) > 31) return null;
    if (Number(yr) < 1990 || Number(yr) > 2100) return null;
    return new Date(`${yr}-${mo}-${dy}T${hr}:${min}:${sec}`).toISOString();
  } catch {
    return null;
  }
}

// Warn when less than 500 MB remains on the data volume.
const LOW_DISK_THRESHOLD_BYTES = 500 * 1024 * 1024; // 500 MB

/**
 * Returns available bytes on DATA_DIR's filesystem, or null if unavailable.
 * Uses the same df logic as getStorageUsage() but as a lightweight inline check.
 */
function getAvailableDiskBytes() {
  try {
    const { execSync } = require("child_process");
    const out = execSync(`df -B1 "${DATA_DIR}" 2>/dev/null || true`, { encoding: "utf-8" });
    const lines = out.trim().split("\n");
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      if (parts.length >= 4) return parseInt(parts[3]) || null;
    }
  } catch { /* non-critical */ }
  return null;
}

const uploadLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false, message: "Too many upload requests — please wait 60 seconds." });
app.post("/api/upload", uploadLimiter, requireAdminOrScopedTenant, upload.array("photos", 100), async (req, res) => {
  const ignoredUploadFiles = Array.isArray(req.ignoredUploadFiles) ? req.ignoredUploadFiles : [];
  if ((req.files || []).length === 0) {
    return res.status(400).json({
      files: [],
      error: ignoredUploadFiles.length > 0 ? "No supported image files were uploaded" : "No files were uploaded",
      ignoredFileCount: ignoredUploadFiles.length,
    });
  }

  // ── Disk space guard ─────────────────────────────────────────────────────
  // Reject uploads early when the data volume is critically low to prevent
  // partial writes that could leave already-uploaded files out of sync with the database.
  const availableBytes = getAvailableDiskBytes();
  if (availableBytes !== null && availableBytes < LOW_DISK_THRESHOLD_BYTES) {
    // Clean up the already-accepted multer temp files
    for (const f of (req.files || [])) {
      try {
        fs.unlinkSync(f.path);
      } catch (err) {
        console.error("Failed to cleanup temp file:", f.path, err);
      }
    }
    return res.status(507).json({
      error: `Server storage is critically low (${Math.round(availableBytes / 1024 / 1024)} MB remaining). Free up space before uploading.`,
    });
  }

  // ── Extract image metadata (dimensions + EXIF date) for each uploaded file ──
  const uploadedFiles = (await Promise.all(
    (req.files || []).map(async (f) => {
      let width = 800;
      let height = 600;
      let takenAt = null;
      try {
        const meta = await sharp(f.path).metadata();
        if (!meta.format || !["jpeg", "png", "webp", "gif", "avif", "tiff", "heif"].includes(meta.format)) {
          throw new Error(`Unsupported image format: ${meta.format || "unknown"}`);
        }
        if (meta.width) width = meta.width;
        if (meta.height) height = meta.height;
        if (meta.exif) takenAt = parseExifDate(meta.exif);
      } catch (err) {
        try { fs.unlinkSync(f.path); } catch {}
        console.warn(`Rejected invalid image upload "${f.originalname}": ${err.message || err}`);
        return null;
      }
      const originalBaseName = f.originalname.replace(/\.[^.]+$/, "").replace(/^_+/, "");
      const originalFileNumber = (originalBaseName.match(/(\d+)(?!.*\d)/) || [])[1];
      return {
        id: path.basename(f.filename, path.extname(f.filename)),
        url: `/uploads/${f.filename}`,
        originalName: f.originalname,
        ...(originalFileNumber ? { originalFileNumber } : {}),
        proofId: originalBaseName || path.basename(f.filename, path.extname(f.filename)),
        size: f.size,
        localPath: f.path,
        width,
        height,
        takenAt,
      };
    })
  )).filter(Boolean);

  const rejectedInvalidCount = (req.files || []).length - uploadedFiles.length;
  if ((req.files || []).length > 0 && uploadedFiles.length === 0) {
    return res.status(400).json({
      files: [],
      error: "No valid image files were uploaded",
      ignoredFileCount: ignoredUploadFiles.length,
      rejectedInvalidCount,
    });
  }

  // ── FTP Upload (if enabled) ──────────────────────────────────────────────
  // Determine FTP settings: use tenant-specific settings when ?tenant= is provided,
  // otherwise fall back to global admin FTP settings stored in wv_ftp_settings.
  let ftpSettings = null;
  const tenantSlug = req.query.tenant;
  // albumFolder: optional sub-directory name (album title or booking type)
  const albumFolder = req.query.albumFolder ? String(req.query.albumFolder) : null;
  const albumId = req.query.albumId ? String(req.query.albumId) : null;
  const db = readDb();
  const uploadOwners = dbGet(db, "wv_upload_owners", {});
  for (const file of uploadedFiles) {
    const filename = path.basename(String(file.url || ""));
    if (filename) uploadOwners[filename] = tenantSlug ? { tenantSlug: String(tenantSlug), uploadedAt: new Date().toISOString() } : { admin: true, uploadedAt: new Date().toISOString() };
  }
  db["wv_upload_owners"] = uploadOwners;

  if (tenantSlug) {
    const raw = db[`t_${tenantSlug}_wv_tenant_settings`];
    const ts = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
    if (ts.ftpEnabled && ts.ftpHost) ftpSettings = ts;
  } else {
    const raw = db["wv_ftp_settings"];
    const gs = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
    if (gs.ftpEnabled && gs.ftpHost) ftpSettings = gs;
  }

  let ftpUploaded = false;
  if (ftpSettings) {
    const ftpEntries = uploadedFiles.map((f) => ({ localPath: f.localPath, remoteFilename: f.originalName }));
    // Use album sub-folder when ftpOrganizeByAlbum is enabled and a folder name was supplied
    const subFolder = ftpSettings.ftpOrganizeByAlbum && albumFolder ? albumFolder : null;
    const result = await uploadFilesToFtp(ftpEntries, ftpSettings, { subFolder });
    ftpUploaded = result.ok;
    if (!result.ok) {
      console.warn(`[FTP] Upload failed: ${result.error || "unknown error"} (${result.failed}/${uploadedFiles.length} file(s) failed)`);
    }
  }

  const files = uploadedFiles.map(({ localPath: _lp, ...rest }) => ({ ...rest, ftpUploaded }));
  let albumPersisted = false;
  let albumPersistError = null;
  if (albumId && files.length > 0) {
    try {
      const result = _appendUploadedFilesToAlbum(db, tenantSlug || null, albumId, files, ftpUploaded);
      if (result.ok) {
        writeDb(db);
        albumPersisted = true;
      } else {
        albumPersistError = result.error || "Album update failed";
      }
    } catch (err) {
      albumPersistError = err.message || "Album update failed";
    }
  }

  // Persist ownership even when an upload is not immediately attached to an album.
  writeDb(db);

  res.json({ files, albumPersisted, albumPersistError, ignoredFileCount: ignoredUploadFiles.length, rejectedInvalidCount });

  if (req.query.autoEdit === "1" && albumId && files.length > 0) {
    setImmediate(() => autoEditAlbumUploads({ albumId, tenantSlug: tenantSlug || null, uploadedFiles }));
  }

  // ── Pre-generate thumbnails asynchronously ───────────────────────────────
  // Fire-and-forget: warm the thumb cache for every uploaded file so the
  // gallery renders fast thumbnails on first load without waiting for the
  // first client request to trigger on-demand generation.
  setImmediate(async () => {
    const wm = getWatermarkSettings(tenantSlug || null);
    for (const f of uploadedFiles) {
      const baseName = path.basename(f.localPath, path.extname(f.localPath));
      for (const watermarked of [true, false]) {
        const cacheFile = path.join(CACHE_DIR, getCacheFilename(baseName, "thumb", watermarked, tenantSlug || null));
        if (fs.existsSync(cacheFile)) continue;
        try {
          let pipeline = sharp(f.localPath).resize(THUMB_WIDTH, null, { withoutEnlargement: true });
          if (watermarked) {
            const renderW = Math.min(f.width, THUMB_WIDTH);
            const renderH = f.width > THUMB_WIDTH ? Math.round(f.height * (THUMB_WIDTH / f.width)) : f.height;
            const overlay = await buildWatermarkOverlay(renderW, renderH, wm);
            pipeline = pipeline.composite([overlay]);
          }
          const buf = await pipeline.jpeg({ quality: 82, progressive: true }).toBuffer();
          fs.writeFileSync(cacheFile, buf);
        } catch { /* non-critical */ }
      }
    }
  });
});

// ── Lightroom Classic integration ─────────────────────
// These routes are intentionally admin-authenticated. Lightroom Classic runs on
// the photographer's own workstation and uses the same SHA-256 credential that
// the web admin stores for authenticated API calls.
async function requireLightroomAdmin(req, res, next) {
  // Lightroom's SDK does not expose a SHA-256 primitive. Accept the normal
  // browser session hash, or a raw password over HTTPS and hash it locally
  // before comparing it to the server's stored bcrypt(SHA-256(password)).
  let authenticated = await authenticateAdmin(req);
  if (!authenticated) {
    const header = req.headers.authorization || "";
    if (header.startsWith("Basic ")) {
      try {
        const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
        const separator = decoded.indexOf(":");
        const username = decoded.slice(0, separator);
        const password = decoded.slice(separator + 1);
        const admin = dbGet(readDb(), DB_KEYS.ADMIN);
        authenticated = separator > 0 && String(admin?.username || "").toLowerCase() === username.toLowerCase()
          && await verifyPasswordHash(sha256(password), admin.passwordHash);
      } catch { authenticated = false; }
    }
  }
  if (!authenticated) return res.status(401).json({ ok: false, error: "Authentication required" });
  next();
}

function lightroomAlbumSummary(album, tenantSlug) {
  return {
    id: album.id,
    tenantSlug: tenantSlug || undefined,
    title: album.title || album.slug || album.id,
    slug: album.slug || undefined,
    clientName: album.clientName || undefined,
    bookingId: album.bookingId || undefined,
    // The booking UI stores these fields on event/session albums when available.
    eventName: album.eventName || album.eventType || undefined,
    sessionDate: album.sessionDate || album.date || undefined,
    startTime: album.startTime || album.timeSlot || undefined,
    photoCount: Array.isArray(album.photos) ? album.photos.length : 0,
    proofingStage: album.proofingStage || "not-started",
  };
}

function selectedPhotoIdsForLightroom(album) {
  const rounds = Array.isArray(album.proofingRounds) ? album.proofingRounds : [];
  const latest = rounds[rounds.length - 1];
  if (Array.isArray(latest?.selectedPhotoIds)) return new Set(latest.selectedPhotoIds);
  return new Set((album.photos || []).filter(photo => photo?.starred).map(photo => photo.id));
}

app.get("/api/lightroom/albums", requireLightroomAdmin, (req, res) => {
  const db = readDb();
  const albums = [];
  const main = dbGet(db, DB_KEYS.ALBUMS, []);
  if (Array.isArray(main)) albums.push(...main.map(album => lightroomAlbumSummary(album, null)));
  for (const key of Object.keys(db)) {
    if (!key.startsWith("t_") || !key.endsWith("_wv_albums")) continue;
    const tenantSlug = key.slice(2, -"_wv_albums".length);
    const tenantAlbums = dbGet(db, key, []);
    if (Array.isArray(tenantAlbums)) albums.push(...tenantAlbums.map(album => lightroomAlbumSummary(album, tenantSlug)));
  }
  res.json({ ok: true, albums });
});

app.get("/api/lightroom/albums/:albumId/picks", requireLightroomAdmin, (req, res) => {
  const db = readDb();
  const found = findAlbumById(db, req.params.albumId);
  if (!found) return res.status(404).json({ ok: false, error: "Album not found" });
  const { album, tenantSlug } = found;
  const selectedIds = selectedPhotoIdsForLightroom(album);
  const origin = `${req.protocol}://${req.get("host")}`;
  const latestRound = Array.isArray(album.proofingRounds) ? album.proofingRounds.at(-1) : null;
  const assets = (album.photos || []).map(photo => {
    const proof = _ensurePhotoProofIdentity(photo);
    return {
      assetId: proof.id,
      proofId: proof.proofId,
      originalName: proof.originalName,
      originalFileNumber: proof.originalFileNumber,
      takenAt: proof.takenAt || null,
      selected: selectedIds.has(proof.id),
      // This is deliberately a Lightroom-authenticated route rather than the
      // public gallery URL. The public URL correctly renders a watermark for a
      // client preview; the photographer needs the clean, low-resolution file
      // to identify and edit the matching RAW.
      proofUrl: `${origin}/api/lightroom/albums/${encodeURIComponent(album.id)}/assets/${encodeURIComponent(proof.id)}/proof`,
      clientNote: latestRound?.clientNote || null,
      finalUrl: proof.finalSrc?.startsWith("/") ? `${origin}${proof.finalSrc}` : proof.finalSrc || null,
    };
  });
  res.json({
    ok: true,
    album: lightroomAlbumSummary(album, tenantSlug),
    selectionSubmittedAt: latestRound?.submittedAt || null,
    assets,
  });
});

app.get("/api/lightroom/albums/:albumId/assets/:assetId/proof", requireLightroomAdmin, (req, res) => {
  const found = findAlbumById(readDb(), req.params.albumId);
  if (!found) return res.status(404).json({ ok: false, error: "Album not found" });
  const photo = (found.album.photos || []).find(item => item?.id === req.params.assetId);
  if (!photo) return res.status(404).json({ ok: false, error: "Photo not found" });

  // Finals replace `src`, while proofSrc retains the original low-res proof.
  const source = String(photo.proofSrc || photo.src || "");
  const filename = path.basename(source.split(/[?#]/)[0]);
  if (isIgnoredSystemFileName(filename) || !isSupportedImageFilename(filename)) {
    return res.status(404).json({ ok: false, error: "Proof file not found" });
  }
  const filepath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ ok: false, error: "Proof file not found" });
  res.set({ "Cache-Control": "private, no-store", "X-Watermarked": "false" });
  return res.sendFile(filepath);
});

const lightroomFinalUpload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });
app.post("/api/lightroom/albums/:albumId/finals", requireLightroomAdmin, lightroomFinalUpload.single("final"), async (req, res) => {
  const assetId = String(req.body?.assetId || "").trim();
  if (!assetId || !req.file) return res.status(400).json({ ok: false, error: "assetId and a JPEG final are required" });
  if (path.extname(req.file.originalname).toLowerCase() !== ".jpg" && path.extname(req.file.originalname).toLowerCase() !== ".jpeg") {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ ok: false, error: "Finals must be JPEG files" });
  }
  try {
    const metadata = await sharp(req.file.path).metadata();
    if (metadata.format !== "jpeg") throw new Error("not a JPEG");
    const db = readDb();
    const found = findAlbumById(db, req.params.albumId);
    if (!found) throw new Error("Album not found");
    const storeKey = found.tenantSlug ? `t_${found.tenantSlug}_wv_albums` : DB_KEYS.ALBUMS;
    const albums = dbGet(db, storeKey, []);
    const albumIndex = albums.findIndex(album => album.id === found.album.id);
    const photoIndex = albums[albumIndex]?.photos?.findIndex(photo => photo.id === assetId) ?? -1;
    if (albumIndex < 0 || photoIndex < 0) throw new Error("Photo not found in album");
    const uploadedUrl = `/uploads/${req.file.filename}`;
    const photo = albums[albumIndex].photos[photoIndex];
    // Keep the proof URL for audit/re-proofing while making the final rendition
    // the image served by the regular website gallery.
    albums[albumIndex].photos[photoIndex] = {
      ...photo,
      proofSrc: photo.proofSrc || photo.src,
      src: uploadedUrl,
      thumbnail: `${uploadedUrl}?size=thumb&wm=0`,
      finalSrc: uploadedUrl,
      finalOriginalName: req.file.originalname,
      finalUploadedAt: new Date().toISOString(),
      fileSize: req.file.size,
      width: metadata.width || photo.width,
      height: metadata.height || photo.height,
    };
    db[storeKey] = JSON.stringify(albums);
    writeDb(db);
    res.json({ ok: true, assetId, finalUrl: uploadedUrl });
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(err.message === "Album not found" || err.message === "Photo not found in album" ? 404 : 400).json({ ok: false, error: err.message || "Final upload failed" });
  }
});

// ── Delete ALL uploaded photos from disk ───────────────
const deleteAllLimiter = rateLimit({ windowMs: 10_000, max: 1, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests — please wait before retrying" } });
app.delete("/api/upload/all", deleteAllLimiter, requireAuth, async (_req, res) => {
  try {
    const files = fs.readdirSync(UPLOADS_DIR);
    let deleted = 0;
    for (const f of files) {
      try { fs.unlinkSync(path.join(UPLOADS_DIR, f)); deleted++; } catch {}
    }
    clearImageCache();

    // Wipe all photo records from the database so album refs don't break —
    // including tenant albums and tenant photo libraries so stale references
    // don't accumulate after a full storage wipe.
    const db = readDb();
    // Collect all album keys (main + tenant)
    const albumKeys = Object.keys(db).filter(k => k === ALBUMS_KEY || (k.startsWith("t_") && k.endsWith(TENANT_ALBUMS_SUFFIX)));
    for (const key of albumKeys) {
      const albums = typeof db[key] === "string" ? JSON.parse(db[key]) : db[key];
      if (Array.isArray(albums)) {
        db[key] = JSON.stringify(albums.map(a => ({ ...a, photos: [], photoCount: 0, coverImage: "" })));
      }
    }
    // Collect all photo library keys (main + tenant)
    const photoLibKeys = Object.keys(db).filter(k => k === PHOTO_LIB_KEY || (k.startsWith("t_") && k.endsWith(TENANT_PHOTO_LIB_SUFFIX)));
    for (const key of photoLibKeys) {
      db[key] = JSON.stringify([]);
    }
    db["wv_upload_owners"] = {};
    writeDb(db);

    res.json({ ok: true, deleted });
  } catch (err) {
    console.error("Delete all error:", err.message);
    res.status(500).json({ error: "Failed to delete files" });
  }
});

const uploadDeleteLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false, message: { error: "Too many delete requests — please wait" } });

function uploadReferenceKeys(db, filename) {
  const safeName = path.basename(String(filename || ""));
  if (!safeName) return [];
  const relevantKeys = Object.keys(db).filter(key =>
    key === DB_KEYS.ALBUMS || key === DB_KEYS.PHOTO_LIB ||
    (key.startsWith("t_") && (key.endsWith(TENANT_ALBUMS_SUFFIX) || key.endsWith(TENANT_PHOTO_LIB_SUFFIX)))
  );
  return relevantKeys.filter(key => {
    const value = dbGet(db, key, []);
    return JSON.stringify(value).includes(`/uploads/${safeName}`);
  });
}

function uploadMatchesAlbumScope(db, filename, tenantSlug) {
  const safeName = path.basename(String(filename || ""));
  if (!safeName) return false;
  const owner = dbGet(db, "wv_upload_owners", {})?.[safeName];
  return uploadBelongsToScope(owner, uploadReferenceKeys(db, safeName), tenantSlug || null);
}

function invalidAlbumUploadReferences(db, album, tenantSlug) {
  const names = collectUploadFileNames({ coverImage: album?.coverImage, photos: album?.photos || [] });
  return [...names].filter(filename => !uploadMatchesAlbumScope(db, filename, tenantSlug));
}

function purgeCacheVariantsForUpload(filename) {
  const baseName = path.basename(String(filename || ""), path.extname(String(filename || "")));
  if (!baseName) return 0;
  let purged = 0;
  try {
    for (const cacheName of fs.readdirSync(CACHE_DIR)) {
      if (cacheName.startsWith(`${baseName}_`) || cacheName.startsWith(`${baseName}-`)) {
        try { fs.unlinkSync(path.join(CACHE_DIR, cacheName)); purged++; } catch {}
      }
    }
  } catch {}
  return purged;
}

app.delete("/api/upload/:filename", uploadDeleteLimiter, requireAdminOrScopedTenant, (req, res) => {
  const safeName = path.basename(req.params.filename);
  const filepath = path.join(UPLOADS_DIR, safeName);
  try {
    const db = readDb();
    const references = uploadReferenceKeys(db, safeName);
    if (references.length > 0) return res.status(409).json({ error: "File is still referenced by an album or photo library", referenceKeys: references });
    if (req.authContext?.type === "tenant") {
      const owner = dbGet(db, "wv_upload_owners", {})?.[safeName];
      if (!owner || owner.tenantSlug !== req.authContext.slug) return res.status(403).json({ error: "This file is not owned by the authenticated tenant" });
    }
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    const purgedCacheFiles = purgeCacheVariantsForUpload(safeName);
    const owners = dbGet(db, "wv_upload_owners", {});
    if (owners[safeName]) {
      delete owners[safeName];
      db["wv_upload_owners"] = owners;
      writeDb(db);
    }
    res.json({ ok: true, purgedCacheFiles });
  } catch {
    res.status(500).json({ error: "Failed to delete file" });
  }
});

// ── Watermarking helpers ──────────────────────────────
function getWatermarkSettings(tenantSlug) {
  try {
    const db = readDb();
    // If a tenant slug is provided, prefer their watermark settings (stored in t_{slug}_wv_tenant_settings)
    if (tenantSlug) {
      const raw = db[`t_${tenantSlug}_wv_tenant_settings`];
      const ts = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
      // Only use tenant watermark if at least one watermark field is explicitly configured
      if (ts.watermarkText || ts.watermarkImage || ts.watermarkPosition) {
        const globalSettings = (() => {
          try { const s = db["wv_settings"]; return typeof s === "string" ? JSON.parse(s) : (s || {}); } catch { return {}; }
        })();
        return {
          text: ts.watermarkText || globalSettings.watermarkText || "WATERMARK VAULT",
          opacity: Math.min(1, Math.max(0, (ts.watermarkOpacity ?? globalSettings.watermarkOpacity ?? 20) / 100)),
          position: ts.watermarkPosition || globalSettings.watermarkPosition || "tiled",
          imageBase64: ts.watermarkImage || null,
          size: ts.watermarkSize ?? globalSettings.watermarkSize ?? 40,
        };
      }
    }
    const settings = db["wv_settings"];
    const parsed = typeof settings === "string" ? JSON.parse(settings) : settings;
    return {
      text: parsed?.watermarkText || "WATERMARK VAULT",
      opacity: Math.min(1, Math.max(0, (parsed?.watermarkOpacity ?? 20) / 100)),
      position: parsed?.watermarkPosition || "tiled",
      imageBase64: parsed?.watermarkImage || null, // base64 data URL
      size: parsed?.watermarkSize ?? 40,
    };
  } catch {
    return { text: "WATERMARK VAULT", opacity: 0.2, position: "tiled", imageBase64: null, size: 40 };
  }
}

async function buildWatermarkOverlay(imgWidth, imgHeight, wm) {
  const watermarkScale = Math.min(100, Math.max(10, Number(wm?.size) || 40));
  const watermarkOpacity = Math.min(1, Math.max(0, Number(wm?.opacity) || 0));
  // If watermark is an image (base64 data URL)
  if (wm.imageBase64 && wm.imageBase64.startsWith("data:image/")) {
    try {
      const base64Data = wm.imageBase64.split(",")[1];
      const wmBuf = Buffer.from(base64Data, "base64");
      // For tiled: cap watermark size to reasonable max regardless of image resolution
      // CSS preview uses fixed h-8 (32px) tiles — scale proportionally but cap it
      const positionedPadding = wm.position === "center" ? 0 : 40;
      const maxPositionedWidth = Math.max(1, imgWidth - positionedPadding);
      const maxPositionedHeight = Math.max(1, imgHeight - positionedPadding);
      const wmSize = wm.position === "tiled"
        ? Math.min(400, Math.max(24, Math.round(imgWidth * 0.12 * (watermarkScale / 40))))
        : Math.min(maxPositionedWidth, Math.max(1, Math.round(imgWidth * (watermarkScale / 100))));
      const resizeOptions = wm.position === "tiled"
        ? { width: wmSize, fit: "inside" }
        : { width: wmSize, height: maxPositionedHeight, fit: "inside" };
      const wmResized = await sharp(wmBuf)
        .resize(resizeOptions)
        .ensureAlpha()
        .linear([1, 1, 1, watermarkOpacity], [0, 0, 0, 0])
        .png()
        .toBuffer();
      const wmMeta = await sharp(wmResized).metadata();

      if (wm.position === "tiled") {
        // Rotate watermark -30° for diagonal tile pattern
        const rotatedWm = await sharp(wmResized)
          .rotate(-30, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer();
        const tiles = [];
        const gapX = Math.round(imgWidth * 0.35);
        const gapY = Math.round(imgHeight * 0.25);
        for (let y = -gapY; y < imgHeight + gapY; y += gapY) {
          for (let x = -gapX; x < imgWidth + gapX; x += gapX) {
            tiles.push({ input: rotatedWm, top: Math.round(y), left: Math.round(x), blend: "over" });
          }
        }
        // Create transparent canvas and composite tiles
        const canvas = sharp({
          create: { width: imgWidth, height: imgHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
        });
        const tiled = await canvas.composite(tiles).png().toBuffer();
        return { input: tiled, blend: "over" };
      } else {
        // Single positioned watermark
        const positions = {
          center: { top: Math.round((imgHeight - wmMeta.height) / 2), left: Math.round((imgWidth - wmMeta.width) / 2) },
          "top-left": { top: 20, left: 20 },
          "top-right": { top: 20, left: imgWidth - wmMeta.width - 20 },
          "bottom-left": { top: imgHeight - wmMeta.height - 20, left: 20 },
          "bottom-right": { top: imgHeight - wmMeta.height - 20, left: imgWidth - wmMeta.width - 20 },
        };
        const pos = positions[wm.position] || positions.center;
        return { input: wmResized, blend: "over", ...pos };
      }
    } catch (e) {
      console.error("Watermark image error, falling back to text:", e.message);
    }
  }

  // Text watermark via SVG
  // Keep font size modest relative to image — ~3% of width, min 18px, max 48px
  const baseFontSize = Math.min(48, Math.max(18, Math.round(imgWidth * 0.03)));
  const fontSize = Math.min(120, Math.max(10, Math.round(baseFontSize * (watermarkScale / 40))));
  // Escape text for safe SVG embedding — prevents SVG injection via malicious watermark text
  const text = (wm.text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const alpha = Math.round(watermarkOpacity * 255).toString(16).padStart(2, "0");

  if (wm.position === "tiled") {
    // Widely spaced diagonal tiles — one instance per ~350x180px cell
    const cellW = Math.round(imgWidth * 0.38);
    const cellH = Math.round(imgHeight * 0.22);
    const cols = Math.ceil(imgWidth / cellW) + 2;
    const rows = Math.ceil(imgHeight / cellH) + 2;
    let svgContent = "";
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const x = Math.round((col - 0.5) * cellW);
        const y = Math.round((r - 0.5) * cellH);
        svgContent += `<text x="${x}" y="${y}" transform="rotate(-30, ${x}, ${y})">${text}</text>`;
      }
    }
    const svg = `<svg width="${imgWidth}" height="${imgHeight}" xmlns="http://www.w3.org/2000/svg">
      <style>text { font-family: Georgia, serif; font-size: ${fontSize}px; fill: #ffffff${alpha}; letter-spacing: 2px; }</style>
      ${svgContent}
    </svg>`;
    return { input: Buffer.from(svg), blend: "over" };
  } else {
    // Single centred/positioned text
    const w = Math.round(fontSize * text.length * 0.65);
    const h = fontSize * 2;
    const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <style>text { font-family: Georgia, serif; font-size: ${fontSize}px; fill: #ffffff${alpha}; letter-spacing: 2px; }</style>
      <text x="50%" y="60%" dominant-baseline="middle" text-anchor="middle" transform="rotate(-30, ${w/2}, ${h/2})">${text}</text>
    </svg>`;
    const positions = {
      center: { top: Math.round((imgHeight - h) / 2), left: Math.round((imgWidth - w) / 2) },
      "top-left": { top: 20, left: 20 },
      "top-right": { top: 20, left: Math.max(0, imgWidth - w - 20) },
      "bottom-left": { top: Math.max(0, imgHeight - h - 20), left: 20 },
      "bottom-right": { top: Math.max(0, imgHeight - h - 20), left: Math.max(0, imgWidth - w - 20) },
    };
    const pos = positions[wm.position] || positions.center;
    return { input: Buffer.from(svg), blend: "over", ...pos };
  }
}

// ── Check if a photo is paid/free for a session ───────
/** Find an album by ID across main and all tenant album stores. */
function findAlbumById(db, albumId) {
  let mainMatch = null;
  const tenantMatches = [];

  const mainRaw = db["wv_albums"];
  const main = mainRaw ? (typeof mainRaw === "string" ? JSON.parse(mainRaw) : mainRaw) : [];
  if (Array.isArray(main)) {
    const found = main.find(a => a.id === albumId);
    if (found) mainMatch = { album: found, tenantSlug: null };
  }

  for (const key of Object.keys(db)) {
    if (!key.startsWith("t_") || !key.endsWith("_wv_albums")) continue;
    const tSlug = key.slice(2, key.length - "_wv_albums".length);
    if (!licensedTenantBySlug(tSlug)) continue;
    const raw = db[key];
    const parsed = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : [];
    if (Array.isArray(parsed)) {
      const found = parsed.find(a => a.id === albumId);
      if (found) tenantMatches.push({ album: found, tenantSlug: tSlug });
    }
  }

  return _chooseAlbumStoreMatch(mainMatch, tenantMatches);
}

const purchaserRegistrationLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many registration attempts" } });
app.post("/api/album/register-purchaser", purchaserRegistrationLimiter, (req, res) => {
  const { albumId, email } = req.body || {};
  if (!albumId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""))) {
    return res.status(400).json({ error: "Album and a valid email are required" });
  }
  const db = readDb();
  const found = findAlbumById(db, albumId);
  if (!found) return res.status(404).json({ error: "Album not found" });
  if (albumAccessWindow(found.album, Date.now(), galleryTimezone(db, found.tenantSlug)).galleryExpired) return res.status(410).json({ error: "This gallery has expired" });
  const gallerySession = getGallerySessionForAlbum(req, found.album);
  if (!gallerySession || gallerySession.tenantSlug !== found.tenantSlug) return res.status(401).json({ error: "A valid gallery session is required" });
  const storeKey = found.tenantSlug ? `t_${found.tenantSlug}_wv_albums` : "wv_albums";
  const albumsRaw = db[storeKey];
  const albums = albumsRaw ? (typeof albumsRaw === "string" ? JSON.parse(albumsRaw) : albumsRaw) : [];
  const index = albums.findIndex(album => album.id === found.album.id);
  if (index < 0) return res.status(404).json({ error: "Album not found" });

  const album = albums[index];
  const sessionKey = gallerySession.sessionKey;
  const purchases = { ...(album.sessionPurchases || {}) };
  const existing = purchases[sessionKey] || {};
  purchases[sessionKey] = {
    ...existing,
    fullAlbum: existing.fullAlbum === true,
    photoIds: [...new Set(existing.photoIds || [])],
    purchaserEmail: String(email).trim().toLowerCase(),
  };
  album.sessionPurchases = purchases;
  albums[index] = album;
  db[storeKey] = typeof albumsRaw === "string" ? JSON.stringify(albums) : albums;
  writeDb(db);
  res.json({ ok: true, sessionKey });
});

const IMPORTED_PORTFOLIO_GALLERY = [
  { id: "archive-wedding-waterfront", image: "/portfolio/imported/alexrosanna-010.jpg", alt: "Couple embracing beside the waterfront", category: "Weddings" },
  { id: "archive-portrait-red-dress", image: "/portfolio/imported/aurie-175.jpg", alt: "Editorial portrait in a red dress", category: "Portraits" },
  { id: "archive-live-band", image: "/portfolio/imported/coogebay-thevanns-22-09-240103.jpg", alt: "Live band performing on an outdoor stage", category: "Live music" },
  { id: "archive-dj-duo", image: "/portfolio/imported/cosmosmidnight-fullres-018.jpg", alt: "DJ duo performing under coloured lights", category: "Live music" },
  { id: "archive-stage-performer", image: "/portfolio/imported/zm-382.jpg", alt: "Performer on stage beneath blue lighting", category: "Live music" },
  { id: "archive-concert-crowd", image: "/portfolio/imported/zm-day2-120.jpg", alt: "Concert crowd holding illuminated light sticks", category: "Live music" },
  { id: "archive-party-crowd", image: "/portfolio/imported/greenwoodhotel-cruiser-31-10-240046.jpg", alt: "Crowd celebrating at a live party", category: "Events" },
  { id: "archive-party-djs", image: "/portfolio/imported/greenwoodhotel-cruiser-31-10-240095.jpg", alt: "DJs performing at an outdoor party", category: "Events" },
  { id: "archive-formal-audience", image: "/portfolio/imported/thewarwick-nrl-115.jpg", alt: "Audience watching a formal presentation", category: "Events" },
  { id: "archive-gaming-event", image: "/portfolio/imported/thewarwick-nrl-46.jpg", alt: "Guests gathered around a gaming activation", category: "Events" },
  { id: "archive-balter-bar", image: "/portfolio/imported/coogebay-thevanns-22-09-240010.jpg", alt: "Balter beverage display at a branded event", category: "Brand and business" },
  { id: "archive-balter-can", image: "/portfolio/imported/greenwoodhotel-cruiser-31-10-240113.jpg", alt: "Balter Easy Hazy can at an event", category: "Brand and business" },
  { id: "archive-restaurant-team", image: "/portfolio/imported/cloudec-050.jpg", alt: "Restaurant team portrait", category: "Brand and business" },
  { id: "archive-brand-gardening", image: "/portfolio/imported/cloudec-264.jpg", alt: "Team member working in a garden", category: "Brand and business" },
  { id: "archive-event-drinks", image: "/portfolio/imported/curzonhallschneidercorporate26-10-24-150.jpg", alt: "Guests enjoying drinks at a corporate event", category: "Brand and business" },
  { id: "archive-corporate-networking", image: "/portfolio/imported/oatlandsestatesmallbusinessevent30-10-24137.jpg", alt: "Professionals networking at an evening reception", category: "Brand and business" },
  { id: "archive-event-selfie", image: "/portfolio/imported/oatlandsestatesmallbusinessevent30-10-24109.jpg", alt: "Guests taking a selfie at a formal event", category: "Events" },
  { id: "archive-outdoor-service", image: "/portfolio/imported/oatlandsestategraduationsetup13-11-240053.jpg", alt: "Outdoor beverage service at an event", category: "Events" },
  { id: "archive-corporate-conversation", image: "/portfolio/imported/stryd-140.jpg", alt: "Business guests in conversation", category: "Brand and business" },
  { id: "food-lexus-slider-service", image: "/portfolio/curated/food-lexus-slider-service.jpg", alt: "Black-bun sliders carried through live service at a Lexus event", category: "Food & Hospitality" },
  { id: "food-mcdonalds-live-cooking", image: "/portfolio/curated/food-mcdonalds-live-cooking.jpg", alt: "Navarra chef cooks paella inside the McDonald's headquarters", category: "Food & Hospitality" },
  { id: "food-mcdonalds-chef-service", image: "/portfolio/curated/food-mcdonalds-chef-service.jpg", alt: "Navarra chef serves a guest during a live catering activation", category: "Food & Hospitality" },
  { id: "food-conca-oyster-service", image: "/portfolio/curated/food-conca-oyster-service.jpg", alt: "Guests select fresh oysters during an interactive tasting", category: "Food & Hospitality" },
  { id: "food-lexus-tasting-tray", image: "/portfolio/curated/food-lexus-tasting-tray.jpg", alt: "Colourful tasting cups presented during live event service", category: "Food & Hospitality" },
  { id: "food-conca-pasta", image: "/portfolio/curated/food-conca-pasta.jpg", alt: "Fresh filled pasta plated with tomato and basil", category: "Food & Hospitality" },
  { id: "archive-catered-prosciutto", image: "/portfolio/imported/aawedding-190.jpg", alt: "Catered prosciutto finished with herbs", category: "Food and hospitality" },
  { id: "archive-chef-service", image: "/portfolio/imported/curzonhallschneidercorporate26-10-24-123.jpg", alt: "Chef serving guests at an outdoor station", category: "Food and hospitality" },
  { id: "archive-catering-spread", image: "/portfolio/imported/lemontage6-2-2025roomshotsnestle25of71.jpg", alt: "Catered sandwich and appetizer spread", category: "Food and hospitality" },
  { id: "archive-plated-service", image: "/portfolio/imported/lemontage6-2-2025roomshotsnestle28of71.jpg", alt: "Chef plating dishes during service", category: "Food and hospitality" },
  { id: "archive-gnocchi", image: "/portfolio/imported/oatlandsestategraduationsetup13-11-240101.jpg", alt: "Gnocchi finished with parmesan and herbs", category: "Food and hospitality" },
  { id: "archive-plated-entree", image: "/portfolio/imported/lemontagegraduationsetup15-11-240083.jpg", alt: "Plated entree prepared for a formal dinner", category: "Food and hospitality" },
  { id: "archive-formal-room-blue", image: "/portfolio/imported/lemontagegraduationsetup15-11-240014.jpg", alt: "Ballroom prepared with blue architectural lighting", category: "Formals" },
  { id: "archive-formal-table-blue", image: "/portfolio/imported/lemontagegraduationsetup15-11-240008-enhanced-nr.jpg", alt: "Formal table setting with blue linens", category: "Formals" },
  { id: "archive-corporate-room", image: "/portfolio/imported/lemontage6-2-2025roomshotsnestle42of71.jpg", alt: "Corporate dining room during an event", category: "Formals" },
  { id: "archive-gift-table", image: "/portfolio/imported/oatlandsestate1-2-25elizabethroom41of66.jpg", alt: "Formal table setting with wrapped gifts", category: "Formals" },
  { id: "archive-editorial-writing", image: "/portfolio/imported/cloudec-037.jpg", alt: "Hands writing in strong afternoon light", category: "Details" },
  { id: "archive-cocktails", image: "/portfolio/imported/thewarwick-nrl-2-copy.jpg", alt: "Two pink cocktails at an evening event", category: "Details" },
  { id: "archive-cosplay", image: "/portfolio/imported/zm-182.jpg", alt: "Cosplay guests arriving at a convention", category: "Cosplay" },
  { id: "navarra-ballroom", image: "/portfolio/curated/navarra-ballroom.jpg", alt: "Conca D'Oro ballroom prepared for an evening dining event", category: "Venues & Details" },
  { id: "navarra-plated-entree", image: "/portfolio/curated/navarra-plated-entree.jpg", alt: "Restaurant entree plated with vegetables and edible flowers", category: "Food & Hospitality" },
  { id: "navarra-seafood", image: "/portfolio/curated/navarra-seafood.jpg", alt: "Seafood entree with prawns and mussels served at Le Montage", category: "Food & Hospitality" },
  { id: "navarra-chefs", image: "/portfolio/curated/navarra-chefs.jpg", alt: "Navarra chefs preparing dishes during live service", category: "Food & Hospitality" },
  { id: "navarra-dessert", image: "/portfolio/curated/navarra-dessert.jpg", alt: "Red gluten-free dessert finished with berries and meringue", category: "Food & Hospitality" },
  { id: "navarra-mcdonalds", image: "/portfolio/curated/navarra-mcdonalds.jpg", alt: "McDonald's character beside a Navarra catering display", category: "Brand & Corporate" },
  { id: "navarra-mercedes", image: "/portfolio/curated/navarra-mercedes.jpg", alt: "Waiter carrying drinks beside Mercedes performance cars", category: "Brand & Corporate" },
  { id: "navarra-pinsent", image: "/portfolio/curated/navarra-pinsent.jpg", alt: "Corporate speakers addressing guests at a harbour-side launch", category: "Brand & Corporate" },
  { id: "cosplay-animaga-steps", image: "/portfolio/curated/cosplay-animaga-steps.jpg", alt: "Blue and white cosplayer posed across architectural steps at Animaga", category: "Cosplay & Conventions" },
  { id: "cosplay-animaga-sunlight", image: "/portfolio/curated/cosplay-animaga-sunlight.jpg", alt: "Cosplayer reaching into warm sunlight beneath trees at Animaga", category: "Cosplay & Conventions" },
  { id: "cosplay-animaga-armour", image: "/portfolio/curated/cosplay-animaga-armour.jpg", alt: "Red and black armoured cosplayer in an editorial portrait", category: "Cosplay & Conventions" },
  { id: "cosplay-animaga-harbour", image: "/portfolio/curated/cosplay-animaga-harbour.jpg", alt: "Armoured character beside Sydney Harbour at sunset", category: "Cosplay & Conventions" },
  { id: "cosplay-pax-spiderman", image: "/portfolio/curated/cosplay-pax-spiderman.jpg", alt: "Spider-Man cosplayer crouched in character at PAX", category: "Cosplay & Conventions" },
  { id: "cosplay-pax-duo", image: "/portfolio/curated/cosplay-pax-duo.jpg", alt: "Elaborately costumed duo posed beneath trees at PAX", category: "Cosplay & Conventions" },
  { id: "cosplay-pax-valkyries", image: "/portfolio/curated/cosplay-pax-valkyries.jpg", alt: "Fantasy characters stage a confrontation at PAX", category: "Cosplay & Conventions" },
  { id: "cosplay-smash-confetti", image: "/portfolio/curated/cosplay-smash-confetti.jpg", alt: "Packed SMASH convention crowd beneath a burst of confetti", category: "Cosplay & Conventions" },
  { id: "cosplay-smash-stage", image: "/portfolio/curated/cosplay-smash-stage.jpg", alt: "Stage performer addressing the SMASH audience under theatrical light", category: "Cosplay & Conventions" },
  { id: "cosplay-smash-auditorium", image: "/portfolio/curated/cosplay-smash-auditorium.jpg", alt: "Wide view across a packed SMASH convention auditorium", category: "Cosplay & Conventions" },
  { id: "sports-hyrox-motion", image: "/portfolio/curated/sports-hyrox-motion.jpg", alt: "HYROX competitors surge past a race arch in motion", category: "Sports" },
  { id: "sports-hyrox-leap", image: "/portfolio/curated/sports-hyrox-leap.jpg", alt: "HYROX partners leap across the illuminated finish line", category: "Sports" },
  { id: "sports-sydney-wheelchair", image: "/portfolio/curated/sports-sydney-wheelchair.jpg", alt: "Wheelchair racer powers through a tree-lined Sydney Marathon bend", category: "Sports" },
  { id: "sports-hyrox-row", image: "/portfolio/curated/sports-hyrox-row.jpg", alt: "Packed HYROX rowing station viewed from above", category: "Sports" },
  { id: "sports-hyrox-pan", image: "/portfolio/curated/sports-hyrox-pan.jpg", alt: "Sled athlete isolated through a layered panning exposure", category: "Sports" },
  { id: "sports-hyrox-handstand", image: "/portfolio/curated/sports-hyrox-handstand.jpg", alt: "HYROX athlete performs a handstand at the finish", category: "Sports" },
  { id: "sports-hoka-dawn", image: "/portfolio/curated/sports-hoka-dawn.jpg", alt: "HOKA runners pass beneath palm silhouettes before sunrise", category: "Sports" },
  { id: "sports-hyrox-crawl", image: "/portfolio/curated/sports-hyrox-crawl.jpg", alt: "Exhausted HYROX athlete crawls toward the lens at track level", category: "Sports" },
  { id: "sports-hyrox-finish", image: "/portfolio/curated/sports-hyrox-finish.jpg", alt: "HYROX competitors collide in a finish-line embrace", category: "Sports" },
  { id: "sports-hyrox-adaptive", image: "/portfolio/curated/sports-hyrox-adaptive.jpg", alt: "Adaptive HYROX athlete races through the course with lateral motion", category: "Sports" },
  { id: "sports-hoka-pan", image: "/portfolio/curated/sports-hoka-pan.jpg", alt: "Elite HOKA runner stays sharp against streaked spectators", category: "Sports" },
  { id: "sports-hyrox-brisbane", image: "/portfolio/curated/sports-hyrox-brisbane.jpg", alt: "HYROX athlete pushes a sled from below the rails", category: "Sports" },
  { id: "wedding-aa-exit", image: "/portfolio/curated/wedding-aa-exit.jpg", alt: "Newlyweds leave the church as guests applaud around them", category: "Weddings" },
  { id: "wedding-kj-laugh", image: "/portfolio/curated/wedding-kj-laugh.jpg", alt: "Bride laughs toward the camera while carrying a vivid red bouquet", category: "Weddings" },
  { id: "wedding-kj-harbour", image: "/portfolio/curated/wedding-kj-harbour.jpg", alt: "Groom carries the bride beside Sydney Harbour as she raises her bouquet", category: "Weddings" },
  { id: "music-chronobeat-motion", image: "/portfolio/curated/music-chronobeat-motion.jpg", alt: "Concert guest dances with illuminated light sticks amid circular motion", category: "Live Music" },
  { id: "music-chronobeat-guitar", image: "/portfolio/curated/music-chronobeat-guitar.jpg", alt: "Guitarist bends over the stage while the band streaks through coloured light", category: "Live Music" },
  { id: "music-teddyloid-smash-crowd", image: "/portfolio/curated/music-teddyloid-smash-crowd.webp", alt: "TeddyLoid performs above a packed SMASH crowd holding illuminated light sticks", category: "Live Music" },
  { id: "music-teddyloid-smash-portrait", image: "/portfolio/curated/music-teddyloid-smash-portrait.webp", alt: "TeddyLoid points toward the audience while performing at SMASH", category: "Live Music" },
  { id: "music-teddyloid-smash-wide", image: "/portfolio/curated/music-teddyloid-smash-wide.webp", alt: "Wide view of TeddyLoid performing to a full SMASH auditorium", category: "Live Music" },
  { id: "music-teddyloid-smash-stage", image: "/portfolio/curated/music-teddyloid-smash-stage.webp", alt: "TeddyLoid mixes from side stage as dancers face the SMASH audience", category: "Live Music" },
  { id: "cosplay-animaga-editorial", image: "/portfolio/curated/cosplay-animaga-editorial.jpg", alt: "Pink-haired cosplayer reclines across broad architectural steps", category: "Cosplay & Conventions" },
  { id: "cosplay-pax-portrait", image: "/portfolio/curated/cosplay-pax-portrait.jpg", alt: "Red-haired horned character poses in a close editorial portrait", category: "Cosplay & Conventions" },
  { id: "sports-hyrox-jump", image: "/portfolio/curated/sports-hyrox-jump.jpg", alt: "HYROX athlete suspended in a celebratory jump inside a symmetrical arena", category: "Sports" },
  { id: "sports-hoka-city-pan", image: "/portfolio/curated/sports-hoka-city-pan.jpg", alt: "Runners streak past a heritage streetscape and moving city bus", category: "Sports" },
  { id: "sports-hyrox-sleds", image: "/portfolio/curated/sports-hyrox-sleds.jpg", alt: "Two HYROX athletes drive sleds through parallel lanes from above", category: "Sports" },
  { id: "brand-digipark-red", image: "/portfolio/curated/brand-digipark-red.jpg", alt: "Guests meditate beneath an immense glowing red projection", category: "Brand & Corporate" },
  { id: "brand-digipark-tunnel", image: "/portfolio/curated/brand-digipark-tunnel.jpg", alt: "Fitness participants move through a luminous blue digital tunnel", category: "Brand & Corporate" },
  { id: "food-lexus-live-service", image: "/portfolio/curated/food-lexus-live-service.jpg", alt: "Navarra chef slices cured meat during live service at a Lexus event", category: "Food & Hospitality" },
];
const PORTFOLIO_RETIRED_GALLERY_IDS = new Set(["sports-hyrox-sled", "sports-hoka-library", "sports-sydney-marathon", "archive-wedding-garden", "archive-wedding-blossoms", "wedding-harbour"]);
const PORTFOLIO_RETIRED_IMAGE_PATHS = new Set([
  "/portfolio/weddings.jpg",
  "/portfolio/imported/jjswedding-138.jpg",
  "/portfolio/imported/melanienicholaswedding0152.jpg",
  "/portfolio/gallery/wedding-candid.jpg",
]);
const PORTFOLIO_RETIRED_RIBBON_IMAGE_PATHS = new Set([
  "/portfolio/gallery/wedding-garden.jpg",
  "/portfolio/curated/wedding-aa-exit.jpg",
  "/portfolio/curated/wedding-kj-laugh.jpg",
  "/portfolio/gallery/wedding-celebration.jpg",
]);
const PORTFOLIO_LEGACY_RIBBON_IMAGES = {
  homeRibbonImages: ["/portfolio/gallery/wedding-garden.jpg", "/portfolio/gallery/wedding-celebration.jpg", "/portfolio/gallery/wedding-candid.jpg"],
  aboutRibbonImages: ["/portfolio/gallery/concert-crowd.jpg", "/portfolio/gallery/event-energy.jpg", "/portfolio/gallery/brand-event.jpg"],
  testimonialsRibbonImages: ["/portfolio/gallery/wedding-celebration.jpg", "/portfolio/gallery/wedding-candid.jpg", "/portfolio/gallery/concert-performer.jpg"],
};

const PORTFOLIO_CATEGORY_ORDER = ["Weddings", "Live Music", "Cosplay & Conventions", "Sports", "Events", "Brand & Corporate", "Food & Hospitality", "Venues & Details", "Portraits"];
const PORTFOLIO_FEATURED_IMAGE_ORDER = ["music-teddyloid-smash-crowd", "music-teddyloid-smash-portrait", "music-teddyloid-smash-wide", "music-teddyloid-smash-stage", "food-lexus-slider-service", "food-mcdonalds-live-cooking", "food-mcdonalds-chef-service", "food-conca-oyster-service", "food-lexus-tasting-tray", "food-conca-pasta"];
const PORTFOLIO_CATEGORY_LABELS = {
  "live music": "Live Music",
  "brand and business": "Brand & Corporate",
  "food and hospitality": "Food & Hospitality",
  formals: "Venues & Details",
  details: "Venues & Details",
  cosplay: "Cosplay & Conventions",
};
const CORE_PORTFOLIO_GALLERY = [
  { id: "wedding-aisle", image: "/portfolio/gallery/wedding-garden.jpg", alt: "Newlyweds walking down the church aisle", category: "Weddings" },
  { id: "wedding-flowers", image: "/portfolio/gallery/wedding-celebration.jpg", alt: "Wedding floral details", category: "Weddings" },
  { id: "dj", image: "/portfolio/gallery/concert-performer.jpg", alt: "DJ performing at a live event", category: "Live Music" },
  { id: "performer", image: "/portfolio/gallery/food-detail.jpg", alt: "Singer performing under stage lights", category: "Live Music" },
  { id: "nightlife-sign", image: "/portfolio/gallery/concert-crowd.jpg", alt: "Neon venue signage at a nightlife event", category: "Events" },
  { id: "cocktail", image: "/portfolio/gallery/event-energy.jpg", alt: "Cocktail service at an event", category: "Events" },
  { id: "brand-networking", image: "/portfolio/gallery/brand-event.jpg", alt: "Guests networking at a business event", category: "Brand & Corporate" },
  { id: "event-production", image: "/portfolio/gallery/portrait-editorial.jpg", alt: "Event production team at work", category: "Brand & Corporate" },
  { id: "chef", image: "/portfolio/gallery/corporate-networking.jpg", alt: "Chef serving guests at a catered event", category: "Food & Hospitality" },
  { id: "wine-detail", image: "/portfolio/gallery/formal-room.jpg", alt: "Wine and glassware at a formal event", category: "Venues & Details" },
  { id: "balter", image: "/portfolio/gallery/nightlife.jpg", alt: "Balter brand activation", category: "Brand & Corporate" },
];
const CURATED_PORTFOLIO_GALLERY = [...CORE_PORTFOLIO_GALLERY, ...IMPORTED_PORTFOLIO_GALLERY]
  .map(item => ({ ...item, category: PORTFOLIO_CATEGORY_LABELS[String(item.category || "").toLowerCase()] || item.category }))
  .sort((left, right) => {
    const categoryDifference = PORTFOLIO_CATEGORY_ORDER.indexOf(left.category) - PORTFOLIO_CATEGORY_ORDER.indexOf(right.category);
    if (categoryDifference) return categoryDifference;
    const leftFeatured = PORTFOLIO_FEATURED_IMAGE_ORDER.indexOf(left.id);
    const rightFeatured = PORTFOLIO_FEATURED_IMAGE_ORDER.indexOf(right.id);
    return (leftFeatured < 0 ? Number.MAX_SAFE_INTEGER : leftFeatured) - (rightFeatured < 0 ? Number.MAX_SAFE_INTEGER : rightFeatured);
  });

const DEFAULT_PORTFOLIO = {
  gallerySeedVersion: 8,
  brandName: "Zac Morgan Photography",
  logo: "/portfolio/logo.png",
  heroImage: "/portfolio/live-action.jpg",
  heroImages: ["/portfolio/live-action.jpg", "/portfolio/gallery/concert-performer.jpg", "/portfolio/gallery/brand-event.jpg"],
  heroLabel: "Live in action",
  heroServicesLabel: "Weddings · Events · Live music · Sport · Brands",
  introEyebrow: "Hey, I'm Zac, an event / wedding photographer",
  introTitle: "Let's get to know each other",
  introBody: "What started as a hobby quickly became a passion for capturing the moments people want to remember. I photograph weddings, live music, parties and corporate events across Sydney.",
  aboutSecondaryBody: "I work quietly when the moment calls for it and step in with direction when it helps. The goal is a polished gallery that keeps the people, movement and atmosphere that made the day yours.",
  portfolioTitle: "Stories that still feel alive.",
  portfolioBody: "Weddings, performances, conventions, sport and brands photographed with energy and intent.",
  testimonialsTitle: "The experience matters too.",
  testimonialsIntro: "Feedback from weddings, celebrations, portrait sessions and business events across Sydney.",
  portrait: "/portfolio/portrait.jpg",
  homeRibbonImages: ["/portfolio/imported/oatlandsestatesmallbusinessevent30-10-24109.jpg", "/portfolio/curated/brand-digipark-tunnel.jpg", "/portfolio/curated/food-lexus-live-service.jpg"],
  storyEyebrow: "Ways of seeing",
  storyTitle: "Every room has its own rhythm.",
  philosophyEyebrow: "The work",
  philosophyTitle: "Photographs should feel like the night did.",
  philosophyBody: "Not over-directed. Not flattened into a trend. Just the people, atmosphere and small details that made the moment yours.",
  philosophyImage: "/portfolio/gallery/food-detail.jpg",
  portfolioClientsLabel: "Selected clients and venues",
  portfolioClients: ["Asahi Breweries", "Navarra Venues", "SMASH!", "Sportograf"],
  portfolioCtaEyebrow: "Your story, photographed honestly",
  portfolioCtaTitle: "Planning something?",
  portfolioCtaLabel: "Check availability",
  concertEyebrow: "Live music photography",
  concertTitle: "The room, at full volume.",
  concertBody: "Touring artists, festivals, venues and late-night sets photographed from inside the energy. Fast, atmospheric coverage built for press, social and the archive.",
  concertHeroImage: "/portfolio/curated/music-teddyloid-smash-crowd.webp",
  concertHighlights: ["Live sets", "Artist portraits", "Crowd and atmosphere", "Fast selects"],
  aboutApproachEyebrow: "The approach",
  aboutApproachTitle: "Present enough to guide. Quiet enough to notice.",
  aboutApproachBody: "I look for the interactions happening between the scheduled moments: the reaction across the room, the energy building before a performance, and the details your team spent months getting right.",
  aboutSupportingImage: "/portfolio/gallery/concert-performer.jpg",
  aboutSupportingCaption: "Working across Sydney weddings, events, venues and live productions.",
  aboutValues: [
    { id: "natural", title: "Natural over staged", body: "Real expressions and useful direction, without turning your event into a production." },
    { id: "dependable", title: "Fast and dependable", body: "Clear communication, careful backups and delivery that respects your timeline." },
    { id: "people", title: "Built around people", body: "Coverage adapts to your guests, venue, schedule and what matters most to you." },
  ],
  aboutRibbonImages: ["/portfolio/curated/brand-digipark-red.jpg", "/portfolio/curated/sports-hyrox-jump.jpg", "/portfolio/curated/music-chronobeat-motion.jpg"],
  testimonialsFeatureEyebrow: "From first message to final gallery",
  testimonialsFeatureTitle: "Clear, calm and ready for the moment.",
  testimonialsFeaturePoints: ["Straightforward planning", "Natural, true-to-life coverage", "Careful backup and timely delivery"],
  testimonialsImage: "/portfolio/gallery/portrait-editorial.jpg",
  testimonialsRibbonImages: ["/portfolio/curated/wedding-aa-exit.jpg", "/portfolio/curated/cosplay-smash-confetti.jpg", "/portfolio/curated/brand-digipark-tunnel.jpg"],
  enquiryImage: "/portfolio/gallery/concert-crowd.jpg",
  enquirySteps: [
    { id: "details", title: "Send the details", body: "Share the date, venue and kind of coverage you have in mind." },
    { id: "fit", title: "Confirm the fit", body: "You'll receive availability, options and a clear recommendation." },
    { id: "book", title: "Lock it in", body: "Approve the booking, sign online and your date is secured." },
  ],
  testimonial: "Zac is an extremely talented photographer. His photos captured the energy of the night perfectly and were delivered quickly.",
  testimonialAuthor: "Henry M",
  projects: [
    { id: "weddings", title: "Engagements / Weddings", image: "/portfolio/curated/wedding-aa-exit.jpg", description: "Relaxed, honest coverage from the quiet moments to the dance floor.", category: "Weddings" },
    { id: "bands", title: "Band Photos", image: "/portfolio/bands.jpg", description: "Live performance and artist imagery that keeps the atmosphere intact.", category: "Live Music" },
    { id: "corporate", title: "Corporate Events", image: "/portfolio/corporate.jpg", description: "Polished event coverage for teams, brands and venues.", category: "Brand & Corporate" },
    { id: "parties", title: "Parties", image: "/portfolio/parties.jpg", description: "Candid celebration photography with people at the centre.", category: "Events" },
    { id: "cosplay", title: "Cosplay & Conventions", image: "/portfolio/curated/cosplay-smash-confetti.jpg", description: "Character portraits, stages and convention crowds photographed with colour and energy.", category: "Cosplay & Conventions" },
    { id: "sports", title: "Sport & Endurance", image: "/portfolio/curated/sports-hyrox-motion.jpg", description: "Fast, expressive race coverage from first light to the finish line.", category: "Sports" },
    { id: "food", title: "Food & Hospitality", image: "/portfolio/curated/food-mcdonalds-live-cooking.jpg", description: "Food, chefs and service photographed with colour, texture and a sense of occasion.", category: "Food & Hospitality" },
  ],
  galleryImages: CURATED_PORTFOLIO_GALLERY,
  testimonials: [
    { id: "alexander", quote: "Zac's photos for our wedding were amazing. He was professional, genuine and made sure the day was captured beautifully, from our families to the candid moments.", author: "Alexander", context: "Wedding" },
    { id: "jorden", quote: "The photos were stunning, the session was fun and relaxed, and the turnaround time was incredibly fast.", author: "Jorden", context: "Portrait session" },
    { id: "luisa", quote: "Thanks so much Zac for your amazing work at our wedding. I am loving all the photos that captured the best day of my life.", author: "Luisa Munoz", context: "Wedding" },
    { id: "henry", quote: "Zac was the ultimate professional, capturing only the best photos for my son's 21st and creating a lifetime of memories.", author: "Henry Makhouf", context: "21st birthday" },
    { id: "keith", quote: "The photos were outstanding and the turnaround time was very speedy. Highly recommend.", author: "Keith", context: "Family celebration" },
    { id: "lorenzo", quote: "Professional, punctual and a great communicator. He handled the brief with professionalism and flair.", author: "Lorenzo", context: "Corporate event" },
  ],
  instagramUrl: "https://www.instagram.com/zacmphotos/",
  instagramHandle: "@zacmphotos",
  linkedinUrl: "https://www.linkedin.com/in/zacmorgan1/",
  contactEmail: "zacmorganphotography@gmail.com",
  locationLabel: "Sydney, Australia",
  bookingTitle: "Tell me what you're planning",
  bookingBody: "Share the date, location and feeling you want captured. I'll reply with availability and the right coverage option.",
  bookingButtonLabel: "Start an enquiry",
  footerTitle: "Let's make it memorable.",
  enquiryEventTypes: ["Wedding / engagement", "Corporate event", "Party", "Live music", "Sports / race coverage", "Convention / cosplay", "Brand / business shoot", "Other"],
};

function publicPortfolioContent(value) {
  const { webhookUrl: _privateWebhook, ...publicValue } = value || {};
  const merged = { ...DEFAULT_PORTFOLIO, ...publicValue };
  const requiresGalleryMigration = (Number(publicValue.gallerySeedVersion) || 0) < DEFAULT_PORTFOLIO.gallerySeedVersion;
  if (requiresGalleryMigration) {
    const existingGallery = Array.isArray(merged.galleryImages) ? merged.galleryImages : [];
    const existingById = new Map(existingGallery.map(item => [item?.id, item]));
    const seedIds = new Set(DEFAULT_PORTFOLIO.galleryImages.map(item => item.id));
    merged.galleryImages = [
      ...DEFAULT_PORTFOLIO.galleryImages.map(item => {
        const next = { ...item, ...(existingById.get(item.id) || {}), category: item.category };
        return PORTFOLIO_RETIRED_IMAGE_PATHS.has(next.image) ? { ...next, image: item.image } : next;
      }),
      ...existingGallery.filter(item => item?.id && !seedIds.has(item.id) && !PORTFOLIO_RETIRED_GALLERY_IDS.has(item.id) && !PORTFOLIO_RETIRED_IMAGE_PATHS.has(item.image)),
    ];
    merged.gallerySeedVersion = DEFAULT_PORTFOLIO.gallerySeedVersion;
    if (merged.concertHeroImage === "/portfolio/imported/zm-day2-120.jpg") {
      merged.concertHeroImage = DEFAULT_PORTFOLIO.concertHeroImage;
    }
  }
  const existingProjects = Array.isArray(merged.projects) ? merged.projects : [];
  const existingProjectsById = new Map(existingProjects.map(project => [project?.id, project]));
  const defaultProjectIds = new Set(DEFAULT_PORTFOLIO.projects.map(project => project.id));
  merged.projects = [
    ...DEFAULT_PORTFOLIO.projects.map(project => {
      const existing = existingProjectsById.get(project.id) || {};
      const next = { ...project, ...existing };
      return PORTFOLIO_RETIRED_IMAGE_PATHS.has(next.image) ? { ...next, image: project.image } : next;
    }),
    ...existingProjects.filter(project => project?.id && !defaultProjectIds.has(project.id)),
  ];
  for (const key of ["heroImages", "homeRibbonImages", "aboutRibbonImages", "testimonialsRibbonImages"]) {
    const stored = Array.isArray(merged[key]) ? merged[key] : [];
    const legacy = PORTFOLIO_LEGACY_RIBBON_IMAGES[key];
    const storedImages = requiresGalleryMigration && legacy && stored.length === legacy.length && stored.every((image, index) => image === legacy[index]) ? [] : stored;
    merged[key] = [...new Set([
      ...storedImages.filter(image => image && !PORTFOLIO_RETIRED_IMAGE_PATHS.has(image) && !PORTFOLIO_RETIRED_RIBBON_IMAGE_PATHS.has(image)),
      ...DEFAULT_PORTFOLIO[key],
    ])].slice(0, 3);
  }
  for (const key of ["heroImage", "portrait", "philosophyImage", "concertHeroImage", "aboutSupportingImage", "testimonialsImage", "enquiryImage"]) {
    if (PORTFOLIO_RETIRED_IMAGE_PATHS.has(merged[key])) merged[key] = DEFAULT_PORTFOLIO[key];
  }
  for (const key of ["testimonials", "aboutValues", "enquirySteps"]) {
    merged[key] = (Array.isArray(merged[key]) ? merged[key] : DEFAULT_PORTFOLIO[key]).map((item, index) => ({
      ...(DEFAULT_PORTFOLIO[key][index] || {}),
      ...item,
      id: item?.id || `${key}-${index + 1}`,
    }));
  }
  return merged;
}

app.get("/api/site-context", (req, res) => {
  const hostname = String(req.hostname || "").toLowerCase();
  const portfolioHosts = publicSiteHosts();
  const appHosts = String(process.env.APP_HOSTS || "book.zacmclients.photos").split(",").map(v => v.trim().toLowerCase());
  if (portfolioHosts.includes(hostname)) return res.json({ role: "portfolio" });
  if (appHosts.includes(hostname)) return res.json({ role: "platform" });
  const tenant = readTenants().find(t => tenantIsLicensed(t) && String(t.customDomain || "").toLowerCase() === hostname);
  return res.json(tenant ? { role: "tenant-booking", tenantSlug: tenant.slug } : { role: "platform" });
});

app.get("/api/portfolio", (_req, res) => {
  const published = dbGet(readDb(), DB_KEYS.PORTFOLIO_PUBLISHED, DEFAULT_PORTFOLIO);
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  res.json(publicPortfolioContent(published));
});

app.get("/api/admin/portfolio", requireAuth, (_req, res) => {
  const db = readDb();
  const published = dbGet(db, DB_KEYS.PORTFOLIO_PUBLISHED, DEFAULT_PORTFOLIO);
  const draft = dbGet(db, DB_KEYS.PORTFOLIO_DRAFT, published);
  const privateSettings = dbGet(db, DB_KEYS.PORTFOLIO_SETTINGS, {});
  res.json({ draft: { ...publicPortfolioContent(draft), webhookUrl: privateSettings.webhookUrl || "" }, publishedAt: published?.updatedAt });
});

app.put("/api/admin/portfolio/draft", requireAuth, (req, res) => {
  if (!req.body?.draft || typeof req.body.draft !== "object") return res.status(400).json({ error: "draft is required" });
  const db = readDb();
  const draft = req.body.draft;
  const webhookUrl = typeof draft.webhookUrl === "string" ? draft.webhookUrl.trim() : "";
  if (webhookUrl && !/^https:\/\/(?:canary\.|ptb\.)?(?:discord(?:app)?\.com)\/api\/webhooks\//i.test(webhookUrl)) {
    return res.status(400).json({ error: "Webhook must be a Discord webhook URL" });
  }
  db[DB_KEYS.PORTFOLIO_DRAFT] = { ...publicPortfolioContent(draft), updatedAt: new Date().toISOString() };
  db[DB_KEYS.PORTFOLIO_SETTINGS] = { webhookUrl };
  writeDb(db);
  res.json({ ok: true });
});

app.post("/api/admin/portfolio/publish", requireAuth, (_req, res) => {
  const db = readDb();
  const draft = dbGet(db, DB_KEYS.PORTFOLIO_DRAFT, DEFAULT_PORTFOLIO);
  const publishedAt = new Date().toISOString();
  db[DB_KEYS.PORTFOLIO_PUBLISHED] = { ...publicPortfolioContent(draft), updatedAt: publishedAt };
  writeDb(db);
  res.json({ ok: true, publishedAt });
});

const portfolioUpload = multer({
  storage: multer.diskStorage({
    destination: PORTFOLIO_MEDIA_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(5).toString("hex")}${path.extname(file.originalname).toLowerCase() || ".jpg"}`),
  }),
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith("image/") && isSupportedImageFilename(file.originalname)),
});

app.post("/api/admin/portfolio/media", requireAuth, portfolioUpload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a supported image up to 40 MB" });
  res.json({ ok: true, url: `/portfolio-media/${encodeURIComponent(req.file.filename)}` });
});

app.get("/portfolio-media/:filename", (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!isSupportedImageFilename(filename)) return res.status(404).end();
  const target = path.join(PORTFOLIO_MEDIA_DIR, filename);
  if (!fs.existsSync(target)) return res.status(404).end();
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.sendFile(target);
});

app.post("/api/admin/portfolio/webhook/test", requireAuth, async (req, res) => {
  const webhookUrl = String(req.body?.webhookUrl || "").trim();
  if (!/^https:\/\/(?:canary\.|ptb\.)?(?:discord(?:app)?\.com)\/api\/webhooks\//i.test(webhookUrl)) return res.status(400).json({ error: "Enter a valid Discord webhook URL" });
  try {
    await sendDiscordEmbed(webhookUrl, { embeds: [{ title: "Portfolio enquiry webhook connected", description: "New website enquiries will appear here.", color: 0xd0a94a, timestamp: new Date().toISOString() }] });
    res.json({ ok: true });
  } catch (error) {
    res.status(502).json({ error: error?.message || "Webhook test failed" });
  }
});

const portfolioEnquiryLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false, message: { error: "Too many enquiries. Please try again later." } });
async function emailPortfolioEnquiry(recipient, enquiry) {
  const transporter = getTransporter();
  if (!transporter || !recipient) return false;
  const subject = `New website enquiry: ${enquiry.eventTypeTitle} - ${enquiry.name}`.replace(/[\r\n]+/g, " ").slice(0, 200);
  const profile = dbGet(readDb(), DB_KEYS.PROFILE, {});
  const brandName = profile.businessName || profile.brandName || profile.name || "PhotoFlow";
  const adminUrl = `${(process.env.APP_BASE_URL || "https://book.zacmclients.photos").replace(/\/$/, "")}/admin/enquiries`;
  const message = buildAdminAlertEmail({
    title: "New website enquiry",
    intro: `${enquiry.name} submitted an enquiry through the portfolio website.`,
    rows: [
      { label: "Name", value: enquiry.name },
      { label: "Email", value: enquiry.email },
      enquiry.phone ? { label: "Phone", value: enquiry.phone } : null,
      { label: "Session", value: enquiry.eventTypeTitle },
      enquiry.preferredDate ? { label: "Preferred date", value: enquiry.preferredDate } : null,
      enquiry.venue ? { label: "Venue", value: enquiry.venue } : null,
    ].filter(Boolean),
    message: enquiry.message,
    actionUrl: adminUrl,
    actionLabel: "Open enquiries in admin",
    brandName,
  });
  try {
    await transporter.sendMail({
      from: getFromAddress(),
      to: recipient,
      replyTo: enquiry.email,
      subject,
      ...message,
    });
    return true;
  } catch (error) {
    console.error("Portfolio enquiry email failed:", error?.message || error);
    return false;
  }
}

app.post("/api/portfolio/enquiry", portfolioEnquiryLimiter, async (req, res) => {
  const { name, email, phone, eventTypeTitle, preferredDate, venue, referralSource, message, website } = req.body || {};
  if (website) return res.json({ ok: true }); // honeypot
  if (!name || typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "Name is required" });
  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return res.status(400).json({ error: "A valid email is required" });
  if (!message || typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "Tell us a little about the event" });
  const enquiry = {
    id: `enq-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    name: name.trim().slice(0, 120), email: email.trim().slice(0, 200), phone: String(phone || "").trim().slice(0, 50) || undefined,
    eventTypeTitle: String(eventTypeTitle || "Website enquiry").trim().slice(0, 100),
    preferredDate: /^\d{4}-\d{2}-\d{2}$/.test(String(preferredDate || "")) ? preferredDate : undefined,
    message: `${venue ? `Venue / location: ${String(venue).trim().slice(0, 180)}\n` : ""}${referralSource ? `How they found Zac: ${String(referralSource).trim().slice(0, 100)}\n` : ""}${venue || referralSource ? "\n" : ""}${message.trim().slice(0, 3000)}`,
    status: "pending", createdAt: new Date().toISOString(), source: "portfolio",
  };
  const db = readDb();
  const enquiries = dbGet(db, DB_KEYS.ENQUIRIES, []);
  const list = Array.isArray(enquiries) ? enquiries : [];
  list.push(enquiry);
  db[DB_KEYS.ENQUIRIES] = list;
  writeDb(db);
  const portfolioSettings = dbGet(db, DB_KEYS.PORTFOLIO_SETTINGS, {});
  const globalSettings = dbGet(db, DB_KEYS.SETTINGS, {});
  const webhookUrl = portfolioSettings.webhookUrl || globalSettings.discordWebhookUrl;
  let webhookDelivered = false;
  if (webhookUrl) {
    try { await notifyNewEnquiry(webhookUrl, enquiry); webhookDelivered = true; } catch (error) { console.error("Portfolio enquiry webhook failed:", error?.message || error); }
  }
  const publishedPortfolio = dbGet(db, DB_KEYS.PORTFOLIO_PUBLISHED, DEFAULT_PORTFOLIO);
  const enquiryRecipient = String(process.env.PORTFOLIO_ENQUIRY_EMAIL || publishedPortfolio.contactEmail || process.env.EMAIL_SERVER_USER || "").trim();
  const emailDelivered = await emailPortfolioEnquiry(enquiryRecipient, enquiry);
  res.status(201).json({ ok: true, enquiryId: enquiry.id, webhookDelivered, emailDelivered });
});

// Most camera frames in an album share dimensions and watermark settings. Reusing
// the rendered overlay avoids rebuilding the same full-resolution tiled PNG for
// every photo in a bulk download.
const watermarkOverlayCache = new Map();
function getWatermarkOverlayCacheKey(imgWidth, imgHeight, wm) {
  const imageHash = wm.imageBase64
    ? crypto.createHash("sha1").update(wm.imageBase64).digest("hex")
    : "text";
  return `${imgWidth}x${imgHeight}:${wm.text}:${wm.opacity}:${wm.position}:${wm.size}:${imageHash}`;
}

async function getCachedWatermarkOverlay(imgWidth, imgHeight, wm) {
  const key = getWatermarkOverlayCacheKey(imgWidth, imgHeight, wm);
  let pending = watermarkOverlayCache.get(key);
  if (pending) {
    watermarkOverlayCache.delete(key);
    watermarkOverlayCache.set(key, pending);
    return pending;
  }

  pending = buildWatermarkOverlay(imgWidth, imgHeight, wm);
  watermarkOverlayCache.set(key, pending);
  while (watermarkOverlayCache.size > WATERMARK_OVERLAY_CACHE_SIZE) {
    watermarkOverlayCache.delete(watermarkOverlayCache.keys().next().value);
  }
  try {
    return await pending;
  } catch (err) {
    if (watermarkOverlayCache.get(key) === pending) watermarkOverlayCache.delete(key);
    throw err;
  }
}

function isPhotoAccessible(filename, sessionKey, albumId) {
  const access = getPhotoDownloadAccess(filename, sessionKey, albumId);
  return access.accessible && access.clean;
}

function getPhotoDownloadAccess(filename, sessionKey, albumId) {
  try {
    const db = readDb();
    const found = findAlbumById(db, albumId);
    if (!found) return { accessible: false, clean: false, reason: "album-not-found" };
    const album = found.album;

    const photo = album.photos?.find(p => {
      const url = p.url || p.src || "";
      const urlBasename = url.split("?")[0].split("/").pop() || "";
      return urlBasename === filename;
    });
    if (!photo) return { accessible: false, clean: false, reason: "photo-not-found" };
    if (!uploadMatchesAlbumScope(db, filename, found.tenantSlug)) {
      return { accessible: false, clean: false, reason: "upload-scope-mismatch", photoId: photo.id };
    }
    const purchase = album.sessionPurchases?.[sessionKey];
    if (purchase?.source === "share-link") {
      const shareAccess = galleryShareLinkAccess(album, purchase.shareLinkId, Date.now(), galleryTimezone(db, found.tenantSlug));
      if (!shareAccess.active || !shareAccess.allowDownload) {
        return { accessible: false, clean: false, reason: "share-link-revoked", photoId: photo.id };
      }
    }
    const sessionData = db[`wv_session_${sessionKey}_${albumId}`];
    const sessionParsed = typeof sessionData === "string" ? JSON.parse(sessionData) : sessionData;
    return galleryPhotoDownloadEntitlement({
      album,
      photo,
      sessionKey,
      unlockedPhotoIds: Array.isArray(sessionParsed?.unlockedPhotoIds) ? sessionParsed.unlockedPhotoIds : [],
      timeZone: galleryTimezone(db, found.tenantSlug),
    });
  } catch {
    return { accessible: false, clean: false, reason: "access-error" };
  }
}

/** Atomically persist any new free entitlements before issuing bytes/jobs. */
function claimFreePhotoDownloads(albumId, sessionKey, requestedPhotoIds) {
  try {
    const db = readDb();
    const found = findAlbumById(db, albumId);
    if (!found) return { ok: false, status: 404, error: "Album not found" };
    const storeKey = found.tenantSlug ? `t_${found.tenantSlug}_wv_albums` : DB_KEYS.ALBUMS;
    const albums = getStoredArray(db, storeKey);
    const albumIndex = albums.findIndex(album => album.id === found.album.id);
    if (albumIndex < 0) return { ok: false, status: 409, error: "Album store is inconsistent" };
    const album = albums[albumIndex];
    const requested = [...new Set((Array.isArray(requestedPhotoIds) ? requestedPhotoIds : []).map(String).filter(Boolean))];
    const deliverableIds = new Set(deliverableAlbumPhotos(album).map(photo => String(photo.id)));
    if (!requested.length || requested.some(id => !deliverableIds.has(id))) {
      return { ok: false, status: 400, error: "One or more photos are unavailable" };
    }
    const sessionStoreKey = `wv_session_${sessionKey}_${album.id}`;
    const sessionData = dbGet(db, sessionStoreKey, {});
    const alreadyClaimedPhotoIds = Array.isArray(sessionData?.unlockedPhotoIds) ? sessionData.unlockedPhotoIds : [];
    const nonQuotaPhotoIds = requested.filter(id => hasNonQuotaPhotoEntitlement(album, id, sessionKey));
    const quota = Number.isFinite(Number(album.freeDownloads)) ? Number(album.freeDownloads) : 5;
    const claim = planFreePhotoClaims({
      requestedPhotoIds: requested,
      alreadyClaimedPhotoIds,
      nonQuotaPhotoIds,
      quota,
      used: album.usedFreeDownloads?.[sessionKey] || 0,
    });
    if (!claim.ok) return { ok: false, status: 403, error: claim.error, ...claim };
    if (claim.newlyClaimedPhotoIds.length) {
      db[sessionStoreKey] = {
        ...(sessionData && typeof sessionData === "object" ? sessionData : {}),
        unlockedPhotoIds: claim.claimedPhotoIds,
        updatedAt: new Date().toISOString(),
      };
      album.usedFreeDownloads = { ...(album.usedFreeDownloads || {}), [sessionKey]: claim.used };
      albums[albumIndex] = album;
      db[storeKey] = JSON.stringify(albums);
      writeDb(db);
    }
    return { ok: true, ...claim, album };
  } catch (error) {
    console.error("Failed to claim free photo entitlements:", error?.message || error);
    return { ok: false, status: 500, error: "Unable to reserve download entitlement" };
  }
}

/** Generate (or load from cache) a watermarked full-res buffer for a file. */
async function getWatermarkedBuffer(safeName, filepath) {
  const baseName = path.basename(safeName, path.extname(safeName));
  const cacheFile = path.join(CACHE_DIR, getCacheFilename(baseName, "full", true));

  if (fs.existsSync(cacheFile)) {
    return fs.readFileSync(cacheFile);
  }

  const origMeta = await sharp(filepath).metadata();
  const origW = origMeta.width || 800;
  const origH = origMeta.height || 600;
  const wm = getWatermarkSettings();
  const overlay = await buildWatermarkOverlay(origW, origH, wm);
  const result = await sharp(filepath)
    .composite([overlay])
    .jpeg({ quality: 82, progressive: true })
    .toBuffer();
  try { fs.writeFileSync(cacheFile, result); } catch {}
  return result;
}

/** Create a streaming watermarked JPEG for ZIP downloads without buffering full albums in memory. */
async function getWatermarkedZipStream(filepath) {
  const origMeta = await sharp(filepath).metadata();
  const origW = origMeta.width || 800;
  const origH = origMeta.height || 600;
  const wm = getWatermarkSettings();
  const overlay = await getCachedWatermarkOverlay(origW, origH, wm);
  return sharp(filepath)
    .composite([overlay])
    .jpeg({ quality: 82, progressive: true });
}

/** Return a cached watermarked full-res file path for ZIP packaging. */
const watermarkedZipRenders = new Map();
async function getWatermarkedZipFilePath(safeName, filepath, tenantSlug = null) {
  const baseName = path.basename(safeName, path.extname(safeName));
  const cacheFile = path.join(CACHE_DIR, getCacheFilename(baseName, "full", true, tenantSlug));
  if (fs.existsSync(cacheFile)) return cacheFile;

  const existingRender = watermarkedZipRenders.get(cacheFile);
  if (existingRender) return existingRender;

  const render = (async () => {
    const tmpFile = path.join(ZIP_JOBS_DIR, `${baseName}_full_wm_${crypto.randomBytes(6).toString("hex")}.tmp`);
    try {
      const origMeta = await sharp(filepath).metadata();
      const origW = origMeta.width || 800;
      const origH = origMeta.height || 600;
      const wm = getWatermarkSettings(tenantSlug);
      const overlay = await getCachedWatermarkOverlay(origW, origH, wm);
      await sharp(filepath, { sequentialRead: true })
        .composite([overlay])
        .jpeg({ quality: 82 })
        .toFile(tmpFile);
      fs.renameSync(tmpFile, cacheFile);
      return cacheFile;
    } catch (err) {
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
      throw err;
    }
  })();
  watermarkedZipRenders.set(cacheFile, render);
  try {
    return await render;
  } finally {
    if (watermarkedZipRenders.get(cacheFile) === render) watermarkedZipRenders.delete(cacheFile);
  }
}

const sizedZipRenders = new Map();
async function getSizedZipFilePath(safeName, filepath, clean, tenantSlug, quality) {
  const settings = ZIP_QUALITY_SETTINGS[quality];
  if (!settings) return clean ? filepath : getWatermarkedZipFilePath(safeName, filepath, tenantSlug);

  const baseName = path.basename(safeName, path.extname(safeName));
  const cacheFile = path.join(CACHE_DIR, getCacheFilename(baseName, `zip_${quality}`, !clean, tenantSlug));
  if (fs.existsSync(cacheFile)) return cacheFile;
  const existingRender = sizedZipRenders.get(cacheFile);
  if (existingRender) return existingRender;

  const render = (async () => {
    const tmpFile = path.join(ZIP_JOBS_DIR, `${baseName}_zip_${quality}_${crypto.randomBytes(6).toString("hex")}.tmp`);
    try {
      const origMeta = await sharp(filepath).metadata();
      const origW = origMeta.width || settings.width;
      const origH = origMeta.height || Math.round(settings.width * 0.75);
      const renderW = Math.min(origW, settings.width);
      const renderH = Math.round(origH * (renderW / origW));
      let pipeline = sharp(filepath, { sequentialRead: true })
        .resize(settings.width, null, { withoutEnlargement: true });
      if (!clean) {
        const wm = getWatermarkSettings(tenantSlug);
        const overlay = await getCachedWatermarkOverlay(renderW, renderH, wm);
        pipeline = pipeline.composite([overlay]);
      }
      await pipeline.jpeg({ quality: settings.jpegQuality }).toFile(tmpFile);
      fs.renameSync(tmpFile, cacheFile);
      return cacheFile;
    } catch (err) {
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
      throw err;
    }
  })();
  sizedZipRenders.set(cacheFile, render);
  try {
    return await render;
  } finally {
    if (sizedZipRenders.get(cacheFile) === render) sizedZipRenders.delete(cacheFile);
  }
}

// ── Serve watermarked / resized photo ────────────────────────
// Supports:
//   ?size=thumb   → resize to 700 px wide (for gallery grids)
//   ?size=medium  → resize to 1400 px wide (for lightbox)
//   ?wm=0         → legacy hint only; clean access still requires entitlement
// Resized variants are cached in _cache/ for fast re-delivery.
// Run POST /api/cache/clear after changing watermark settings.

const THUMB_WIDTH = 700;
const MEDIUM_WIDTH = 1400;

function getCacheFilename(baseName, sizeLabel, watermarked, tenantSlug) {
  const tenantPart = tenantSlug ? `_t_${tenantSlug}` : "";
  return `${baseName}_${sizeLabel}${tenantPart}_${watermarked ? "wm" : "clean"}.jpg`;
}

// Rate-limit the image endpoint: generous limit per IP to guard against DoS
// while allowing normal gallery browsing (600 requests / 60 s ≈ 10 images/s)
const imageServeLimiter = rateLimit({
  windowMs: 60_000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many image requests — please slow down" },
});

app.get("/uploads/:filename", imageServeLimiter, async (req, res) => {
  const safeName = path.basename(req.params.filename);
  const filepath = path.join(UPLOADS_DIR, safeName);

  if (isIgnoredSystemFileName(safeName) || !isSupportedImageFilename(safeName)) {
    return res.status(404).send("Not found");
  }

  if (!fs.existsSync(filepath)) return res.status(404).send("Not found");

  // Guard against symlink-based path traversal: resolve the real path and confirm
  // it still starts with UPLOADS_DIR.  This prevents a malicious symlink inside the
  // uploads folder from being used to read arbitrary files outside of it.
  try {
    const realFilepath = fs.realpathSync(filepath);
    const realUploadsDir = fs.realpathSync(UPLOADS_DIR);
    if (!realFilepath.startsWith(realUploadsDir + path.sep) && realFilepath !== realUploadsDir) {
      return res.status(403).send("Forbidden");
    }
  } catch {
    return res.status(404).send("Not found");
  }

  const requestedSize = req.query.size === "thumb" || req.query.size === "medium" ? req.query.size : null;
  const ownershipDb = readDb();
  const ownerScope = resolveUploadOwnerScope(dbGet(ownershipDb, "wv_upload_owners", {})?.[safeName], uploadReferenceKeys(ownershipDb, safeName));
  if (!ownerScope.ok) return res.status(409).send("Upload ownership is ambiguous");
  const suppliedTenant = typeof req.query.tenant === "string" && req.query.tenant.trim() ? req.query.tenant.trim() : null;
  if (suppliedTenant !== null && suppliedTenant !== ownerScope.tenantSlug) return res.status(403).send("Tenant scope does not match this upload");
  const tenantSlug = ownerScope.tenantSlug;
  if (tenantSlug && !licensedTenantBySlug(tenantSlug)) return res.status(404).send("Not found");

  // Check paid access via query params
  if (req.query.sessionKey) return res.status(400).send("Session credentials are not accepted in URLs");
  const { albumId, paid } = req.query;
  const albumMatch = albumId ? findAlbumById(readDb(), albumId) : null;
  const gallerySession = albumMatch ? getGallerySessionForAlbum(req, albumMatch.album) : null;
  let hasAccess = paid === "1" && gallerySession && gallerySession.tenantSlug === albumMatch.tenantSlug
    ? isPhotoAccessible(safeName, gallerySession.sessionKey, albumId)
    : false;

  let authenticatedOwner = false;
  if (req.query.wm === "0") {
    authenticatedOwner = await authenticateAdmin(req);
    if (!authenticatedOwner && ownerScope.tenantSlug) {
      const tenantSession = getTenantSession(req);
      const tenant = tenantSession ? licensedTenantBySlug(ownerScope.tenantSlug)?.tenant : null;
      authenticatedOwner = !!tenant && tenantSession.sub === ownerScope.tenantSlug && tenantSession.cv === credentialVersion(tenant.passwordHash);
    }
    if (authenticatedOwner) hasAccess = true;
  }

  // Anonymous/gallery image URLs are previews, never full-resolution download
  // endpoints. Owners can still request their clean original with wm=0.
  const previewVariant = uploadPreviewVariant(requestedSize, authenticatedOwner);
  const targetWidth = previewVariant.targetWidth;

  // A bare `wm=0` is not an entitlement. Clean delivery requires the same
  // album/session check as the protected original endpoint.
  const shouldWatermark = !hasAccess;

  // Fast path: no resize, no watermark → serve original file directly
  if (!targetWidth && !shouldWatermark) {
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const stat = fs.statSync(filepath);
      // Honour conditional GET so repeat requests return 304
      if (req.headers["if-modified-since"] && new Date(req.headers["if-modified-since"]) >= stat.mtime) {
        return res.status(304).end();
      }
      res.set({
        "Cache-Control": "private, no-store",
        "Last-Modified": stat.mtime.toUTCString(),
        "X-Watermarked": "false",
      });
    } catch { /* non-critical — still serve the file */ }
    return res.sendFile(filepath);
  }

  // ── File-based cache ────────────────────────────────────────
  const cacheDir = CACHE_DIR;
  const baseName = path.basename(safeName, path.extname(safeName));
  const sizeLabel = previewVariant.sizeLabel;
  // Include tenantSlug in cache filename so each tenant gets their own cached variant
  const cacheFile = resolveContainedPath(cacheDir, getCacheFilename(baseName, sizeLabel, shouldWatermark, tenantSlug));
  if (!cacheFile) return res.status(409).send("Invalid cache scope");

  try {
    if (fs.existsSync(cacheFile)) {
      const stat = fs.statSync(cacheFile);
      const lastModified = stat.mtime.toUTCString();

      // Honour conditional GET — avoid re-sending unchanged bytes (RFC 7232: 304 if not modified since)
      if (req.headers["if-modified-since"] && new Date(req.headers["if-modified-since"]) >= stat.mtime) {
        return res.status(304).end();
      }

      res.set({
        "Content-Type": "image/jpeg",
        "Cache-Control": hasAccess ? "private, no-store" : "public, max-age=86400",
        "Last-Modified": lastModified,
        "X-Watermarked": shouldWatermark ? "true" : "false",
        "X-Cache": "HIT",
      });
      return res.sendFile(cacheFile);
    }
  } catch { /* cache miss — compute below */ }

  // ── Compute image ───────────────────────────────────────────
  try {
    // Get original dimensions (needed for watermark overlay sizing)
    const origMeta = await sharp(filepath).metadata();
    const origW = origMeta.width || 800;
    const origH = origMeta.height || 600;

    // Compute post-resize dimensions for watermark overlay
    let renderW = origW;
    let renderH = origH;
    if (targetWidth && origW > targetWidth) {
      renderW = targetWidth;
      renderH = Math.round(origH * (targetWidth / origW));
    }

    // Build watermark overlay (if needed) using the post-resize canvas size
    const composites = [];
    if (shouldWatermark) {
      const wm = getWatermarkSettings(tenantSlug);
      const overlay = await buildWatermarkOverlay(renderW, renderH, wm);
      composites.push(overlay);
    }

    // Build Sharp pipeline: optionally resize, then composite
    let pipeline = sharp(filepath);
    if (targetWidth && origW > targetWidth) {
      pipeline = pipeline.resize(targetWidth, null, { withoutEnlargement: true });
    }
    if (composites.length > 0) {
      pipeline = pipeline.composite(composites);
    }

    const result = await pipeline.jpeg({ quality: 82, progressive: true }).toBuffer();

    // Persist to cache
    let lastModified = new Date().toUTCString();
    try {
      fs.writeFileSync(cacheFile, result);
      lastModified = fs.statSync(cacheFile).mtime.toUTCString();
    } catch { /* non-critical */ }

    res.set({
      "Content-Type": "image/jpeg",
      "Cache-Control": hasAccess ? "private, no-store" : "public, max-age=86400",
      "Last-Modified": lastModified,
      "X-Watermarked": shouldWatermark ? "true" : "false",
      "X-Cache": "MISS",
    });
    return res.send(result);
  } catch (err) {
    console.error("Image processing error for", safeName, err.message);
    // Never leak the clean original when a protected render fails.
    if (shouldWatermark) return res.status(500).send("Image preview unavailable");
    return res.sendFile(filepath);
  }
});

// ── Serve original photo (paid, requires valid session) ──
app.get("/api/photo/:filename/original", async (req, res) => {
  // Strip any query-string that may have been incorporated into the filename (e.g. "photo.jpg?tenant=slug")
  const safeName = path.basename(req.params.filename.split("?")[0]);
  const filepath = path.join(UPLOADS_DIR, safeName);
  if (isIgnoredSystemFileName(safeName) || !isSupportedImageFilename(safeName)) {
    return res.status(404).send("Not found");
  }
  if (!fs.existsSync(filepath)) return res.status(404).send("Not found");

  // Guard against symlink-based path traversal
  try {
    const realFilepath = fs.realpathSync(filepath);
    const realUploadsDir = fs.realpathSync(UPLOADS_DIR);
    if (!realFilepath.startsWith(realUploadsDir + path.sep) && realFilepath !== realUploadsDir) {
      return res.status(403).send("Forbidden");
    }
  } catch {
    return res.status(404).send("Not found");
  }

  if (req.query.sessionKey) return res.status(400).send("Session credentials are not accepted in URLs");
  const { albumId } = req.query;
  const albumMatch = albumId ? findAlbumById(readDb(), albumId) : null;
  const gallerySession = albumMatch ? getGallerySessionForAlbum(req, albumMatch.album) : null;
  if (!gallerySession || gallerySession.tenantSlug !== albumMatch.tenantSlug) return res.status(403).send("Forbidden");
  const sessionKey = gallerySession.sessionKey;

  const access = getPhotoDownloadAccess(safeName, sessionKey, albumId);
  if (!access.accessible || !access.clean) {
    return res.status(["gallery-expired", "downloads-expired"].includes(access.reason) ? 410 : 403).send("Forbidden");
  }

  {
    const albumMatch = findAlbumById(readDb(), albumId);
    const policy = normalizeDownloadEmailPolicy(albumMatch?.album?.downloadEmailCapture);
    if (policy === "required") {
      const captureId = typeof req.query.downloadEmailCaptureId === "string"
        ? req.query.downloadEmailCaptureId.slice(0, 120)
        : "";
      const validCapture = captureId && readDownloadEmailCaptures().some(record =>
        record.id === captureId
        && recordMatchesRequest(record, albumId, sessionKey, DOWNLOAD_CAPTURE_SECRET)
      );
      if (!validCapture) {
        return res.status(428).json({
          error: "Email address required before downloading this gallery",
          code: "DOWNLOAD_EMAIL_REQUIRED",
          policy,
        });
      }
    }
  }

  const claim = claimFreePhotoDownloads(albumId, sessionKey, [access.photoId]);
  if (!claim.ok) return res.status(claim.status || 403).json({ error: claim.error });

  res.setHeader("Cache-Control", "private, no-store");
  res.sendFile(filepath);
});

app.post("/api/photo/:filename/original/access", imageServeLimiter, async (req, res) => {
  const safeName = path.basename(String(req.params.filename || "").split("?")[0]);
  const filepath = path.join(UPLOADS_DIR, safeName);
  if (isIgnoredSystemFileName(safeName) || !isSupportedImageFilename(safeName) || !fs.existsSync(filepath)) return res.status(404).send("Not found");
  try {
    const realFilepath = fs.realpathSync(filepath);
    const realUploadsDir = fs.realpathSync(UPLOADS_DIR);
    if (!realFilepath.startsWith(realUploadsDir + path.sep)) return res.status(403).send("Forbidden");
  } catch { return res.status(404).send("Not found"); }
  const albumId = String(req.body?.albumId || "");
  const albumMatch = findAlbumById(readDb(), albumId);
  const gallerySession = albumMatch ? getGallerySessionForAlbum(req, albumMatch.album) : null;
  if (!gallerySession || gallerySession.tenantSlug !== albumMatch.tenantSlug) return res.status(403).send("Forbidden");
  const access = getPhotoDownloadAccess(safeName, gallerySession.sessionKey, albumId);
  if (!access.accessible) return res.status(["gallery-expired", "downloads-expired"].includes(access.reason) ? 410 : 403).send("Forbidden");
  if (normalizeDownloadEmailPolicy(albumMatch.album.downloadEmailCapture) === "required") {
    const captureId = String(req.body?.downloadEmailCaptureId || "").slice(0, 120);
    const validCapture = captureId && readDownloadEmailCaptures().some(record => record.id === captureId && recordMatchesRequest(record, albumId, gallerySession.sessionKey, DOWNLOAD_CAPTURE_SECRET));
    if (!validCapture) return res.status(428).json({ error: "Email address required before downloading this gallery", code: "DOWNLOAD_EMAIL_REQUIRED" });
  }
  const claim = claimFreePhotoDownloads(albumId, gallerySession.sessionKey, [access.photoId]);
  if (!claim.ok) return res.status(claim.status || 403).json({ error: claim.error });
  res.setHeader("Cache-Control", "private, no-store");
  if (access.clean) return res.sendFile(filepath);
  try {
    const watermarkedPath = await getWatermarkedZipFilePath(safeName, filepath, albumMatch.tenantSlug);
    return res.sendFile(watermarkedPath);
  } catch (error) {
    console.error(`Protected watermarked download failed for ${safeName}:`, error?.message || error);
    return res.status(500).json({ error: "Unable to prepare the protected download" });
  }
});

// (Legacy processPhotoForAI / processPhotoAI helpers removed — logic now inline in the GET endpoint below)

const aiEnhanceLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many enhancement requests — please wait" } });
// ── Photo edit param helpers ───────────────────────────────────────────────────

// Parse a preset name into a canonical edit-params object.
// All values use the same scale as the manual sliders below.
function presetToEditParams(preset) {
  const presets = {
    // Live-event defaults: conservative enough for batches of camera JPEGs.
    natural:     { exposure: 3,  highlights: -18, shadows: 12, contrast: 8,  vibrance: 10, saturation: 0,  warmth: 3,   clarity: 8,  denoise: 5,  sharpness: 48 },
    indoor:      { exposure: 8,  highlights: -25, shadows: 24, contrast: 5,  vibrance: 8,  saturation: -3, warmth: -4,  clarity: 5,  denoise: 30, sharpness: 42 },
    concert:     { exposure: 2,  highlights: -38, shadows: 8,  contrast: 24, vibrance: 18, saturation: 5,  warmth: -8,  clarity: 18, denoise: 22, sharpness: 55 },
    sports:      { exposure: 4,  highlights: -22, shadows: 14, contrast: 18, vibrance: 18, saturation: 3,  warmth: 0,   clarity: 22, denoise: 10, sharpness: 68 },
    // Moody: darker, high contrast, desaturated, cool
    moody:      { exposure: -10, highlights: -25, shadows: 10, contrast: 35, vibrance: -15, saturation: -10, warmth: -15, clarity: 20, denoise: 0, sharpness: 80 },
    // Bright & Airy: lifted, low contrast, warm, pastel
    bright:     { exposure: 20,  highlights: -10, shadows: 30, contrast: -20, vibrance: 25, saturation: 5,  warmth: 20,  clarity: -10, denoise: 5, sharpness: 40 },
    // Film: faded blacks, warm, slight grain
    film:       { exposure: 5,   highlights: -15, shadows: 25, contrast: 10, vibrance: 15, saturation: -5,  warmth: 25,  clarity: 5,  denoise: 0, sharpness: 50 },
    // Black & white: desaturate fully, boost contrast + clarity
    bw:         { exposure: 0,   highlights: -10, shadows: 5,  contrast: 30, vibrance: -100, saturation: -100, warmth: 0, clarity: 30, denoise: 0, sharpness: 70 },
    // Faded/matte: lifted blacks, low sat, slight warm
    fade:       { exposure: 10,  highlights: -20, shadows: 35, contrast: -30, vibrance: -10, saturation: -20, warmth: 10, clarity: -5, denoise: 5, sharpness: 30 },
    // Pop: vivid, punchy, saturated
    pop:        { exposure: 5,   highlights: -5,  shadows: 5,  contrast: 25, vibrance: 40, saturation: 25,  warmth: 5,   clarity: 25, denoise: 0, sharpness: 90 },
    // Golden hour: warm orange tones, lifted shadows
    golden:     { exposure: 8,   highlights: -10, shadows: 20, contrast: 15, vibrance: 20, saturation: 10,  warmth: 45,  clarity: 10, denoise: 0, sharpness: 50 },
    // Cool / blue-toned
    cool:       { exposure: 0,   highlights: -10, shadows: 10, contrast: 20, vibrance: 10, saturation: 0,   warmth: -35, clarity: 15, denoise: 0, sharpness: 60 },
  };
  return presets[preset] || null;
}

// Parse a natural language prompt into edit params.
// Maps common photography keywords to reasonable slider positions.
function promptToEditParams(prompt) {
  const p = prompt.toLowerCase();
  const params = { exposure: 0, highlights: 0, shadows: 0, contrast: 0, vibrance: 0, saturation: 0, warmth: 0, clarity: 0, denoise: 0, sharpness: 60 };

  // Exposure / brightness
  if (/brighter|lighten|brighten|overexposed fix/.test(p))   params.exposure  += 20;
  if (/darker|darken|moodier|underexposed fix/.test(p))      params.exposure  -= 15;
  if (/very bright|much brighter/.test(p))                   params.exposure  += 35;

  // Highlights
  if (/recover highlight|pull highlight|blow/.test(p))       params.highlights -= 30;
  if (/lift highlight|bright sky/.test(p))                   params.highlights += 20;

  // Shadows
  if (/lift shadow|open shadow|fill shadow|dark area/.test(p)) params.shadows += 30;
  if (/crush shadow|deep shadow/.test(p))                    params.shadows   -= 20;

  // Contrast
  if (/more contrast|punchy|punchier|pop/.test(p))           params.contrast  += 30;
  if (/less contrast|softer|flat|matte/.test(p))             params.contrast  -= 25;
  if (/low contrast/.test(p))                                params.contrast  -= 35;

  // Saturation / vibrance / color
  if (/more color|vivid|vibrant|saturate/.test(p))           params.vibrance  += 35;
  if (/less color|muted|desaturate/.test(p))                 params.saturation -= 30;
  if (/black.and.white|b&w|bw|monochrome|grayscale/.test(p)) { params.saturation = -100; params.vibrance = -100; }
  if (/pastel/.test(p))                                      { params.saturation -= 20; params.vibrance -= 10; }

  // Warmth / temperature
  if (/warmer|warm|golden|orange|sunset|cozy/.test(p))       params.warmth    += 30;
  if (/cooler|cool|blue|cold|overcast/.test(p))              params.warmth    -= 30;

  // Clarity / texture
  if (/clarity|texture|detail|crisp/.test(p))                params.clarity   += 25;
  if (/smooth|soft skin|dreamy/.test(p))                     params.clarity   -= 20;

  // Denoise
  if (/denoise|reduce noise|clean|grain/.test(p))            params.denoise   += 60;

  // Sharpness
  if (/sharpen|sharp|crisp/.test(p))                         params.sharpness += 30;
  if (/softer|soft|blur|hazy/.test(p))                       params.sharpness -= 30;

  // Preset-like keywords
  if (/moody|cinematic|dark/.test(p))        Object.assign(params, { exposure: -10, highlights: -20, shadows: 10, contrast: 30, warmth: -10, clarity: 15, saturation: -10 });
  if (/bright.airy|airy|fresh/.test(p))      Object.assign(params, { exposure: 20, shadows: 25, contrast: -20, vibrance: 20, warmth: 15, clarity: -10 });
  if (/film|analogue|analog|vintage/.test(p)) Object.assign(params, { exposure: 5, shadows: 20, contrast: 10, warmth: 20, saturation: -5, clarity: 5 });

  return params;
}

// Apply an edit-params object to a Sharp pipeline and return the processed pipeline.
// params: { exposure, highlights, shadows, contrast, vibrance, saturation, warmth, clarity, denoise, sharpness }
// All values are in a -100…+100 range (or 0–100 for denoise/sharpness).
async function applyEditParams(filepath, params, outputPath) {
  const { exposure=0, highlights=0, shadows=0, contrast=0,
          vibrance=0, saturation=0, warmth=0, clarity=0,
          denoise=0, sharpness=60 } = params;

  // ── Translate human-scale params into Sharp operation values ──────────────

  // Brightness factor: exposure ±100 maps to ×0.5…×2.0
  const brightnessFactor = Math.max(0.3, 1 + (exposure / 100) * 0.8);

  // Saturation multiplier: saturation ±100 maps to 0…2.5, vibrance adds on top
  // vibrance is a gentler version (boosts muted colours more than already-vivid ones)
  const satFactor = Math.max(0, 1 + (saturation / 100) * 1.2 + (vibrance / 100) * 0.6);

  // Temperature approximation: adjust red/blue channel gains without rotating
  // every hue (which made skin and coloured stage lights shift unnaturally).
  const warmthAmount = Math.max(-1, Math.min(1, warmth / 100));
  const redGain = 1 + warmthAmount * 0.11;
  const blueGain = 1 - warmthAmount * 0.11;

  // Contrast: linear gain + offset. contrast ±100 → gain 0.5…1.8
  const contrastGain = Math.max(0.3, 1 + (contrast / 100) * 0.6);
  const contrastOffset = -(contrastGain - 1) * 60;

  // Highlights and shadows via gamma-like curves approximated with linear
  // Sharp doesn't have direct HL/shadow controls — we approximate with a
  // sequential lighten-only / darken-only linear op:
  //   highlights < 0 → compress highlights (darken top end)
  //   shadows > 0 → lift shadows (raise black floor)
  const recoverHighlights = Math.max(0, -highlights / 100);
  const liftHighlights = Math.max(0, highlights / 100);
  const liftShadows = Math.max(0, shadows / 100);
  const crushShadows = Math.max(0, -shadows / 100);
  const toneGain = Math.max(0.65, 1 - recoverHighlights * 0.18 + liftHighlights * 0.08 + crushShadows * 0.08);
  const toneOffset = recoverHighlights * 8 + liftShadows * 20 - crushShadows * 8;

  // Clarity ≈ unsharp mask (positive = local contrast boost, negative = blur)
  const clarityAmount = clarity / 100;  // -1…1

  // Denoise via median blur approximation (only if > 0)
  const denoiseLevel = Math.max(0, Math.min(100, denoise));

  // Sharpness
  const sharpSigma = 0.8;
  const sharpAmount = Math.max(0, sharpness / 100) * 2.5;

  // ── Build the Sharp pipeline ──────────────────────────────────────────────
  // Auto-orient from EXIF before editing so portrait JPEGs stay upright after
  // metadata is rewritten.
  let pipeline = sharp(filepath).rotate();

  // 1. Modulate (brightness, saturation, hue)
  pipeline = pipeline.modulate({ brightness: brightnessFactor, saturation: Math.max(0.01, satFactor) });

  // 1b. Warm/cool channel balance.
  if (Math.abs(warmthAmount) > 0.01) {
    pipeline = pipeline.recomb([
      [redGain, 0, 0],
      [0, 1, 0],
      [0, 0, blueGain],
    ]);
  }

  // 2. Global contrast
  pipeline = pipeline.linear(contrastGain, contrastOffset);

  // 3. A single bounded tone pass avoids compounding global linear operations.
  if (Math.abs(highlights) > 2 || Math.abs(shadows) > 2) pipeline = pipeline.linear(toneGain, toneOffset);

  // 4. Clarity — positive = local contrast (CLAHE), negative = gentle blur
  if (clarityAmount > 0.05) {
    pipeline = pipeline.clahe({ width: 32, height: 32, maxSlope: Math.max(1, 3 * clarityAmount) });
  } else if (clarityAmount < -0.05) {
    pipeline = pipeline.blur(Math.abs(clarityAmount) * 2.5);
  }

  // 5. Denoise — median blur if requested
  if (denoiseLevel > 10) {
    pipeline = pipeline.median(denoiseLevel > 60 ? 5 : 3);
  }

  // 6. Sharpen
  if (sharpAmount > 0.05) {
    pipeline = pipeline.sharpen({ sigma: sharpSigma, m1: sharpAmount * 0.5, m2: sharpAmount });
  }

  await pipeline
    .withMetadata({ orientation: 1 })
    .jpeg({ quality: 91, progressive: true, chromaSubsampling: "4:4:4" })
    .toFile(outputPath);
}

// ── XMP preset store ──────────────────────────────────────────────────────────
// Uploaded XMP presets are stored as JSON in _cache/xmp-presets.json
const XMP_PRESETS_FILE = path.join(CACHE_DIR, "xmp-presets.json");

function loadXmpPresets() {
  try { return JSON.parse(fs.readFileSync(XMP_PRESETS_FILE, "utf8")); } catch { return {}; }
}
function saveXmpPresets(presets) {
  try { fs.writeFileSync(XMP_PRESETS_FILE, JSON.stringify(presets, null, 2)); } catch {}
}

// Parse an XMP file buffer into our edit-params format.
// Handles both global CRS attributes and MaskGroupBasedCorrections (approximated globally).
function parseXmpToEditParams(xmlText) {
  // Helper: extract a CRS attribute value by name
  const getAttr = (name) => {
    const m = xmlText.match(new RegExp(`crs:${name}="([^"]*)"`, "i"));
    return m ? parseFloat(m[1]) : null;
  };
  const getStrAttr = (name) => {
    const m = xmlText.match(new RegExp(`crs:${name}="([^"]*)"`, "i"));
    return m ? m[1] : null;
  };

  // Extract preset name from RDF Alt
  const nameMatch = xmlText.match(/<crs:Name>[\s\S]*?x-default[^>]*>([^<]+)<\/rdf:li>/i);
  const presetName = nameMatch ? nameMatch[1].trim() : "Imported Preset";

  // ── Global CRS parameters (standard LR develop settings) ─────────────────
  // These map 1:1 to our edit-params with appropriate scaling.
  // Lightroom scale: exposure ±5 (stops), we use ±100
  const lrToExp   = (v) => v != null ? Math.round(v * 20) : 0;   // LR ±5 → ours ±100
  const lrToTone  = (v) => v != null ? Math.round(v * 100) : 0;  // LR 0…1 → ours 0…100
  const lrToSigned= (v) => v != null ? Math.round(v * 100) : 0;  // LR -1…1 → ours -100…100

  // Temperature: LR range ~2000–50000K, neutral ~5000K. We use warmth -100…+100
  const lrTempToWarmth = (v) => {
    if (v == null) return 0;
    // Relative to neutral 5500K: positive = warmer, negative = cooler
    const delta = v - 5500;
    return Math.max(-100, Math.min(100, Math.round(delta / 45)));
  };
  const lrTintToWarmth = (v) => v != null ? Math.round(v / 1.5) : 0; // tint ±150 → ours ±100

  const globalExposure   = lrToExp(getAttr("Exposure2012") ?? getAttr("Exposure"));
  const globalHighlights = lrToSigned(getAttr("Highlights2012") ?? getAttr("Highlights"));
  const globalShadows    = lrToSigned(getAttr("Shadows2012") ?? getAttr("Shadows"));
  const globalContrast   = lrToSigned(getAttr("Contrast2012") ?? getAttr("Contrast"));
  const globalWhites     = lrToSigned(getAttr("Whites2012"));
  const globalBlacks     = lrToSigned(getAttr("Blacks2012"));
  const globalClarity    = lrToSigned(getAttr("Clarity2012") ?? getAttr("Clarity"));
  const globalVibrance   = lrToSigned(getAttr("Vibrance"));
  const globalSaturation = lrToSigned(getAttr("Saturation"));
  const globalSharpness  = lrToTone(getAttr("Sharpness")) ?? 60;
  const globalDenoise    = lrToTone(getAttr("LuminanceSmoothing") ?? getAttr("LuminanceNoiseReductionDetail"));
  const globalTemp       = lrTempToWarmth(getAttr("Temperature"));
  const globalTint       = lrTintToWarmth(getAttr("Tint"));

  // Combine whites/blacks into exposure adjustment (they shift the tone curve ends)
  const effectiveExposure = Math.round(globalExposure + globalWhites * 0.3 - globalBlacks * 0.2);
  const effectiveWarmth   = Math.round(globalTemp + globalTint * 0.3);

  // ── Masked corrections (global approximations) ─────────────────────────────
  // Extract all LocalX values from MaskGroupBasedCorrections and average them.
  const localExps    = [...xmlText.matchAll(/crs:LocalExposure2012="([^"]+)"/g)].map(m => parseFloat(m[1]));
  const localConts   = [...xmlText.matchAll(/crs:LocalContrast2012="([^"]+)"/g)].map(m => parseFloat(m[1]));
  const localSats    = [...xmlText.matchAll(/crs:LocalSaturation="([^"]+)"/g)].map(m => parseFloat(m[1]));
  const localClars   = [...xmlText.matchAll(/crs:LocalClarity2012="([^"]+)"/g)].map(m => parseFloat(m[1]));
  const localTexts   = [...xmlText.matchAll(/crs:LocalTexture="([^"]+)"/g)].map(m => parseFloat(m[1]));
  const localHighs   = [...xmlText.matchAll(/crs:LocalHighlights2012="([^"]+)"/g)].map(m => parseFloat(m[1]));
  const localShads   = [...xmlText.matchAll(/crs:LocalShadows2012="([^"]+)"/g)].map(m => parseFloat(m[1]));
  const localWhts    = [...xmlText.matchAll(/crs:LocalWhites2012="([^"]+)"/g)].map(m => parseFloat(m[1]));
  const localBlks    = [...xmlText.matchAll(/crs:LocalBlacks2012="([^"]+)"/g)].map(m => parseFloat(m[1]));

  const avgNonZero = (arr) => {
    const nz = arr.filter(v => v !== 0);
    return nz.length ? nz.reduce((a, b) => a + b, 0) / nz.length : 0;
  };

  const localExpAdj  = Math.round((avgNonZero(localExps) + avgNonZero(localWhts) * 0.3 - avgNonZero(localBlks) * 0.2) * 20);
  const localContAdj = Math.round(avgNonZero(localConts) * 100);
  const localSatAdj  = Math.round(avgNonZero(localSats) * 100);
  const localClarAdj = Math.round((avgNonZero(localClars) + avgNonZero(localTexts) * 0.7) * 100);
  const localHlAdj   = Math.round(avgNonZero(localHighs) * 100);
  const localShAdj   = Math.round(avgNonZero(localShads) * 100);

  // Merge global + local (local adds to global for approximation)
  const params = {
    exposure:   Math.max(-100, Math.min(100, effectiveExposure  + localExpAdj)),
    highlights: Math.max(-100, Math.min(100, globalHighlights   + localHlAdj)),
    shadows:    Math.max(-100, Math.min(100, globalShadows       + localShAdj)),
    contrast:   Math.max(-100, Math.min(100, globalContrast      + localContAdj)),
    vibrance:   Math.max(-100, Math.min(100, globalVibrance)),
    saturation: Math.max(-100, Math.min(100, globalSaturation    + localSatAdj)),
    warmth:     Math.max(-100, Math.min(100, effectiveWarmth)),
    clarity:    Math.max(-100, Math.min(100, globalClarity       + localClarAdj)),
    denoise:    Math.max(0,    Math.min(100, globalDenoise)),
    sharpness:  Math.max(0,    Math.min(100, globalSharpness)),
  };

  return { name: presetName, params };
}

// GET — list all uploaded XMP presets
app.get("/api/xmp-presets", requireAuth, (req, res) => {
  const presets = loadXmpPresets();
  // Return as array: [{ id, name, params }]
  res.json(Object.entries(presets).map(([id, p]) => ({ id, name: p.name, params: p.params })));
});

// POST — upload one or more XMP files, parse and store them
app.post("/api/xmp-presets", requireAuth, (req, res, next) => {
  const uploadXmp = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 512 * 1024, files: 20 },
    fileFilter: (_, file, cb) => cb(null, /\.xmp$/i.test(file.originalname)),
  }).array("presets");
  uploadXmp(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files?.length) return res.status(400).json({ error: "No XMP files received" });
    const existing = loadXmpPresets();
    const added = [];
    for (const file of req.files) {
      try {
        const xmlText = file.buffer.toString("utf8");
        const { name, params } = parseXmpToEditParams(xmlText);
        const id = `xmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        existing[id] = { name, params, uploadedAt: new Date().toISOString() };
        added.push({ id, name, params });
      } catch (e) {
        console.warn("Failed to parse XMP:", file.originalname, e.message);
      }
    }
    saveXmpPresets(existing);
    res.json({ added });
  });
});

// DELETE — remove an XMP preset by id
app.delete("/api/xmp-presets/:id", requireAuth, (req, res) => {
  const existing = loadXmpPresets();
  if (!existing[req.params.id]) return res.status(404).json({ error: "Not found" });
  delete existing[req.params.id];
  saveXmpPresets(existing);
  res.json({ ok: true });
});

// ── Smart Auto exposure analysis ─────────────────────────────────────────────
// A local, deterministic JPEG histogram analysis. This is intentionally
// conservative for event batches and does not claim to reproduce Adobe.
async function computeAdobeAutoParams(filepath) {
  const { channels } = await sharp(filepath).rotate().stats();
  const greyStats = await sharp(filepath).rotate().greyscale().stats();
  const histogram = greyStats.channels[0]?.histogram || [];
  const totalPixels = histogram.reduce((sum, count) => sum + count, 0);
  const percentile = (ratio) => {
    if (!totalPixels) return Math.round(greyStats.channels[0]?.mean || 128);
    const target = totalPixels * ratio;
    let seen = 0;
    for (let value = 0; value < histogram.length; value++) {
      seen += histogram[value];
      if (seen >= target) return value;
    }
    return 255;
  };
  const p05 = percentile(0.05);
  const p50 = percentile(0.50);
  const p95 = percentile(0.95);
  const p99 = percentile(0.99);

  const meanBrightness = greyStats.channels[0]?.mean || (channels[0].mean + channels[1].mean + channels[2].mean) / 3;
  const meanStd        = (channels[0].stdev + channels[1].stdev + channels[2].stdev) / 3;

  // Min/max give us the actual tonal range
  const minVal = Math.min(channels[0].min, channels[1].min, channels[2].min);
  const maxVal = Math.max(channels[0].max, channels[1].max, channels[2].max);
  const tonalRange = maxVal - minVal;

  // ── Exposure ──────────────────────────────────────────────────────────────
  // Target the actual scene brightness, not just the median. Indoor sports
  // frames often contain a large dark background and a few hot ceiling lights;
  // using p50 alone incorrectly darkened the athlete. Blend mean + median and
  // keep negative compensation gentle so proofs remain client-ready.
  const targetBrightness = 122;
  const exposureReference = (meanBrightness * 0.7) + (p50 * 0.3);
  const evDiff = Math.log2(Math.max(1, targetBrightness) / Math.max(1, exposureReference));
  const exposure = Math.max(-18, Math.min(35, Math.round(evDiff * 24)));

  // ── Highlights ────────────────────────────────────────────────────────────
  // Pull highlights down if maxVal is very close to 255 (blown), lift if very low
  const highlightClipping = Math.max(0, (p99 - 232) / 23);
  const highlights = Math.max(-70, Math.min(20, Math.round(-highlightClipping * 58)));

  // ── Shadows ───────────────────────────────────────────────────────────────
  // Lift shadows if minVal is very dark (crushed blacks), leave if already open
  const shadowCrush = Math.max(0, (24 - p05) / 24);
  const shadows = Math.max(-20, Math.min(65, Math.round((shadowCrush * 50) + (meanBrightness < 118 ? 10 : 0))));

  // ── Contrast ─────────────────────────────────────────────────────────────
  // Flat image (low std) → add contrast; high std → don't touch
  const tonalSpread = p95 - p05;
  const contrast = tonalSpread < 105 ? 22 : tonalSpread < 145 ? 16 : tonalSpread > 225 ? -4 : 8;

  // ── Vibrance ─────────────────────────────────────────────────────────────
  // Desaturated image → boost vibrance; already vivid → gentle
  const rg = Math.abs(channels[0].mean - channels[1].mean);
  const rb = Math.abs(channels[0].mean - channels[2].mean);
  const colorfulness = Math.min(100, (rg + rb) / 2);
  const vibrance = Math.max(0, Math.min(40, Math.round((40 - colorfulness * 0.5))));

  // ── Warmth (White Balance) ─────────────────────────────────────────────────
  // If red >> blue → image is warm/orange, nudge cool. Blue >> red → warm it up.
  const rbBalance = channels[0].mean - channels[2].mean;  // positive = warm cast
  const warmth = Math.max(-18, Math.min(18, Math.round(-rbBalance * 0.22)));

  // ── Clarity ───────────────────────────────────────────────────────────────
  // Flat/hazy photos get a clarity boost
  const clarity = meanStd < 40 ? 15 : meanStd < 60 ? 8 : 0;

  const denoise = meanStd < 26 && meanBrightness < 95 ? 22 : 5;
  return { exposure, highlights, shadows, contrast, vibrance, saturation: 0, warmth, clarity, denoise, sharpness: 48 };
}

// Apply the built-in, deterministic auto edit after a proof is safely stored.
// This keeps upload latency low while still publishing an edited rendition to
// the client album. The original upload remains available for reprocessing.
async function autoEditAlbumUploads({ albumId, tenantSlug, uploadedFiles }) {
  if (!albumId || !uploadedFiles?.length) return;
  const db = readDb();
  const storeKey = tenantSlug ? `t_${tenantSlug}_wv_albums` : ALBUMS_KEY;
  const albums = _parseAlbumsFromDb(db[storeKey]);
  const idx = albums.findIndex(a => a.id === albumId || a.slug === albumId);
  if (idx < 0) return;
  const album = albums[idx];
  let changed = false;
  for (const file of uploadedFiles) {
    const photo = (album.photos || []).find(p => p.id === file.id);
    if (!photo || !file.localPath || !fs.existsSync(file.localPath)) continue;
    try {
      const params = await computeAdobeAutoParams(file.localPath);
      const editedName = `${path.basename(file.localPath, path.extname(file.localPath))}-auto.jpg`;
      const editedPath = path.join(UPLOADS_DIR, editedName);
      await applyEditParams(file.localPath, params, editedPath);
      const editedUrl = `/uploads/${editedName}`;
      if (!photo.beforeSrc) photo.beforeSrc = photo.src;
      photo.editedSrc = editedUrl;
      photo.src = editedUrl;
      photo.editRecipe = { engine: "photoflow-auto-v1", params, processedAt: new Date().toISOString() };
      changed = true;
    } catch (err) {
      console.warn(`[AUTO-EDIT] Failed for ${file.originalName || file.id}:`, err.message);
    }
  }
  if (changed) {
    albums[idx] = { ...album, photos: album.photos, photoCount: album.photos.length, _photosStripped: false };
    db[storeKey] = JSON.stringify(albums);
    writeDb(db);
  }
}

app.get("/api/photo/:filename/ai-enhanced", aiEnhanceLimiter, requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  // Strip any query-string that may have been incorporated into the filename (e.g. "photo.jpg?tenant=slug")
  const safeName = path.basename(req.params.filename.split("?")[0]);
  const filepath = path.join(UPLOADS_DIR, safeName);
  if (!fs.existsSync(filepath)) return res.status(404).send("Not found");

  // Guard against symlink-based path traversal
  try {
    const realFilepath = fs.realpathSync(filepath);
    const realUploadsDir = fs.realpathSync(UPLOADS_DIR);
    if (!realFilepath.startsWith(realUploadsDir + path.sep) && realFilepath !== realUploadsDir) {
      return res.status(403).send("Forbidden");
    }
  } catch {
    return res.status(404).send("Not found");
  }

  const photoId = path.basename(safeName, path.extname(safeName));
  const force   = req.query.force === "1";

  // ── Determine edit mode ───────────────────────────────────────────────────
  // mode=preset      → built-in preset name in req.query.preset
  // mode=xmp         → uploaded XMP preset id in req.query.xmpId
  // mode=adobe-auto  → per-image Adobe-style Auto analysis
  // mode=prompt      → natural language text in req.query.prompt
  // mode=manual      → individual slider values in req.query.*
  // mode=auto (default) → adaptive pipeline based on image stats + optional multipliers
  const mode = req.query.mode || "auto";

  try {
    let editParams = null;
    let cacheKey   = "auto";

    if (mode === "preset") {
      const presetName = (req.query.preset || "").toLowerCase().replace(/[^a-z]/g, "");
      editParams = presetToEditParams(presetName);
      if (!editParams) return res.status(400).json({ error: `Unknown preset: ${presetName}` });
      cacheKey = `preset-${presetName}`;

    } else if (mode === "xmp") {
      // Apply an uploaded XMP preset by id
      const xmpId = (req.query.xmpId || "").replace(/[^a-z0-9_]/gi, "");
      if (!xmpId) return res.status(400).json({ error: "Missing xmpId" });
      const allXmp = loadXmpPresets();
      if (!allXmp[xmpId]) return res.status(404).json({ error: "XMP preset not found" });
      editParams = allXmp[xmpId].params;
      cacheKey = `xmp-${xmpId}`;

    } else if (mode === "adobe-auto") {
      // Per-image Adobe-style Auto: analyse and compute optimal params
      editParams = await computeAdobeAutoParams(filepath);
      // Cache key incorporates a hash of the image stats so it's stable per file
      const { channels } = await sharp(filepath).stats();
      const statsKey = [channels[0].mean, channels[0].stdev, channels[1].mean, channels[2].mean].map(v => Math.round(v)).join("_");
      cacheKey = `adobe-auto-${statsKey}`;

    } else if (mode === "prompt") {
      const promptText = (req.query.prompt || "").slice(0, 200); // limit length
      editParams = promptToEditParams(promptText);
      // Cache key: sanitise prompt to safe filename chars
      cacheKey = `prompt-${promptText.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;

    } else if (mode === "manual") {
      const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v) || 0));
      editParams = {
        exposure:   clamp(req.query.exposure,   -100, 100),
        highlights: clamp(req.query.highlights, -100, 100),
        shadows:    clamp(req.query.shadows,    -100, 100),
        contrast:   clamp(req.query.contrast,   -100, 100),
        vibrance:   clamp(req.query.vibrance,   -100, 100),
        saturation: clamp(req.query.saturation, -100, 100),
        warmth:     clamp(req.query.warmth,     -100, 100),
        clarity:    clamp(req.query.clarity,    -100, 100),
        denoise:    clamp(req.query.denoise,       0, 100),
        sharpness:  clamp(req.query.sharpness,     0, 100),
      };
      const vals = Object.values(editParams).map(v => Math.round(v));
      cacheKey = `manual-${vals.join("_")}`;

    } else {
      // mode=auto — adaptive pipeline with optional multipliers (legacy behaviour)
      const parseParam = (val, def = 100) => { const n = parseFloat(val); return (isFinite(n) && n >= 0 && n <= 200) ? n : def; };
      const brightnessParam  = parseParam(req.query.brightness);
      const saturationParam  = parseParam(req.query.saturation);
      const contrastParam    = parseParam(req.query.contrast);
      const sharpnessParam   = parseParam(req.query.sharpness);
      cacheKey = `auto-b${brightnessParam}s${saturationParam}c${contrastParam}sh${sharpnessParam}`;

      const cachedPathAuto = path.join(CACHE_DIR, `${photoId}-edit-${cacheKey}.jpg`);
      if (!force && fs.existsSync(cachedPathAuto)) {
        res.set({ "Cache-Control": "private, no-store", "Content-Type": "image/jpeg" });
        return res.sendFile(cachedPathAuto);
      }
      if (fs.existsSync(cachedPathAuto)) try { fs.unlinkSync(cachedPathAuto); } catch {}

      const { channels } = await sharp(filepath).stats();
      const meanBrightness = (channels[0].mean + channels[1].mean + channels[2].mean) / 3;
      const meanStd        = (channels[0].stdev + channels[1].stdev + channels[2].stdev) / 3;
      const applyMult = (base, mult) => 1 + (base - 1) * (mult / 100);
      const baseBF = meanBrightness < 80 ? 1.28 : meanBrightness < 120 ? 1.18 : meanBrightness < 160 ? 1.10 : 1.05;
      const baseCG = meanStd < 30 ? 1.22 : meanStd < 50 ? 1.15 : meanStd < 70 ? 1.10 : 1.06;
      const baseSF = meanStd < 40 ? 1.40 : meanStd < 65 ? 1.28 : 1.18;
      const bSigma = meanStd < 50 ? 1.2 : 0.9;
      const bFlat  = meanStd < 50 ? 1.5 : 1.0;
      const bJagged= meanStd < 50 ? 2.5 : 2.0;
      const bf = applyMult(baseBF, brightnessParam);
      const cg = applyMult(baseCG, contrastParam);
      const co = -(cg - 1) * 55;
      const sf = applyMult(baseSF, saturationParam);
      const sm = sharpnessParam / 100;
      await sharp(filepath)
        .modulate({ brightness: bf, saturation: sf })
        .linear(cg, co)
        .clahe({ width: 32, height: 32, maxSlope: 3 })
        .sharpen({ sigma: bSigma, m1: Math.max(0.01, bFlat * sm), m2: Math.max(0.01, bJagged * sm) })
        .jpeg({ quality: 92, progressive: true })
        .toFile(cachedPathAuto);
      console.log(`[AI-auto] ${safeName}: brightness=${meanBrightness.toFixed(1)} std=${meanStd.toFixed(1)}`);
      res.set({ "Cache-Control": "private, no-store", "Content-Type": "image/jpeg" });
      return res.sendFile(cachedPathAuto);
    }

    // ── Shared path for preset / prompt / manual ──────────────────────────
    const cachedPathEdit = path.join(CACHE_DIR, `${photoId}-edit-${cacheKey}.jpg`);
    if (!force && fs.existsSync(cachedPathEdit)) {
      res.set({ "Cache-Control": "private, no-store", "Content-Type": "image/jpeg" });
      return res.sendFile(cachedPathEdit);
    }
    if (fs.existsSync(cachedPathEdit)) try { fs.unlinkSync(cachedPathEdit); } catch {}

    await applyEditParams(filepath, editParams, cachedPathEdit);
    console.log(`[AI-${mode}] ${safeName}: ${JSON.stringify(editParams)}`);
    res.set({ "Cache-Control": "private, no-store", "Content-Type": "image/jpeg" });
    res.sendFile(cachedPathEdit);

  } catch (err) {
    console.error(`AI edit failed for ${safeName}:`, err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Image edit failed", detail: process.env.NODE_ENV === "development" ? err.message : undefined });
    }
  }
});

// ── Apply AI enhancement (overwrite original with the cached enhanced file) ────
// Called after the user clicks "Apply" to permanently commit the enhancement.
// Copies _cache/{photoId}-ai-enhanced.jpg over the original upload, then purges
// all cached derivatives for that photo so they regenerate from the new base.
app.post("/api/photo/:filename/apply-enhancement", requireAuth, async (req, res) => {
  const safeName = path.basename(req.params.filename.split("?")[0]);
  const originalPath = path.join(UPLOADS_DIR, safeName);

  // Path traversal guard
  try {
    const real = fs.realpathSync(originalPath);
    const realUploads = fs.realpathSync(UPLOADS_DIR);
    if (!real.startsWith(realUploads + path.sep)) return res.status(403).send("Forbidden");
  } catch { return res.status(404).json({ ok: false, error: "File not found" }); }

  const photoId = path.basename(safeName, path.extname(safeName));
  const cachedPath = path.join(CACHE_DIR, `${photoId}-ai-enhanced.jpg`);

  if (!fs.existsSync(cachedPath)) {
    return res.status(404).json({ ok: false, error: "No cached enhancement found — enhance first" });
  }

  try {
    // Overwrite the original file with the enhanced version
    fs.copyFileSync(cachedPath, originalPath);

    // Purge all cache entries for this photo (thumbs, watermarked variants, etc.)
    // so they are regenerated from the new enhanced base on next request.
    const cacheFiles = fs.readdirSync(CACHE_DIR);
    let purged = 0;
    for (const f of cacheFiles) {
      if (f.startsWith(photoId + "-") || f.startsWith(photoId + ".")) {
        try { fs.unlinkSync(path.join(CACHE_DIR, f)); purged++; } catch { /* noop */ }
      }
    }

    console.log(`[AI] Applied enhancement to ${safeName}, purged ${purged} cache entries`);
    res.json({ ok: true, purged });
  } catch (err) {
    console.error(`[AI] apply-enhancement failed for ${safeName}:`, err.message);
    res.status(500).json({ ok: false, error: "Failed to apply enhancement" });
  }
});

// ── Clear image cache ──────────────────────────────────
function countAndDeleteDir(dirPath) {
  let cleared = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        cleared += countAndDeleteDir(entryPath);
        try { fs.rmdirSync(entryPath); } catch {}
      } else {
        try { fs.unlinkSync(entryPath); cleared++; } catch {}
      }
    }
  } catch {}
  return cleared;
}

function getCacheBreakdown(cacheDir) {
  const breakdown = { thumb_wm: 0, thumb_clean: 0, medium_wm: 0, medium_clean: 0, full_wm: 0, full_clean: 0, other: 0, totalBytes: 0 };
  if (!fs.existsSync(cacheDir)) return breakdown;
  try {
    for (const f of fs.readdirSync(cacheDir)) {
      try {
        const stat = fs.statSync(path.join(cacheDir, f));
        if (!stat.isFile()) continue;
        breakdown.totalBytes += stat.size;
        if (f.endsWith("_thumb_wm.jpg")) breakdown.thumb_wm++;
        else if (f.endsWith("_thumb_clean.jpg")) breakdown.thumb_clean++;
        else if (f.endsWith("_medium_wm.jpg")) breakdown.medium_wm++;
        else if (f.endsWith("_medium_clean.jpg")) breakdown.medium_clean++;
        else if (f.endsWith("_full_wm.jpg")) breakdown.full_wm++;
        else if (f.endsWith("_full_clean.jpg")) breakdown.full_clean++;
        else breakdown.other++;
      } catch {}
    }
  } catch {}
  return breakdown;
}

function clearImageCache() {
  const before = getCacheBreakdown(CACHE_DIR);
  let cleared = 0;
  if (fs.existsSync(CACHE_DIR)) {
    cleared = countAndDeleteDir(CACHE_DIR);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  return { cleared, breakdown: before };
}

app.post("/api/cache/clear", requireAuth, (_req, res) => {
  if ([...zipJobs.values()].some(job => job.status === "preparing")) {
    return res.status(409).json({ error: "A ZIP download is being prepared. Try clearing the image cache again when it finishes." });
  }
  const { cleared, breakdown } = clearImageCache();
  res.json({ ok: true, cleared, breakdown });
});

// ── Cache stats (counts without clearing) ──────────────
app.get("/api/cache/stats", requireAuth, (_req, res) => {
  const breakdown = getCacheBreakdown(CACHE_DIR);
  const total = breakdown.thumb_wm + breakdown.thumb_clean + breakdown.medium_wm + breakdown.medium_clean + breakdown.full_wm + breakdown.full_clean + breakdown.other;
  res.json({ ok: true, total, breakdown });
});

// ── Bulk-delete specific files (orphan cleanup) ──────────────
app.post("/api/upload/bulk-delete", uploadDeleteLimiter, requireAuth, async (req, res) => {
  const { filenames } = req.body;
  if (!Array.isArray(filenames)) {
    return res.status(400).json({ error: "filenames array required" });
  }
  // Cap the number of files per request to prevent abuse
  if (filenames.length > 500) {
    return res.status(400).json({ error: "Too many filenames in a single request (max 500)" });
  }
  let deleted = 0;
  const skippedReferenced = [];
  const db = readDb();
  const owners = dbGet(db, "wv_upload_owners", {});
  for (const name of filenames) {
    const safeName = path.basename(String(name));
    if (uploadReferenceKeys(db, safeName).length > 0) {
      skippedReferenced.push(safeName);
      continue;
    }
    const filepath = path.join(UPLOADS_DIR, safeName);
    try {
      if (fs.existsSync(filepath)) { fs.unlinkSync(filepath); deleted++; }
      delete owners[safeName];
      purgeCacheVariantsForUpload(safeName);
      // Remove any cached variants for this file (including tenant-specific variants).
      // getCacheFilename takes an optional tenantSlug 4th arg; passing null covers the
      // global cache and we also scan for any t_<slug> variants present on disk.
      const base = path.basename(safeName, path.extname(safeName));
      // Collect tenant slugs from the database so we can wipe their caches too.
      const tenantSlugs = [null, ...Object.keys(db)
        .filter(k => k.startsWith("t_") && k.endsWith("_wv_tenant_settings"))
        .map(k => k.slice(2, k.length - "_wv_tenant_settings".length))
      ];
      for (const tenantSlug of tenantSlugs) {
        for (const sizeLabel of ["thumb", "medium", "full"]) {
          for (const watermarked of [true, false]) {
            const cf = path.join(CACHE_DIR, getCacheFilename(base, sizeLabel, watermarked, tenantSlug));
            try { if (fs.existsSync(cf)) fs.unlinkSync(cf); } catch {}
          }
        }
      }
    } catch { /* skip individual failures */ }
  }
  db["wv_upload_owners"] = owners;
  writeDb(db);
  res.json({ ok: true, deleted, skippedReferenced });
});

// ── Download original photos as a zip (authenticated) ──────────
// Accepts either:
//   { filenames: string[], sessionKey, albumId }   — all clean originals (legacy)
//   { files: [{filename, clean}], sessionKey, albumId } — per-file clean/watermarked
const downloadZipLimiter = rateLimit({ windowMs: 60_000, max: 6, standardHeaders: true, legacyHeaders: false, message: { error: "Too many zip requests — please wait before retrying" } });
const downloadEmailLimiter = rateLimit({ windowMs: 60_000, max: 12, standardHeaders: true, legacyHeaders: false, message: { error: "Too many email capture attempts — please wait" } });
const zipJobs = new Map();
const FREE_DOWNLOAD_REASONS = new Set(["album-unlock", "session-unlock", "free-quota"]);
const DOWNLOAD_CAPTURE_RETENTION_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const DOWNLOAD_CAPTURE_MAX_RECORDS = 20_000;
const DOWNLOAD_CAPTURE_SECRET = process.env.DOWNLOAD_CAPTURE_HASH_SECRET
  || process.env.SESSION_SECRET
  || process.env.SUPER_ADMIN_PASSWORD
  || "watermark-vault-download-capture";

function readDownloadEmailCaptures(db = readDb()) {
  const records = dbGet(db, DB_KEYS.DOWNLOAD_EMAIL_CAPTURES, []);
  return Array.isArray(records) ? records : [];
}

function pruneDownloadEmailCaptures(records, now = Date.now()) {
  const cutoff = now - DOWNLOAD_CAPTURE_RETENTION_MS;
  return records
    .filter(record => {
      const timestamp = Date.parse(record.updatedAt || record.createdAt || "");
      return Number.isFinite(timestamp) && timestamp >= cutoff;
    })
    .slice(-DOWNLOAD_CAPTURE_MAX_RECORDS);
}

function saveDownloadEmailCaptures(db, records) {
  db[DB_KEYS.DOWNLOAD_EMAIL_CAPTURES] = pruneDownloadEmailCaptures(records);
  writeDb(db);
}

function createOrReuseDownloadEmailCapture({ email, albumMatch, sessionKey, req }) {
  const normalizedEmail = normalizeDownloadEmail(email);
  if (!normalizedEmail) return { error: "A valid email address is required" };
  const db = readDb();
  const records = readDownloadEmailCaptures(db);
  const candidate = buildDownloadCaptureRecord({
    email: normalizedEmail,
    album: albumMatch.album,
    tenantSlug: albumMatch.tenantSlug,
    sessionKey,
    ip: req.ip,
    userAgent: req.get("user-agent"),
    secret: DOWNLOAD_CAPTURE_SECRET,
  });
  let record = records.find(existing =>
    existing.email === normalizedEmail
    && recordMatchesRequest(existing, albumMatch.album.id, sessionKey, DOWNLOAD_CAPTURE_SECRET)
  );
  if (record) {
    record.updatedAt = new Date().toISOString();
    record.userAgent = candidate.userAgent;
    record.ipHash = candidate.ipHash;
  } else {
    record = candidate;
    records.push(record);
  }
  saveDownloadEmailCaptures(db, records);
  return { record };
}

function resolveDownloadEmailCapture(req, albumId, sessionKey, accessibleFiles) {
  const freeFiles = accessibleFiles.filter(file => FREE_DOWNLOAD_REASONS.has(file.accessReason));
  const albumMatch = findAlbumById(readDb(), albumId);
  if (!albumMatch) return { ok: false, status: 404, error: "Album not found" };
  const policy = normalizeDownloadEmailPolicy(albumMatch.album.downloadEmailCapture);
  if (policy === "off") return { ok: true, record: null, freeFiles, policy };
  let record = null;
  const captureId = typeof req.body.downloadEmailCaptureId === "string"
    ? req.body.downloadEmailCaptureId.slice(0, 120)
    : "";
  if (captureId) {
    record = readDownloadEmailCaptures().find(candidate =>
      candidate.id === captureId
      && recordMatchesRequest(candidate, albumMatch.album.id, sessionKey, DOWNLOAD_CAPTURE_SECRET)
    ) || null;
  }

  const suppliedEmail = typeof req.body.email === "string" ? req.body.email.trim() : "";
  if (!record && suppliedEmail) {
    const result = createOrReuseDownloadEmailCapture({
      email: suppliedEmail,
      albumMatch,
      sessionKey,
      req,
    });
    if (result.error) return { ok: false, status: 400, error: result.error };
    record = result.record;
  }

  if (policy === "required" && !record) {
    return {
      ok: false,
      status: 428,
      error: "Email address required before downloading this gallery",
      code: "DOWNLOAD_EMAIL_REQUIRED",
      policy,
    };
  }
  return { ok: true, record, freeFiles, policy };
}

function recordCapturedDownload(record, { requested, accessibleFiles, quality }) {
  if (!record) return;
  const db = readDb();
  const records = readDownloadEmailCaptures(db);
  const stored = records.find(candidate => candidate.id === record.id);
  if (!stored) return;
  const now = new Date().toISOString();
  const watermarkedPhotos = accessibleFiles.filter(file => !file.clean).length;
  stored.updatedAt = now;
  stored.firstDownloadedAt ||= now;
  stored.lastDownloadedAt = now;
  stored.downloadCount = Number(stored.downloadCount || 0) + 1;
  stored.requestedPhotos = Number(stored.requestedPhotos || 0) + Number(requested || 0);
  stored.includedPhotos = Number(stored.includedPhotos || 0) + accessibleFiles.length;
  stored.watermarkedPhotos = Number(stored.watermarkedPhotos || 0) + watermarkedPhotos;
  stored.cleanPhotos = Number(stored.cleanPhotos || 0) + (accessibleFiles.length - watermarkedPhotos);
  stored.lastQuality = quality;
  saveDownloadEmailCaptures(db, records);
}

app.post("/api/download/email-capture", downloadEmailLimiter, (req, res) => {
  const { albumId, email } = req.body || {};
  if (!albumId) return res.status(400).json({ error: "albumId is required" });
  const albumMatch = findAlbumById(readDb(), albumId);
  if (!albumMatch) return res.status(404).json({ error: "Album not found" });
  const gallerySession = getGallerySessionForAlbum(req, albumMatch.album);
  if (!gallerySession || gallerySession.tenantSlug !== albumMatch.tenantSlug) return res.status(401).json({ error: "A valid gallery session is required" });
  const sessionKey = gallerySession.sessionKey;
  const policy = normalizeDownloadEmailPolicy(albumMatch.album.downloadEmailCapture);
  if (policy === "off") return res.status(409).json({ error: "Email capture is not enabled for this album", policy });
  const result = createOrReuseDownloadEmailCapture({ email, albumMatch, sessionKey, req });
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json({
    ok: true,
    captureId: result.record.id,
    policy,
    albumId: albumMatch.album.id,
  });
});

app.post("/api/download/email-capture/complete", downloadEmailLimiter, (req, res) => {
  const { captureId, albumId } = req.body || {};
  if (!captureId || !albumId) return res.status(400).json({ error: "captureId and albumId are required" });
  const albumMatch = findAlbumById(readDb(), albumId);
  const gallerySession = albumMatch ? getGallerySessionForAlbum(req, albumMatch.album) : null;
  if (!gallerySession || gallerySession.tenantSlug !== albumMatch.tenantSlug) return res.status(401).json({ error: "A valid gallery session is required" });
  const sessionKey = gallerySession.sessionKey;
  const record = readDownloadEmailCaptures().find(candidate =>
    candidate.id === String(captureId).slice(0, 120)
    && recordMatchesRequest(candidate, albumId, sessionKey, DOWNLOAD_CAPTURE_SECRET)
  );
  if (!record) return res.status(404).json({ error: "Email capture not found for this download session" });
  const included = Math.max(0, Math.min(MAX_ZIP_FILES, Number(req.body.included) || 0));
  const clean = Math.max(0, Math.min(included, Number(req.body.clean) || 0));
  const requested = Math.max(included, Math.min(MAX_ZIP_FILES, Number(req.body.requested) || included));
  recordCapturedDownload(record, {
    requested,
    accessibleFiles: Array.from({ length: included }, (_, index) => ({ clean: index < clean })),
    quality: ["2mb", "5mb", "original"].includes(req.body.quality) ? req.body.quality : "original",
  });
  res.json({ ok: true });
});

app.get("/api/admin/download-email-stats", requireAuth, (req, res) => {
  const records = pruneDownloadEmailCaptures(readDownloadEmailCaptures());
  const albumId = typeof req.query.albumId === "string" ? req.query.albumId : "";
  const filtered = albumId ? records.filter(record => record.albumId === albumId) : records;
  const uniqueEmails = new Set(filtered.map(record => record.email));
  res.setHeader("Cache-Control", "no-store");
  res.json({
    totalCaptures: filtered.length,
    uniqueEmails: uniqueEmails.size,
    downloads: filtered.reduce((sum, record) => sum + Number(record.downloadCount || 0), 0),
    requestedPhotos: filtered.reduce((sum, record) => sum + Number(record.requestedPhotos || 0), 0),
    includedPhotos: filtered.reduce((sum, record) => sum + Number(record.includedPhotos || 0), 0),
    watermarkedPhotos: filtered.reduce((sum, record) => sum + Number(record.watermarkedPhotos || 0), 0),
    cleanPhotos: filtered.reduce((sum, record) => sum + Number(record.cleanPhotos || 0), 0),
    records: filtered.slice(-500).reverse().map(({ sessionHash: _sessionHash, ipHash: _ipHash, ...record }) => record),
    retentionDays: Math.round(DOWNLOAD_CAPTURE_RETENTION_MS / 86_400_000),
  });
});

function readZipStats() {
  return dbGet(readDb(), DB_KEYS.ZIP_STATS, { generated: 0, downloaded: 0, failed: 0, photos: 0, bytes: 0, totalBuildMs: 0, lastGeneratedAt: null, lastDownloadedAt: null });
}

function updateZipStats(changes) {
  const db = readDb();
  const current = dbGet(db, DB_KEYS.ZIP_STATS, {});
  const next = { generated: 0, downloaded: 0, failed: 0, photos: 0, bytes: 0, totalBuildMs: 0, ...current };
  for (const key of ["generated", "downloaded", "failed", "photos", "bytes", "totalBuildMs"]) {
    if (changes[key]) next[key] = Number(next[key] || 0) + Number(changes[key]);
  }
  Object.assign(next, changes.lastGeneratedAt ? { lastGeneratedAt: changes.lastGeneratedAt } : {}, changes.lastDownloadedAt ? { lastDownloadedAt: changes.lastDownloadedAt } : {});
  db[DB_KEYS.ZIP_STATS] = next;
  writeDb(db);
  return next;
}

function zipDiskStats() {
  let files = 0; let bytes = 0;
  try { for (const name of fs.readdirSync(ZIP_JOBS_DIR)) { const stat = fs.statSync(path.join(ZIP_JOBS_DIR, name)); if (stat.isFile()) { files++; bytes += stat.size; } } } catch {}
  return { files, bytes };
}

app.get("/api/admin/zip-stats", requireAuth, (_req, res) => {
  const totals = readZipStats();
  const active = [...zipJobs.values()].filter(job => job.status === "preparing").length;
  const ready = [...zipJobs.values()].filter(job => job.status === "done").length;
  res.json({ ...totals, active, ready, disk: zipDiskStats(), readyTtlMs: ZIP_READY_TTL_MS, transferredTtlMs: ZIP_TRANSFERRED_TTL_MS, averageBuildMs: totals.generated ? Math.round(totals.totalBuildMs / totals.generated) : 0 });
});

function normalizeZipFileList(filenames, files) {
  const source = Array.isArray(files)
    ? files.map(f => ({ filename: String(f.filename || ""), clean: f.clean === true }))
    : Array.isArray(filenames)
      ? filenames.map(n => ({ filename: String(n), clean: true }))
      : null;
  if (!source) return null;
  const unique = new Map();
  for (const item of source) {
    const safeName = path.basename(item.filename.split("?")[0]);
    if (!safeName) continue;
    const existing = unique.get(safeName);
    unique.set(safeName, { filename: safeName, clean: item.clean || existing?.clean === true });
  }
  return [...unique.values()];
}

function validateZipRequest(req, res) {
  const { filenames, files, albumId } = req.body;
  const rawCount = Array.isArray(files) ? files.length : Array.isArray(filenames) ? filenames.length : 0;
  if (rawCount > MAX_ZIP_FILES) {
    res.status(400).json({ error: `Too many files in a single zip request (max ${MAX_ZIP_FILES})` });
    return null;
  }
  const quality = ["2mb", "5mb", "original"].includes(req.body.quality) ? req.body.quality : "original";
  const fileList = normalizeZipFileList(filenames, files);
  if (!fileList) {
    res.status(400).json({ error: "files array (or filenames) and albumId required" });
    return null;
  }
  if (!albumId) {
    res.status(400).json({ error: "albumId required" });
    return null;
  }
  const db = readDb();
  const albumMatch = findAlbumById(db, albumId);
  if (albumMatch && albumAccessWindow(albumMatch.album, Date.now(), galleryTimezone(db, albumMatch.tenantSlug)).downloadsExpired) {
    res.status(410).json({ error: "Gallery downloads have expired" });
    return null;
  }
  const gallerySession = albumMatch ? getGallerySessionForAlbum(req, albumMatch.album) : null;
  if (!gallerySession || gallerySession.tenantSlug !== albumMatch.tenantSlug) {
    res.status(401).json({ error: "A valid gallery session is required" });
    return null;
  }
  if (fileList.length > MAX_ZIP_FILES) {
    res.status(400).json({ error: `Too many files in a single zip request (max ${MAX_ZIP_FILES})` });
    return null;
  }
  return { fileList, sessionKey: gallerySession.sessionKey, albumId, quality };
}

function uniqueZipEntryName(preferredName, fallbackName, quality, usedNames) {
  const rawName = String(preferredName || fallbackName || "photo.jpg")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, "_")
    .trim();
  const fallbackExt = path.extname(fallbackName) || ".jpg";
  const rawExt = path.extname(rawName);
  const outputExt = quality === "original" ? (rawExt || fallbackExt) : ".jpg";
  const rawStem = rawExt ? rawName.slice(0, -rawExt.length) : rawName;
  const stem = (rawStem || "photo").slice(0, Math.max(1, 180 - outputExt.length));
  let candidate = `${stem}${outputExt}`;
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${stem} (${suffix++})${outputExt}`;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function collectAccessibleZipFiles(fileList, sessionKey, albumId, quality = "original") {
  const accessibleFiles = [];
  const albumMatch = findAlbumById(readDb(), albumId);
  const tenantSlug = albumMatch?.tenantSlug || null;
  const albumPhotos = Array.isArray(albumMatch?.album?.photos) ? albumMatch.album.photos : [];
  const albumPhotosByStoredName = new Map(albumPhotos.map(photo => {
    const source = photo.url || photo.src || "";
    return [source.split("?")[0].split("/").pop() || "", photo];
  }));
  const usedArchiveNames = new Set();
  let missingCount = 0;
  let deniedCount = 0;
  let downgradedCount = 0;
  for (const { filename, clean } of fileList) {
    const safeName = path.basename(filename.split("?")[0]);
    const filepath = resolveExistingUploadPath(safeName);
    if (!filepath) {
      missingCount++;
      continue;
    }
    const access = getPhotoDownloadAccess(safeName, sessionKey, albumId);
    if (!access.accessible) {
      deniedCount++;
      continue;
    }
    const serveClean = clean && access.clean;
    if (clean && !access.clean) downgradedCount++;
    const photo = albumPhotosByStoredName.get(safeName);
    const preferredName = photo?.originalName || (photo?.title ? `${photo.title}${path.extname(safeName)}` : safeName);
    const archiveName = uniqueZipEntryName(preferredName, safeName, quality, usedArchiveNames);
    accessibleFiles.push({
      safeName,
      filepath,
      clean: serveClean,
      tenantSlug,
      quality,
      archiveName,
      photoId: access.photoId || photo?.id || null,
      accessReason: access.reason,
    });
  }
  return { accessibleFiles, missingCount, deniedCount, downgradedCount };
}

function getZipAlbumName(albumId) {
  let albumName = "photos";
  try {
    const db = readDb();
    const album = findAlbumById(db, albumId)?.album;
    if (album?.title) albumName = album.title.replace(/[^a-z0-9_\- ]/gi, "_").trim();
  } catch {}
  return albumName;
}

function publicZipJob(job) {
  return {
    jobId: job.id,
    status: job.status,
    requested: job.requested,
    total: job.total,
    ready: job.ready,
    skipped: job.skipped,
    downgraded: job.downgraded,
    startedAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.error || null,
    filename: job.filename,
    bytes: job.bytes || 0,
    buildMs: job.status === "done" ? job.updatedAt - job.createdAt : null,
    expiresAt: job.expiresAt || null,
    includedPhotoIds: job.includedPhotoIds || [],
    includedFiles: job.includedFiles || [],
  };
}

function cleanupZipJob(jobId, delayMs = 15 * 60 * 1000) {
  const existing = zipJobs.get(jobId);
  if (existing?.cleanupTimer) clearTimeout(existing.cleanupTimer);
  if (existing) existing.expiresAt = Date.now() + delayMs;
  const timeout = setTimeout(() => {
    const job = zipJobs.get(jobId);
    if (!job) return;
    try { if (job.filepath && fs.existsSync(job.filepath)) fs.unlinkSync(job.filepath); } catch {}
    zipJobs.delete(jobId);
  }, delayMs);
  if (existing) existing.cleanupTimer = timeout;
  if (typeof timeout.unref === "function") timeout.unref();
}

async function buildZipJob(job, accessibleFiles) {
  fs.mkdirSync(ZIP_JOBS_DIR, { recursive: true });
  const output = fs.createWriteStream(job.filepath);
  const archive = archiver("zip", { zlib: { level: 0 } });
  const closed = new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
  });
  archive.on("progress", (progress) => {
    const processed = Number(progress?.entries?.processed) || 0;
    if (processed > job.ready) {
      job.ready = Math.min(job.total, processed);
      job.updatedAt = Date.now();
    }
  });
  archive.pipe(output);

  try {
    let nextIndex = 0;
    let preparedCount = 0;
    const addNextFiles = async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= accessibleFiles.length) return;
        const { safeName, filepath, clean, tenantSlug, quality, archiveName } = accessibleFiles[index];
        const preparedPath = quality === "original"
          ? (clean ? filepath : await getWatermarkedZipFilePath(safeName, filepath, tenantSlug))
          : await getSizedZipFilePath(safeName, filepath, clean, tenantSlug, quality);
        archive.file(preparedPath, { name: archiveName });
        preparedCount++;
        job.ready = Math.max(job.ready, preparedCount);
        job.updatedAt = Date.now();
      }
    };
    const workerCount = Math.min(ZIP_WATERMARK_CONCURRENCY, accessibleFiles.length);
    await Promise.all(Array.from({ length: workerCount }, () => addNextFiles()));
    await archive.finalize();
    await closed;
    job.ready = job.total;
    job.status = "done";
    job.updatedAt = Date.now();
    try { job.bytes = fs.statSync(job.filepath).size; } catch { job.bytes = 0; }
    updateZipStats({ generated: 1, photos: job.total, bytes: job.bytes, totalBuildMs: job.updatedAt - job.createdAt, lastGeneratedAt: new Date(job.updatedAt).toISOString() });
    console.log(`[ZIP] ${job.id} completed ${job.total}/${job.requested} photos in ${((job.updatedAt - job.createdAt) / 1000).toFixed(1)}s`);
    cleanupZipJob(job.id);
  } catch (err) {
    job.status = "failed";
    job.error = err?.message || "Failed to create zip";
    job.updatedAt = Date.now();
    updateZipStats({ failed: 1 });
    try { archive.abort(); } catch {}
    cleanupZipJob(job.id, 60 * 1000);
  }
}

app.post("/api/download/zip/start", downloadZipLimiter, async (req, res) => {
  const valid = validateZipRequest(req, res);
  if (!valid) return;
  const { fileList, sessionKey, albumId, quality } = valid;
  const { accessibleFiles, missingCount, deniedCount, downgradedCount } = collectAccessibleZipFiles(fileList, sessionKey, albumId, quality);

  if (accessibleFiles.length === 0) {
    return res.status(403).json({
      error: "No accessible photos found for this session",
      missing: missingCount,
      denied: deniedCount,
      requested: fileList.length,
    });
  }

  const emailCapture = resolveDownloadEmailCapture(req, albumId, sessionKey, accessibleFiles);
  if (!emailCapture.ok) {
    return res.status(emailCapture.status).json({
      error: emailCapture.error,
      code: emailCapture.code,
      policy: emailCapture.policy,
    });
  }

  const entitlementClaim = claimFreePhotoDownloads(albumId, sessionKey, accessibleFiles.map(file => file.photoId));
  if (!entitlementClaim.ok) return res.status(entitlementClaim.status || 403).json({ error: entitlementClaim.error });

  const albumName = getZipAlbumName(albumId);
  const jobId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  const job = {
    id: jobId,
    status: "preparing",
    requested: fileList.length,
    total: accessibleFiles.length,
    ready: 0,
    skipped: missingCount + deniedCount,
    downgraded: downgradedCount,
    error: null,
    filename: `${albumName}.zip`,
    quality,
    filepath: path.join(ZIP_JOBS_DIR, `${jobId}.zip`),
    includedPhotoIds: accessibleFiles.map(file => file.photoId).filter(Boolean),
    includedFiles: accessibleFiles.map(file => file.safeName),
    includedAccess: accessibleFiles.map(file => ({ clean: file.clean })),
    downloadEmailCaptureId: emailCapture.record?.id || null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  zipJobs.set(jobId, job);
  res.setHeader("Cache-Control", "private, no-store");
  res.status(202).json(publicZipJob(job));
  setImmediate(() => buildZipJob(job, accessibleFiles));
});

app.get("/api/download/zip/:jobId/status", (req, res) => {
  const job = zipJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Zip job not found or expired" });
  res.setHeader("Cache-Control", "private, no-store");
  res.json(publicZipJob(job));
});

app.get("/api/download/zip/:jobId/file", (req, res) => {
  const job = zipJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Zip job not found or expired" });
  if (job.status === "failed") return res.status(500).json({ error: job.error || "Failed to create zip" });
  if (job.status !== "done" || !fs.existsSync(job.filepath)) return res.status(409).json(publicZipJob(job));

  res.setHeader("Cache-Control", "private, no-store");
  res.download(job.filepath, job.filename, (err) => {
    if (err) console.error("Zip job download error:", err.message);
    else if (!job.downloadRecorded) {
      job.downloadRecorded = true;
      job.downloadedAt = Date.now();
      updateZipStats({ downloaded: 1, lastDownloadedAt: new Date(job.downloadedAt).toISOString() });
      if (job.downloadEmailCaptureId) {
        recordCapturedDownload({ id: job.downloadEmailCaptureId }, {
          requested: job.requested,
          accessibleFiles: job.includedAccess || [],
          quality: job.quality,
        });
      }
    }
    cleanupZipJob(job.id, ZIP_TRANSFERRED_TTL_MS);
  });
});

app.post("/api/download/zip", downloadZipLimiter, async (req, res) => {
  const valid = validateZipRequest(req, res);
  if (!valid) return;
  const { fileList, sessionKey, albumId, quality } = valid;
  const { accessibleFiles, missingCount, deniedCount, downgradedCount } = collectAccessibleZipFiles(fileList, sessionKey, albumId, quality);

  if (accessibleFiles.length === 0) {
    return res.status(403).json({
      error: "No accessible photos found for this session",
      missing: missingCount,
      denied: deniedCount,
      requested: fileList.length,
    });
  }

  const emailCapture = resolveDownloadEmailCapture(req, albumId, sessionKey, accessibleFiles);
  if (!emailCapture.ok) {
    return res.status(emailCapture.status).json({
      error: emailCapture.error,
      code: emailCapture.code,
      policy: emailCapture.policy,
    });
  }

  const entitlementClaim = claimFreePhotoDownloads(albumId, sessionKey, accessibleFiles.map(file => file.photoId));
  if (!entitlementClaim.ok) return res.status(entitlementClaim.status || 403).json({ error: entitlementClaim.error });

  const albumName = getZipAlbumName(albumId);

  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${albumName}.zip"`);
  res.setHeader("X-Zip-Requested", String(fileList.length));
  res.setHeader("X-Zip-Included", String(accessibleFiles.length));
  res.setHeader("X-Zip-Skipped", String(missingCount + deniedCount));
  res.setHeader("X-Zip-Downgraded-Watermarked", String(downgradedCount));

  // JPEG images are already compressed — store them as-is (level 0) to keep zip creation fast
  const archive = archiver("zip", { zlib: { level: 0 } });
  let zipFailed = false;
  archive.on("error", (err) => {
    zipFailed = true;
    console.error("Zip archive error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: "Failed to create zip" });
    else res.destroy(err);
  });

  archive.pipe(res);
  let nextIndex = 0;
  const addNextFiles = async () => {
    while (!zipFailed && !res.destroyed) {
      const index = nextIndex++;
      if (index >= accessibleFiles.length) return;
      const { safeName, filepath, clean, tenantSlug, quality: fileQuality, archiveName } = accessibleFiles[index];
      const preparedPath = fileQuality === "original"
        ? (clean ? filepath : await getWatermarkedZipFilePath(safeName, filepath, tenantSlug))
        : await getSizedZipFilePath(safeName, filepath, clean, tenantSlug, fileQuality);
      archive.file(preparedPath, { name: archiveName });
    }
  };
  const workerCount = Math.min(ZIP_WATERMARK_CONCURRENCY, accessibleFiles.length);
  try {
    await Promise.all(Array.from({ length: workerCount }, () => addNextFiles()));
    if (!zipFailed && !res.destroyed) {
      await archive.finalize();
      recordCapturedDownload(emailCapture.record, { requested: fileList.length, accessibleFiles, quality });
    }
  } catch (err) {
    zipFailed = true;
    console.error("Zip preparation error:", err?.message || err);
    try { archive.abort(); } catch {}
    if (!res.headersSent) res.status(500).json({ error: "Failed to prepare protected photos" });
    else res.destroy(err);
  }
});

// ── Discord webhook endpoints ─────────────────────────
/** Test a Discord webhook URL by sending a sample embed. */
app.post("/api/discord/test", requireAuth, async (req, res) => {
  const { webhookUrl } = req.body || {};
  if (!webhookUrl || typeof webhookUrl !== "string") {
    return res.status(400).json({ ok: false, error: "webhookUrl required" });
  }
  try {
    await sendDiscordEmbed(webhookUrl, {
      embeds: [{
        title: "✅ PhotoFlow — Connection Test",
        color: 0x7c3aed,
        description: "Your Discord webhook is connected and working correctly.",
        fields: [
          { name: "Status", value: "✅ Connected", inline: true },
          { name: "Service", value: "PhotoFlow", inline: true },
        ],
        footer: { text: "PhotoFlow · Discord Integration" },
        timestamp: new Date().toISOString(),
      }],
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || "Failed to send test message" });
  }
});

/** Generic Discord notification endpoint — used by frontend for custom events. */
app.post("/api/discord/notify", requireAuth, async (req, res) => {
  const db = readDb();

  // Support tenant-scoped notifications: if tenantSlug is provided, use that tenant's
  // Discord webhook settings instead of the global admin settings.
  const tenantSlug = req.body?.tenantSlug;
  let parsed;
  if (tenantSlug) {
    const tenantSettingsRaw = db[`t_${tenantSlug}_wv_tenant_settings`];
    parsed = tenantSettingsRaw
      ? (typeof tenantSettingsRaw === "string" ? JSON.parse(tenantSettingsRaw) : tenantSettingsRaw)
      : {};
  } else {
    const settings = db["wv_settings"];
    parsed = typeof settings === "string" ? JSON.parse(settings) : (settings || {});
  }

  const webhookUrl = parsed?.discordWebhookUrl;
  if (!webhookUrl) return res.json({ ok: true, skipped: true });

  const { event, type, booking, album, payment, photoCount, clientNote } = req.body || {};
  const eventType = event || type;

  try {
    switch (eventType) {
      case "new-booking":
        if (parsed?.discordNotifyBookings !== false && booking) await notifyNewBooking(webhookUrl, booking);
        break;
      case "new-enquiry": {
        const enquiry = req.body.enquiry;
        if (parsed?.discordNotifyBookings !== false && enquiry) await notifyNewEnquiry(webhookUrl, enquiry);
        break;
      }
      case "booking-update":
      case "booking-status":
        if (parsed?.discordNotifyBookings !== false && booking) await notifyBookingUpdate(webhookUrl, booking, req.body.oldStatus || booking.oldStatus, req.body.newStatus || booking.newStatus);
        break;
      case "payment":
        if (parsed?.discordNotifyBookings !== false && booking && payment) await notifyPayment(webhookUrl, booking, payment);
        break;
      case "album-purchase":
        if (parsed?.discordNotifyDownloads !== false && album) await notifyAlbumPurchase(webhookUrl, album, req.body.purchaseType || "full", req.body.amount || 0, req.body.email);
        break;
      case "proofing-submission":
        if (parsed?.discordNotifyProofing !== false && album) await notifyProofingSubmission(webhookUrl, album, photoCount || 0, clientNote);
        break;
      case "invoice-created":
      case "invoice-sent":
      case "invoice-paid":
      case "invoice-overdue":
      case "invoice-cancelled":
      case "invoice-reminder": {
        const invoice = req.body.invoice;
        const subType = eventType.replace("invoice-", "");
        if (parsed?.discordNotifyInvoices !== false && invoice) await notifyInvoice(webhookUrl, invoice, subType);
        break;
      }
      default:
        // Generic passthrough embed
        if (req.body.embeds) await sendDiscordEmbed(webhookUrl, req.body);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Discord notify error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** Get all tenant webhook configurations — super admin only.
 *  Requires the caller to pass the super-admin password hash as a Bearer token
 *  (matching how the rest of the app handles admin auth via hashed credentials). */
app.get("/api/super-admin/webhooks", async (req, res) => {
  if (!process.env.SUPER_ADMIN_USERNAME) return res.status(403).json({ ok: false, error: "Super admin not configured" });
  const username = await authenticatedAdminUsername(req);
  if (!username) return res.status(401).json({ ok: false, error: "Authentication required" });
  if (username.toLowerCase() !== String(process.env.SUPER_ADMIN_USERNAME).toLowerCase()) return res.status(403).json({ ok: false, error: "Forbidden" });

  function maskWebhookUrl(url) {
    if (!url) return null;
    // Mask the token part of Discord webhook URLs: /webhooks/{id}/{token} → /webhooks/{id}/***
    return url.replace(/(\/api\/webhooks\/[^/]+\/)([^/?]+)/, "$1***");
  }

  const db = readDb();
  const tenants = readTenants();
  const webhooks = tenants.map(t => {
    const rawSettings = db[`t_${t.slug}_wv_tenant_settings`];
    const settings = rawSettings ? (typeof rawSettings === "string" ? JSON.parse(rawSettings) : rawSettings) : {};
    return {
      tenantSlug: t.slug,
      displayName: t.displayName,
      discordWebhookUrl: maskWebhookUrl(settings.discordWebhookUrl || null),
      discordNotifyBookings: settings.discordNotifyBookings !== false,
      discordNotifyDownloads: settings.discordNotifyDownloads !== false,
      discordNotifyProofing: settings.discordNotifyProofing !== false,
      discordNotifyInvoices: settings.discordNotifyInvoices !== false,
    };
  });
  // Also include global admin webhook
  const globalRaw = db["wv_settings"];
  const globalSettings = globalRaw ? (typeof globalRaw === "string" ? JSON.parse(globalRaw) : globalRaw) : {};
  webhooks.unshift({
    tenantSlug: "__admin__",
    displayName: "Admin (Global)",
    discordWebhookUrl: maskWebhookUrl(globalSettings.discordWebhookUrl || null),
    discordNotifyBookings: globalSettings.discordNotifyBookings !== false,
    discordNotifyDownloads: globalSettings.discordNotifyDownloads !== false,
    discordNotifyProofing: globalSettings.discordNotifyProofing !== false,
    discordNotifyInvoices: globalSettings.discordNotifyInvoices !== false,
  });
  res.json({ ok: true, webhooks });
});

// ── Proofing submission endpoint ──────────────────────
app.post("/api/proofing/submit", async (req, res) => {
  const { albumId, selectedPhotoIds, clientNote } = req.body || {};
  if (!albumId || !Array.isArray(selectedPhotoIds)) {
    return res.status(400).json({ ok: false, error: "albumId and selectedPhotoIds required" });
  }
  try {
    const db = readDb();
    // Search across main and all tenant album stores
    const found = findAlbumById(db, albumId);
    if (!found) return res.status(404).json({ ok: false, error: "Album not found" });

    const { album, tenantSlug } = found;
    const timeZone = galleryTimezone(db, tenantSlug);
    if (albumAccessWindow(album, Date.now(), timeZone).galleryExpired) return res.status(410).json({ ok: false, error: "This gallery has expired" });
    const gallerySession = getGallerySessionForAlbum(req, album);
    if (!gallerySession || gallerySession.tenantSlug !== tenantSlug) return res.status(401).json({ ok: false, error: "A valid gallery session is required" });
    const normalizedSelectedIds = [...new Set(selectedPhotoIds.map(String).filter(Boolean))];
    const selectableIds = new Set(deliverableAlbumPhotos(album).map(photo => String(photo.id)));
    if (normalizedSelectedIds.length > selectableIds.size || normalizedSelectedIds.some(id => !selectableIds.has(id))) {
      return res.status(400).json({ ok: false, error: "One or more selected photos are unavailable" });
    }
    const storeKey = tenantSlug ? `t_${tenantSlug}_wv_albums` : "wv_albums";
    const raw = db[storeKey];
    const parsed = raw ? (typeof raw === "string" ? JSON.parse(raw) : (Array.isArray(raw) ? raw : [])) : [];
    const idx = parsed.findIndex(a => a.id === albumId);
    // Defensive check: findAlbumById already confirmed existence, but the parsed array
    // could be inconsistent if db was concurrently modified or corrupted.
    if (idx === -1) return res.status(500).json({ ok: false, error: "Album index inconsistency — please retry" });

    // Reject submissions when proofing is not enabled on the album
    if (!album.proofingEnabled) {
      return res.status(400).json({ ok: false, error: "Proofing is not enabled for this album" });
    }

    // Reject submissions after the proofing window has closed
    if (albumAccessWindow({ expiresAt: album.proofingExpiresAt }, Date.now(), timeZone).galleryExpired) {
      return res.status(403).json({ ok: false, error: "Proofing window has expired" });
    }

    // Reject submissions if the album is not in the active proofing stage
    if (album.proofingStage !== "proofing") {
      return res.status(400).json({ ok: false, error: "Album is not currently accepting proofing submissions" });
    }

    // Mark starred photos and record the round
    const selectedSet = new Set(normalizedSelectedIds);
    const updatedPhotos = (album.photos || []).map(p => ({
      ...p,
      starred: selectedSet.has(String(p.id)),
    }));

    const rounds = album.proofingRounds || [];
    const normalizedClientNote = typeof clientNote === "string" ? clientNote.trim().slice(0, 5000) : "";
    const submissionData = { selectedPhotoIds: normalizedSelectedIds, clientNote: normalizedClientNote || undefined, submittedAt: new Date().toISOString() };
    let updatedRounds;
    if (rounds.length > 0) {
      // Update the most recent round with the client's selections
      updatedRounds = rounds.map((r, i) =>
        i === rounds.length - 1 ? { ...r, ...submissionData } : r
      );
    } else {
      updatedRounds = [{ roundNumber: 1, sentAt: new Date().toISOString(), ...submissionData }];
    }

    const updatedAlbum = { ...album, photos: updatedPhotos, proofingStage: "selections-submitted", proofingRounds: updatedRounds };
    parsed[idx] = updatedAlbum;
    db[storeKey] = JSON.stringify(parsed);
    writeDb(db);

    // ── FTP: move newly-starred photos to the "-starred" sub-folder ──────────
    // Only runs when ftpStarredFolder is enabled in the applicable FTP settings.
    (async () => {
      try {
        let ftpSettings = null;
        if (tenantSlug) {
          const tsRaw = db[`t_${tenantSlug}_wv_tenant_settings`];
          const ts = tsRaw ? (typeof tsRaw === "string" ? JSON.parse(tsRaw) : tsRaw) : {};
          if (ts.ftpEnabled && ts.ftpHost && ts.ftpStarredFolder) ftpSettings = ts;
        } else {
          const raw = db["wv_ftp_settings"];
          const gs = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
          if (gs.ftpEnabled && gs.ftpHost && gs.ftpStarredFolder) ftpSettings = gs;
        }
        if (!ftpSettings) return;

        const folderBase = sanitizeFolderName(album.title || album.slug || albumId);
        const remotePath = ftpSettings.ftpRemotePath || "/";
        const sourceFolder = ftpSettings.ftpOrganizeByAlbum
          ? path.posix.join(remotePath, folderBase)
          : remotePath;
        const starredFolder = path.posix.join(remotePath, `${folderBase}-starred`);

        for (const p of updatedPhotos.filter(p => p.starred)) {
          const filename = uploadFilenameFromSrc(p.src);
          if (!filename) continue;
          const localFilePath = path.join(UPLOADS_DIR, filename);
          const fromPath = path.posix.join(sourceFolder, filename);
          const toPath = path.posix.join(starredFolder, filename);
          await moveFileOnFtp(
            fs.existsSync(localFilePath) ? localFilePath : null,
            fromPath,
            toPath,
            ftpSettings
          ).catch(err => console.warn("[FTP] Starred move failed for", filename, err.message));
        }
      } catch (ftpErr) {
        console.warn("[FTP] Starred folder move error:", ftpErr.message);
      }
    })();

    // Fire discord notification — use tenant webhook if available, else main
    let discordUrl, discordNotify;
    if (tenantSlug) {
      const tsRaw = db[`t_${tenantSlug}_wv_tenant_settings`];
      const ts = tsRaw ? (typeof tsRaw === "string" ? JSON.parse(tsRaw) : tsRaw) : {};
      discordUrl = ts?.discordWebhookUrl;
      discordNotify = ts?.discordNotifyProofing !== false;
    } else {
      const settings = db["wv_settings"];
      const settingsParsed = typeof settings === "string" ? JSON.parse(settings) : (settings || {});
      discordUrl = settingsParsed?.discordWebhookUrl;
      discordNotify = settingsParsed?.discordNotifyProofing !== false;
    }
    if (discordUrl && discordNotify) {
      notifyProofingSubmission(discordUrl, updatedAlbum, normalizedSelectedIds.length, normalizedClientNote).catch(() => {});
    }

    res.json({ ok: true, album: publicAlbumDto(updatedAlbum, gallerySession) });
  } catch (err) {
    console.error("Proofing submit error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to save proofing picks" });
  }
});

// ── Cache warm / force-render ─────────────────────────
// mode=warm  → thumb variants only, skip files that already exist in cache
// mode=force → all variants (thumb + medium + full), overwrite everything
const cacheWarmLimiter = rateLimit({ windowMs: 60_000, max: 1, standardHeaders: true, legacyHeaders: false, message: { error: "A cache warm job is already running — please wait" } });
app.post("/api/cache/warm", cacheWarmLimiter, requireAuth, async (req, res) => {
  const mode = (req.query.mode || req.body?.mode || "warm");
  const forceAll = mode === "force";
  const sizesToRender = forceAll ? ["thumb", "medium", "full"] : ["thumb"];

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Transfer-Encoding", "chunked");

  let files;
  try {
    files = fs.readdirSync(UPLOADS_DIR).filter(f => {
      return !isIgnoredSystemFileName(f) && isSupportedImageFilename(f);
    });
  } catch {
    res.end(JSON.stringify({ ok: false, error: "Cannot read uploads directory" }) + "\n");
    return;
  }

  const total = files.length;
  let done = 0;
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  const modeLabel = forceAll ? "force-rendering all variants" : "warming thumbnails";
  res.write(JSON.stringify({ progress: true, done: 0, total, generated: 0, skipped: 0, failed: 0, stage: `Starting ${modeLabel} for ${total} photos…` }) + "\n");

  for (const filename of files) {
    const filepath = path.join(UPLOADS_DIR, filename);
    const baseName = path.basename(filename, path.extname(filename));

    for (const sizeLabel of sizesToRender) {
      for (const watermarked of [true, false]) {
        const cacheFile = path.join(CACHE_DIR, getCacheFilename(baseName, sizeLabel, watermarked));
        // In warm mode skip existing; in force mode always overwrite
        if (!forceAll && fs.existsSync(cacheFile)) { skipped++; continue; }
        try {
          const targetSize = sizeLabel === "thumb" ? THUMB_WIDTH : sizeLabel === "medium" ? MEDIUM_WIDTH : null;
          let pipeline = targetSize
            ? sharp(filepath).resize(targetSize, null, { fit: "inside", withoutEnlargement: true })
            : sharp(filepath);
          if (watermarked) {
            const meta = await sharp(filepath).metadata();
            const origW = meta.width || 2000;
            const origH = meta.height || 2000;
            // Build the watermark overlay using post-resize dimensions so the
            // warmed cache matches what the live /uploads/:filename endpoint produces.
            let renderW = origW;
            let renderH = origH;
            if (targetSize && origW > targetSize) {
              renderW = targetSize;
              renderH = Math.round(origH * (targetSize / origW));
            }
            const wm = getWatermarkSettings();
            const overlay = await buildWatermarkOverlay(renderW, renderH, wm);
            pipeline = pipeline.composite([overlay]);
          }
          const buf = await pipeline.jpeg({ quality: 82, progressive: true }).toBuffer();
          fs.writeFileSync(cacheFile, buf);
          generated++;
        } catch (err) { failed++; console.error(`Cache warm error [${sizeLabel}/${watermarked ? "wm" : "clean"}] ${filename}:`, err.message); }
      }
    }

    done++;
    if (done % 5 === 0 || done === total) {
      res.write(JSON.stringify({ progress: true, done, total, generated, skipped, failed, stage: `${done}/${total} — ${filename}` }) + "\n");
    }
  }

  res.end(JSON.stringify({ ok: true, done: total, total, generated, skipped, failed, stage: "Complete" }) + "\n");
});

// ── Shared store object (used by email routes + automation scheduler) ────────
// Provides a unified get/set interface over the in-memory DB cache so that
// email helpers (appendEmailLog, reminder sender) don't need direct access to
// the raw readDb / writeDb functions.
const store = {
  get(key) {
    const db = readDb();
    const raw = db[key];
    if (raw === undefined || raw === null) return null;
    if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return raw; } }
    return raw;
  },
  set(key, value) {
    const db = readDb();
    db[key] = value;
    writeDb(db);
  },
};

function sendMainBookingReceipt(booking, options = {}) {
  const profile = dbGet(readDb(), DB_KEYS.PROFILE, {});
  return sendBookingConfirmationEmail({
    to: booking.clientEmail,
    clientName: booking.clientName,
    eventTitle: booking.type,
    date: booking.date,
    time: booking.time,
    duration: booking.duration,
    location: booking.location || "",
    price: booking.paymentAmount || 0,
    depositAmount: booking.depositAmount || 0,
    paymentMethod: booking.paymentMethod || booking.depositMethod || booking.paymentPath || (booking.paymentAmount ? "stripe" : "none"),
    paymentStatus: booking.paymentStatus,
    status: booking.status,
    modifyToken: booking.modifyToken,
    bookingId: booking.id,
    paymentReference: booking.paymentReference,
    appBaseUrl: String(process.env.APP_BASE_URL || `https://${String(process.env.APP_HOSTS || "book.zacmclients.photos").split(",")[0].trim()}`).replace(/\/$/, ""),
    store: options.recordEmailLog === false ? null : store,
    brandName: profile.businessName || profile.brandName || profile.name || "PhotoFlow",
  });
}

async function sendTenantBookingReceipt(booking, eventKey, options = {}) {
  const db = readDb();
  const settings = dbGet(db, `t_${booking.tenantSlug}_wv_tenant_settings`, {});
  const tenant = readTenants().find(item => item.slug === booking.tenantSlug);
  const transport = buildTenantTransporter(settings);
  if (!transport) return { ok: false, reason: "not_configured" };
  const bookings = getStoredArray(db, DB_KEYS.BOOKINGS);
  const index = bookings.findIndex(item => item.id === booking.id && item.tenantSlug === booking.tenantSlug);
  if (index < 0) return { ok: false, reason: "not_found" };
  const events = Array.isArray(bookings[index].receiptEmailEvents) ? bookings[index].receiptEmailEvents : [];
  if (events.some(event => event.key === eventKey)) return { ok: true, duplicate: true };
  events.push({ key: eventKey, status: "queued", createdAt: new Date().toISOString() });
  bookings[index].receiptEmailEvents = events;
  db[DB_KEYS.BOOKINGS] = JSON.stringify(bookings);
  writeDb(db);
  const result = await sendBookingConfirmationEmail({
    to: booking.clientEmail,
    clientName: booking.clientName,
    eventTitle: booking.type,
    date: booking.date,
    time: booking.time,
    duration: booking.duration,
    location: booking.location || "",
    price: booking.paymentAmount || 0,
    depositAmount: booking.depositAmount || 0,
    paymentMethod: booking.paymentMethod || booking.depositMethod || booking.paymentPath || (booking.paymentAmount ? "stripe" : "none"),
    paymentStatus: booking.paymentStatus,
    status: booking.status,
    paymentKind: booking.lastPaymentKind || options.paymentKind,
    modifyToken: booking.modifyToken,
    bookingId: booking.id,
    paymentReference: booking.paymentReference,
    appBaseUrl: String(process.env.APP_BASE_URL || `https://${String(process.env.APP_HOSTS || "book.zacmclients.photos").split(",")[0].trim()}`).replace(/\/$/, ""),
    transport,
    fromAddress: getTenantFromAddress(settings),
    brandName: settings.businessName || settings.brandName || tenant?.displayName || "PhotoFlow",
  });
  const resultDb = readDb();
  const resultBookings = getStoredArray(resultDb, DB_KEYS.BOOKINGS);
  const resultIndex = resultBookings.findIndex(item => item.id === booking.id && item.tenantSlug === booking.tenantSlug);
  if (resultIndex >= 0) {
    resultBookings[resultIndex].receiptEmailEvents = (resultBookings[resultIndex].receiptEmailEvents || []).map(event =>
      event.key === eventKey ? { ...event, status: result.ok ? "sent" : "failed", completedAt: new Date().toISOString(), error: result.ok ? undefined : String(result.error || result.reason || "unknown").slice(0, 500) } : event
    );
    resultDb[DB_KEYS.BOOKINGS] = JSON.stringify(resultBookings);
    writeDb(resultDb);
  }
  return result;
}

async function sendBookingUpdateReceipt(booking, updateType, previousBooking) {
  if (!booking?.clientEmail || booking.emailsDisabled) return { ok: false, reason: "unsubscribed_or_missing_email" };
  const db = readDb();
  const profile = dbGet(db, DB_KEYS.PROFILE, {});
  const tenant = booking.tenantSlug ? readTenants().find(item => item.slug === booking.tenantSlug) : null;
  const settings = booking.tenantSlug ? dbGet(db, `t_${booking.tenantSlug}_wv_tenant_settings`, {}) : null;
  const transport = booking.tenantSlug ? buildTenantTransporter(settings) : getTransporter();
  const fromAddress = booking.tenantSlug ? getTenantFromAddress(settings) : getFromAddress();
  if (!transport || !fromAddress) return { ok: false, reason: "not_configured" };
  const appBaseUrl = String(process.env.APP_BASE_URL || `https://${String(process.env.APP_HOSTS || "book.zacmclients.photos").split(",")[0].trim()}`).replace(/\/$/, "");
  return sendBookingUpdateEmail({
    transport,
    fromAddress,
    to: booking.clientEmail,
    store,
    updateType,
    clientName: booking.clientName,
    eventTitle: booking.type,
    date: booking.date,
    time: booking.time,
    duration: booking.duration,
    location: booking.location || "",
    bookingId: booking.id,
    paymentReference: booking.paymentReference,
    modifyUrl: booking.modifyToken && appBaseUrl
      ? `${appBaseUrl}/booking/modify/${encodeURIComponent(booking.modifyToken)}`
      : "",
    previousDate: previousBooking?.date,
    previousTime: previousBooking?.time,
    brandName: settings?.businessName || settings?.brandName || tenant?.displayName || profile.businessName || profile.brandName || profile.name || "PhotoFlow",
  });
}

// ── Integrations ──────────────────────────────────────
registerGoogleCalendarRoutes(app, {
  requireAuth,
  readDb,
  writeDb,
  createOAuthState: () => signSession({ purpose: "admin-gcal", sub: "admin" }, SESSION_SECRET, { ttlSeconds: 10 * 60 }),
  verifyOAuthState: state => !!verifySession(state, SESSION_SECRET, { purpose: "admin-gcal" }),
});
registerEmailRoutes(app, store, { requireAuth });
registerStripeRoutes(app, { readDb, writeDb, readLicenseKeys, writeLicenseKeys, requireAuth, getGallerySession: getGallerySessionForAlbum, onBookingPaid: queueInitialBookingCalendarSync });
registerTenantStripeRoutes(app, { readDb, writeDb, readTenants, readLicenseKeys, getLicKeyLimits, readEventSlotRequests, writeEventSlotRequests, requireTenant, getGallerySession: getGallerySessionForAlbum, sendTenantBookingReceipt, onBookingPaid: queueInitialBookingCalendarSync, isTenantLicensed: tenantIsLicensed });
registerGoogleSheetsRoutes(app, { requireAuth });

const tenantLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests" } });
const tenantPublicLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests" } });
const tenantBookingLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests" } });

// ── Per-tenant Google Calendar integration ────────────────────────────────
// Allows each tenant to configure their own Google OAuth2 credentials and
// connect their own Google Calendar account independently.
(function registerTenantGoogleCalendarRoutes() {
  const { google } = require("googleapis");

  function getTenantGcalCredentials(slug) {
    const db = readDb();
    const rawSettings = db[`t_${slug}_wv_tenant_settings`];
    const settings = rawSettings ? (typeof rawSettings === "string" ? JSON.parse(rawSettings) : rawSettings) : {};
    const raw = settings.googleApiCredentials;
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function getTenantOAuth2Client(slug) {
    const creds = getTenantGcalCredentials(slug);
    if (!creds?.web) return null;
    const { client_id, client_secret, redirect_uris } = creds.web;
    const redirectUri = (redirect_uris || []).find(u => u.includes("googlecalendar")) || redirect_uris?.[0];
    return new google.auth.OAuth2(client_id, client_secret, redirectUri);
  }

  function loadTenantTokens(slug) {
    const db = readDb();
    const raw = db[`t_${slug}_wv_gcal_tokens`];
    if (!raw) return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  }

  function saveTenantTokens(slug, tokens) {
    const db = readDb();
    db[`t_${slug}_wv_gcal_tokens`] = tokens;
    writeDb(db);
  }

  function clearTenantTokens(slug) {
    const db = readDb();
    delete db[`t_${slug}_wv_gcal_tokens`];
    writeDb(db);
  }

  function loadTenantCalSettings(slug) {
    const db = readDb();
    const raw = db[`t_${slug}_wv_gcal_settings`];
    if (!raw) return {};
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  }

  function saveTenantCalSettings(slug, patch) {
    const db = readDb();
    const existing = loadTenantCalSettings(slug);
    db[`t_${slug}_wv_gcal_settings`] = { ...existing, ...patch };
    writeDb(db);
  }

  function getAuthenticatedTenantClient(slug) {
    const client = getTenantOAuth2Client(slug);
    if (!client) return null;
    const tokens = loadTenantTokens(slug);
    if (!tokens?.access_token) return null;
    client.setCredentials(tokens);
    client.on("tokens", t => saveTenantTokens(slug, { ...tokens, ...t }));
    return client;
  }

  // Status
  app.get("/api/tenant/:slug/integrations/googlecalendar/status", tenantLimiter, requireTenant, (req, res) => {
    const { slug } = req.params;
    const tokens   = loadTenantTokens(slug);
    const settings = loadTenantCalSettings(slug);
    const creds    = getTenantGcalCredentials(slug);
    res.json({
      configured: !!creds?.web,
      connected:  !!tokens?.access_token,
      email:      tokens?.email || null,
      autoSync:   settings.autoSync  ?? false,
      calendarId: settings.calendarId || "primary",
    });
  });

  // Start OAuth — redirects browser to Google consent screen
  app.get("/api/tenant/:slug/integrations/googlecalendar/auth", tenantLimiter, requireTenant, (req, res) => {
    const { slug } = req.params;
    const client = getTenantOAuth2Client(slug);
    if (!client) return res.status(400).json({ error: "Google credentials not configured for this account" });
    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/userinfo.email",
      ],
      state: signSession({ purpose: "tenant-gcal", sub: slug }, SESSION_SECRET, { ttlSeconds: 10 * 60 }),
    });
    res.json({ url });
  });

  // OAuth callback — saves tokens and redirects back to tenant admin
  app.get("/api/tenant/:slug/integrations/googlecalendar/callback", tenantLimiter, requireTenant, async (req, res) => {
    const { slug } = req.params;
    const { code, state } = req.query;
    if (!code) return res.status(400).send("Missing code");
    const oauthState = verifySession(String(state || ""), SESSION_SECRET, { purpose: "tenant-gcal" });
    if (!oauthState || oauthState.sub !== slug) return res.status(400).send("Invalid or expired OAuth state");
    const client = getTenantOAuth2Client(slug);
    if (!client) return res.status(400).send("Google credentials not configured");
    try {
      const { tokens } = await client.getToken(code);
      client.setCredentials(tokens);
      const oauth2 = google.oauth2({ version: "v2", auth: client });
      tokens.email = (await oauth2.userinfo.get()).data.email;
      saveTenantTokens(slug, tokens);
      res.redirect(`/tenant-admin/${slug}?gcal=connected`);
    } catch (err) {
      console.error("Tenant Google OAuth error:", err);
      res.redirect(`/tenant-admin/${slug}?gcal=error`);
    }
  });

  // Disconnect
  app.post("/api/tenant/:slug/integrations/googlecalendar/disconnect", tenantLimiter, requireTenant, (req, res) => {
    clearTenantTokens(req.params.slug);
    res.json({ ok: true });
  });

  // List calendars
  app.get("/api/tenant/:slug/integrations/googlecalendar/calendars", tenantLimiter, requireTenant, async (req, res) => {
    const auth = getAuthenticatedTenantClient(req.params.slug);
    if (!auth) return res.status(401).json({ error: "Not connected" });
    try {
      const { data } = await google.calendar({ version: "v3", auth }).calendarList.list();
      res.json({ calendars: data.items || [] });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Save calendar settings (autoSync, calendarId)
  app.post("/api/tenant/:slug/integrations/googlecalendar/settings", tenantLimiter, requireTenant, (req, res) => {
    saveTenantCalSettings(req.params.slug, req.body);
    res.json({ ok: true });
  });

  // Sync a single booking
  app.post("/api/tenant/:slug/integrations/googlecalendar/event", tenantLimiter, requireTenant, async (req, res) => {
    const { slug } = req.params;
    const auth = getAuthenticatedTenantClient(slug);
    if (!auth) return res.status(401).json({ error: "Not connected" });
    const { booking, calendarId } = req.body;
    if (!booking) return res.status(400).json({ error: "Missing booking" });
    const calId = calendarId || loadTenantCalSettings(slug).calendarId || "primary";
    try {
      const cal = google.calendar({ version: "v3", auth });
      const tenant = readTenants().find(item => item.slug === slug);
      const requestBody = buildBookingCalendarEvent(booking, tenant?.timezone || "Australia/Sydney");
      let eventId = booking.gcalEventId || null;
      let updated = false;
      if (eventId && booking.gcalCalendarId && booking.gcalCalendarId !== calId) {
        try { await cal.events.delete({ calendarId: booking.gcalCalendarId, eventId }); }
        catch (error) {
          const status = Number(error?.code || error?.response?.status);
          if (status !== 404 && status !== 410) throw error;
        }
        eventId = null;
      }
      if (eventId) {
        try {
          const { data } = await cal.events.update({ calendarId: calId, eventId, requestBody });
          eventId = data.id;
          updated = true;
        } catch (error) {
          const status = Number(error?.code || error?.response?.status);
          if (status !== 404 && status !== 410) throw error;
          eventId = null;
        }
      }
      if (!eventId) {
        const existing = await cal.events.list({ calendarId: calId, privateExtendedProperty: [`watermarkVaultBookingId=${booking.id}`], singleEvents: true, showDeleted: false, maxResults: 10 });
        eventId = existing.data.items?.find(item => item.status !== "cancelled" && item.id)?.id || null;
        if (eventId) {
          const { data } = await cal.events.update({ calendarId: calId, eventId, requestBody });
          eventId = data.id;
          updated = true;
        } else {
          const { data } = await cal.events.insert({ calendarId: calId, requestBody });
          eventId = data.id;
        }
      }
      persistBookingCalendarEventLink(booking.id, eventId, calId);
      res.json({ ok: true, eventId, updated });
    } catch (err) {
      console.error("Tenant calendar event error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });
})();

// Shared limiter for authenticated administration routes. Keep this declared
// before the first route that references it; const bindings are not usable
// during module initialization before their declaration.
const superLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests" } });

// ── Atomic invoice administration ─────────────────────────────
const INVOICE_SERVER_MANAGED_FIELDS = new Set([
  "stripeSessionId", "stripeCheckoutOrderId", "stripeCheckoutSessionId",
  "stripeCheckoutStartedAt", "stripeCheckoutStatus", "stripeCheckoutSnapshotHash",
  "paymentNeedsReview", "paymentReviewStatus", "paymentReviewReason", "paymentReviews",
]);

function allocateInvoiceNumber(invoices, preferred = "", excludeId = "") {
  const used = new Set(invoices
    .filter(invoice => String(invoice?.id || "") !== String(excludeId || ""))
    .map(invoice => String(invoice?.number || "").trim().toUpperCase())
    .filter(Boolean));
  const requested = String(preferred || "").trim().toUpperCase();
  if (requested && !used.has(requested)) return requested;
  let next = Math.max(0, ...invoices.map(invoice => parseInt(String(invoice?.number || "").replace(/\D/g, ""), 10) || 0)) + 1;
  let candidate;
  do { candidate = `INV-${String(next++).padStart(4, "0")}`; } while (used.has(candidate));
  return candidate;
}

function validInvoiceInput(value) {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && String(value.id || "").trim().length > 0
    && String(value.id || "").trim().length <= 128
    && Array.isArray(value.items)
    && value.items.length <= 500;
}

app.get("/api/admin/invoices", superLimiter, requireAuth, (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(getStoredArray(readDb(), DB_KEYS.INVOICES));
});

app.post("/api/admin/invoices", superLimiter, requireAuth, authenticatedLargeJson, (req, res) => {
  const input = req.body?.invoice;
  if (!validInvoiceInput(input)) return res.status(400).json({ ok: false, code: "INVALID_INVOICE", error: "A valid invoice is required" });
  return withCheckoutResourceLock("invoice-store:main", () => {
    const db = readDb();
    const invoices = getStoredArray(db, DB_KEYS.INVOICES);
    if (invoices.some(invoice => String(invoice.id) === String(input.id))) {
      return res.status(409).json({ ok: false, code: "INVOICE_EXISTS", error: "Invoice already exists" });
    }
    const invoice = {
      ...input,
      id: String(input.id),
      number: allocateInvoiceNumber(invoices, input.number),
      createdAt: String(input.createdAt || new Date().toISOString()),
    };
    invoices.push(invoice);
    db[DB_KEYS.INVOICES] = JSON.stringify(invoices);
    writeDb(db);
    return res.status(201).json({ ok: true, invoice });
  });
});

app.put("/api/admin/invoices/:id", superLimiter, requireAuth, authenticatedLargeJson, (req, res) => {
  const invoiceId = String(req.params.id || "").trim();
  const input = req.body?.invoice;
  if (!invoiceId || !validInvoiceInput({ ...input, id: invoiceId })) return res.status(400).json({ ok: false, code: "INVALID_INVOICE", error: "A valid invoice is required" });
  return withCheckoutResourceLock(`checkout:main:invoice:${invoiceId}`, () => withCheckoutResourceLock("invoice-store:main", () => {
    const db = readDb();
    const invoices = getStoredArray(db, DB_KEYS.INVOICES);
    const index = invoices.findIndex(invoice => String(invoice?.id || "") === invoiceId && invoice?.tenantSlug == null);
    if (index < 0) return res.status(404).json({ ok: false, code: "INVOICE_NOT_FOUND", error: "Invoice not found" });
    const previous = invoices[index];
    const invoice = { ...previous, ...input, id: invoiceId, number: allocateInvoiceNumber(invoices, input.number, invoiceId) };
    for (const field of INVOICE_SERVER_MANAGED_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(previous, field)) invoice[field] = previous[field];
      else delete invoice[field];
    }
    invoices[index] = invoice;
    db[DB_KEYS.INVOICES] = JSON.stringify(invoices);
    writeDb(db);
    return res.json({ ok: true, invoice });
  }));
});

app.delete("/api/admin/invoices/:id", superLimiter, requireAuth, (req, res) => {
  const invoiceId = String(req.params.id || "").trim();
  return withCheckoutResourceLock(`checkout:main:invoice:${invoiceId}`, () => withCheckoutResourceLock("invoice-store:main", () => {
    const db = readDb();
    const invoices = getStoredArray(db, DB_KEYS.INVOICES);
    const index = invoices.findIndex(invoice => String(invoice?.id || "") === invoiceId && invoice?.tenantSlug == null);
    if (index < 0) return res.status(404).json({ ok: false, code: "INVOICE_NOT_FOUND", error: "Invoice not found" });
    if (["open", "processing"].includes(String(invoices[index].stripeCheckoutStatus || ""))) {
      return res.status(409).json({ ok: false, code: "INVOICE_CHECKOUT_ACTIVE", error: "Expire or complete the active Stripe checkout before deleting this invoice" });
    }
    const [deleted] = invoices.splice(index, 1);
    db[DB_KEYS.INVOICES] = JSON.stringify(invoices);
    writeDb(db);
    return res.json({ ok: true, invoice: deleted });
  }));
});

function dataIntegrityRepairSnapshot(db, apply = false) {
  const now = new Date();
  const nowIso = now.toISOString();
  const bookings = getStoredArray(db, DB_KEYS.BOOKINGS);
  const invoices = getStoredArray(db, DB_KEYS.INVOICES);
  const issues = { bookingReferences: 0, paymentTimestamps: 0, paidPendingBookings: 0, expiredHolds: 0, invoiceNumbers: 0 };
  const repairedBookings = bookings.map(source => {
    const booking = { ...source };
    const currentReference = String(booking.paymentReference || "").trim();
    if (!currentReference || currentReference.length > 16 || /^BK-\d{8}-/i.test(currentReference)) {
      issues.bookingReferences++;
      if (apply) booking.paymentReference = `PF-${crypto.createHash("sha256").update(String(booking.id || "booking")).digest("hex").slice(0, 8).toUpperCase()}`;
    }
    const settledAt = booking.stripePaidAt || booking.depositPaidAt || booking.updatedAt || booking.createdAt || nowIso;
    if (["paid", "cash"].includes(String(booking.paymentStatus || "")) && !booking.paidAt) {
      issues.paymentTimestamps++;
      if (apply) booking.paidAt = settledAt;
    }
    if (booking.paymentStatus === "deposit-paid" && !booking.depositPaidAt) {
      issues.paymentTimestamps++;
      if (apply) booking.depositPaidAt = booking.paidAt || booking.updatedAt || booking.createdAt || nowIso;
    }
    if (booking.status === "pending" && booking.requiresConfirmation !== true && ["paid", "cash"].includes(String(booking.paymentStatus || ""))) {
      issues.paidPendingBookings++;
      if (apply) {
        booking.status = "confirmed";
        booking.statusHistory = [...(Array.isArray(booking.statusHistory) ? booking.statusHistory : []), { status: "confirmed", changedAt: nowIso, note: "Data repair: settled payment" }];
      }
    }
    const holdExpired = Number.isFinite(Date.parse(String(booking.holdExpiresAt || ""))) && Date.parse(booking.holdExpiresAt) <= now.getTime();
    const unsettled = !["paid", "cash", "deposit-paid"].includes(String(booking.paymentStatus || "unpaid"));
    if (booking.status === "pending" && unsettled && holdExpired && booking.archived !== true) {
      issues.expiredHolds++;
      if (apply) {
        booking.archived = true;
        booking.archivedAt = nowIso;
        booking.archiveReason = "Expired unpaid booking hold";
      }
    }
    return booking;
  });

  const seenNumbers = new Set();
  const repairedInvoices = invoices.map(invoice => {
    const number = String(invoice?.number || "").trim().toUpperCase();
    if (!number || seenNumbers.has(number)) {
      issues.invoiceNumbers++;
      const repaired = apply ? { ...invoice, number: allocateInvoiceNumber([...invoices, ...Array.from(seenNumbers).map(value => ({ number: value }))], "", invoice.id) } : invoice;
      if (apply) seenNumbers.add(repaired.number);
      return repaired;
    }
    seenNumbers.add(number);
    return invoice;
  });
  const total = Object.values(issues).reduce((sum, count) => sum + count, 0);
  return { total, issues, bookings: repairedBookings, invoices: repairedInvoices, repairedAt: nowIso };
}

app.get("/api/admin/data-integrity", superLimiter, requireAuth, (_req, res) => {
  const report = dataIntegrityRepairSnapshot(readDb(), false);
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, total: report.total, issues: report.issues });
});

app.post("/api/admin/data-integrity/repair", superLimiter, requireAuth, (req, res) => {
  return withCheckoutResourceLock("data-integrity:main", () => {
    const db = readDb();
    const report = dataIntegrityRepairSnapshot(db, true);
    if (report.total > 0) {
      db[DB_KEYS.BOOKINGS] = JSON.stringify(report.bookings);
      db[DB_KEYS.INVOICES] = JSON.stringify(report.invoices);
      const audit = getStoredArray(db, "wv_data_repair_audit");
      audit.push({ repairedAt: report.repairedAt, issues: report.issues, actor: "admin" });
      db.wv_data_repair_audit = JSON.stringify(audit.slice(-100));
      writeDb(db);
    }
    res.json({ ok: true, total: report.total, issues: report.issues, repairedAt: report.repairedAt });
  });
});

// ── Invoice share endpoint (public — no auth required) ────────
const invoiceShareLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests" } });
function safeInvoiceParty(party) {
  const source = party && typeof party === "object" ? party : {};
  return Object.fromEntries(["name", "email", "address", "abn", "taxNumber", "vatId"]
    .filter(key => source[key] != null).map(key => [key, String(source[key]).slice(0, 1000)]));
}

function safePublicInvoiceDto(invoice, tenantSlug, bankTransfer) {
  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    from: safeInvoiceParty(invoice.from),
    to: safeInvoiceParty(invoice.to),
    items: (Array.isArray(invoice.items) ? invoice.items : []).slice(0, 500).map(item => ({
      id: item.id,
      description: String(item.description || "").slice(0, 2000),
      subdescription: item.subdescription ? String(item.subdescription).slice(0, 2000) : undefined,
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unitPrice) || 0,
    })),
    currency: invoice.currency || "AUD",
    notes: String(invoice.notes || "").slice(0, 10_000),
    dueDate: invoice.dueDate,
    serviceDate: invoice.serviceDate,
    serviceDateNote: invoice.serviceDateNote,
    receiptAttachmentNote: invoice.receiptAttachmentNote,
    createdAt: invoice.createdAt,
    sentAt: invoice.sentAt,
    paidAt: invoice.paidAt,
    tax: invoice.tax,
    discount: invoice.discount,
    amountPaid: invoice.amountPaid,
    albumId: invoice.albumId,
    albumSlug: invoice.albumSlug,
    albumTitle: invoice.albumTitle,
    albumProtected: invoice.albumProtected,
    albumAccessUrl: invoice.albumAccessUrl || null,
    showAlbumLinkAfterPayment: invoice.showAlbumLinkAfterPayment === true,
    paymentMethods: tenantSlug
      ? (bankTransfer?.enabled ? ["bank"] : [])
      : (Array.isArray(invoice.paymentMethods) ? invoice.paymentMethods.filter(method => ["stripe", "bank"].includes(method)) : undefined),
    tenantSlug,
    cardPaymentAvailable: !tenantSlug && mainStripeReady() && (!Array.isArray(invoice.paymentMethods) || invoice.paymentMethods.includes("stripe")),
    bankTransfer,
  };
}

function findSharedInvoice(db, token) {
  const matches = [];
  const main = dbGet(db, DB_KEYS.INVOICES, []);
  for (const invoice of Array.isArray(main) ? main : []) if (timingSafeTextEqual(invoice.shareToken, token)) matches.push({ invoice, tenantSlug: null });
  const active = new Set(readTenants().filter(tenant => tenantIsLicensed(tenant)).map(tenant => tenant.slug));
  for (const slug of active) {
    const invoices = dbGet(db, `t_${slug}_wv_invoices`, []);
    for (const invoice of Array.isArray(invoices) ? invoices : []) if (timingSafeTextEqual(invoice.shareToken, token)) matches.push({ invoice, tenantSlug: slug });
  }
  return matches.length === 1 ? matches[0] : null;
}

app.get("/api/invoice/share/:token", invoiceShareLimiter, (req, res) => {
  const db = readDb();
  const match = findSharedInvoice(db, req.params.token);
  if (!match) return res.status(404).json({ error: "Invoice not found" });
  const enriched = { ...match.invoice };
  let linkedAlbum = null;
  if (enriched.albumId && (!enriched.albumSlug || !enriched.albumTitle)) {
    const albums = dbGet(db, match.tenantSlug ? `t_${match.tenantSlug}_wv_albums` : DB_KEYS.ALBUMS, []);
    linkedAlbum = Array.isArray(albums) ? albums.find(a => a.id === enriched.albumId) : null;
    if (linkedAlbum) {
      enriched.albumSlug = enriched.albumSlug || linkedAlbum.slug || linkedAlbum.id;
      enriched.albumTitle = enriched.albumTitle || linkedAlbum.title || "Client gallery";
    }
  } else if (enriched.albumId) {
    const albums = dbGet(db, match.tenantSlug ? `t_${match.tenantSlug}_wv_albums` : DB_KEYS.ALBUMS, []);
    linkedAlbum = Array.isArray(albums) ? albums.find(album => album.id === enriched.albumId) : null;
  }
  if (linkedAlbum) {
    enriched.albumProtected = !!linkedAlbum.accessCode || !!linkedAlbum.clientToken;
    if (enriched.status === "paid" && enriched.showAlbumLinkAfterPayment === true) {
      enriched.albumAccessUrl = `/gallery/${encodeURIComponent(linkedAlbum.slug || linkedAlbum.id)}${linkedAlbum.clientToken ? `#token=${encodeURIComponent(linkedAlbum.clientToken)}` : ""}`;
    }
  }
  const tenantSettings = match.tenantSlug ? dbGet(db, `t_${match.tenantSlug}_wv_tenant_settings`, {}) : null;
  const globalSettings = dbGet(db, DB_KEYS.SETTINGS, {});
  const bankTransfer = match.tenantSlug
    ? (tenantSettings?.bankTransferEnabled ? {
      enabled: true,
      accountName: tenantSettings.bankAccountName || null,
      bsb: tenantSettings.bankBsb || null,
      accountNumber: tenantSettings.bankAccountNumber || null,
      payId: tenantSettings.bankPayId || null,
      payIdType: tenantSettings.bankPayIdType || null,
      instructions: tenantSettings.bankInstructions || null,
    } : null)
    : (globalSettings?.bankTransfer?.enabled ? {
      enabled: true,
      accountName: globalSettings.bankTransfer.accountName || null,
      bsb: globalSettings.bankTransfer.bsb || null,
      accountNumber: globalSettings.bankTransfer.accountNumber || null,
      payId: globalSettings.bankTransfer.payId || null,
      payIdType: globalSettings.bankTransfer.payIdType || null,
      instructions: globalSettings.bankTransfer.instructions || null,
    } : null);
  res.setHeader("Cache-Control", "private, no-store");
  res.json(safePublicInvoiceDto(enriched, match.tenantSlug, bankTransfer));
});

// ── Tenants ──────────────────────────────────────────
const TENANTS_FILE = path.join(DATA_DIR, "tenants.json");

/** Slugs must be lowercase alphanumeric with optional hyphens, 2-30 chars */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,28}[a-z0-9]$|^[a-z0-9]{1,2}$/;

function readTenants() {
  try {
    if (!fs.existsSync(TENANTS_FILE)) return [];
    const tenants = JSON.parse(fs.readFileSync(TENANTS_FILE, "utf-8"));
    if (!Array.isArray(tenants)) throw new Error("Tenant database must contain an array");
    return tenants;
  } catch (err) {
    console.error("Unable to read tenants database:", err.message);
    throw err;
  }
}

function galleryTimezone(db, tenantSlug) {
  if (tenantSlug) {
    const tenant = readTenants().find(item => item.slug === tenantSlug);
    if (tenant?.timezone) return tenant.timezone;
    const tenantSettings = dbGet(db, `t_${tenantSlug}_wv_tenant_settings`, {});
    if (tenantSettings?.timezone) return tenantSettings.timezone;
  }
  return dbGet(db, DB_KEYS.PROFILE, {})?.timezone || process.env.TZ || "Australia/Sydney";
}

function writeTenants(tenants) {
  writeJsonFileAtomicSync(TENANTS_FILE, tenants);
}

function licensedTenantBySlug(slug, tenants = readTenants(), keys = readLicenseKeys()) {
  const tenant = tenants.find(item => item.slug === slug);
  const state = tenantLicenseState(tenant, keys);
  return state.active ? { tenant, license: state.license } : null;
}

function tenantIsLicensed(tenantOrSlug) {
  const slug = typeof tenantOrSlug === "string" ? tenantOrSlug : tenantOrSlug?.slug;
  return !!slug && !!licensedTenantBySlug(slug);
}

function claimTenantLicense(keys, tenants, slug, requestedKey, currentKey = "") {
  const normalized = String(requestedKey || "").trim().toUpperCase();
  const previous = String(currentKey || "").trim().toUpperCase();
  if (normalized === previous) {
    const currentTenant = tenants.find(item => item.slug === slug);
    const state = tenantLicenseState(currentTenant, keys);
    if (state.active) return { ok: true, keys };
    const referencedElsewhere = tenants.some(item => item.slug !== slug && String(item.licenseKey || "").trim().toUpperCase() === normalized);
    const keyIndex = keys.findIndex(item => String(item.key || "").trim().toUpperCase() === normalized);
    const legacyKey = keyIndex >= 0 ? keys[keyIndex] : null;
    const expiry = Date.parse(legacyKey?.expiresAt || "");
    const safelyClaimable = !!legacyKey
      && !referencedElsewhere
      && !legacyKey.revokedAt && legacyKey.revoked !== true && legacyKey.status !== "revoked"
      && (!legacyKey.expiresAt || (Number.isFinite(expiry) && expiry > Date.now()))
      && (!legacyKey.usedBy || String(legacyKey.usedBy) === slug);
    if (!safelyClaimable) return { ok: false, status: 409, error: "The current licence is not active or uniquely claimable" };
    const repairedKeys = keys.map(item => ({ ...item }));
    repairedKeys[keyIndex] = {
      ...legacyKey,
      usedAt: legacyKey.usedAt || new Date().toISOString(),
      usedBy: slug,
      setupToken: undefined,
    };
    return { ok: true, keys: repairedKeys };
  }
  const nextKeys = keys.map(item => ({ ...item }));
  if (previous) {
    const previousIndex = nextKeys.findIndex(item => String(item.key || "").toUpperCase() === previous && String(item.usedBy || "") === slug);
    if (previousIndex >= 0) {
      const { usedAt: _usedAt, usedBy: _usedBy, ...released } = nextKeys[previousIndex];
      nextKeys[previousIndex] = {
        ...released,
        releasedAt: new Date().toISOString(),
        setupToken: crypto.randomBytes(32).toString("hex"),
      };
    }
  }
  if (!normalized) return { ok: true, keys: nextKeys };
  if (tenants.some(item => item.slug !== slug && String(item.licenseKey || "").trim().toUpperCase() === normalized)) {
    return { ok: false, status: 409, error: "That licence is already assigned to another tenant" };
  }
  const keyIndex = nextKeys.findIndex(item => String(item.key || "").trim().toUpperCase() === normalized);
  if (keyIndex < 0) return { ok: false, status: 400, error: "Licence key not found" };
  const key = nextKeys[keyIndex];
  if (key.revokedAt || key.revoked === true || key.status === "revoked") return { ok: false, status: 409, error: "That licence has been revoked" };
  if (key.expiresAt && (!Number.isFinite(Date.parse(key.expiresAt)) || Date.parse(key.expiresAt) <= Date.now())) return { ok: false, status: 409, error: "That licence has expired or is invalid" };
  if (key.usedAt || key.usedBy) return { ok: false, status: 409, error: "That licence is already claimed" };
  nextKeys[keyIndex] = {
    ...key,
    usedAt: new Date().toISOString(),
    usedBy: slug,
    setupToken: undefined,
    releasedAt: undefined,
  };
  return { ok: true, keys: nextKeys };
}

function getTenantSession(req) {
  const cookieToken = parseCookies(req.headers.cookie)[TENANT_SESSION_COOKIE];
  const authorization = String(req.headers.authorization || "");
  const bearerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  for (const token of [bearerToken, cookieToken]) {
    const session = verifySession(token, SESSION_SECRET, { purpose: "tenant" });
    if (session?.sub && isValidSlug(session.sub)) return session;
  }
  return null;
}

async function requireTenant(req, res, next) {
  if (await authenticateAdmin(req)) {
    req.authContext = { type: "admin" };
    return next();
  }
  const session = getTenantSession(req);
  const requestedSlug = String(req.params.slug || "");
  if (!session || session.sub !== requestedSlug) {
    return res.status(401).json({ error: "Tenant authentication required" });
  }
  const licensed = licensedTenantBySlug(requestedSlug);
  const tenant = licensed?.tenant;
  if (!tenant) return res.status(403).json({ error: "Tenant account or licence is inactive" });
  if (session.cv !== credentialVersion(tenant.passwordHash)) return res.status(401).json({ error: "Tenant session has expired" });
  req.authContext = { type: "tenant", slug: requestedSlug, tenant };
  next();
}

async function requireAdminOrScopedTenant(req, res, next) {
  if (await authenticateAdmin(req)) {
    req.authContext = { type: "admin" };
    return next();
  }
  const requestedSlug = String(req.params.slug || req.query.tenant || req.body?.tenantSlug || "");
  const session = getTenantSession(req);
  if (!requestedSlug || !session || session.sub !== requestedSlug) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const licensed = licensedTenantBySlug(requestedSlug);
  const tenant = licensed?.tenant;
  if (!tenant) return res.status(403).json({ error: "Tenant account or licence is inactive" });
  if (session.cv !== credentialVersion(tenant.passwordHash)) return res.status(401).json({ error: "Tenant session has expired" });
  req.authContext = { type: "tenant", slug: requestedSlug, tenant };
  next();
}

// List all tenants
app.get("/api/tenants", tenantLimiter, requireAuth, (_req, res) => {
  res.json(readTenants().map(safeTenantPrivateDto));
});

// Create tenant
app.post("/api/tenants", tenantLimiter, requireAuth, (req, res) => {
  const { slug, displayName, email, bio, timezone, licenseKey } = req.body || {};
  if (!slug || typeof slug !== "string" || !SLUG_RE.test(slug)) {
    return res.status(400).json({ error: "Invalid slug — use lowercase letters, numbers, and hyphens (1-30 chars)" });
  }
  if (!displayName || typeof displayName !== "string" || !displayName.trim()) {
    return res.status(400).json({ error: "displayName is required" });
  }
  if (!licenseKey || typeof licenseKey !== "string") return res.status(400).json({ error: "An unclaimed active licence key is required" });
  const tenants = readTenants();
  if (tenants.find(t => t.slug === slug)) {
    return res.status(409).json({ error: "Slug already in use" });
  }
  const claimed = claimTenantLicense(readLicenseKeys(), tenants, slug, licenseKey);
  if (!claimed.ok) return res.status(claimed.status).json({ error: claimed.error });
  const tenant = {
    slug,
    displayName: displayName.trim(),
    email: (email || "").trim(),
    bio: (bio || "").trim() || undefined,
    timezone: timezone || "Australia/Sydney",
    licenseKey: String(licenseKey).trim().toUpperCase(),
    active: true,
    createdAt: new Date().toISOString(),
  };
  writeLicenseKeys(claimed.keys);
  tenants.push(tenant);
  writeTenants(tenants);
  res.json(safeTenantPrivateDto(tenant));
});

// Update tenant
app.put("/api/tenants/:slug", tenantLimiter, requireAuth, async (req, res) => {
  let tenants = readTenants();
  let idx = tenants.findIndex(t => t.slug === req.params.slug);
  if (idx === -1) return res.status(404).json({ error: "Tenant not found" });
  const { slug: _ignoreSlug, createdAt: _ignoreCreatedAt, ...updates } = req.body || {};
  if (updates.passwordHash !== undefined) {
    if (typeof updates.passwordHash !== "string" || updates.passwordHash.length < 32 || updates.passwordHash.length > 256) {
      return res.status(400).json({ error: "A valid password hash is required" });
    }
    updates.passwordHash = await bcryptHash(updates.passwordHash);
    tenants = readTenants();
    idx = tenants.findIndex(t => t.slug === req.params.slug);
    if (idx === -1) return res.status(404).json({ error: "Tenant not found" });
  }
  // Validate and normalise customDomain when provided
  if (updates.customDomain !== undefined) {
    if (updates.customDomain === "" || updates.customDomain === null) {
      // Allow explicit removal
      updates.customDomain = undefined;
    } else {
      // Strip accidental protocol prefix, normalise to lowercase
      const normalizedDomain = String(updates.customDomain).replace(/^https?:\/\//i, "").toLowerCase().trim();
      // Basic DNS hostname validation: labels separated by dots, no consecutive dots, no leading/trailing dots
      const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63}(?<!-))+$/;
      if (!DOMAIN_RE.test(normalizedDomain)) {
        return res.status(400).json({ error: "Invalid custom domain format" });
      }
      // Ensure the domain is not already claimed by another tenant
      const conflict = tenants.find(
        t => t.slug !== req.params.slug && t.customDomain && t.customDomain.toLowerCase() === normalizedDomain
      );
      if (conflict) {
        return res.status(409).json({ error: "Custom domain is already in use by another tenant" });
      }
      updates.customDomain = normalizedDomain;
    }
  }
  let updatedLicenseKeys = null;
  if (Object.prototype.hasOwnProperty.call(updates, "licenseKey")) {
    const requestedLicense = String(updates.licenseKey || "").trim().toUpperCase();
    const assignment = claimTenantLicense(readLicenseKeys(), tenants, req.params.slug, requestedLicense, tenants[idx].licenseKey);
    if (!assignment.ok) return res.status(assignment.status).json({ error: assignment.error });
    updatedLicenseKeys = assignment.keys;
    updates.licenseKey = requestedLicense || undefined;
    if (!requestedLicense) updates.active = false;
  }
  tenants[idx] = { ...tenants[idx], ...updates, slug: req.params.slug };
  if (updatedLicenseKeys) writeLicenseKeys(updatedLicenseKeys);
  writeTenants(tenants);
  res.json(safeTenantPrivateDto(tenants[idx]));
});

// Delete tenant
app.delete("/api/tenants/:slug", tenantLimiter, requireAuth, (req, res) => {
  const tenants = readTenants();
  const slug = req.params.slug;
  const deletedTenant = tenants.find(t => t.slug === slug);
  const filtered = tenants.filter(t => t.slug !== slug);
  if (filtered.length === tenants.length) return res.status(404).json({ error: "Tenant not found" });
  const db = readDb();
  const prefix = `t_${slug}_`;
  const removedKeys = Object.keys(db).filter(key => key.startsWith(prefix));
  const owners = dbGet(db, "wv_upload_owners", {});
  const tenantFiles = new Set();
  for (const key of removedKeys) collectUploadFileNames(dbGet(db, key, db[key]), tenantFiles);
  for (const [filename, owner] of Object.entries(owners)) {
    if (owner?.tenantSlug === slug) tenantFiles.add(path.basename(filename));
  }
  for (const key of removedKeys) delete db[key];
  const bookings = dbGet(db, DB_KEYS.BOOKINGS, []);
  if (Array.isArray(bookings)) db[DB_KEYS.BOOKINGS] = JSON.stringify(bookings.filter(booking => booking.tenantSlug !== slug));

  let deletedFiles = 0;
  let purgedCacheFiles = 0;
  for (const filename of tenantFiles) {
    const safeName = path.basename(filename);
    if (!safeName || uploadReferenceKeys(db, safeName).length > 0) continue;
    const filepath = path.join(UPLOADS_DIR, safeName);
    let removedOrMissing = !fs.existsSync(filepath);
    if (!removedOrMissing) {
      try { fs.unlinkSync(filepath); deletedFiles++; removedOrMissing = true; }
      catch (err) { console.error(`Unable to delete tenant upload ${safeName}:`, err.message); }
    }
    if (!removedOrMissing) continue;
    delete owners[safeName];
    const baseName = path.basename(safeName, path.extname(safeName));
    try {
      for (const cacheName of fs.readdirSync(CACHE_DIR)) {
        if (cacheName.startsWith(`${baseName}_`) || cacheName.startsWith(`${baseName}-`)) {
          try { fs.unlinkSync(path.join(CACHE_DIR, cacheName)); purgedCacheFiles++; } catch {}
        }
      }
    } catch {}
  }
  db["wv_upload_owners"] = owners;
  writeDb(db);
  writeTenants(filtered);
  if (deletedTenant?.licenseKey) {
    const keys = readLicenseKeys();
    const keyIndex = keys.findIndex(item => String(item.key || "").toUpperCase() === String(deletedTenant.licenseKey).toUpperCase() && String(item.usedBy || "") === slug);
    if (keyIndex >= 0 && !keys[keyIndex].revokedAt && keys[keyIndex].revoked !== true) {
      const { usedAt: _usedAt, usedBy: _usedBy, ...released } = keys[keyIndex];
      keys[keyIndex] = { ...released, releasedAt: new Date().toISOString(), setupToken: crypto.randomBytes(32).toString("hex") };
      writeLicenseKeys(keys);
    }
  }
  res.json({ ok: true, removedKeys: removedKeys.length, deletedFiles, purgedCacheFiles });
});

// Resolve a hostname to a tenant slug — used by the frontend for custom-domain support
app.get("/api/tenant/by-domain", tenantPublicLimiter, (req, res) => {
  const domain = req.query.domain;
  if (!domain || typeof domain !== "string") {
    return res.status(400).json({ error: "domain query parameter is required" });
  }
  const normalized = domain.toLowerCase().trim();
  const tenants = readTenants();
  const tenant = tenants.find(
    t => tenantIsLicensed(t) && t.customDomain && t.customDomain.toLowerCase() === normalized
  );
  if (!tenant) return res.json({});
  res.json({ slug: tenant.slug, displayName: tenant.displayName });
});

// Caddy on-demand TLS verification — returns 200 if the domain belongs to an active tenant, 404 otherwise
// Used as the `ask` URL in Caddy's on_demand_tls block to prevent issuing certs for arbitrary domains.
app.get("/api/caddy/verify-domain", tenantPublicLimiter, (req, res) => {
  const domain = req.query.domain;
  if (!domain || typeof domain !== "string") return res.status(400).end();
  const normalized = domain.toLowerCase().trim();
  if (publicSiteHosts().includes(normalized)) return res.status(200).end();
  const tenants = readTenants();
  const found = tenants.some(
    t => tenantIsLicensed(t) && t.customDomain && t.customDomain.toLowerCase() === normalized
  );
  res.status(found ? 200 : 404).end();
});

// Public tenant data for booking page — returns event types + profile
app.get("/api/tenant/:slug/public", tenantPublicLimiter, (req, res) => {
  const slug = req.params.slug;
  const tenant = licensedTenantBySlug(slug)?.tenant;
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  const db = readDb();
  // Try tenant-specific event types only — do not fall back to main admin's event types
  const tenantKey = `t_${slug}_wv_event_types`;
  const raw = db[tenantKey] ?? null;
  const allEventTypes = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : [];
  const eventTypes = Array.isArray(allEventTypes)
    ? allEventTypes.filter(e => e.active !== false)
    : [];

  // Check if the tenant's booking limit has been reached
  let bookingLimitReached = false;
  if (tenant.licenseKey) {
    const allKeys = readLicenseKeys();
    const licKey = allKeys.find(k => k.key === tenant.licenseKey);
    if (licKey) {
      const limits = getLicKeyLimits(licKey);
      if (limits.maxBookings !== null) {
        const rawBks = db["wv_bookings"];
        const existingBookings = rawBks ? (typeof rawBks === "string" ? JSON.parse(rawBks) : (Array.isArray(rawBks) ? rawBks : [])) : [];
        const tenantBookingCount = existingBookings.filter(b => b.tenantSlug === slug && bookingCountsTowardTenantLimit(b)).length;
        bookingLimitReached = tenantBookingCount >= limits.maxBookings;
      }
    }
  }

  // Include enquiry settings from tenant settings (if configured)
  const tenantSettingsRaw = db[`t_${slug}_wv_tenant_settings`];
  const tenantSettings = tenantSettingsRaw ? (typeof tenantSettingsRaw === "string" ? JSON.parse(tenantSettingsRaw) : tenantSettingsRaw) : {};
  const enquiryEnabled = tenantSettings?.enquiryEnabled === true;
  const enquiryLabel = tenantSettings?.enquiryLabel || "Make an Enquiry";
  const brandColor = tenantSettings?.brandColor || null;
  // Cosplay fields toggle
  const cosplayFieldsEnabled = tenantSettings?.cosplayFieldsEnabled === true;
  const conventionFieldEnabled = tenantSettings?.conventionFieldEnabled === true;
  // Bank transfer details — only expose non-secret fields
  const bankTransfer = tenantSettings?.bankTransferEnabled ? {
    enabled: true,
    accountName: tenantSettings.bankAccountName || null,
    bsb: tenantSettings.bankBsb || null,
    accountNumber: tenantSettings.bankAccountNumber || null,
    payId: tenantSettings.bankPayId || null,
    payIdType: tenantSettings.bankPayIdType || null,
    instructions: tenantSettings.bankInstructions || null,
  } : null;

  // Allow browsers and CDNs to cache for 60 s; revalidate after that.
  res.setHeader("Cache-Control", SHORT_CACHE);
  res.json({ tenant: safeTenantPublicDto(tenant), eventTypes: eventTypes.map(sanitizePublicEventType), bookingLimitReached, enquiryEnabled, enquiryLabel, brandColor,
    cosplayFieldsEnabled, conventionFieldEnabled, bankTransfer });
});

const TENANT_SERVER_MANAGED_STORE_KEYS = new Set([
  "wv_event_counter", "wv_extra_event_slots", "wv_license_keys", "wv_license_plans",
  "wv_event_ids_seen", "wv_gcal_tokens", "wv_gcal_settings", "wv_upload_owners", "wv_stripe_processed_events",
]);
function tenantStoreKeyIsAllowed(key) {
  return tenantSelfServiceStoreKeyAllowed(key) && !TENANT_SERVER_MANAGED_STORE_KEYS.has(String(key || ""));
}

// Get tenant-scoped store key (for main admin to manage tenant data)
app.get("/api/tenant/:slug/store/:key", tenantLimiter, requireTenant, (req, res) => {
  if (!tenantStoreKeyIsAllowed(req.params.key)) return res.status(403).json({ error: "This tenant store key is not available through the generic store" });
  const db = readDb();
  const fullKey = `t_${req.params.slug}_${req.params.key}`;
  res.json({ value: db[fullKey] ?? null });
});

// Set tenant-scoped store key
app.put("/api/tenant/:slug/store/:key", tenantLimiter, requireTenant, (req, res) => {
  const slug = req.params.slug;
  if (!tenantStoreKeyIsAllowed(req.params.key)) {
    return res.status(403).json({ error: "This tenant store key is not available through the generic store" });
  }
  const db = readDb();

  // ── License key enforcement for event types ────────────────────────────
  if (req.params.key === "wv_event_types") {
    const licensed = licensedTenantBySlug(slug);
    if (!licensed) return res.status(403).json({ error: "Tenant account or licence is inactive" });
    const newEventTypes = Array.isArray(req.body.value) ? req.body.value : [];
    const currentEventTypes = getStoredArray(db, `t_${slug}_wv_event_types`);
    const identity = validateEventTypeIdentityChange(currentEventTypes, newEventTypes);
    if (!identity.ok) return res.status(400).json({ error: identity.error });
    const seenKey = `t_${slug}_wv_event_ids_seen`;
    const persistedSeen = dbGet(db, seenKey, []);
    const seenIds = new Set([
      ...(Array.isArray(persistedSeen) ? persistedSeen.map(String) : []),
      ...currentEventTypes.map(item => String(item?.id || "")).filter(Boolean),
    ]);
    const introducedIds = newEventTypes.map(item => String(item.id)).filter(id => !seenIds.has(id));
    const counterKey = `t_${slug}_wv_event_counter`;
    const counter = Math.max(Number(db[counterKey]) || 0, seenIds.size);
    const newCounter = counter + introducedIds.length;
    const limits = getLicKeyLimits(licensed.license);
    if (limits.maxEvents !== null) {
      const extraSlotsKey = `t_${slug}_wv_extra_event_slots`;
      const extraSlots = typeof db[extraSlotsKey] === "number" ? db[extraSlotsKey] : 0;
      const effectiveLimit = limits.maxEvents + extraSlots;
      if (newCounter > effectiveLimit) {
        const extraPrice = limits.extraEventPrice;
        const msg = extraPrice != null
          ? `Event type limit reached (${effectiveLimit}). You can purchase extra slots for $${extraPrice} each.`
          : `Event type limit reached (${effectiveLimit}). Contact your platform administrator to upgrade your plan.`;
        return res.status(403).json({ error: msg, limitReached: true, extraEventPrice: extraPrice });
      }
    }
    introducedIds.forEach(id => seenIds.add(id));
    db[counterKey] = newCounter;
    db[seenKey] = [...seenIds];
  }

  const fullKey = `t_${slug}_${req.params.key}`;
  db[fullKey] = req.body.value;
  writeDb(db);
  res.json({ ok: true });
});

// Clear only the tenant-specific watermark cache entries for a given slug
app.post("/api/tenant/:slug/cache/clear", tenantLimiter, requireTenant, (req, res) => {
  const slug = req.params.slug;
  const tenants = readTenants();
  if (!tenants.find(t => t.slug === slug)) return res.status(404).json({ error: "Tenant not found" });
  if ([...zipJobs.values()].some(job => job.status === "preparing")) {
    return res.status(409).json({ error: "A ZIP download is being prepared. Try clearing the image cache again when it finishes." });
  }
  // Cache filenames are `${baseName}_${sizeLabel}_t_${slug}_wm.jpg` — use underscore-bounded match
  // to prevent slug "foo" from matching slug "foobar"'s files.
  const slugPattern = new RegExp(`_t_${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_`);
  let cleared = 0;
  if (fs.existsSync(CACHE_DIR)) {
    try {
      for (const f of fs.readdirSync(CACHE_DIR)) {
        if (slugPattern.test(f)) {
          try { fs.unlinkSync(path.join(CACHE_DIR, f)); cleared++; } catch {}
        }
      }
    } catch {}
  }
  res.json({ ok: true, cleared });
});

// Return cache stats for a tenant (file count + total size)
app.get("/api/tenant/:slug/cache/stats", tenantLimiter, requireTenant, (req, res) => {
  const slug = req.params.slug;
  const slugPattern = new RegExp(`_t_${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_`);
  let count = 0;
  let sizeBytes = 0;
  if (fs.existsSync(CACHE_DIR)) {
    try {
      for (const f of fs.readdirSync(CACHE_DIR)) {
        if (slugPattern.test(f)) {
          try {
            const stat = fs.statSync(path.join(CACHE_DIR, f));
            count++;
            sizeBytes += stat.size;
          } catch {}
        }
      }
    } catch {}
  }
  res.json({ ok: true, count, sizeBytes });
});

// Public endpoint: look up a booking by its modifyToken or id (used by the reschedule page)
// Rate-limited to prevent enumeration of booking IDs
const bookingLookupLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests" } });
const publicBookingLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many booking attempts — please wait" } });

function publicBookingDto(booking) {
  const allowed = [
    "id", "paymentReference", "clientName", "clientEmail", "phone", "date", "time", "eventTypeId", "type",
    "duration", "status", "notes", "answers", "answerLabels", "createdAt", "paymentStatus", "paymentAmount",
    "instagramHandle", "modifyToken", "depositRequired", "depositAmount", "depositMethod", "depositPaidAt", "paidAt",
    "requiresConfirmation", "tenantSlug", "statusHistory",
  ];
  const dto = Object.fromEntries(allowed.filter(key => booking?.[key] !== undefined).map(key => [key, booking[key]]));
  dto.referenceImages = (Array.isArray(booking?.referenceImages) ? booking.referenceImages : []).map(image => {
    const access = signSession({ purpose: "booking-reference", bookingId: booking.id, imageId: image.id }, SESSION_SECRET, { ttlSeconds: 15 * 60 });
    return {
      id: image.id,
      originalName: image.originalName,
      size: image.size,
      mimeType: image.mimeType,
      uploadedAt: image.uploadedAt,
      url: `/api/booking/reference-images/${encodeURIComponent(image.id)}?access=${encodeURIComponent(access)}`,
    };
  });
  return dto;
}

function getStoredArray(db, key) {
  const value = dbGet(db, key, []);
  return Array.isArray(value) ? value : [];
}

function bookingCountsTowardTenantLimit(booking, nowMs = Date.now()) {
  return bookingBlocksAvailability(booking, nowMs);
}

function unconfirmedBookingHoldExpiresAt(settings, paymentPath) {
  if (paymentPath === "stripe") {
    return new Date(Date.now() + Math.max(1, Math.min(120, Number(settings?.bookingTimerMinutes) || 15)) * 60_000).toISOString();
  }
  const hours = Math.max(1, Math.min(168, Number(settings?.unconfirmedBookingHoldHours) || 48));
  return new Date(Date.now() + hours * 60 * 60_000).toISOString();
}

function bookingValidationContext(db, tenantSlug, eventTypes, timezone, excludeBookingId, additionalBookings = []) {
  return {
    eventTypes,
    bookings: [...getStoredArray(db, DB_KEYS.BOOKINGS), ...additionalBookings],
    tenantSlug,
    timezone: timezone || "Australia/Sydney",
    excludeBookingId,
  };
}

function zonedDateTimeToUtc(dateValue, timeValue, timeZone) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  let utcMs = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(utcMs));
    const get = type => Number(parts.find(part => part.type === type)?.value);
    const representedAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    utcMs -= representedAsUtc - Date.UTC(year, month - 1, day, hour, minute);
  }
  return new Date(utcMs);
}

function busyPeriodToBooking(period, dateValue, timeZone, tenantSlug, index) {
  const toLocal = value => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(value));
    const get = type => parts.find(part => part.type === type)?.value;
    return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
  };
  const start = toLocal(period.start);
  const end = toLocal(period.end);
  if (start.date > dateValue || end.date < dateValue) return null;
  const startMinutes = start.date < dateValue ? 0 : start.minutes;
  const endMinutes = end.date > dateValue ? 24 * 60 : end.minutes;
  if (endMinutes <= startMinutes) return null;
  return {
    id: `gcal-busy-${index}`,
    date: dateValue,
    time: `${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(startMinutes % 60).padStart(2, "0")}`,
    duration: endMinutes - startMinutes,
    status: "confirmed",
    tenantSlug: tenantSlug || undefined,
  };
}

async function getGoogleBusyBookings(tenantSlug, dateValue, timeZone) {
  let client;
  let calendarId = "primary";
  if (tenantSlug) {
    const db = readDb();
    const settings = dbGet(db, `t_${tenantSlug}_wv_tenant_settings`, {});
    const tokens = dbGet(db, `t_${tenantSlug}_wv_gcal_tokens`, null);
    let credentials;
    try { credentials = settings.googleApiCredentials ? JSON.parse(settings.googleApiCredentials) : null; } catch { credentials = null; }
    if (!credentials?.web || !tokens?.access_token) return [];
    const { google } = require("googleapis");
    const { client_id, client_secret, redirect_uris } = credentials.web;
    client = new google.auth.OAuth2(client_id, client_secret, (redirect_uris || []).find(uri => uri.includes("googlecalendar")) || redirect_uris?.[0]);
    client.setCredentials(tokens);
    client.on("tokens", fresh => {
      const latestDb = readDb();
      latestDb[`t_${tenantSlug}_wv_gcal_tokens`] = { ...tokens, ...fresh };
      writeDb(latestDb);
    });
    calendarId = dbGet(db, `t_${tenantSlug}_wv_gcal_settings`, {})?.calendarId || settings.googleCalendarId || "primary";
  } else {
    client = getMainGoogleCalendarClient();
    if (!client) return [];
    calendarId = loadMainCalendarSettings()?.calendarId || "primary";
  }
  const { google } = require("googleapis");
  const dayStart = zonedDateTimeToUtc(dateValue, "00:00", timeZone);
  const nextDate = new Date(`${dateValue}T00:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const dayEndValue = nextDate.toISOString().slice(0, 10);
  const dayEnd = zonedDateTimeToUtc(dayEndValue, "00:00", timeZone);
  const { data } = await google.calendar({ version: "v3", auth: client }).freebusy.query({
    requestBody: { timeMin: dayStart.toISOString(), timeMax: dayEnd.toISOString(), timeZone, items: [{ id: calendarId }] },
  });
  return (data.calendars?.[calendarId]?.busy || []).map((period, index) => busyPeriodToBooking(period, dateValue, timeZone, tenantSlug, index)).filter(Boolean);
}

// Availability is requested again whenever a visitor changes duration on the
// same date. Coalesce those read-only Google free/busy calls briefly; booking
// creation/rescheduling continues to call getGoogleBusyBookings directly and
// therefore always performs a fresh authoritative check.
const googleAvailabilityCache = new Map();
async function getCachedGoogleBusyBookings(tenantSlug, dateValue, timeZone) {
  const key = `${tenantSlug || "main"}:${dateValue}:${timeZone}`;
  const now = Date.now();
  const cached = googleAvailabilityCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;
  const promise = getGoogleBusyBookings(tenantSlug, dateValue, timeZone).catch(error => {
    googleAvailabilityCache.delete(key);
    throw error;
  });
  googleAvailabilityCache.set(key, { expiresAt: now + 15_000, promise });
  if (googleAvailabilityCache.size > 200) {
    for (const [cacheKey, value] of googleAvailabilityCache) if (value.expiresAt <= now) googleAvailabilityCache.delete(cacheKey);
  }
  return promise;
}

function getBookingGoogleCalendarConnection(tenantSlug) {
  if (!tenantSlug) {
    const client = getMainGoogleCalendarClient();
    return client ? { client, calendarId: loadMainCalendarSettings()?.calendarId || "primary", timezone: process.env.TZ || "Australia/Sydney" } : null;
  }
  const db = readDb();
  const settings = dbGet(db, `t_${tenantSlug}_wv_tenant_settings`, {});
  const tokens = dbGet(db, `t_${tenantSlug}_wv_gcal_tokens`, null);
  let credentials = settings.googleApiCredentials;
  if (typeof credentials === "string") {
    try { credentials = JSON.parse(credentials); } catch { credentials = null; }
  }
  if (!credentials?.web || !tokens?.access_token) return null;
  const { google } = require("googleapis");
  const { client_id, client_secret, redirect_uris } = credentials.web;
  const client = new google.auth.OAuth2(client_id, client_secret, (redirect_uris || []).find(uri => uri.includes("googlecalendar")) || redirect_uris?.[0]);
  client.setCredentials(tokens);
  client.on("tokens", fresh => {
    const latestDb = readDb();
    latestDb[`t_${tenantSlug}_wv_gcal_tokens`] = { ...tokens, ...fresh };
    writeDb(latestDb);
  });
  const tenant = readTenants().find(item => item.slug === tenantSlug);
  return {
    client,
    calendarId: dbGet(db, `t_${tenantSlug}_wv_gcal_settings`, {})?.calendarId || settings.googleCalendarId || "primary",
    timezone: tenant?.timezone || "Australia/Sydney",
  };
}

function buildBookingCalendarEvent(booking, timezone) {
  const start = zonedDateTimeToUtc(booking.date, booking.time, timezone);
  const end = new Date(start.getTime() + Math.max(1, Number(booking.duration) || 60) * 60_000);
  return {
    summary: `📸 ${booking.type || "Session"} — ${booking.clientName || "Client"}`,
    description: [
      booking.clientName ? `Client: ${booking.clientName}` : "",
      booking.clientEmail ? `Email: ${booking.clientEmail}` : "",
      booking.phone ? `Phone: ${booking.phone}` : "",
      `Duration: ${Math.max(1, Number(booking.duration) || 60)}min`,
      booking.status ? `Status: ${booking.status}` : "",
      booking.paymentStatus ? `Payment: ${booking.paymentStatus}` : "",
      booking.notes ? `Notes: ${booking.notes}` : "",
      `Ref: ${booking.id}`,
    ].filter(Boolean).join("\n"),
    start: { dateTime: start.toISOString(), timeZone: timezone },
    end: { dateTime: end.toISOString(), timeZone: timezone },
    colorId: booking.status === "confirmed" ? "2" : booking.status === "completed" ? "10" : booking.status === "cancelled" ? "11" : "5",
    extendedProperties: { private: { watermarkVaultBookingId: booking.id } },
  };
}

function bookingReadyForCalendar(booking) {
  return !!booking && booking.archived !== true && booking.status !== "cancelled" && (
    ["confirmed", "completed"].includes(booking.status)
    || ["paid", "deposit-paid"].includes(booking.paymentStatus)
  );
}

async function syncBookingCalendarMutation(booking, action) {
  if (!booking?.id) return "not-linked";
  if (["create", "reschedule"].includes(action) && (!bookingBlocksAvailability(booking) || !bookingReadyForCalendar(booking))) return "not-eligible";
  const connection = getBookingGoogleCalendarConnection(booking.tenantSlug || null);
  if (!connection) {
    // Do not silently orphan a known Calendar event when deleting its booking.
    // Cancellation can remain queued until the owner reconnects Google.
    if (action === "cancel" && (booking.gcalEventId || booking.gcalCalendarId)) {
      const error = new Error("Google Calendar must be reconnected before this booking event can be removed");
      error.code = "CALENDAR_NOT_CONNECTED";
      throw error;
    }
    return "not-configured";
  }
  const { google } = require("googleapis");
  const calendar = google.calendar({ version: "v3", auth: connection.client });
  const findLinkedEventIds = async calendarId => {
    const existing = await calendar.events.list({
      calendarId,
      privateExtendedProperty: [`watermarkVaultBookingId=${booking.id}`],
      singleEvents: true,
      showDeleted: false,
      maxResults: 10,
    });
    return (existing.data.items || []).filter(item => item.status !== "cancelled" && item.id).map(item => item.id);
  };
  if (["create", "reschedule"].includes(action)) {
    let eventId = booking.gcalEventId || null;
    const requestBody = buildBookingCalendarEvent(booking, connection.timezone);
    if (eventId && booking.gcalCalendarId && booking.gcalCalendarId !== connection.calendarId) {
      try { await calendar.events.delete({ calendarId: booking.gcalCalendarId, eventId }); }
      catch (error) {
        const status = Number(error?.code || error?.response?.status);
        if (status !== 404 && status !== 410) throw error;
      }
      eventId = null;
    }
    if (eventId) {
      try {
        await calendar.events.update({ calendarId: connection.calendarId, eventId, requestBody });
      } catch (err) {
        const status = Number(err?.code || err?.response?.status);
        if (status !== 404 && status !== 410) throw err;
        eventId = null;
      }
    }
    if (!eventId) {
      eventId = (await findLinkedEventIds(connection.calendarId))[0] || null;
      if (eventId) await calendar.events.update({ calendarId: connection.calendarId, eventId, requestBody });
      else {
        const created = await calendar.events.insert({ calendarId: connection.calendarId, requestBody });
        eventId = created.data.id;
      }
    }
    if (!eventId) throw new Error("Google Calendar did not return an event ID");
    persistBookingCalendarEventLink(booking.id, eventId, connection.calendarId);
    return "synced";
  }
  if (action === "cancel") {
    const calendarIds = new Set([connection.calendarId, booking.gcalCalendarId].filter(Boolean));
    for (const calendarId of calendarIds) {
      const eventIds = new Set(booking.gcalEventId && calendarId === (booking.gcalCalendarId || connection.calendarId) ? [booking.gcalEventId] : []);
      for (const eventId of await findLinkedEventIds(calendarId)) eventIds.add(eventId);
      for (const eventId of eventIds) try {
        await calendar.events.delete({ calendarId, eventId });
      } catch (err) {
        const status = Number(err?.code || err?.response?.status);
        if (status !== 404 && status !== 410) throw err;
      }
    }
    return "synced";
  }
  return "not-linked";
}

function persistBookingCalendarEventLink(bookingId, gcalEventId, gcalCalendarId) {
  const db = readDb();
  const bookings = getStoredArray(db, DB_KEYS.BOOKINGS);
  const index = bookings.findIndex(item => item.id === bookingId);
  if (index < 0) return;
  bookings[index] = { ...bookings[index], gcalEventId, gcalCalendarId };
  db[DB_KEYS.BOOKINGS] = JSON.stringify(bookings);
  writeDb(db);
}

function persistBookingCalendarSyncState(bookingId, state, action, errorMessage) {
  const db = readDb();
  const bookings = getStoredArray(db, DB_KEYS.BOOKINGS);
  const index = bookings.findIndex(item => item.id === bookingId);
  if (index < 0) return;
  const changedAt = new Date().toISOString();
  bookings[index] = {
    ...bookings[index],
    calendarSyncStatus: state,
    calendarSyncAction: action,
    calendarSyncUpdatedAt: changedAt,
    calendarSyncError: errorMessage ? String(errorMessage).slice(0, 500) : undefined,
    ...(state === "synced" && action === "cancel" ? { gcalEventId: undefined, gcalCalendarId: undefined } : {}),
  };
  db[DB_KEYS.BOOKINGS] = JSON.stringify(bookings);
  writeDb(db);
}

function enqueueBookingCalendarSync(booking, action, err) {
  const db = readDb();
  const queue = getStoredArray(db, DB_KEYS.CALENDAR_SYNC_QUEUE).filter(item => item.bookingId !== booking.id);
  queue.push({
    id: `gcal-sync-${crypto.randomUUID()}`,
    bookingId: booking.id,
    action,
    attempts: 0,
    nextAttemptAt: new Date(Date.now() + 30_000).toISOString(),
    lastError: String(err?.message || err || "Calendar sync failed").slice(0, 500),
    createdAt: new Date().toISOString(),
  });
  db[DB_KEYS.CALENDAR_SYNC_QUEUE] = JSON.stringify(queue);
  writeDb(db);
  persistBookingCalendarSyncState(booking.id, "queued", action, err?.message || err);
}

function queueInitialBookingCalendarSync(booking) {
  queueBookingCalendarSync(booking, "create");
}

function queueBookingCalendarSync(booking, action) {
  setImmediate(async () => {
    try {
      const current = getStoredArray(readDb(), DB_KEYS.BOOKINGS).find(item => item.id === booking.id);
      if (!current) return;
      const result = await syncBookingCalendarMutation(current, action);
      if (result === "synced") persistBookingCalendarSyncState(current.id, "synced", action);
    } catch (err) {
      console.error(`Google Calendar ${action} failed for booking ${booking.id}; queued for retry:`, err.message);
      const current = getStoredArray(readDb(), DB_KEYS.BOOKINGS).find(item => item.id === booking.id);
      if (current) enqueueBookingCalendarSync(current, action, err);
    }
  });
}

let bookingCalendarSyncWorkerRunning = false;
async function processBookingCalendarSyncQueue() {
  if (bookingCalendarSyncWorkerRunning) return;
  bookingCalendarSyncWorkerRunning = true;
  try {
    const db = readDb();
    const queue = getStoredArray(db, DB_KEYS.CALENDAR_SYNC_QUEUE);
    const bookings = getStoredArray(db, DB_KEYS.BOOKINGS);
    const remaining = [];
    const now = Date.now();
    for (const booking of bookings.filter(item => item.gcalEventId && !bookingBlocksAvailability(item, now))) {
      try {
        const result = await syncBookingCalendarMutation(booking, "cancel");
        if (result === "synced") persistBookingCalendarSyncState(booking.id, "synced", "cancel");
      } catch (error) {
        enqueueBookingCalendarSync(booking, "cancel", error);
      }
    }
    for (const item of queue) {
      if (Date.parse(item.nextAttemptAt || 0) > now) { remaining.push(item); continue; }
      const booking = bookings.find(candidate => candidate.id === item.bookingId);
      if (!booking) continue;
      try {
        const result = await syncBookingCalendarMutation(booking, item.action);
        if (result === "synced") persistBookingCalendarSyncState(booking.id, "synced", item.action);
      } catch (err) {
        const attempts = Number(item.attempts || 0) + 1;
        console.error(`Google Calendar ${item.action} retry failed for booking ${booking.id}:`, err.message);
        remaining.push({
          ...item,
          attempts,
          lastError: String(err.message || err).slice(0, 500),
          nextAttemptAt: new Date(Date.now() + Math.min(6 * 60 * 60_000, 30_000 * (2 ** Math.min(attempts, 9)))).toISOString(),
        });
      }
    }
    const latestDb = readDb();
    const snapshotIds = new Set(queue.map(item => item.id));
    const appendedWhileRunning = getStoredArray(latestDb, DB_KEYS.CALENDAR_SYNC_QUEUE).filter(item => !snapshotIds.has(item.id));
    const merged = new Map();
    for (const item of [...remaining, ...appendedWhileRunning]) merged.set(`${item.bookingId}:${item.action}`, item);
    latestDb[DB_KEYS.CALENDAR_SYNC_QUEUE] = JSON.stringify([...merged.values()]);
    writeDb(latestDb);
  } finally {
    bookingCalendarSyncWorkerRunning = false;
  }
}

const bookingCalendarSyncTimer = setInterval(() => {
  processBookingCalendarSyncQueue().catch(err => console.error("Google Calendar sync queue failed:", err.message));
}, 30_000);
bookingCalendarSyncTimer.unref?.();

app.get("/api/availability", bookingLookupLimiter, async (req, res) => {
  const db = readDb();
  const eventTypes = getStoredArray(db, DB_KEYS.EVENT_TYPES).filter(eventType => eventType?.active !== false);
  const eventType = eventTypes.find(item => item.id === req.query.eventTypeId);
  const date = String(req.query.date || "");
  if (!eventType || !parseDate(date)) return res.status(400).json({ ok: false, error: "A valid date and eventTypeId are required" });
  const profile = dbGet(db, DB_KEYS.PROFILE, {});
  const timezone = profile?.timezone || process.env.TZ || "Australia/Sydney";
  let googleBusy;
  try { googleBusy = await getCachedGoogleBusyBookings(null, date, timezone); }
  catch (err) {
    console.error("Google Calendar availability check failed:", err.message);
    return res.status(503).json({ ok: false, error: "Calendar availability is temporarily unavailable" });
  }
  const slots = generateAvailableSlots({
    eventType,
    date,
    duration: req.query.duration,
    eventTypes,
    bookings: [...getStoredArray(db, DB_KEYS.BOOKINGS), ...googleBusy],
    tenantSlug: null,
    timezone,
  });
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, date, eventTypeId: eventType.id, timezone, slots });
});

app.get("/api/tenant/:slug/availability", tenantPublicLimiter, async (req, res) => {
  const tenant = licensedTenantBySlug(req.params.slug)?.tenant;
  if (!tenant) return res.status(404).json({ ok: false, error: "Tenant not found" });
  const db = readDb();
  const eventTypes = getStoredArray(db, `t_${tenant.slug}_wv_event_types`).filter(eventType => eventType?.active !== false);
  const eventType = eventTypes.find(item => item.id === req.query.eventTypeId);
  const date = String(req.query.date || "");
  if (!eventType || !parseDate(date)) return res.status(400).json({ ok: false, error: "A valid date and eventTypeId are required" });
  const timezone = tenant.timezone || "Australia/Sydney";
  let googleBusy;
  try { googleBusy = await getCachedGoogleBusyBookings(tenant.slug, date, timezone); }
  catch (err) {
    console.error(`Tenant ${tenant.slug} Google Calendar availability check failed:`, err.message);
    return res.status(503).json({ ok: false, error: "Calendar availability is temporarily unavailable" });
  }
  const slots = generateAvailableSlots({
    eventType,
    date,
    duration: req.query.duration,
    eventTypes,
    bookings: [...getStoredArray(db, DB_KEYS.BOOKINGS), ...googleBusy],
    tenantSlug: tenant.slug,
    timezone,
  });
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, date, eventTypeId: eventType.id, timezone, slots });
});

app.get("/api/booking/:token", bookingLookupLimiter, (req, res) => {
  const { token } = req.params;
  if (!token || typeof token !== "string") return res.status(400).json({ error: "Invalid token" });
  const db = readDb();
  const raw = db["wv_bookings"];
  const bookings = raw ? (typeof raw === "string" ? JSON.parse(raw) : (Array.isArray(raw) ? raw : [])) : [];
  const booking = bookings.find(b => timingSafeTextEqual(b.modifyToken, token));
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  if (!bookingAllowsCapabilityMutation(booking)) return res.status(410).json({ error: "This booking has been archived" });
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, booking: publicBookingDto(booking) });
});

const bookingReferenceUpload = multer({
  storage: multer.diskStorage({
    destination: BOOKING_REFERENCES_DIR,
    filename: (_req, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(String(file.originalname || "")).toLowerCase();
    const allowedExtension = [".jpg", ".jpeg", ".png", ".webp"].includes(extension);
    const allowedMime = ["image/jpeg", "image/png", "image/webp"].includes(String(file.mimetype || "").toLowerCase());
    callback(null, allowedExtension && allowedMime);
  },
});

function requireBookingReferenceCapability(req, res, next) {
  const token = String(req.params.token || "");
  if (!token) return res.status(404).json({ ok: false, error: "Booking not found" });
  const bookings = getStoredArray(readDb(), DB_KEYS.BOOKINGS);
  const matches = bookings.filter(booking => typeof booking?.modifyToken === "string" && booking.modifyToken.length > 0 && timingSafeTextEqual(booking.modifyToken, token));
  if (matches.length !== 1) return res.status(404).json({ ok: false, error: "Booking not found" });
  if (!bookingAllowsCapabilityMutation(matches[0]) || matches[0].status === "cancelled") return res.status(409).json({ ok: false, error: "Reference images cannot be changed for this booking" });
  req.referenceBookingId = matches[0].id;
  req.referenceBookingScope = matches[0].tenantSlug ? `tenant:${matches[0].tenantSlug}` : "main";
  return next();
}

function removeReferenceFiles(files) {
  for (const file of files || []) {
    try { fs.unlinkSync(file.path); } catch {}
  }
}

function acceptBookingReferenceImages(req, res, next) {
  bookingReferenceUpload.array("images", 5)(req, res, error => {
    if (!error) return next();
    removeReferenceFiles(req.files);
    const message = error.code === "LIMIT_FILE_SIZE" ? "Each reference image must be 8 MB or smaller"
      : error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE" ? "Upload no more than five reference images"
      : "Reference images could not be uploaded";
    return res.status(400).json({ ok: false, error: message });
  });
}

app.post("/api/booking/:token/reference-images", bookingLookupLimiter, requireBookingReferenceCapability, acceptBookingReferenceImages, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const files = Array.isArray(req.files) ? req.files : [];
  if (!files.length) return res.status(400).json({ ok: false, error: "Choose at least one JPEG, PNG, or WebP image" });
  try {
    for (const file of files) {
      const metadata = await sharp(file.path).metadata();
      if (!metadata.width || !metadata.height || metadata.width * metadata.height > 80_000_000) throw new Error("invalid-dimensions");
    }
  } catch {
    removeReferenceFiles(files);
    return res.status(400).json({ ok: false, error: "One or more files are not valid images" });
  }
  return withCheckoutResourceLock(bookingCheckoutResourceLockKey(req.referenceBookingScope, req.referenceBookingId), async () => {
    const db = readDb();
    const bookings = getStoredArray(db, DB_KEYS.BOOKINGS);
    const index = bookings.findIndex(booking => booking.id === req.referenceBookingId && timingSafeTextEqual(booking.modifyToken, req.params.token));
    if (index < 0 || !bookingAllowsCapabilityMutation(bookings[index]) || bookings[index].status === "cancelled") {
      removeReferenceFiles(files);
      return res.status(409).json({ ok: false, error: "Reference images cannot be changed for this booking" });
    }
    const existing = Array.isArray(bookings[index].referenceImages) ? bookings[index].referenceImages : [];
    if (existing.length + files.length > 5) {
      removeReferenceFiles(files);
      return res.status(409).json({ ok: false, error: "A booking can retain up to five reference images" });
    }
    const uploadedAt = new Date().toISOString();
    const additions = files.map(file => ({
      id: crypto.randomUUID(), filename: path.basename(file.filename), originalName: String(file.originalname || "reference image").slice(0, 180),
      mimeType: file.mimetype, size: file.size, uploadedAt,
    }));
    bookings[index] = { ...bookings[index], referenceImages: [...existing, ...additions] };
    db[DB_KEYS.BOOKINGS] = JSON.stringify(bookings);
    writeDb(db);
    return res.status(201).json({ ok: true, booking: publicBookingDto(bookings[index]) });
  });
});

app.delete("/api/booking/:token/reference-images/:imageId", bookingLookupLimiter, requireBookingReferenceCapability, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return withCheckoutResourceLock(bookingCheckoutResourceLockKey(req.referenceBookingScope, req.referenceBookingId), async () => {
    const db = readDb();
    const bookings = getStoredArray(db, DB_KEYS.BOOKINGS);
    const index = bookings.findIndex(booking => booking.id === req.referenceBookingId && timingSafeTextEqual(booking.modifyToken, req.params.token));
    if (index < 0) return res.status(404).json({ ok: false, error: "Booking not found" });
    const images = Array.isArray(bookings[index].referenceImages) ? bookings[index].referenceImages : [];
    const image = images.find(item => item.id === req.params.imageId);
    if (!image) return res.status(404).json({ ok: false, error: "Reference image not found" });
    bookings[index] = { ...bookings[index], referenceImages: images.filter(item => item.id !== image.id) };
    db[DB_KEYS.BOOKINGS] = JSON.stringify(bookings);
    writeDb(db);
    try { fs.unlinkSync(resolveContainedPath(BOOKING_REFERENCES_DIR, image.filename)); } catch {}
    return res.json({ ok: true, booking: publicBookingDto(bookings[index]) });
  });
});

app.get("/api/booking/reference-images/:imageId", bookingLookupLimiter, (req, res) => {
  const session = verifySession(String(req.query.access || ""), SESSION_SECRET, { purpose: "booking-reference" });
  if (!session || session.imageId !== req.params.imageId) return res.status(404).end();
  const bookings = getStoredArray(readDb(), DB_KEYS.BOOKINGS);
  const booking = bookings.find(item => item.id === session.bookingId && item.archived !== true);
  const image = booking?.referenceImages?.find(item => item.id === session.imageId);
  if (!image) return res.status(404).end();
  const target = resolveContainedPath(BOOKING_REFERENCES_DIR, image.filename);
  if (!target || !fs.existsSync(target)) return res.status(404).end();
  res.setHeader("Cache-Control", "private, no-store");
  res.type(image.mimeType || "application/octet-stream");
  return res.sendFile(target);
});

app.get("/api/admin/bookings/:id/reference-images/:imageId", bookingLookupLimiter, requireAuth, (req, res) => {
  const bookings = getStoredArray(readDb(), DB_KEYS.BOOKINGS);
  const booking = bookings.find(item => item.id === req.params.id);
  const image = booking?.referenceImages?.find(item => item.id === req.params.imageId);
  if (!image) return res.status(404).end();
  const target = resolveContainedPath(BOOKING_REFERENCES_DIR, image.filename);
  if (!target || !fs.existsSync(target)) return res.status(404).end();
  res.setHeader("Cache-Control", "private, no-store");
  res.type(image.mimeType || "application/octet-stream");
  return res.sendFile(target);
});

app.patch("/api/booking/:token", bookingLookupLimiter, async (req, res) => {
  const token = String(req.params.token || "");
  const initialDb = readDb();
  const initialBookings = getStoredArray(initialDb, DB_KEYS.BOOKINGS);
  const initialIndex = initialBookings.findIndex(booking => timingSafeTextEqual(booking.modifyToken, token));
  if (initialIndex < 0) return res.status(404).json({ ok: false, error: "Booking not found" });
  const booking = initialBookings[initialIndex];
  if (!bookingAllowsCapabilityMutation(booking)) return res.status(409).json({ ok: false, error: "This booking is archived; contact the photographer to restore it" });
  const calendarAction = req.body?.action === "cancel" || req.body?.status === "cancelled" ? "cancel" : "reschedule";
  let googleBusy = [];
  if (calendarAction === "cancel") {
    if (["cancelled", "completed"].includes(booking.status)) return res.status(409).json({ ok: false, error: `This booking is already ${booking.status}` });
  } else {
    if (booking.status === "cancelled" || booking.status === "completed") return res.status(409).json({ ok: false, error: `This booking cannot be rescheduled because it is ${booking.status}` });
    if (!bookingBlocksAvailability(booking)) return res.status(409).json({ ok: false, error: "This booking hold has expired" });
    const tenant = booking.tenantSlug ? licensedTenantBySlug(booking.tenantSlug)?.tenant : null;
    if (booking.tenantSlug && !tenant) return res.status(409).json({ ok: false, error: "The photographer account is unavailable" });
    const eventTypes = booking.tenantSlug
      ? getStoredArray(initialDb, `t_${booking.tenantSlug}_wv_event_types`)
      : getStoredArray(initialDb, DB_KEYS.EVENT_TYPES);
    try { googleBusy = await getGoogleBusyBookings(booking.tenantSlug || null, String(req.body?.date || ""), tenant?.timezone || dbGet(initialDb, DB_KEYS.PROFILE, {})?.timezone || "Australia/Sydney"); }
    catch (err) {
      console.error("Google Calendar reschedule check failed:", err.message);
      return res.status(503).json({ ok: false, error: "Calendar availability is temporarily unavailable" });
    }
    if (booking.gcalEventId && String(req.body?.date || "") === booking.date) {
      googleBusy = googleBusy.filter(period => !(
        period.date === booking.date
        && period.time === booking.time
        && Number(period.duration) === Number(booking.duration)
      ));
    }
    const validation = validateBookingRequest({
      eventTypeId: booking.eventTypeId,
      date: req.body?.date,
      time: req.body?.time,
      duration: booking.duration,
    }, bookingValidationContext(initialDb, booking.tenantSlug || null, eventTypes, tenant?.timezone || dbGet(initialDb, DB_KEYS.PROFILE, {})?.timezone, booking.id, googleBusy));
    if (!validation.ok) return res.status(validation.status).json({ ok: false, error: validation.error });
  }

  // The Google check above yields to the event loop. Re-read and revalidate
  // against the canonical current array before committing so another booking
  // mutation cannot be overwritten or double-claim the requested slot.
  const commitDb = readDb();
  const commitBookings = getStoredArray(commitDb, DB_KEYS.BOOKINGS);
  const commitIndex = commitBookings.findIndex(item => item.id === booking.id && timingSafeTextEqual(item.modifyToken, token));
  if (commitIndex < 0) return res.status(404).json({ ok: false, error: "Booking not found" });
  const current = commitBookings[commitIndex];
  if (!bookingAllowsCapabilityMutation(current)) return res.status(409).json({ ok: false, error: "This booking is archived; contact the photographer to restore it" });
  const changedAt = new Date().toISOString();
  let updatedBooking;
  if (calendarAction === "cancel") {
    if (["cancelled", "completed"].includes(current.status)) return res.status(409).json({ ok: false, error: `This booking is already ${current.status}` });
    updatedBooking = {
      ...current,
      status: "cancelled",
      holdExpiresAt: undefined,
      cancelledAt: changedAt,
      statusHistory: [...(Array.isArray(current.statusHistory) ? current.statusHistory : []), { status: "cancelled", changedAt, note: "Cancelled by client" }],
    };
  } else {
    if (["cancelled", "completed"].includes(current.status)) return res.status(409).json({ ok: false, error: `This booking cannot be rescheduled because it is ${current.status}` });
    if (!bookingBlocksAvailability(current)) return res.status(409).json({ ok: false, error: "This booking hold has expired" });
    const currentTenant = current.tenantSlug ? licensedTenantBySlug(current.tenantSlug)?.tenant : null;
    if (current.tenantSlug && !currentTenant) return res.status(409).json({ ok: false, error: "The photographer account is unavailable" });
    const currentEventTypes = current.tenantSlug
      ? getStoredArray(commitDb, `t_${current.tenantSlug}_wv_event_types`)
      : getStoredArray(commitDb, DB_KEYS.EVENT_TYPES);
    const timezone = currentTenant?.timezone || dbGet(commitDb, DB_KEYS.PROFILE, {})?.timezone || "Australia/Sydney";
    let currentGoogleBusy = googleBusy;
    if (current.gcalEventId && String(req.body?.date || "") === current.date) {
      currentGoogleBusy = currentGoogleBusy.filter(period => !(
        period.date === current.date && period.time === current.time && Number(period.duration) === Number(current.duration)
      ));
    }
    const finalValidation = validateBookingRequest({
      eventTypeId: current.eventTypeId,
      date: req.body?.date,
      time: req.body?.time,
      duration: current.duration,
    }, bookingValidationContext(commitDb, current.tenantSlug || null, currentEventTypes, timezone, current.id, currentGoogleBusy));
    if (!finalValidation.ok) return res.status(finalValidation.status).json({ ok: false, error: finalValidation.error });
    updatedBooking = {
      ...current,
      date: finalValidation.normalized.date,
      time: finalValidation.normalized.time,
      rescheduledAt: changedAt,
      statusHistory: [...(Array.isArray(current.statusHistory) ? current.statusHistory : []), { status: current.status, changedAt, note: "Rescheduled by client" }],
    };
  }
  commitBookings[commitIndex] = updatedBooking;
  commitDb[DB_KEYS.BOOKINGS] = JSON.stringify(commitBookings);
  writeDb(commitDb);
  if (calendarAction === "cancel") {
    try {
      const tenantSettings = updatedBooking.tenantSlug ? dbGet(commitDb, `t_${updatedBooking.tenantSlug}_wv_tenant_settings`, {}) : null;
      await expireBookingCheckout(updatedBooking, tenantSettings);
    } catch (err) {
      console.error(`Unable to expire Stripe checkout for cancelled booking ${updatedBooking.id}:`, err.message);
    }
  }
  try {
    const syncState = await syncBookingCalendarMutation(updatedBooking, calendarAction);
    if (syncState === "synced") persistBookingCalendarSyncState(updatedBooking.id, "synced", calendarAction);
  } catch (err) {
    console.error(`Google Calendar ${calendarAction} failed for booking ${updatedBooking.id}; queued for retry:`, err.message);
    enqueueBookingCalendarSync(updatedBooking, calendarAction, err);
  }
  if (calendarAction === "cancel" || current.date !== updatedBooking.date || current.time !== updatedBooking.time) {
    setImmediate(() => sendBookingUpdateReceipt(updatedBooking, calendarAction, current).catch(error => {
      console.error(`Booking ${calendarAction} email failed for ${updatedBooking.id}:`, error?.message || error);
    }));
  }
  res.json({ ok: true, booking: publicBookingDto(updatedBooking) });
});

app.post("/api/enquiry", publicBookingLimiter, (req, res) => {
  const db = readDb();
  const settings = dbGet(db, DB_KEYS.SETTINGS, {});
  if (settings?.enquiryEnabled === false) return res.status(403).json({ ok: false, error: "Enquiries are not currently enabled" });
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const message = String(req.body?.message || "").trim();
  if (!name || name.length > 160 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !message || message.length > 5000) {
    return res.status(400).json({ ok: false, error: "Name, valid email, and message are required" });
  }
  const eventTypes = getStoredArray(db, DB_KEYS.EVENT_TYPES);
  const eventType = req.body?.eventTypeId ? eventTypes.find(item => item.id === req.body.eventTypeId && item.active !== false) : null;
  if (req.body?.eventTypeId && !eventType) return res.status(400).json({ ok: false, error: "Event type is unavailable" });
  const preferredDate = req.body?.preferredDate ? String(req.body.preferredDate) : undefined;
  const preferredStartTime = req.body?.preferredStartTime ? String(req.body.preferredStartTime) : undefined;
  const preferredEndTime = req.body?.preferredEndTime ? String(req.body.preferredEndTime) : undefined;
  if ((preferredDate && !parseDate(preferredDate)) || (preferredStartTime && !parseTime(preferredStartTime)) || (preferredEndTime && !parseTime(preferredEndTime))) {
    return res.status(400).json({ ok: false, error: "Preferred date or time is invalid" });
  }
  const enquiries = getStoredArray(db, DB_KEYS.ENQUIRIES);
  const recentCutoff = Date.now() - 60 * 60_000;
  const duplicate = enquiries.find(item => item.email === email && item.message === message && Date.parse(item.createdAt || 0) >= recentCutoff);
  if (duplicate) return res.status(202).json({ ok: true, enquiry: duplicate });
  if (enquiries.length >= 5000) return res.status(429).json({ ok: false, error: "Enquiries are temporarily unavailable" });
  const enquiry = {
    id: `enq-${crypto.randomUUID()}`,
    name,
    email,
    phone: String(req.body?.phone || "").trim().slice(0, 40) || undefined,
    eventTypeId: eventType?.id,
    eventTypeTitle: eventType?.title,
    preferredDate,
    preferredStartTime,
    preferredEndTime,
    message,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  enquiries.push(enquiry);
  db[DB_KEYS.ENQUIRIES] = JSON.stringify(enquiries);
  writeDb(db);
  if (settings?.discordWebhookUrl && settings?.discordNotifyBookings !== false) notifyNewEnquiry(settings.discordWebhookUrl, enquiry).catch(() => {});
  res.status(201).json({ ok: true, enquiry });
});

// Create a main-site booking.  This is intentionally separate from the generic
// store API: public visitors must not be able to overwrite the bookings list.
app.post("/api/booking", publicBookingLimiter, async (req, res) => {
  const input = req.body || {};
  const { clientName, clientEmail, phone, date, time, eventTypeId, duration, answers, paymentMethod, payInFull } = input;
  if (!clientName || typeof clientName !== "string" || !clientName.trim()) return res.status(400).json({ error: "clientName is required" });
  if (!clientEmail || typeof clientEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail.trim())) return res.status(400).json({ error: "Valid clientEmail is required" });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !time || !/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: "A valid date and time are required" });
  const allowedMethods = new Set(["stripe", "bank", "none"]);
  if (!allowedMethods.has(paymentMethod)) return res.status(400).json({ error: "Invalid payment method" });

  const db = readDb();
  const initialAttempt = evaluatePublicBookingAttempt(getStoredArray(db, DB_KEYS.BOOKINGS), input);
  if (initialAttempt.action === "invalid" || initialAttempt.action === "conflict") {
    return res.status(initialAttempt.status).json({ ok: false, code: initialAttempt.code, error: initialAttempt.error });
  }
  if (initialAttempt.action === "reuse") {
    return res.status(200).json({ ok: true, booking: publicBookingDto(initialAttempt.booking), reused: true });
  }
  const eventTypes = getStoredArray(db, DB_KEYS.EVENT_TYPES);
  const profile = dbGet(db, DB_KEYS.PROFILE, {});
  let googleBusy;
  try { googleBusy = await getGoogleBusyBookings(null, date, profile?.timezone || "Australia/Sydney"); }
  catch (err) {
    console.error("Google Calendar booking check failed:", err.message);
    return res.status(503).json({ error: "Calendar availability is temporarily unavailable" });
  }
  const validation = validateBookingRequest({ eventTypeId, date, time, duration }, bookingValidationContext(db, null, eventTypes, profile?.timezone, undefined, googleBusy));
  if (!validation.ok) return res.status(validation.status).json({ error: validation.error });
  const { eventType, normalized } = validation;
  const totalPrice = normalized.paymentAmount;
  const settings = dbGet(db, DB_KEYS.SETTINGS, {});
  if (totalPrice === 0 && paymentMethod !== "none") return res.status(400).json({ error: "This session does not require payment" });
  if (totalPrice > 0 && paymentMethod === "none") return res.status(400).json({ error: "A payment method is required" });
  if (paymentMethod === "stripe" && (!mainStripeReady() || settings?.stripeEnabled === false)) return res.status(400).json({ error: "Stripe is not available" });
  if (paymentMethod === "bank" && settings?.bankTransfer?.enabled !== true) return res.status(400).json({ error: "Bank transfer is not available" });
  if (Array.isArray(eventType.depositMethods) && eventType.depositMethods.length > 0 && paymentMethod !== "none" && !eventType.depositMethods.includes(paymentMethod)) {
    return res.status(400).json({ error: "That payment method is not available for this session" });
  }
  const answerInput = answers && typeof answers === "object" && !Array.isArray(answers) ? answers : {};
  const safeAnswers = {};
  for (const question of Array.isArray(eventType.questions) ? eventType.questions : []) {
    const value = answerInput[question.id];
    if (question.required && (value === undefined || value === null || String(value).trim() === "")) {
      return res.status(400).json({ error: `${question.label || "A required question"} is required` });
    }
    if (value !== undefined && value !== null) safeAnswers[question.id] = String(value).slice(0, 2000);
  }
  const depositRequired = totalPrice > 0 && normalized.depositRequired && payInFull !== true;
  // Re-read and validate immediately before the synchronous write. Concurrent
  // requests may both pass the earlier Google/network check; this final check
  // serializes them through Node's event loop and prevents lost/double bookings.
  const commitDb = readDb();
  const bookings = getStoredArray(commitDb, DB_KEYS.BOOKINGS);
  const commitAttempt = evaluatePublicBookingAttempt(bookings, input);
  if (commitAttempt.action === "invalid" || commitAttempt.action === "conflict") {
    return res.status(commitAttempt.status).json({ ok: false, code: commitAttempt.code, error: commitAttempt.error });
  }
  if (commitAttempt.action === "reuse") {
    return res.status(200).json({ ok: true, booking: publicBookingDto(commitAttempt.booking), reused: true });
  }
  const commitEventTypes = getStoredArray(commitDb, DB_KEYS.EVENT_TYPES);
  const commitValidation = validateBookingRequest({ eventTypeId, date, time, duration }, bookingValidationContext(commitDb, null, commitEventTypes, profile?.timezone, undefined, googleBusy));
  if (!commitValidation.ok) return res.status(commitValidation.status).json({ error: commitValidation.error });
  if (JSON.stringify(commitValidation.eventType) !== JSON.stringify(eventType)) {
    return res.status(409).json({ error: "Booking configuration changed; please refresh and try again" });
  }
  const answerLabels = Array.isArray(eventType.questions) ? Object.fromEntries(eventType.questions.map(question => [question.id, question.label])) : {};
  const id = `bk-${crypto.randomUUID()}`;
  const booking = {
    id,
    modifyToken: `mod-${crypto.randomBytes(32).toString("base64url")}`,
    paymentReference: `PF-${id.slice(-8).toUpperCase()}`,
    clientName: clientName.trim().slice(0, 160), clientEmail: clientEmail.trim().slice(0, 254),
    phone: typeof phone === "string" ? phone.trim().slice(0, 40) : "",
    date: normalized.date, time: normalized.time, eventTypeId: eventType.id, type: eventType.title || "Session", duration: normalized.duration,
    status: normalized.requiresConfirmation || totalPrice > 0 ? "pending" : "confirmed",
    requiresConfirmation: normalized.requiresConfirmation,
    notes: "", answers: safeAnswers, answerLabels, createdAt: new Date().toISOString(),
    paymentStatus: totalPrice === 0 ? "paid" : paymentMethod === "bank" ? "pending-confirmation" : "unpaid",
    paymentAmount: totalPrice, depositRequired, depositAmount: depositRequired ? normalized.depositAmount : 0,
    holdExpiresAt: totalPrice > 0 ? unconfirmedBookingHoldExpiresAt(settings, paymentMethod) : undefined,
    ...(commitAttempt.action === "create" ? {
      bookingAttemptIdHash: commitAttempt.bookingAttemptIdHash,
      bookingAttemptIdentityHash: commitAttempt.bookingAttemptIdentityHash,
    } : {}),
    // Bank transfer is selected at booking time. Stripe is only recorded after
    // Stripe successfully creates a checkout session (see stripe.js).
    depositMethod: paymentMethod === "bank" ? "bank" : undefined,
    paymentMethod: paymentMethod === "bank" ? "bank" : undefined,
  };
  bookings.push(booking);
  commitDb[DB_KEYS.BOOKINGS] = JSON.stringify(bookings);
  writeDb(commitDb);

  try {
    const settingsRaw = commitDb[DB_KEYS.SETTINGS];
    const settings = typeof settingsRaw === "string" ? JSON.parse(settingsRaw) : (settingsRaw || {});
    if (settings.discordWebhookUrl && settings.discordNotifyBookings !== false) notifyNewBooking(settings.discordWebhookUrl, booking).catch(() => {});
  } catch {}
  if (paymentMethod !== "stripe") {
    sendMainBookingReceipt(booking).catch(error => console.error(`Booking receipt email failed for ${booking.id}:`, error?.message || error));
    queueInitialBookingCalendarSync(booking);
  }
  res.status(201).json({ ok: true, booking: publicBookingDto(booking) });
});

// Create a booking on behalf of a tenant
app.post("/api/tenant/:slug/booking", tenantBookingLimiter, async (req, res) => {
  const slug = req.params.slug;
  const tenant = licensedTenantBySlug(slug)?.tenant;
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const { clientName, clientEmail, phone, date, time, eventTypeId, type, duration, notes, answers, paymentMethod,
    cosplayCharacter, cosplayCostume, conventionName } = req.body || {};
  if (!clientName || typeof clientName !== "string" || !clientName.trim()) {
    return res.status(400).json({ error: "clientName is required" });
  }
  if (!clientEmail || typeof clientEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail.trim())) {
    return res.status(400).json({ error: "Valid clientEmail is required" });
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "date (YYYY-MM-DD) is required" });
  }
  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    return res.status(400).json({ error: "time (HH:MM) is required" });
  }

  const db = readDb();
  const eventTypes = getStoredArray(db, `t_${slug}_wv_event_types`);
  let googleBusy;
  try { googleBusy = await getGoogleBusyBookings(slug, date, tenant.timezone || "Australia/Sydney"); }
  catch (err) {
    console.error(`Tenant ${slug} Google Calendar booking check failed:`, err.message);
    return res.status(503).json({ error: "Calendar availability is temporarily unavailable" });
  }
  const validation = validateBookingRequest({ eventTypeId, date, time, duration }, bookingValidationContext(db, slug, eventTypes, tenant.timezone, undefined, googleBusy));
  if (!validation.ok) return res.status(validation.status).json({ error: validation.error });
  const { eventType, normalized } = validation;
  const tenantSettings = dbGet(db, `t_${slug}_wv_tenant_settings`, {});
  const selectedPaymentMethod = normalized.paymentAmount > 0 ? String(paymentMethod || "contact") : "none";
  if (!["stripe", "bank", "contact", "none"].includes(selectedPaymentMethod) || (normalized.paymentAmount > 0 && selectedPaymentMethod === "none")) {
    return res.status(400).json({ error: "A valid payment path is required" });
  }
  if (selectedPaymentMethod === "stripe" && !tenantStripeReady(tenantSettings)) return res.status(400).json({ error: "Stripe is not available" });
  if (selectedPaymentMethod === "bank" && tenantSettings.bankTransferEnabled !== true) return res.status(400).json({ error: "Bank transfer is not available" });
  const answerInput = answers && typeof answers === "object" && !Array.isArray(answers) ? answers : {};
  const safeAnswers = {};
  const answerLabels = {};
  for (const question of Array.isArray(eventType.questions) ? eventType.questions : []) {
    const value = answerInput[question.id];
    answerLabels[question.id] = question.label;
    if (question.required && (value === undefined || value === null || String(value).trim() === "")) {
      return res.status(400).json({ error: `${question.label || "A required question"} is required` });
    }
    if (value !== undefined && value !== null) safeAnswers[question.id] = String(value).slice(0, 2000);
  }

  const commitDb = readDb();
  const commitEventTypes = getStoredArray(commitDb, `t_${slug}_wv_event_types`);
  const commitValidation = validateBookingRequest({ eventTypeId, date, time, duration }, bookingValidationContext(commitDb, slug, commitEventTypes, tenant.timezone, undefined, googleBusy));
  if (!commitValidation.ok) return res.status(commitValidation.status).json({ error: commitValidation.error });
  if (JSON.stringify(commitValidation.eventType) !== JSON.stringify(eventType)) {
    return res.status(409).json({ error: "Booking configuration changed; please refresh and try again" });
  }

  // ── License key booking limit enforcement ──────────────────────────────
  if (tenant.licenseKey) {
    const allKeys = readLicenseKeys();
    const licKey = allKeys.find(k => k.key === tenant.licenseKey);
    if (licKey) {
      const limits = getLicKeyLimits(licKey);
      if (limits.maxBookings !== null) {
        const existingBookings = getStoredArray(commitDb, DB_KEYS.BOOKINGS);
        const tenantBookingCount = existingBookings.filter(b => b.tenantSlug === slug && bookingCountsTowardTenantLimit(b)).length;
        if (tenantBookingCount >= limits.maxBookings) {
          return res.status(403).json({ error: `Booking limit reached (${limits.maxBookings} bookings). Contact your platform administrator to upgrade your plan.` });
        }
      }
    }
  }

  const booking = {
    id: `bk-${crypto.randomUUID()}`,
    modifyToken: `mod-${crypto.randomBytes(32).toString("base64url")}`,
    clientName: clientName.trim().slice(0, 160),
    clientEmail: clientEmail.trim().toLowerCase().slice(0, 254),
    phone: typeof phone === "string" ? phone.trim().slice(0, 40) : "",
    date: normalized.date,
    time: normalized.time,
    eventTypeId: eventType.id,
    type: eventType.title,
    duration: normalized.duration,
    status: normalized.paymentAmount === 0 && !normalized.requiresConfirmation ? "confirmed" : "pending",
    requiresConfirmation: normalized.requiresConfirmation,
    notes: String(notes || "").trim().slice(0, 5000),
    answers: safeAnswers,
    answerLabels,
    cosplayCharacter: String(cosplayCharacter || "").trim().slice(0, 160) || undefined,
    cosplayCostume: String(cosplayCostume || "").trim().slice(0, 500) || undefined,
    conventionName: String(conventionName || "").trim().slice(0, 160) || undefined,
    createdAt: new Date().toISOString(),
    tenantSlug: slug,
    paymentAmount: normalized.paymentAmount,
    depositRequired: normalized.depositRequired,
    depositAmount: normalized.depositAmount,
    paymentStatus: normalized.paymentAmount === 0 ? "paid" : selectedPaymentMethod === "bank" ? "pending-confirmation" : "unpaid",
    paymentMethod: selectedPaymentMethod === "contact" || selectedPaymentMethod === "none" ? undefined : selectedPaymentMethod,
    depositMethod: ["stripe", "bank"].includes(selectedPaymentMethod) ? selectedPaymentMethod : undefined,
    paymentPath: selectedPaymentMethod,
    holdExpiresAt: normalized.paymentAmount > 0 ? unconfirmedBookingHoldExpiresAt(tenantSettings, selectedPaymentMethod) : undefined,
  };

  const bookings = getStoredArray(commitDb, DB_KEYS.BOOKINGS);
  bookings.push(booking);
  commitDb["wv_bookings"] = JSON.stringify(bookings);
  writeDb(commitDb);

  // Fire Discord notification — use tenant-specific webhook if configured, else fall back to global
  try {
    const tenantSettingsRaw = commitDb[`t_${slug}_wv_tenant_settings`];
    const tenantSettings = tenantSettingsRaw ? (typeof tenantSettingsRaw === "string" ? JSON.parse(tenantSettingsRaw) : tenantSettingsRaw) : {};
    const settingsRaw = commitDb["wv_settings"];
    const globalSettings = typeof settingsRaw === "string" ? JSON.parse(settingsRaw) : (settingsRaw || {});
    // Prefer tenant-specific settings when a tenant webhook is configured
    const useTenantSettings = !!tenantSettings?.discordWebhookUrl;
    const activeSettings = useTenantSettings ? tenantSettings : globalSettings;
    const webhookUrl = activeSettings?.discordWebhookUrl;
    const notifyBookings = activeSettings?.discordNotifyBookings !== false;
    if (webhookUrl && notifyBookings) {
      notifyNewBooking(webhookUrl, { ...booking, type: `${booking.type} (${tenant.displayName})` }).catch(() => {});
    }
  } catch {}

  if (selectedPaymentMethod !== "stripe") {
    sendTenantBookingReceipt(booking, "created").catch(error => console.error(`Tenant booking receipt failed for ${booking.id}:`, error?.message || error));
    queueInitialBookingCalendarSync(booking);
  }

  res.status(201).json({ ok: true, booking: publicBookingDto(booking) });
});

// Submit an enquiry to a tenant (public — rate-limited)
app.post("/api/tenant/:slug/enquiry", tenantBookingLimiter, (req, res) => {
  const slug = req.params.slug;
  const tenant = licensedTenantBySlug(slug)?.tenant;
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  // Check that enquiry mode is enabled for this tenant
  const db = readDb();
  const tenantSettingsRaw = db[`t_${slug}_wv_tenant_settings`];
  const tenantSettings = tenantSettingsRaw ? (typeof tenantSettingsRaw === "string" ? JSON.parse(tenantSettingsRaw) : tenantSettingsRaw) : {};
  if (!tenantSettings?.enquiryEnabled) {
    return res.status(403).json({ error: "Enquiry mode is not enabled for this photographer" });
  }

  const { name, email, phone, eventTypeId, preferredDate, preferredStartTime, preferredEndTime, message } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim() || name.trim().length > 160) return res.status(400).json({ error: "A valid name is required" });
  if (!email || typeof email !== "string" || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: "Valid email is required" });
  }
  if (!message || typeof message !== "string" || !message.trim() || message.length > 5000) return res.status(400).json({ error: "message is required and must be under 5000 characters" });
  const eventTypes = getStoredArray(db, `t_${slug}_wv_event_types`);
  const eventType = eventTypeId ? eventTypes.find(item => item.id === eventTypeId && item.active !== false) : null;
  if (eventTypeId && !eventType) return res.status(400).json({ error: "Event type is unavailable" });
  if ((preferredDate && !parseDate(preferredDate)) || (preferredStartTime && !parseTime(preferredStartTime)) || (preferredEndTime && !parseTime(preferredEndTime))) {
    return res.status(400).json({ error: "Preferred date or time is invalid" });
  }

  const enquiry = {
    id: `enq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim().slice(0, 160),
    email: email.trim().toLowerCase().slice(0, 254),
    phone: String(phone || "").trim().slice(0, 40) || undefined,
    eventTypeId: eventType?.id,
    eventTypeTitle: eventType?.title,
    preferredDate: preferredDate || undefined,
    preferredStartTime: preferredStartTime || undefined,
    preferredEndTime: preferredEndTime || undefined,
    message: message.trim(),
    status: "pending",
    createdAt: new Date().toISOString(),
    tenantSlug: slug,
  };

  // Persist enquiry into tenant-scoped store
  const enquiryKey = `t_${slug}_wv_enquiries`;
  const existingRaw = db[enquiryKey];
  const existing = existingRaw ? (typeof existingRaw === "string" ? JSON.parse(existingRaw) : (Array.isArray(existingRaw) ? existingRaw : [])) : [];
  if (!Array.isArray(existing) || existing.length >= 5000) return res.status(429).json({ error: "Enquiries are temporarily unavailable" });
  const duplicate = existing.find(item => item.email === enquiry.email && item.message === enquiry.message && Date.parse(item.createdAt || 0) >= Date.now() - 60 * 60_000);
  if (duplicate) return res.status(202).json({ ok: true, enquiry: duplicate });
  existing.push(enquiry);
  db[enquiryKey] = existing;
  writeDb(db);

  // Discord notification (non-blocking)
  try {
    const settingsRaw = db["wv_settings"];
    const globalSettings = typeof settingsRaw === "string" ? JSON.parse(settingsRaw) : (settingsRaw || {});
    const useTenantSettings = !!tenantSettings?.discordWebhookUrl;
    const activeSettings = useTenantSettings ? tenantSettings : globalSettings;
    const webhookUrl = activeSettings?.discordWebhookUrl;
    if (webhookUrl && activeSettings?.discordNotifyBookings !== false) {
      notifyNewEnquiry(webhookUrl, enquiry).catch(() => {});
    }
  } catch {}

  res.json({ ok: true, enquiry });
});

// ── Super Admin Info ──────────────────────────────────
// Returns the username that is considered the super admin (set via env var).
// The client uses this to unlock the Platform tab for cross-tenant visibility.
app.get("/api/super-admin/info", requireAuth, (_req, res) => {
  res.json({ superAdminUsername: process.env.SUPER_ADMIN_USERNAME || null });
});

// ── Super Admin: Cross-Tenant Data ───────────────────

// Aggregate stats: tenant count, total bookings, etc.
app.get("/api/super/stats", superLimiter, requireAuth, (_req, res) => {
  const db = readDb();
  const tenants = readTenants();
  const mainRaw = db["wv_bookings"];
  const allBookings = mainRaw ? (typeof mainRaw === "string" ? JSON.parse(mainRaw) : (Array.isArray(mainRaw) ? mainRaw : [])) : [];
  const operationalBookings = allBookings.filter(b => b?.archived !== true);
  const mainBookings = operationalBookings.filter(b => !b.tenantSlug);
  const tenantStats = tenants.map(t => {
    const tenantBookings = operationalBookings.filter(b => b.tenantSlug === t.slug);
    const archivedBookings = allBookings.filter(b => b.tenantSlug === t.slug && b.archived === true).length;
    const tenantEtRaw = db[`t_${t.slug}_wv_event_types`];
    const tenantEventTypes = tenantEtRaw ? (typeof tenantEtRaw === "string" ? JSON.parse(tenantEtRaw) : tenantEtRaw) : null;
    return {
      ...t,
      bookingCount: tenantBookings.length,
      pendingBookings: tenantBookings.filter(b => b.status === "pending").length,
      archivedBookings,
      hasCustomEventTypes: !!tenantEventTypes,
    };
  });
  res.json({
    tenantCount: tenants.length,
    totalBookings: operationalBookings.length,
    mainBookings: mainBookings.length,
    archivedBookings: allBookings.length - operationalBookings.length,
    retainedBookings: allBookings.length,
    tenants: tenantStats,
  });
});

// All bookings across all tenants
app.get("/api/super/all-bookings", superLimiter, requireAuth, (_req, res) => {
  const db = readDb();
  const raw = db["wv_bookings"];
  const bookings = raw ? (typeof raw === "string" ? JSON.parse(raw) : (Array.isArray(raw) ? raw : [])) : [];
  res.json(bookings);
});

app.get("/api/admin/payments/health", superLimiter, requireAuth, (_req, res) => {
  const db = readDb();
  const bookings = getStoredArray(db, DB_KEYS.BOOKINGS).filter(booking => !booking?.tenantSlug && booking?.archived !== true);
  const now = Date.now();
  const isExpired = booking => booking?.holdExpiresAt && new Date(booking.holdExpiresAt).getTime() <= now;
  const counts = {
    reviews: bookings.filter(booking => booking.paymentNeedsReview === true).length,
    bankPending: bookings.filter(booking => booking.paymentStatus === "pending-confirmation" || booking.bankTransferPendingAt).length,
    cardProcessing: bookings.filter(booking => ["open", "processing"].includes(String(booking.stripeCheckoutStatus || ""))).length,
    expiredHolds: bookings.filter(booking => isExpired(booking) && !["paid", "cash", "deposit-paid"].includes(booking.paymentStatus)).length,
    unpaid: bookings.filter(booking => (!booking.paymentStatus || booking.paymentStatus === "unpaid") && !isExpired(booking)).length,
  };
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    stripe: {
      ready: mainStripeReady(),
      secretKeyConfigured: !!process.env.STRIPE_SECRET_KEY,
      webhookVerificationConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
      unsafeUnsignedWebhooks: process.env.ALLOW_UNSIGNED_STRIPE_WEBHOOKS === "true",
    },
    counts,
    checkedAt: new Date().toISOString(),
  });
});

const ADMIN_BOOKING_CREATE_FIELDS = new Set([
  "clientName", "clientEmail", "phone", "date", "time", "eventTypeId", "type", "duration",
  "status", "notes", "answers", "answerLabels", "paymentStatus", "paymentAmount", "instagramHandle",
  "depositRequired", "depositAmount", "depositMethod", "paymentMethod", "requiresConfirmation",
  "statusHistory", "tasks", "albumId", "gcalEventId", "source", "tags", "contractId",
  "attendeeCount", "instalmentIds", "seriesId", "seriesConfig",
]);

const ADMIN_BOOKING_EDITABLE_FIELDS = new Set([
  "clientName", "clientEmail", "phone", "date", "time", "eventTypeId", "type", "duration",
  "status", "notes", "answers", "answerLabels", "instagramHandle", "statusHistory", "tasks",
  "albumId", "gcalEventId", "source", "tags", "contractId", "attendeeCount", "instalmentIds",
  "seriesId", "seriesConfig",
]);

const ADMIN_BOOKING_SERVER_MANAGED_FIELDS = new Set([
  "paymentStatus", "paymentAmount", "depositRequired", "depositAmount", "depositMethod",
  "paymentMethod", "requiresConfirmation",
]);

function sanitizeAdminBookingChanges(input, allowedFields = ADMIN_BOOKING_EDITABLE_FIELDS) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const changes = {};
  for (const [key, value] of Object.entries(input)) {
    if (allowedFields.has(key)) changes[key] = value;
  }
  return changes;
}

function withMainBookingLocks(bookingIds, task, index = 0) {
  const ids = [...new Set(bookingIds)].sort();
  if (index >= ids.length) return task();
  return withCheckoutResourceLock(
    bookingCheckoutResourceLockKey("main", ids[index]),
    () => withMainBookingLocks(ids, task, index + 1),
  );
}

// Atomic single-record admin mutations. These deliberately preserve all
// checkout, capability, archive and payment-review fields managed by the
// server, even when an administrator has a stale browser tab open.
app.post("/api/admin/bookings", superLimiter, requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const input = req.body?.booking;
  const bookingId = String(input?.id || "").trim();
  const changes = sanitizeAdminBookingChanges(input, ADMIN_BOOKING_CREATE_FIELDS);
  if (!bookingId || bookingId.length > 128 || !changes) {
    return res.status(400).json({ ok: false, code: "INVALID_BOOKING", error: "A valid booking is required" });
  }
  return withCheckoutResourceLock(bookingCheckoutResourceLockKey("main", bookingId), async () => {
    const db = readDb();
    const bookings = getStoredArray(db, DB_KEYS.BOOKINGS);
    if (bookings.some(booking => String(booking?.id || "") === bookingId)) {
      return res.status(409).json({ ok: false, code: "BOOKING_EXISTS", error: "Booking already exists" });
    }
    const createdAt = String(input?.createdAt || new Date().toISOString());
    const booking = { id: bookingId, ...changes, createdAt, tenantSlug: undefined };
    if (["paid", "cash"].includes(String(booking.paymentStatus || ""))) {
      booking.paidAt = createdAt;
      if (booking.paymentStatus === "cash") booking.paymentMethod = "cash";
      booking.paymentHistory = [{ action: "admin-booking-created-settled", changedAt: createdAt, source: "admin", paymentStatus: booking.paymentStatus }];
      if (booking.status === "pending" && booking.requiresConfirmation !== true) {
        booking.status = "confirmed";
        booking.statusHistory = [...(Array.isArray(booking.statusHistory) ? booking.statusHistory : []), { status: "confirmed", changedAt: createdAt, note: "Admin booking created with settled payment" }];
      }
    } else if (booking.paymentStatus === "deposit-paid") {
      booking.depositPaidAt = createdAt;
      booking.paymentHistory = [{ action: "admin-booking-created-deposit", changedAt: createdAt, source: "admin", paymentStatus: "deposit-paid" }];
    }
    if (booking.status !== "cancelled") {
      const eventTypes = getStoredArray(db, DB_KEYS.EVENT_TYPES);
      if (bookingConflicts(booking, bookings, eventTypes, { tenantSlug: null })) {
        return res.status(409).json({ ok: false, code: "BOOKING_CONFLICT", error: "This time conflicts with an existing booking" });
      }
    }
    bookings.push(booking);
    db[DB_KEYS.BOOKINGS] = JSON.stringify(bookings);
    writeDb(db);
    if (bookingReadyForCalendar(booking)) queueBookingCalendarSync(booking, "create");
    return res.status(201).json({ ok: true, booking });
  });
});

app.patch("/api/admin/bookings/:id", superLimiter, requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const bookingId = String(req.params.id || "").trim();
  if (!bookingId || bookingId.length > 128) {
    return res.status(404).json({ ok: false, code: "BOOKING_NOT_FOUND", error: "Booking not found" });
  }
  const requestedKeys = Object.keys(req.body?.changes || {});
  if (requestedKeys.some(key => ADMIN_BOOKING_SERVER_MANAGED_FIELDS.has(key))) {
    return res.status(409).json({ ok: false, code: "PAYMENT_OPERATION_REQUIRED", error: "Payment fields must be changed through Payment Operations" });
  }
  const changes = sanitizeAdminBookingChanges(req.body?.changes);
  if (!changes || !Object.keys(changes).length) {
    return res.status(400).json({ ok: false, code: "NO_BOOKING_CHANGES", error: "No supported booking changes were supplied" });
  }
  return withCheckoutResourceLock(bookingCheckoutResourceLockKey("main", bookingId), async () => {
    const db = readDb();
    const bookings = getStoredArray(db, DB_KEYS.BOOKINGS);
    const index = bookings.findIndex(booking => !booking?.tenantSlug && String(booking?.id || "") === bookingId);
    if (index < 0) return res.status(404).json({ ok: false, code: "BOOKING_NOT_FOUND", error: "Booking not found" });
    const previous = bookings[index];
    const booking = { ...previous, ...changes, id: bookingId, tenantSlug: previous.tenantSlug };
    const schedulingChanged = ["date", "time", "duration", "eventTypeId", "status"].some(field => Object.prototype.hasOwnProperty.call(changes, field));
    if (schedulingChanged && booking.status !== "cancelled") {
      const eventTypes = getStoredArray(db, DB_KEYS.EVENT_TYPES);
      if (bookingConflicts(booking, bookings, eventTypes, { tenantSlug: null, excludeBookingId: bookingId })) {
        return res.status(409).json({ ok: false, code: "BOOKING_CONFLICT", error: "This time conflicts with an existing booking" });
      }
    }
    bookings[index] = booking;
    db[DB_KEYS.BOOKINGS] = JSON.stringify(bookings);
    writeDb(db);
    const calendarAction = booking.status === "cancelled" || (!bookingReadyForCalendar(booking) && previous.gcalEventId)
      ? "cancel"
      : bookingReadyForCalendar(booking) ? (previous.gcalEventId ? "reschedule" : "create") : null;
    if (calendarAction) queueBookingCalendarSync(booking, calendarAction);
    return res.json({ ok: true, booking });
  });
});

app.delete("/api/admin/bookings/:id", superLimiter, requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const bookingId = String(req.params.id || "").trim();
  if (!bookingId || bookingId.length > 128) {
    return res.status(404).json({ ok: false, code: "BOOKING_NOT_FOUND", error: "Booking not found" });
  }
  return withCheckoutResourceLock(bookingCheckoutResourceLockKey("main", bookingId), async () => {
    let db = readDb();
    let bookings = getStoredArray(db, DB_KEYS.BOOKINGS);
    let index = bookings.findIndex(booking => !booking?.tenantSlug && String(booking?.id || "") === bookingId);
    if (index < 0) return res.status(404).json({ ok: false, code: "BOOKING_NOT_FOUND", error: "Booking not found" });
    try { await syncBookingCalendarMutation(bookings[index], "cancel"); }
    catch (error) {
      console.error(`Calendar cleanup failed before deleting booking ${bookingId}:`, error?.message || error);
      return res.status(502).json({ ok: false, code: "CALENDAR_CLEANUP_FAILED", error: "Google Calendar could not be updated, so the booking was not deleted" });
    }
    db = readDb();
    bookings = getStoredArray(db, DB_KEYS.BOOKINGS);
    index = bookings.findIndex(booking => !booking?.tenantSlug && String(booking?.id || "") === bookingId);
    if (index < 0) return res.status(404).json({ ok: false, code: "BOOKING_NOT_FOUND", error: "Booking not found" });
    bookings.splice(index, 1);
    db[DB_KEYS.BOOKINGS] = JSON.stringify(bookings);
    writeDb(db);
    return res.json({ ok: true, bookingId });
  });
});

// Resolve a Stripe payment review against the current canonical main booking.
// This shares the booking mutation lock with checkout, bank switching, and
// Stripe webhook fulfilment so a delayed webhook cannot overwrite the result.
app.patch("/api/admin/bookings/:id/payment-review", superLimiter, requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const bookingId = String(req.params.id || "").trim();
  const paymentStatus = String(req.body?.paymentStatus || "").trim().toLowerCase();
  if (!bookingId || bookingId.length > 128) {
    return res.status(404).json({ ok: false, code: "BOOKING_NOT_FOUND", error: "Booking not found" });
  }
  if (!["paid", "cash", "deposit-paid"].includes(paymentStatus)) {
    return res.status(400).json({
      ok: false,
      code: "INVALID_PAYMENT_REVIEW_RESOLUTION",
      error: "paymentStatus must be paid, cash, or deposit-paid",
    });
  }

  try {
    return await withCheckoutResourceLock(bookingCheckoutResourceLockKey("main", bookingId), async () => {
      const db = readDb();
      const bookings = getStoredArray(db, DB_KEYS.BOOKINGS);
      const matches = bookings
        .map((booking, index) => ({ booking, index }))
        .filter(match => !match.booking?.tenantSlug && String(match.booking?.id || "") === bookingId);
      if (matches.length === 0) {
        return res.status(404).json({ ok: false, code: "BOOKING_NOT_FOUND", error: "Booking not found" });
      }
      if (matches.length !== 1) {
        return res.status(409).json({
          ok: false,
          code: "PAYMENT_REVIEW_NOT_ACTIVE",
          error: "The booking payment review could not be resolved unambiguously",
        });
      }

      const resolution = resolveBookingPaymentReview(matches[0].booking, paymentStatus, {
        actor: req.authContext?.username || "admin",
      });
      if (!resolution.ok) {
        return res.status(resolution.status).json({ ok: false, code: resolution.code, error: resolution.error });
      }

      bookings[matches[0].index] = resolution.booking;
      db[DB_KEYS.BOOKINGS] = JSON.stringify(bookings);
      writeDb(db);
      return res.json({ ok: true, booking: resolution.booking });
    });
  } catch (error) {
    console.error(`Payment review resolution failed for booking ${bookingId}:`, error?.message || error);
    return res.status(500).json({ ok: false, error: "Payment review resolution failed" });
  }
});

app.patch("/api/admin/bookings/:id/bank-payment", superLimiter, requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const bookingId = String(req.params.id || "").trim();
  if (!bookingId || bookingId.length > 128) return res.status(404).json({ ok: false, code: "BOOKING_NOT_FOUND", error: "Booking not found" });
  try {
    return await withCheckoutResourceLock(bookingCheckoutResourceLockKey("main", bookingId), async () => {
      const db = readDb();
      const bookings = getStoredArray(db, DB_KEYS.BOOKINGS);
      const index = bookings.findIndex(booking => !booking?.tenantSlug && booking.id === bookingId);
      if (index < 0) return res.status(404).json({ ok: false, code: "BOOKING_NOT_FOUND", error: "Booking not found" });
      const current = bookings[index];
      const methods = [current.paymentMethod, current.depositMethod, current.paymentPath].filter(Boolean).map(value => String(value).toLowerCase());
      if (current.paymentStatus !== "pending-confirmation" || !methods.length || methods.some(method => method !== "bank")) {
        return res.status(409).json({ ok: false, code: "BANK_PAYMENT_NOT_PENDING", error: "This booking is not awaiting bank-transfer verification" });
      }
      if (current.paymentNeedsReview || current.archived || ["cancelled", "completed"].includes(current.status)) {
        return res.status(409).json({ ok: false, code: "BANK_PAYMENT_REVIEW_REQUIRED", error: "This payment must be reconciled from the booking review before settlement" });
      }
      const confirmedAt = new Date().toISOString();
      const total = Number(current.paymentAmount) || 0;
      const deposit = Number(current.depositAmount) || 0;
      const depositOnly = current.depositRequired === true && deposit > 0 && deposit < total && !current.depositPaidAt;
      const history = Array.isArray(current.paymentHistory) ? current.paymentHistory.slice(-99) : [];
      const updated = {
        ...current,
        paymentStatus: depositOnly ? "deposit-paid" : "paid",
        paymentMethod: "bank",
        bankTransferVerificationStatus: "confirmed-by-admin",
        bankPaymentConfirmedAt: confirmedAt,
        bankPaymentConfirmedBy: req.authContext?.username || "admin",
        holdExpiresAt: undefined,
        ...(depositOnly ? { depositPaidAt: confirmedAt } : { paidAt: confirmedAt, ...(current.depositPaidAt ? { balancePaidAt: confirmedAt } : {}) }),
        status: current.status === "pending" && !current.requiresConfirmation ? "confirmed" : current.status,
        paymentHistory: [...history, { action: "manual-bank-payment-confirmed", changedAt: confirmedAt, source: "admin", paymentStatus: depositOnly ? "deposit-paid" : "paid", amount: depositOnly ? deposit : Math.max(0, total - (current.depositPaidAt ? deposit : 0)) }],
      };
      bookings[index] = updated;
      db[DB_KEYS.BOOKINGS] = JSON.stringify(bookings);
      writeDb(db);
      setImmediate(() => sendMainBookingReceipt(updated, { recordEmailLog: false }).catch(error => console.error(`Bank payment receipt failed for ${bookingId}:`, error?.message || error)));
      return res.json({ ok: true, booking: updated });
    });
  } catch (error) {
    console.error(`Bank payment confirmation failed for ${bookingId}:`, error?.message || error);
    return res.status(500).json({ ok: false, error: "Bank payment confirmation failed" });
  }
});

app.patch("/api/admin/bookings/:id/complete-balance", superLimiter, requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const bookingId = String(req.params.id || "").trim();
  const method = String(req.body?.method || "bank").trim().toLowerCase();
  if (!bookingId || bookingId.length > 128) return res.status(404).json({ ok: false, code: "BOOKING_NOT_FOUND", error: "Booking not found" });
  if (!["bank", "cash"].includes(method)) return res.status(400).json({ ok: false, code: "INVALID_BALANCE_METHOD", error: "Balance method must be bank or cash" });
  return withCheckoutResourceLock(bookingCheckoutResourceLockKey("main", bookingId), async () => {
    const db = readDb();
    const bookings = getStoredArray(db, DB_KEYS.BOOKINGS);
    const index = bookings.findIndex(booking => !booking?.tenantSlug && booking.id === bookingId);
    if (index < 0) return res.status(404).json({ ok: false, code: "BOOKING_NOT_FOUND", error: "Booking not found" });
    const current = bookings[index];
    if (current.paymentStatus === "paid" && current.balancePaidAt && current.lastPaymentKind === "balance") {
      return res.json({ ok: true, booking: current, reused: true });
    }
    if (current.paymentStatus !== "deposit-paid") {
      return res.status(409).json({ ok: false, code: "DEPOSIT_NOT_SETTLED", error: "This booking does not have a verified deposit awaiting its balance" });
    }
    if (current.paymentNeedsReview || current.archived || current.status === "cancelled") {
      return res.status(409).json({ ok: false, code: "BALANCE_REVIEW_REQUIRED", error: "This balance must be reconciled from the booking review" });
    }
    const total = Math.max(0, Number(current.paymentAmount) || 0);
    const deposit = Math.max(0, Number(current.depositAmount) || 0);
    const balance = Math.max(0, total - deposit);
    if (balance <= 0) return res.status(409).json({ ok: false, code: "NO_BALANCE_DUE", error: "This booking has no remaining balance" });
    const confirmedAt = new Date().toISOString();
    // Older bookings used paymentStatus as the authoritative deposit record
    // before depositPaidAt was introduced. Preserve that verified state and
    // backfill a conservative audit timestamp when the remaining balance is
    // explicitly confirmed by an admin.
    const depositVerifiedAt = current.depositPaidAt
      || (current.lastPaymentKind === "deposit" ? current.lastPaymentAt : undefined)
      || current.paidAt
      || confirmedAt;
    const history = Array.isArray(current.paymentHistory) ? current.paymentHistory.slice(-99) : [];
    const updated = {
      ...current,
      paymentStatus: "paid",
      paymentMethod: method,
      depositPaidAt: depositVerifiedAt,
      paidAt: confirmedAt,
      balancePaidAt: confirmedAt,
      holdExpiresAt: undefined,
      lastPaymentKind: "balance",
      lastPaymentAmount: balance,
      lastPaymentAt: confirmedAt,
      paymentHistory: [...history, { action: "remaining-balance-confirmed", changedAt: confirmedAt, source: "admin", method, paymentStatus: "paid", amount: balance, depositTimestampBackfilled: !current.depositPaidAt }],
    };
    bookings[index] = updated;
    db[DB_KEYS.BOOKINGS] = JSON.stringify(bookings);
    writeDb(db);
    queueBookingCalendarSync(updated, updated.gcalEventId ? "reschedule" : "create");
    setImmediate(() => sendMainBookingReceipt(updated, { recordEmailLog: false }).catch(error => console.error(`Balance receipt failed for ${bookingId}:`, error?.message || error)));
    return res.json({ ok: true, booking: updated });
  });
});

// Archive/unarchive one or more retained bookings without allowing the browser
// to replace the canonical bookings collection. Archiving is limited to
// terminal, elapsed, or expired unpaid holds so it cannot release a live slot.
app.patch("/api/admin/bookings/archive", superLimiter, requireAuth, async (req, res) => {
  const archived = req.body?.archived;
  const bookingIds = req.body?.bookingIds;
  if (typeof archived !== "boolean" || !Array.isArray(bookingIds)) {
    return res.status(400).json({ ok: false, error: "bookingIds and archived are required" });
  }
  const normalizedIds = [...new Set(bookingIds.map(id => String(id || "").trim()))].filter(Boolean);
  if (!normalizedIds.length || normalizedIds.length > 200 || normalizedIds.some(id => id.length > 128)) {
    return res.status(400).json({ ok: false, error: "Provide between 1 and 200 valid booking IDs" });
  }
  return withMainBookingLocks(normalizedIds, () => {
    const db = readDb();
    const bookings = getStoredArray(db, DB_KEYS.BOOKINGS);
    const mainTimezone = dbGet(db, DB_KEYS.PROFILE, {})?.timezone || "Australia/Sydney";
    const tenantTimezones = new Map(readTenants().map(tenant => [tenant.slug, tenant.timezone || "Australia/Sydney"]));
    const result = applyBookingArchiveState(bookings, normalizedIds, archived, {
      actor: req.authContext?.username || "admin",
      timezoneForBooking: booking => booking?.tenantSlug ? tenantTimezones.get(booking.tenantSlug) || "Australia/Sydney" : mainTimezone,
    });
    if (result.changedIds.length) {
      db[DB_KEYS.BOOKINGS] = JSON.stringify(result.bookings);
      writeDb(db);
    }
    const requested = new Set(normalizedIds);
    const updated = result.bookings.filter(booking => requested.has(String(booking?.id || "")));
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      ok: true,
      archived,
      updated,
      changedIds: result.changedIds,
      unchangedIds: result.unchangedIds,
      skipped: result.skipped,
    });
  });
});

// ── Super Admin: Event Slot Requests ──────────────────
// List all event slot purchase requests
app.get("/api/super/event-slot-requests", superLimiter, requireAuth, (_req, res) => {
  const requests = readEventSlotRequests();
  const tenants = readTenants();
  const result = requests.map(r => {
    const tenant = tenants.find(t => t.slug === r.tenantSlug);
    return { ...r, tenantDisplayName: tenant?.displayName || r.tenantSlug };
  });
  res.json(result);
});

// Confirm an event slot request — grants the tenant one extra event slot
app.post("/api/super/event-slot-requests/:id/confirm", superLimiter, requireAuth, (req, res) => {
  const { id } = req.params;
  const { confirmedBy } = req.body || {};
  const requests = readEventSlotRequests();
  const idx = requests.findIndex(r => r.id === id);
  if (idx < 0) return res.status(404).json({ error: "Request not found" });
  if (!licensedTenantBySlug(requests[idx].tenantSlug)) return res.status(409).json({ error: "Tenant licence is not active" });
  if (!["pending", "paid"].includes(requests[idx].status)) {
    return res.status(400).json({ error: "Request is not in a confirmable state" });
  }
  requests[idx] = { ...requests[idx], status: "confirmed", confirmedAt: new Date().toISOString(), confirmedBy: confirmedBy || "admin" };
  writeEventSlotRequests(requests);
  // Grant the extra slot
  const slug = requests[idx].tenantSlug;
  const db = readDb();
  const extraSlotsKey = `t_${slug}_wv_extra_event_slots`;
  db[extraSlotsKey] = (typeof db[extraSlotsKey] === "number" ? db[extraSlotsKey] : 0) + 1;
  writeDb(db);
  res.json({ ok: true, request: requests[idx] });
});

// Reject an event slot request
app.post("/api/super/event-slot-requests/:id/reject", superLimiter, requireAuth, (req, res) => {
  const { id } = req.params;
  const { rejectedBy, notes } = req.body || {};
  const requests = readEventSlotRequests();
  const idx = requests.findIndex(r => r.id === id);
  if (idx < 0) return res.status(404).json({ error: "Request not found" });
  if (!["pending", "paid"].includes(requests[idx].status)) {
    return res.status(400).json({ error: "Request is not in a rejectable state" });
  }
  requests[idx] = {
    ...requests[idx], status: "rejected",
    rejectedAt: new Date().toISOString(), rejectedBy: rejectedBy || "admin",
    ...(notes ? { notes } : {}),
  };
  writeEventSlotRequests(requests);
  res.json({ ok: true, request: requests[idx] });
});

// ── Tenant Event Slot Requests ──────────────────────────
// Submit a request for an extra event slot (bank or stripe payment)
app.post("/api/tenant/:slug/event-slot-request", tenantLimiter, requireTenant, (req, res) => {
  const slug = req.params.slug;
  const tenants = readTenants();
  const tenant = tenants.find(t => t.slug === slug && t.active !== false);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  const { paymentMethod } = req.body || {};
  if (paymentMethod !== "bank") {
    return res.status(400).json({ error: "Extra event slots use bank/manual approval only" });
  }
  // Determine effective extra event price: tenant-level override takes priority
  let extraEventPrice = null;
  if (tenant.extraEventSlotRequestEnabled === true) {
    extraEventPrice = typeof tenant.extraEventPrice === "number" ? tenant.extraEventPrice : null;
  }
  // Fall back to license key price if not overridden at tenant level
  if (extraEventPrice == null && tenant.licenseKey) {
    const allKeys = readLicenseKeys();
    const licKey = allKeys.find(k => k.key === tenant.licenseKey);
    if (licKey) {
      const limits = getLicKeyLimits(licKey);
      extraEventPrice = limits.extraEventPrice;
    }
  }
  if (extraEventPrice == null) return res.status(400).json({ error: "Extra event slots are not available for this tenant" });
  // Reject if a pending/paid request already exists
  const existingRequests = readEventSlotRequests();
  const hasPending = existingRequests.some(r => r.tenantSlug === slug && ["pending", "paid"].includes(r.status));
  if (hasPending) return res.status(409).json({ error: "You already have a pending event slot request" });
  const request = {
    id: `esr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    tenantSlug: slug,
    requestedAt: new Date().toISOString(),
    paymentMethod,
    amount: extraEventPrice,
    status: "pending",
  };
  existingRequests.push(request);
  writeEventSlotRequests(existingRequests);
  res.json({ ok: true, request });
});

// Get the active pending/paid event slot request for a tenant
app.get("/api/tenant/:slug/event-slot-request/pending", tenantLimiter, requireTenant, (req, res) => {
  const slug = req.params.slug;
  const requests = readEventSlotRequests();
  const pending = requests.find(r => r.tenantSlug === slug && ["pending", "paid"].includes(r.status));
  res.json({ request: pending || null });
});

// ── Tenant Login (for mobile app) ─────────────────────
app.post("/api/tenant/:slug/login", tenantLimiter, async (req, res) => {
  const tenants = readTenants();
  const identifier = String(req.params.slug || "").trim().toLowerCase();
  const candidate = tenants.find(t => (
    String(t.slug || "").toLowerCase() === identifier ||
    String(t.email || "").toLowerCase() === identifier ||
    String(t.displayName || "").toLowerCase() === identifier
  ));
  const tenant = candidate && tenantLicenseState(candidate, readLicenseKeys()).active ? candidate : null;
  const { passwordHash } = req.body || {};
  const suppliedHash = typeof passwordHash === "string" ? passwordHash : "";
  const ok = await verifyPasswordHash(suppliedHash, tenant?.passwordHash || DUMMY_TENANT_PASSWORD_HASH);
  if (!tenant || !tenant.passwordHash || !suppliedHash || !ok) {
    return res.status(401).json({ ok: false, error: "Invalid credentials" });
  }
  const token = signSession({ purpose: "tenant", sub: tenant.slug, cv: credentialVersion(tenant.passwordHash) }, SESSION_SECRET, { ttlSeconds: TENANT_SESSION_TTL_SECONDS });
  setHttpOnlyCookie(req, res, TENANT_SESSION_COOKIE, token, TENANT_SESSION_TTL_SECONDS);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    tenant: safeTenantPrivateDto(tenant),
    ...(isExplicitNativeOrigin(req.headers.origin, NATIVE_APP_ORIGINS) ? { sessionToken: token, expiresIn: TENANT_SESSION_TTL_SECONDS } : {}),
  });
});

app.post("/api/tenant/:slug/logout", tenantLimiter, (req, res) => {
  clearHttpOnlyCookie(req, res, TENANT_SESSION_COOKIE);
  res.json({ ok: true });
});

app.get("/api/tenant/:slug/session", tenantLimiter, requireTenant, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, tenant: safeTenantPrivateDto(req.authContext.tenant) });
});

app.put("/api/tenant/:slug/profile", tenantLimiter, requireTenant, async (req, res) => {
  const tenants = readTenants();
  const index = tenants.findIndex(tenant => tenant.slug === req.params.slug);
  if (index < 0) return res.status(404).json({ ok: false, error: "Tenant not found" });
  const updates = {};
  if (req.body?.displayName !== undefined) {
    const displayName = String(req.body.displayName).trim();
    if (!displayName || displayName.length > 120) return res.status(400).json({ ok: false, error: "A valid display name is required" });
    updates.displayName = displayName;
  }
  if (req.body?.email !== undefined) {
    const email = String(req.body.email).trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, error: "A valid email is required" });
    updates.email = email;
  }
  if (req.body?.bio !== undefined) updates.bio = String(req.body.bio).trim().slice(0, 2000) || undefined;
  if (req.body?.timezone !== undefined) {
    const timezone = String(req.body.timezone).trim();
    try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { return res.status(400).json({ ok: false, error: "Invalid timezone" }); }
    updates.timezone = timezone;
  }
  if (req.body?.passwordHash !== undefined) {
    const passwordHash = String(req.body.passwordHash);
    if (passwordHash.length < 32 || passwordHash.length > 256) return res.status(400).json({ ok: false, error: "Invalid password hash" });
    updates.passwordHash = await bcryptHash(passwordHash);
  }
  tenants[index] = { ...tenants[index], ...updates };
  writeTenants(tenants);
  let sessionToken;
  if (updates.passwordHash) {
    sessionToken = signSession({ purpose: "tenant", sub: tenants[index].slug, cv: credentialVersion(tenants[index].passwordHash) }, SESSION_SECRET, { ttlSeconds: TENANT_SESSION_TTL_SECONDS });
    setHttpOnlyCookie(req, res, TENANT_SESSION_COOKIE, sessionToken, TENANT_SESSION_TTL_SECONDS);
  }
  res.json({
    ok: true,
    tenant: safeTenantPrivateDto(tenants[index]),
    ...(sessionToken && isExplicitNativeOrigin(req.headers.origin, NATIVE_APP_ORIGINS) ? { sessionToken, expiresIn: TENANT_SESSION_TTL_SECONDS } : {}),
  });
});

// ── Tenant Mobile Data (bookings + albums for mobile app) ─────────────────
app.get("/api/tenant/:slug/mobile-data", tenantLimiter, requireTenant, (req, res) => {
  const slug = req.params.slug;
  const tenants = readTenants();
  const tenant = tenants.find(t => t.slug === slug && t.active !== false);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  const db = readDb();
  const allBookingsRaw = db["wv_bookings"];
  const allBookings = allBookingsRaw ? (typeof allBookingsRaw === "string" ? JSON.parse(allBookingsRaw) : (Array.isArray(allBookingsRaw) ? allBookingsRaw : [])) : [];
  const tenantBookings = allBookings.filter(b => b.tenantSlug === slug);
  const albumsRaw = db[`t_${slug}_wv_albums`];
  const albums = albumsRaw ? (typeof albumsRaw === "string" ? JSON.parse(albumsRaw) : (Array.isArray(albumsRaw) ? albumsRaw : [])) : [];
  // Strip baked watermark blobs before sending to client — they are not needed
  // for admin views and would greatly inflate the response size.
  const leanAlbums = albums.map(a => ({ ...a, photos: _stripBakedFromPhotos((a.photos || []).map(_ensurePhotoProofIdentity)) }));
  res.json({ tenant: safeTenantPrivateDto(tenant), bookings: tenantBookings, albums: leanAlbums });
});

// Create or update a tenant album (used by mobile app in tenant mode)
app.put("/api/tenant/:slug/albums/:albumId", tenantLimiter, requireTenant, authenticatedLargeJson, (req, res) => {
  const { slug, albumId } = req.params;
  const db = readDb();
  const key = `t_${slug}_wv_albums`;
  const raw = db[key];
  const albums = raw ? (typeof raw === "string" ? JSON.parse(raw) : (Array.isArray(raw) ? raw : [])) : [];
  const idx = albums.findIndex(a => a.id === albumId);
  // Strip baked watermark fields before persisting to keep the database lean.
  const incoming = { ...req.body, id: albumId };
  if (Object.prototype.hasOwnProperty.call(incoming, "downloadEmailCapture")) {
    incoming.downloadEmailCapture = normalizeDownloadEmailPolicy(incoming.downloadEmailCapture);
  }
  // If the client is sending a bandwidth-saving stub (_photosStripped:true, photos:[])
  // don't overwrite the server's real photos array with the empty stub.
  if (incoming._photosStripped) {
    if (Array.isArray(incoming.photos) && incoming.photos.length > 0) {
      const existingPhotos = idx >= 0 && Array.isArray(albums[idx]?.photos) ? albums[idx].photos : [];
      incoming.photos = _mergePhotoArrays(existingPhotos, incoming.photos);
      incoming.photoCount = incoming.photos.length;
    } else {
      delete incoming.photos;
    }
    delete incoming._photosStripped;
  } else if (incoming.photos) {
    incoming.photos = _stripBakedFromPhotos(incoming.photos).map(_ensurePhotoProofIdentity);
  }
  const candidate = idx >= 0 ? { ...albums[idx], ...incoming } : incoming;
  const invalidUploads = invalidAlbumUploadReferences(db, candidate, slug);
  if (invalidUploads.length) return res.status(409).json({ error: "One or more uploads do not belong to this tenant" });
  if (idx >= 0) albums[idx] = candidate;
  else albums.push(candidate);
  db[key] = JSON.stringify(albums);
  writeDb(db);
  res.json({ ok: true });
});

// Upsert a booking that belongs to a tenant (create if new, update if existing; used by tenant admin)
app.put("/api/tenant/:slug/bookings/:bookingId", tenantLimiter, requireTenant, async (req, res) => {
  const { slug, bookingId } = req.params;
  const licensed = licensedTenantBySlug(slug);
  const tenant = licensed?.tenant;
  if (!tenant) return res.status(404).json({ ok: false, error: "Tenant not found" });
  let db = readDb();
  let allBookings = getStoredArray(db, DB_KEYS.BOOKINGS);
  const idx = allBookings.findIndex(b => b.id === bookingId && b.tenantSlug === slug);
  let calendarAction = null;
  const { id: _id, tenantSlug: _ts, ...updates } = req.body || {};
  if (idx < 0) {
    const clientName = String(updates.clientName || "").trim();
    const clientEmail = String(updates.clientEmail || "").trim().toLowerCase();
    if (!clientName || clientName.length > 160 || clientEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
      return res.status(400).json({ ok: false, error: "A valid client name and email are required" });
    }
    const eventTypes = getStoredArray(db, `t_${slug}_wv_event_types`);
    let googleBusy;
    try { googleBusy = await getGoogleBusyBookings(slug, String(updates.date || ""), tenant.timezone || "Australia/Sydney"); }
    catch (error) {
      console.error(`Tenant ${slug} calendar check failed for admin booking:`, error.message);
      return res.status(503).json({ ok: false, error: "Calendar availability is temporarily unavailable" });
    }
    db = readDb();
    allBookings = getStoredArray(db, DB_KEYS.BOOKINGS);
    if (allBookings.some(booking => booking.id === bookingId)) return res.status(409).json({ ok: false, error: "Booking id is already in use" });
    const currentEventTypes = getStoredArray(db, `t_${slug}_wv_event_types`);
    const validation = validateBookingRequest({
      eventTypeId: updates.eventTypeId,
      date: updates.date,
      time: updates.time,
      duration: updates.duration,
    }, bookingValidationContext(db, slug, currentEventTypes, tenant.timezone, undefined, googleBusy));
    if (!validation.ok) return res.status(validation.status).json({ ok: false, error: validation.error });
    if (JSON.stringify(eventTypes.find(item => item.id === updates.eventTypeId)) !== JSON.stringify(validation.eventType)) {
      return res.status(409).json({ ok: false, error: "Booking configuration changed; refresh and try again" });
    }
    const answerInput = updates.answers && typeof updates.answers === "object" && !Array.isArray(updates.answers) ? updates.answers : {};
    const safeAnswers = {};
    const answerLabels = {};
    for (const question of Array.isArray(validation.eventType.questions) ? validation.eventType.questions : []) {
      const value = answerInput[question.id];
      answerLabels[question.id] = String(question.label || "").slice(0, 300);
      if (question.required && (value == null || String(value).trim() === "")) {
        return res.status(400).json({ ok: false, error: `${question.label || "A required question"} is required` });
      }
      if (value != null) safeAnswers[question.id] = String(value).slice(0, 2000);
    }
    const limits = getLicKeyLimits(licensed.license);
    if (limits.maxBookings !== null && allBookings.filter(item => item.tenantSlug === slug && bookingCountsTowardTenantLimit(item)).length >= limits.maxBookings) {
      return res.status(403).json({ ok: false, error: `Booking limit reached (${limits.maxBookings} bookings)` });
    }
    const requestedPaymentStatus = ["paid", "deposit-paid", "pending-confirmation", "unpaid"].includes(updates.paymentStatus)
      ? updates.paymentStatus
      : validation.normalized.paymentAmount > 0 ? "pending-confirmation" : "paid";
    const requestedStatus = ["pending", "confirmed"].includes(updates.status)
      ? updates.status
      : validation.normalized.paymentAmount > 0 || validation.normalized.requiresConfirmation ? "pending" : "confirmed";
    const settled = ["paid", "deposit-paid"].includes(requestedPaymentStatus) || requestedStatus === "confirmed";
    const booking = {
      id: bookingId,
      tenantSlug: slug,
      modifyToken: `mod-${crypto.randomBytes(32).toString("base64url")}`,
      clientName,
      clientEmail,
      phone: String(updates.phone || "").trim().slice(0, 40),
      date: validation.normalized.date,
      time: validation.normalized.time,
      duration: validation.normalized.duration,
      eventTypeId: validation.eventType.id,
      type: validation.eventType.title || "Session",
      status: requestedStatus,
      requiresConfirmation: validation.normalized.requiresConfirmation,
      paymentStatus: requestedPaymentStatus,
      paymentAmount: validation.normalized.paymentAmount,
      depositRequired: validation.normalized.depositRequired,
      depositAmount: validation.normalized.depositAmount,
      notes: String(updates.notes || "").trim().slice(0, 5000),
      answers: safeAnswers,
      answerLabels,
      createdAt: new Date().toISOString(),
      ...(!settled && validation.normalized.paymentAmount > 0 ? { holdExpiresAt: unconfirmedBookingHoldExpiresAt(dbGet(db, `t_${slug}_wv_tenant_settings`, {}), "contact") } : {}),
    };
    allBookings.push(booking);
    db[DB_KEYS.BOOKINGS] = JSON.stringify(allBookings);
    writeDb(db);
    queueInitialBookingCalendarSync(booking);
    return res.json({ ok: true, booking: publicBookingDto(booking) });
  } else {
    const existing = allBookings[idx];
    const {
      modifyToken: _modifyToken,
      stripeSessionId: _stripeSessionId,
      stripeCheckoutSessionId: _stripeCheckoutSessionId,
      stripeFulfilments: _stripeFulfilments,
      receiptEmailEvents: _receiptEvents,
      ...safeUpdates
    } = updates;
    const updated = { ...existing, ...safeUpdates, id: bookingId, tenantSlug: slug, modifyToken: existing.modifyToken };
    if (["confirmed", "completed"].includes(updated.status) || ["paid", "deposit-paid"].includes(updated.paymentStatus)) {
      delete updated.holdExpiresAt;
    } else if (!updated.holdExpiresAt && updated.paymentAmount > 0) {
      updated.holdExpiresAt = unconfirmedBookingHoldExpiresAt(dbGet(db, `t_${slug}_wv_tenant_settings`, {}), updated.paymentPath || "contact");
    }
    calendarAction = updated.status === "cancelled" || (!bookingReadyForCalendar(updated) && existing.gcalEventId)
      ? "cancel"
      : bookingReadyForCalendar(updated) ? (existing.gcalEventId ? "reschedule" : "create") : null;
    allBookings[idx] = updated;
  }
  db[DB_KEYS.BOOKINGS] = JSON.stringify(allBookings);
  writeDb(db);
  if (calendarAction) queueBookingCalendarSync(allBookings[idx], calendarAction);
  res.json({ ok: true, booking: publicBookingDto(allBookings[idx]) });
});

// Delete a booking that belongs to a tenant (tenant admin)
app.delete("/api/tenant/:slug/bookings/:bookingId", tenantLimiter, requireTenant, async (req, res) => {
  const { slug, bookingId } = req.params;
  const tenants = readTenants();
  const tenant = tenants.find(t => t.slug === slug && t.active !== false);
  if (!tenant) return res.status(404).json({ ok: false, error: "Tenant not found" });
  return withCheckoutResourceLock(bookingCheckoutResourceLockKey(`tenant:${slug}`, bookingId), async () => {
    let db = readDb();
    let bookings = getStoredArray(db, DB_KEYS.BOOKINGS);
    let index = bookings.findIndex(booking => booking.id === bookingId && booking.tenantSlug === slug);
    if (index < 0) return res.status(404).json({ ok: false, error: "Booking not found" });
    try { await syncBookingCalendarMutation(bookings[index], "cancel"); }
    catch (error) {
      console.error(`Tenant ${slug} Calendar cleanup failed before deleting booking ${bookingId}:`, error?.message || error);
      return res.status(502).json({ ok: false, code: "CALENDAR_CLEANUP_FAILED", error: "Google Calendar could not be updated, so the booking was not deleted" });
    }
    db = readDb();
    bookings = getStoredArray(db, DB_KEYS.BOOKINGS);
    index = bookings.findIndex(booking => booking.id === bookingId && booking.tenantSlug === slug);
    if (index < 0) return res.status(404).json({ ok: false, error: "Booking not found" });
    bookings.splice(index, 1);
    db[DB_KEYS.BOOKINGS] = JSON.stringify(bookings);
    writeDb(db);
    return res.json({ ok: true });
  });
});

// Delete a tenant album (tenant admin)
app.delete("/api/tenant/:slug/albums/:albumId", tenantLimiter, requireTenant, (req, res) => {
  const { slug, albumId } = req.params;
  const db = readDb();
  const key = `t_${slug}_wv_albums`;
  const raw = db[key];
  const albums = raw ? (typeof raw === "string" ? JSON.parse(raw) : (Array.isArray(raw) ? raw : [])) : [];
  const filtered = albums.filter(a => a.id !== albumId);
  if (filtered.length === albums.length) return res.status(404).json({ ok: false, error: "Album not found" });
  db[key] = JSON.stringify(filtered);
  writeDb(db);
  res.json({ ok: true });
});

// Get license key info for a tenant (tenant admin — shows their own key details)
app.get("/api/tenant/:slug/license-info", tenantLimiter, requireTenant, (req, res) => {
  const slug = req.params.slug;
  const tenants = readTenants();
  const tenant = tenants.find(t => t.slug === slug && t.active !== false);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  const db = readDb();
  // Extra event slots granted by super admin
  const extraSlotsKey = `t_${slug}_wv_extra_event_slots`;
  const extraEventSlots = typeof db[extraSlotsKey] === "number" ? db[extraSlotsKey] : 0;
  // Lifetime event counter (bootstrapped from current array if not yet set)
  const counterKey = `t_${slug}_wv_event_counter`;
  const currentRaw = db[`t_${slug}_wv_event_types`];
  const currentEventTypes = currentRaw ? (typeof currentRaw === "string" ? JSON.parse(currentRaw) : (Array.isArray(currentRaw) ? currentRaw : [])) : [];
  const eventCount = typeof db[counterKey] === "number" ? db[counterKey] : currentEventTypes.length;
  // Base response — may be enriched by license key and/or tenant-level overrides
  let licKeyInfo = { key: null, issuedTo: null, isTrial: false, maxEvents: null, maxBookings: null, extraEventPrice: null, expiresAt: null, usedAt: null };
  if (tenant.licenseKey) {
    const keys = readLicenseKeys();
    const licKey = keys.find(k => k.key === tenant.licenseKey);
    if (licKey) {
      const limits = getLicKeyLimits(licKey);
      licKeyInfo = {
        key: licKey.key,
        issuedTo: licKey.issuedTo,
        isTrial: licKey.isTrial || false,
        maxEvents: limits.maxEvents,
        maxBookings: limits.maxBookings,
        extraEventPrice: limits.extraEventPrice,
        expiresAt: licKey.expiresAt,
        usedAt: licKey.usedAt,
      };
    }
  }
  // Per-tenant override: if enabled, apply tenant-level extraEventPrice (falls back to license key price)
  let effectiveExtraEventPrice = licKeyInfo.extraEventPrice;
  if (tenant.extraEventSlotRequestEnabled === true) {
    effectiveExtraEventPrice = typeof tenant.extraEventPrice === "number" ? tenant.extraEventPrice : effectiveExtraEventPrice;
  }
  // Return non-sensitive fields only
  res.json({
    key: licKeyInfo.key,
    issuedTo: licKeyInfo.issuedTo,
    isTrial: licKeyInfo.isTrial,
    maxEvents: licKeyInfo.maxEvents,
    maxBookings: licKeyInfo.maxBookings,
    extraEventPrice: effectiveExtraEventPrice,
    extraEventSlots,
    eventCount,
    expiresAt: licKeyInfo.expiresAt,
    usedAt: licKeyInfo.usedAt,
    keyPurchaseEnabled: tenant.keyPurchaseEnabled === true,
  });
});

// ── Tenant Settings (per-tenant integration overrides) ─────────────────────

// Secret fields that must never be returned to the frontend.
// Instead of the actual value, the masked response includes a boolean `<field>Set`
// so the UI can show a "Configured ✓" indicator without exposing the secret.
const TENANT_SECRET_FIELDS = [
  "stripeSecretKey",
  "stripeWebhookSecret",
  "smtpPassword",
  "googleApiCredentials",
  "discordWebhookUrl",
  "ftpPassword",
];

function maskTenantSettings(settings) {
  const masked = { ...settings };
  for (const field of TENANT_SECRET_FIELDS) {
    masked[`${field}Set`] = !!(masked[field]);
    delete masked[field];
  }
  return masked;
}

// Get tenant settings (Discord, SMTP, Stripe, bank — per-tenant overrides)
// Secret fields are never returned; boolean <field>Set indicators are sent instead.
app.get("/api/tenant/:slug/settings", tenantLimiter, requireTenant, (req, res) => {
  const slug = req.params.slug;
  const tenants = readTenants();
  if (!tenants.find(t => t.slug === slug)) return res.status(404).json({ error: "Tenant not found" });
  const db = readDb();
  const raw = db[`t_${slug}_wv_tenant_settings`];
  const settings = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
  res.json(maskTenantSettings(settings));
});

// Send email via the tenant's own SMTP settings only. Never relay arbitrary
// tenant content through the platform owner's sender identity.
const tenantEmailSendLimiter = rateLimit({ windowMs: 15 * 60_000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many email requests" } });
app.post("/api/tenant/:slug/email/send", tenantEmailSendLimiter, requireTenant, async (req, res) => {
  const { slug } = req.params;
  const tenants = readTenants();
  const tenant = tenants.find(t => t.slug === slug);
  if (!tenant) return res.status(404).json({ ok: false, error: "Tenant not found" });
  const db = readDb();
  const raw = db[`t_${slug}_wv_tenant_settings`];
  const tenantSettings = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
  const t = buildTenantTransporter(tenantSettings);
  const from = getTenantFromAddress(tenantSettings);
  if (!t) return res.status(400).json({ ok: false, error: "Tenant SMTP is not configured" });
  const { to, subject, html, text } = req.body;
  const recipient = String(to || "").trim().toLowerCase();
  const safeSubject = String(subject || "").trim();
  if (recipient.length > 254 || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(recipient)) return res.status(400).json({ ok: false, error: "A single valid recipient is required" });
  if (!safeSubject || safeSubject.length > 200 || /[\r\n]/.test(safeSubject)) return res.status(400).json({ ok: false, error: "A valid subject is required" });
  if (String(html || "").length > 100_000 || String(text || "").length > 100_000) return res.status(413).json({ ok: false, error: "Email content is too large" });
  const message = prepareCustomEmail({
    subject: safeSubject,
    html,
    text,
    brandName: tenantSettings.businessName || tenantSettings.brandName || tenant.displayName || "PhotoFlow",
  });
  try {
    const info = await t.sendMail({ from, to: recipient, subject: safeSubject, ...message });
    res.json({ ok: true, messageId: info.messageId });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Save tenant settings
// - Secret fields present with a non-empty value → update the stored secret.
// - Secret fields present but empty string → explicitly clear the stored secret.
// - Secret fields absent from the payload → preserve the existing stored value.
// - <field>Set boolean indicators from the frontend are ignored (computed server-side).
// The response never includes secret values; masked booleans are returned instead.
app.put("/api/tenant/:slug/settings", tenantLimiter, requireTenant, (req, res) => {
  const slug = req.params.slug;
  const tenants = readTenants();
  if (!tenants.find(t => t.slug === slug)) return res.status(404).json({ error: "Tenant not found" });
  const db = readDb();
  const existing = (() => {
    const raw = db[`t_${slug}_wv_tenant_settings`];
    return raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
  })();

  const incoming = { ...req.body };

  // Strip server-computed *Set indicators so they cannot override real data
  for (const field of TENANT_SECRET_FIELDS) {
    delete incoming[`${field}Set`];
  }

  const updated = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (TENANT_SECRET_FIELDS.includes(key)) {
      if (value === "") {
        // Explicit empty string → clear the secret
        delete updated[key];
      } else if (value !== undefined && value !== null) {
        // Real non-empty value → update the secret
        updated[key] = value;
      }
      // undefined / null (shouldn't occur after spread but be safe) → keep existing
    } else {
      updated[key] = value;
    }
  }

  db[`t_${slug}_wv_tenant_settings`] = JSON.stringify(updated);
  writeDb(db);
  res.json({ ok: true, settings: maskTenantSettings(updated) });
});


const planLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests" } });
// Self-service licence purchases are fail-closed until a checkout can be
// cryptographically bound to an authenticated tenant and applied atomically.
const LICENSE_SELF_SERVICE_PURCHASES_ENABLED = false;

function readLicensePlans() {
  const db = readDb();
  const raw = db["wv_license_plans"];
  return raw ? (typeof raw === "string" ? JSON.parse(raw) : (Array.isArray(raw) ? raw : [])) : [];
}
function writeLicensePlans(plans) {
  const db = readDb();
  db["wv_license_plans"] = JSON.stringify(plans);
  writeDb(db);
}

// List active plans (public — used on purchase/pricing page)
app.get("/api/license-plans", planLimiter, (_req, res) => {
  res.json(readLicensePlans().filter(p => p.active !== false && p.type === "one-time"));
});

// List ALL plans including inactive (admin only)
app.get("/api/license-plans/all", planLimiter, requireAuth, (_req, res) => {
  res.json(readLicensePlans());
});

// List all purchases
app.get("/api/license-plans/purchases", planLimiter, requireAuth, (_req, res) => {
  const db = readDb();
  const raw = db["wv_license_purchases"];
  const purchases = raw ? (typeof raw === "string" ? JSON.parse(raw) : (Array.isArray(raw) ? raw : [])) : [];
  res.json(purchases);
});

// Create a plan
app.post("/api/license-plans", planLimiter, requireAuth, (req, res) => {
  const { name, type, price, currency, durationDays, description, features } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (type !== "one-time") {
    return res.status(400).json({ error: "Only one-time license plans are supported in this release" });
  }
  if (typeof price !== "number" || price <= 0) {
    return res.status(400).json({ error: "price must be a positive number" });
  }
  const plan = {
    id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim(),
    type,
    price,
    currency: currency || "AUD",
    durationDays: type === "one-time" ? (Number(durationDays) || 365) : undefined,
    description: description?.trim() || undefined,
    features: Array.isArray(features) ? features.filter(f => f && typeof f === "string") : [],
    active: true,
    createdAt: new Date().toISOString(),
  };
  const plans = readLicensePlans();
  plans.push(plan);
  writeLicensePlans(plans);
  res.json(plan);
});

// Update a plan
app.put("/api/license-plans/:id", planLimiter, requireAuth, (req, res) => {
  const plans = readLicensePlans();
  const idx = plans.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Plan not found" });
  const { id: _ignoreId, createdAt: _ignoredAt, ...updates } = req.body || {};
  if (updates.type && updates.type !== "one-time") return res.status(400).json({ error: "Only one-time license plans are supported in this release" });
  plans[idx] = { ...plans[idx], ...updates, id: req.params.id };
  writeLicensePlans(plans);
  res.json(plans[idx]);
});

// Delete a plan
app.delete("/api/license-plans/:id", planLimiter, requireAuth, (req, res) => {
  const plans = readLicensePlans();
  const filtered = plans.filter(p => p.id !== req.params.id);
  if (filtered.length === plans.length) return res.status(404).json({ error: "Plan not found" });
  writeLicensePlans(filtered);
  res.json({ ok: true });
});

// Create Stripe checkout for a license plan purchase
app.post("/api/license-plans/:planId/checkout", planLimiter, async (req, res) => {
  if (!LICENSE_SELF_SERVICE_PURCHASES_ENABLED) return res.status(410).json({ error: "Self-service licence purchases are temporarily unavailable" });
  const plans = readLicensePlans();
  const plan = plans.find(p => p.id === req.params.planId && p.active !== false);
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  if (plan.type !== "one-time") return res.status(409).json({ error: "Recurring license plans are not purchasable in this release" });

  const { buyerEmail, buyerName, successUrl, cancelUrl } = req.body || {};
  if (!buyerEmail || typeof buyerEmail !== "string" || !buyerEmail.trim()) {
    return res.status(400).json({ error: "buyerEmail is required" });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey || !mainStripeReady()) return res.status(503).json({ error: "Stripe checkout is unavailable until webhook verification is configured" });

  try {
    const Stripe = require("stripe");
    const stripe = Stripe(stripeKey);
    const currency = (plan.currency || "AUD").toLowerCase();

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      customer_email: buyerEmail.trim(),
      line_items: [{
        price_data: {
          currency,
          product_data: {
            name: plan.name,
            description: plan.description || `${plan.type === "one-time" ? `${plan.durationDays || 365}-day` : plan.type} license for PhotoFlow`,
          },
          unit_amount: Math.round(plan.price * 100),
          ...(plan.type === "monthly" ? { recurring: { interval: "month" } } : {}),
          ...(plan.type === "yearly" ? { recurring: { interval: "year" } } : {}),
        },
        quantity: 1,
      }],
      mode: (plan.type === "monthly" || plan.type === "yearly") ? "subscription" : "payment",
      success_url: safeCheckoutReturnUrl(req, successUrl, "/?plan_success=1"),
      cancel_url: safeCheckoutReturnUrl(req, cancelUrl, "/?plan_cancelled=1"),
      metadata: {
        type: "license-plan",
        planId: plan.id,
        planName: plan.name,
        buyerEmail: buyerEmail.trim(),
        buyerName: buyerName || "",
        durationDays: String(plan.durationDays || 365),
        expectedAmountCents: String(Math.round(Number(plan.price) * 100)),
        expectedCurrency: currency,
      },
    });
    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("License plan checkout error:", err.message);
    res.status(500).json({ error: err.message || "Stripe error" });
  }
});

// Bank transfer: create a pending purchase (admin activates after manual payment)
app.post("/api/license-plans/:planId/bank-purchase", planLimiter, (req, res) => {
  if (!LICENSE_SELF_SERVICE_PURCHASES_ENABLED) return res.status(410).json({ error: "Self-service licence purchases are temporarily unavailable" });
  const plans = readLicensePlans();
  const plan = plans.find(p => p.id === req.params.planId && p.active !== false);
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  if (plan.type !== "one-time") return res.status(409).json({ error: "Recurring license plans are not purchasable in this release" });
  const { buyerEmail, buyerName } = req.body || {};
  if (!buyerEmail || typeof buyerEmail !== "string" || !buyerEmail.trim()) {
    return res.status(400).json({ error: "buyerEmail is required" });
  }
  const purchase = {
    id: `purchase-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    planId: plan.id,
    planName: plan.name,
    buyerEmail: buyerEmail.trim(),
    buyerName: buyerName || "",
    amount: plan.price,
    currency: plan.currency || "AUD",
    method: "bank",
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  const db = readDb();
  const raw = db["wv_license_purchases"];
  const purchases = raw ? (typeof raw === "string" ? JSON.parse(raw) : (Array.isArray(raw) ? raw : [])) : [];
  purchases.push(purchase);
  db["wv_license_purchases"] = JSON.stringify(purchases);
  writeDb(db);
  res.json({ ok: true, purchase });
});

// Admin: activate a pending bank purchase (generates license key)
app.post("/api/license-plans/purchases/:purchaseId/activate", planLimiter, requireAuth, (req, res) => {
  if (!LICENSE_SELF_SERVICE_PURCHASES_ENABLED) return res.status(410).json({ error: "Legacy licence purchases require manual review" });
  const db = readDb();
  const raw = db["wv_license_purchases"];
  const purchases = raw ? (typeof raw === "string" ? JSON.parse(raw) : (Array.isArray(raw) ? raw : [])) : [];
  const idx = purchases.findIndex(p => p.id === req.params.purchaseId);
  if (idx === -1) return res.status(404).json({ error: "Purchase not found" });
  if (purchases[idx].licenseKey) return res.json({ ok: true, key: purchases[idx].licenseKey });

  const newKey = generateKeyString();
  const plans = readLicensePlans();
  const plan = plans.find(p => p.id === purchases[idx].planId);
  const expiresAt = plan?.durationDays
    ? new Date(Date.now() + plan.durationDays * 86400 * 1000).toISOString()
    : undefined;

  purchases[idx] = {
    ...purchases[idx],
    status: "active",
    licenseKey: newKey,
    activatedAt: new Date().toISOString(),
    expiresAt,
  };
  db["wv_license_purchases"] = JSON.stringify(purchases);

  // Also add to license_keys.json so Setup wizard validates it
  const keys = readLicenseKeys();
  keys.push({
    key: newKey,
    issuedTo: purchases[idx].buyerEmail,
    createdAt: new Date().toISOString(),
    ...(expiresAt ? { expiresAt } : {}),
    notes: `${purchases[idx].planName} — bank transfer`,
  });
  writeLicenseKeys(keys);
  writeDb(db);
  res.json({ ok: true, key: newKey });
});

// ── License Keys ──────────────────────────────────────
const LICENSE_KEYS_FILE = path.join(DATA_DIR, "license_keys.json");
const EVENT_SLOT_REQUESTS_FILE = path.join(DATA_DIR, "event_slot_requests.json");

function readLicenseKeys() {
  try {
    if (!fs.existsSync(LICENSE_KEYS_FILE)) return [];
    const keys = JSON.parse(fs.readFileSync(LICENSE_KEYS_FILE, "utf-8"));
    if (!Array.isArray(keys)) throw new Error("License-key database must contain an array");
    return keys;
  } catch (err) {
    console.error("Unable to read license-key database:", err.message);
    throw err;
  }
}

function writeLicenseKeys(keys) {
  writeJsonFileAtomicSync(LICENSE_KEYS_FILE, keys);
}

function readEventSlotRequests() {
  try {
    if (!fs.existsSync(EVENT_SLOT_REQUESTS_FILE)) return [];
    const requests = JSON.parse(fs.readFileSync(EVENT_SLOT_REQUESTS_FILE, "utf-8"));
    if (!Array.isArray(requests)) throw new Error("Event-slot database must contain an array");
    return requests;
  } catch (err) {
    console.error("Unable to read event-slot database:", err.message);
    throw err;
  }
}

function writeEventSlotRequests(requests) {
  writeJsonFileAtomicSync(EVENT_SLOT_REQUESTS_FILE, requests);
}

/**
 * Resolve the effective limits for a license key.
 * Works for both trial and non-trial keys. maxEvents/maxBookings take precedence
 * over the deprecated trialMaxEvents/trialMaxBookings fields.
 */
function getLicKeyLimits(licKey) {
  return {
    maxEvents: licKey.maxEvents ?? licKey.trialMaxEvents ?? null,
    maxBookings: licKey.maxBookings ?? licKey.trialMaxBookings ?? null,
    extraEventPrice: licKey.extraEventPrice ?? null,
  };
}

function generateKeyString() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  // Use crypto.randomInt for unbiased cryptographically secure selection
  const segment = () => Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join("");
  return `WV-${segment()}-${segment()}-${segment()}-${segment()}`;
}

const licenseKeyLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests" } });

// List all keys
app.get("/api/license-keys", licenseKeyLimiter, requireAuth, (_req, res) => {
  res.json(readLicenseKeys());
});

// Generate a new key
app.post("/api/license-keys/generate", licenseKeyLimiter, requireAuth, (req, res) => {
  const { issuedTo, expiresAt, notes, isTrial, maxEvents, maxBookings, extraEventPrice } = req.body || {};
  if (!issuedTo || typeof issuedTo !== "string" || !issuedTo.trim()) {
    return res.status(400).json({ error: "issuedTo is required" });
  }
  if (expiresAt && isNaN(Date.parse(expiresAt))) {
    return res.status(400).json({ error: "Invalid expiresAt date" });
  }
  const keys = readLicenseKeys();
  const newKey = {
    key: generateKeyString(),
    issuedTo: issuedTo.trim(),
    createdAt: new Date().toISOString(),
    setupToken: crypto.randomBytes(32).toString("hex"),
    ...(expiresAt ? { expiresAt } : {}),
    ...(notes ? { notes: notes.trim() } : {}),
    ...(isTrial ? { isTrial: true } : {}),
    ...(typeof maxEvents === "number" && maxEvents > 0 ? { maxEvents } : {}),
    ...(typeof maxBookings === "number" && maxBookings > 0 ? { maxBookings } : {}),
    ...(typeof extraEventPrice === "number" && extraEventPrice > 0 ? { extraEventPrice } : {}),
  };
  keys.push(newKey);
  writeLicenseKeys(keys);
  res.json(newKey);
});

// Validate a key (returns valid: true/false without marking it used)
app.post("/api/license-keys/validate", licenseKeyLimiter, (req, res) => {
  const { key } = req.body || {};
  if (!key || typeof key !== "string") {
    return res.status(400).json({ valid: false, error: "key is required" });
  }
  const keys = readLicenseKeys();
  const found = keys.find(k => k.key === key.trim().toUpperCase());
  if (!found) return res.json({ valid: false, error: "License key not found" });
  if (found.revokedAt || found.revoked === true || found.status === "revoked") return res.json({ valid: false, error: "License key has been revoked" });
  if (found.usedAt) return res.json({ valid: false, error: "License key already used" });
  if (found.expiresAt && new Date(found.expiresAt) < new Date()) {
    return res.json({ valid: false, error: "License key has expired" });
  }
  res.json({
    valid: true,
    issuedTo: found.issuedTo,
    isTrial: found.isTrial || false,
    trialMaxEvents: found.trialMaxEvents,
    trialMaxBookings: found.trialMaxBookings,
  });
});

// Activate a key (mark as used after setup)
app.post("/api/license-keys/activate", licenseKeyLimiter, (req, res) => {
  res.status(410).json({ ok: false, error: "Standalone license activation is retired; use the atomic setup flow" });
});

// Revoke a key
app.delete("/api/license-keys/:key", licenseKeyLimiter, requireAuth, (req, res) => {
  const keys = readLicenseKeys();
  const keyStr = decodeURIComponent(req.params.key).trim().toUpperCase();
  const index = keys.findIndex(item => String(item.key || "").trim().toUpperCase() === keyStr);
  if (index < 0) return res.status(404).json({ ok: false, error: "Key not found" });
  const revokedAt = new Date().toISOString();
  keys[index] = { ...keys[index], revoked: true, revokedAt, setupToken: undefined };
  const tenants = readTenants();
  let deactivatedTenants = 0;
  for (let tenantIndex = 0; tenantIndex < tenants.length; tenantIndex += 1) {
    if (String(tenants[tenantIndex].licenseKey || "").trim().toUpperCase() !== keyStr) continue;
    tenants[tenantIndex] = { ...tenants[tenantIndex], active: false, licenseRevokedAt: revokedAt };
    deactivatedTenants += 1;
  }
  writeLicenseKeys(keys);
  if (deactivatedTenants) writeTenants(tenants);
  res.json({ ok: true, deactivatedTenants });
});

// ── Tenant Setup (via setup token) ───────────────────
const tenantSetupLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests" } });

// Look up license key info by setup token (no auth required — token is the credential)
app.get("/api/tenant-setup/:token", tenantSetupLimiter, (req, res) => {
  const { token } = req.params;
  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Invalid token" });
  }
  const keys = readLicenseKeys();
  const found = keys.find(k => k.setupToken === token);
  if (!found) return res.status(404).json({ error: "Setup link not found or already used" });
  if (found.revokedAt || found.revoked === true || found.status === "revoked") return res.status(410).json({ error: "This setup link is no longer active" });
  if (found.usedAt) return res.status(410).json({ error: "This setup link has already been used" });
  if (found.expiresAt && new Date(found.expiresAt) < new Date()) {
    return res.status(410).json({ error: "This setup link has expired" });
  }
  res.json({
    key: found.key,
    issuedTo: found.issuedTo,
    isTrial: found.isTrial || false,
    trialMaxEvents: found.trialMaxEvents,
    trialMaxBookings: found.trialMaxBookings,
    expiresAt: found.expiresAt,
  });
});

// Complete tenant setup: create tenant + activate license key
app.post("/api/tenant-setup/:token/complete", tenantSetupLimiter, async (req, res) => {
  const { token } = req.params;
  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Invalid token" });
  }
  const { slug, displayName, email, bio, timezone, passwordHash } = req.body || {};

  // Validate inputs
  if (!slug || typeof slug !== "string" || !SLUG_RE.test(slug)) {
    return res.status(400).json({ error: "Invalid slug — use lowercase letters, numbers, and hyphens (1-30 chars)" });
  }
  if (!displayName || typeof displayName !== "string" || !displayName.trim()) {
    return res.status(400).json({ error: "Display name is required" });
  }
  if (!passwordHash || typeof passwordHash !== "string" || passwordHash.length < 32 || passwordHash.length > 256) {
    return res.status(400).json({ error: "A password is required" });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) return res.status(400).json({ error: "A valid email is required" });

  // Verify the setup token
  let keys = readLicenseKeys();
  let keyIdx = keys.findIndex(k => k.setupToken === token);
  if (keyIdx === -1) return res.status(404).json({ error: "Setup link not found or already used" });
  let licKey = keys[keyIdx];
  if (licKey.revokedAt || licKey.revoked === true || licKey.status === "revoked") return res.status(410).json({ error: "This setup link is no longer active" });
  if (licKey.usedAt) return res.status(410).json({ error: "This setup link has already been used" });
  if (licKey.expiresAt && new Date(licKey.expiresAt) < new Date()) {
    return res.status(410).json({ error: "This setup link has expired" });
  }

  // Check slug uniqueness
  let tenants = readTenants();
  if (tenants.find(t => t.slug === slug)) {
    return res.status(409).json({ error: "That URL slug is already taken — please choose another" });
  }

  const storedPasswordHash = await bcryptHash(passwordHash);
  // Re-check the one-time token and slug after the password hash yields to the
  // event loop, closing the first-claim race between concurrent requests.
  keys = readLicenseKeys();
  keyIdx = keys.findIndex(k => k.setupToken === token);
  if (keyIdx === -1 || keys[keyIdx].usedAt) return res.status(410).json({ error: "This setup link has already been used" });
  licKey = keys[keyIdx];
  if (licKey.revokedAt || licKey.revoked === true || licKey.status === "revoked") return res.status(410).json({ error: "This setup link is no longer active" });
  if (licKey.expiresAt && new Date(licKey.expiresAt) < new Date()) return res.status(410).json({ error: "This setup link has expired" });
  tenants = readTenants();
  if (tenants.some(item => item.slug === slug)) return res.status(409).json({ error: "That URL slug is already taken — please choose another" });

  // Create the tenant
  const tenant = {
    slug,
    displayName: displayName.trim(),
    email: (email || "").trim(),
    bio: (bio || "").trim() || undefined,
    timezone: timezone || "Australia/Sydney",
    licenseKey: licKey.key,
    passwordHash: storedPasswordHash,
    active: true,
    createdAt: new Date().toISOString(),
  };
  tenants.push(tenant);
  writeTenants(tenants);

  // Activate the license key (mark as used)
  keys[keyIdx] = { ...licKey, usedAt: new Date().toISOString(), usedBy: slug };
  writeLicenseKeys(keys);

  const sessionToken = signSession({ purpose: "tenant", sub: tenant.slug, cv: credentialVersion(tenant.passwordHash) }, SESSION_SECRET, { ttlSeconds: TENANT_SESSION_TTL_SECONDS });
  setHttpOnlyCookie(req, res, TENANT_SESSION_COOKIE, sessionToken, TENANT_SESSION_TTL_SECONDS);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    tenant: safeTenantPrivateDto(tenant),
    ...(isExplicitNativeOrigin(req.headers.origin, NATIVE_APP_ORIGINS) ? { sessionToken, expiresIn: TENANT_SESSION_TTL_SECONDS } : {}),
  });
});

const CLIENT_PORTAL_ACCEPTED = Object.freeze({
  ok: true,
  message: "If galleries are available for that address, an email will arrive shortly.",
});
const clientPortalIpLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 8,
  standardHeaders: false,
  legacyHeaders: false,
  handler: (_req, res) => res.status(202).json(CLIENT_PORTAL_ACCEPTED),
});
const clientPortalEmailLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 3,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: req => crypto.createHash("sha256")
    .update(normalizeClientPortalEmail(req.body?.email) || "invalid-email")
    .digest("base64url"),
  handler: (_req, res) => res.status(202).json(CLIENT_PORTAL_ACCEPTED),
});

function clientPortalGalleryLink(trustedBaseUrl, album) {
  const identifier = encodeURIComponent(album.slug || album.id);
  const url = new URL(`/gallery/${identifier}`, trustedBaseUrl).toString();
  return album.clientToken ? `${url}#token=${encodeURIComponent(album.clientToken)}` : url;
}

async function sendClientPortalAlbumGroups({ email, groups, db, tenants, trustedBaseUrl }) {
  const tenantBySlug = new Map(tenants.map(tenant => [tenant.slug, tenant]));
  const profile = dbGet(db, DB_KEYS.PROFILE, {});
  for (const group of groups) {
    const tenant = group.tenantSlug ? tenantBySlug.get(group.tenantSlug) : null;
    const tenantSettings = group.tenantSlug ? dbGet(db, `t_${group.tenantSlug}_wv_tenant_settings`, {}) : null;
    const transport = group.tenantSlug ? buildTenantTransporter(tenantSettings) : getTransporter();
    const from = group.tenantSlug ? getTenantFromAddress(tenantSettings) : getFromAddress();
    if (!transport || !from || !group.albums.length || (group.tenantSlug && !tenant)) continue;
    const senderName = String(tenant?.displayName || profile?.businessName || profile?.name || "Your photographer")
      .replace(/[\r\n]+/g, " ").slice(0, 120);
    const message = buildClientPortalEmail({
      albums: group.albums.map(album => ({
        title: album.title || "Photo gallery",
        url: clientPortalGalleryLink(trustedBaseUrl, album),
      })),
      brandName: tenantSettings?.businessName || tenantSettings?.brandName || senderName,
    });
    try {
      await transport.sendMail({
        from,
        to: email,
        ...message,
      });
    } catch {
      // The public response is deliberately independent of match and SMTP state.
    }
  }
}

app.post("/api/client-portal/request", clientPortalIpLimiter, clientPortalEmailLimiter, (req, res) => {
  const email = normalizeClientPortalEmail(req.body?.email);
  const trustedBaseUrl = safeCheckoutReturnUrl(req, null, "/");
  res.status(202).json(CLIENT_PORTAL_ACCEPTED);
  if (!email) return;
  setImmediate(() => {
    try {
      const db = readDb();
      const tenants = readTenants().filter(tenant => tenantIsLicensed(tenant));
      const tenantAlbums = Object.fromEntries(tenants.map(tenant => [tenant.slug, dbGet(db, `t_${tenant.slug}_wv_albums`, [])]));
      const timezones = Object.fromEntries([
        ["", galleryTimezone(db, null)],
        ...tenants.map(tenant => [tenant.slug, galleryTimezone(db, tenant.slug)]),
      ]);
      const groups = selectClientPortalAlbumGroups({
        email,
        mainAlbums: dbGet(db, DB_KEYS.ALBUMS, []),
        tenantAlbums,
        bookings: dbGet(db, DB_KEYS.BOOKINGS, []),
        activeTenantSlugs: tenants.map(tenant => tenant.slug),
        timezones,
      }).map(group => ({
        ...group,
        albums: group.albums.filter(album => {
          const resolved = findAlbumBySlugOrId(db, album.slug || album.id);
          return !!resolved && resolved.tenantSlug === group.tenantSlug && resolved.album.id === album.id;
        }),
      })).filter(group => group.albums.length);
      void sendClientPortalAlbumGroups({ email, groups, db, tenants, trustedBaseUrl }).catch(() => {});
    } catch {
      // Deliberately silent: this endpoint must never reveal DB or delivery state.
    }
  });
});

function findAlbumBySlugOrId(db, albumSlug) {
  const findIn = arr => Array.isArray(arr) ? arr.find(album => album.slug === albumSlug || album.id === albumSlug) : null;
  const mainAlbum = findIn(dbGet(db, DB_KEYS.ALBUMS, []));
  const mainMatch = mainAlbum ? { album: mainAlbum, tenantSlug: null } : null;
  const tenantMatches = [];
  const activeTenantSlugs = new Set(readTenants().filter(tenant => tenantIsLicensed(tenant)).map(tenant => tenant.slug));
  for (const key of Object.keys(db)) {
    if (!key.startsWith("t_") || !key.endsWith(TENANT_ALBUMS_SUFFIX)) continue;
    const tenantSlug = key.slice(2, -TENANT_ALBUMS_SUFFIX.length);
    if (!activeTenantSlugs.has(tenantSlug)) continue;
    const album = findIn(dbGet(db, key, []));
    if (album) tenantMatches.push({ album, tenantSlug });
  }
  return _chooseAlbumStoreMatch(mainMatch, tenantMatches);
}

function getGallerySessionForAlbum(req, album) {
  if (!album?.id || album.enabled === false) return null;
  const token = parseCookies(req.headers.cookie)[galleryCookieName(album.id)];
  const session = verifySession(token, SESSION_SECRET, { purpose: "gallery" });
  if (!session || session.albumId !== album.id || typeof session.sessionKey !== "string" || session.sessionKey.length < 24) return null;
  if (session.tenantSlug && !licensedTenantBySlug(session.tenantSlug)) return null;
  const sharePurchase = album.sessionPurchases?.[session.sessionKey];
  if (session.shareLinkId) {
    if (!galleryShareLinkAccess(album, session.shareLinkId, Date.now(), galleryTimezone(readDb(), session.tenantSlug)).active) return null;
  } else if (sharePurchase?.source === "share-link") {
    // Legacy share sessions were not revocable; invalidate them on upgrade.
    return null;
  }
  return session;
}

function publicAlbumDto(album, gallerySession) {
  const sessionKey = gallerySession.sessionKey;
  const db = readDb();
  const safe = safeGalleryAlbumDto(album, sessionKey, galleryTimezone(db, gallerySession.tenantSlug));
  safe.downloadEmailCapture = normalizeDownloadEmailPolicy(album.downloadEmailCapture);
  return safe;
}

function establishGalleryAccess(req, res) {
  const db = readDb();
  const chosen = findAlbumBySlugOrId(db, req.params.albumSlug);
  if (!chosen || chosen.album.enabled === false) return res.status(404).json({ error: "Album not found" });
  if (albumAccessWindow(chosen.album, Date.now(), galleryTimezone(db, chosen.tenantSlug)).galleryExpired) return res.status(410).json({ error: "This gallery has expired" });
  const suppliedToken = String(req.body?.token || "");
  const suppliedPin = String(req.body?.pin || "");
  const tokenValid = !!chosen.album.clientToken && timingSafeTextEqual(String(chosen.album.clientToken), suppliedToken);
  const pinValid = !!chosen.album.accessCode && timingSafeTextEqual(String(chosen.album.accessCode), suppliedPin);
  const protectedAlbum = !!chosen.album.clientToken || !!chosen.album.accessCode;
  if (protectedAlbum && !tokenValid && !pinValid) {
    return res.status(401).json({
      protected: true,
      pinRequired: !!chosen.album.accessCode,
      tokenRequired: !!chosen.album.clientToken,
      tenantSlug: chosen.tenantSlug,
      album: { id: chosen.album.id, slug: chosen.album.slug, title: chosen.album.title, description: chosen.album.description, enabled: chosen.album.enabled, photos: [] },
    });
  }
  const existing = getGallerySessionForAlbum(req, chosen.album);
  const sessionKey = existing?.sessionKey || `gallery-${crypto.randomBytes(24).toString("base64url")}`;
  const sessionToken = signSession({
    purpose: "gallery",
    albumId: chosen.album.id,
    tenantSlug: chosen.tenantSlug,
    sessionKey,
  }, SESSION_SECRET, { ttlSeconds: GALLERY_SESSION_TTL_SECONDS });
  setHttpOnlyCookie(req, res, galleryCookieName(chosen.album.id), sessionToken, GALLERY_SESSION_TTL_SECONDS);
  const gallerySession = verifySession(sessionToken, SESSION_SECRET, { purpose: "gallery" });
  res.setHeader("Cache-Control", "no-store");
  return res.json({ album: publicAlbumDto(chosen.album, gallerySession), tenantSlug: chosen.tenantSlug, protected: protectedAlbum });
}

const galleryAccessLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many gallery access attempts" } });
app.post("/api/public-album/:albumSlug/access", galleryAccessLimiter, establishGalleryAccess);
// Compatibility alias for clients built against the earlier session contract.
app.post("/api/public-album/:albumSlug/session", galleryAccessLimiter, establishGalleryAccess);

// ── Public album lookup (cross-store, used by gallery) ─────────────────────
app.get("/api/public-album/:albumSlug", (req, res) => {
  if (req.query.token || req.query.pin || req.query.sessionKey || req.query.email) {
    return res.status(400).json({ error: "Gallery credentials are not accepted in URLs; use the access endpoint" });
  }
  const db = readDb();
  const chosen = findAlbumBySlugOrId(db, req.params.albumSlug);
  if (chosen) {
    if (chosen.album.enabled === false) return res.status(404).json({ error: "Album not found" });
    if (albumAccessWindow(chosen.album, Date.now(), galleryTimezone(db, chosen.tenantSlug)).galleryExpired) return res.status(410).json({ error: "This gallery has expired" });
    const gallerySession = getGallerySessionForAlbum(req, chosen.album);
    if (!gallerySession || gallerySession.tenantSlug !== chosen.tenantSlug) {
      return res.status(401).json({
        protected: !!chosen.album.accessCode || !!chosen.album.clientToken,
        pinRequired: !!chosen.album.accessCode,
        tokenRequired: !!chosen.album.clientToken,
        requiresSession: true,
        tenantSlug: chosen.tenantSlug,
      });
    }
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    return res.json({ album: publicAlbumDto(chosen.album, gallerySession), tenantSlug: chosen.tenantSlug });
  }

  return res.status(404).json({ error: "Album not found" });
});

function resolveGalleryMutation(req, res, identifier, options = {}) {
  const db = readDb();
  const match = findAlbumBySlugOrId(db, String(identifier || ""));
  if (!match || match.album.enabled === false) {
    res.status(404).json({ ok: false, error: "Album not found" });
    return null;
  }
  const accessWindow = albumAccessWindow(match.album, Date.now(), galleryTimezone(db, match.tenantSlug));
  if (accessWindow.galleryExpired || (options.requireDownload && accessWindow.downloadsExpired)) {
    res.status(410).json({ ok: false, error: accessWindow.galleryExpired ? "This gallery has expired" : "Gallery downloads have expired" });
    return null;
  }
  const session = getGallerySessionForAlbum(req, match.album);
  if (!session || session.tenantSlug !== match.tenantSlug) {
    res.status(401).json({ ok: false, error: "A valid gallery session is required" });
    return null;
  }
  const storeKey = match.tenantSlug ? `t_${match.tenantSlug}_${TENANT_ALBUMS_SUFFIX.slice(1)}` : DB_KEYS.ALBUMS;
  const albums = getStoredArray(db, storeKey);
  const index = albums.findIndex(album => album.id === match.album.id);
  if (index < 0) {
    res.status(409).json({ ok: false, error: "Album store is inconsistent" });
    return null;
  }
  return { db, match, session, storeKey, albums, index, album: albums[index] };
}

function deliverableAlbumPhotos(album) {
  return (Array.isArray(album?.photos) ? album.photos : []).filter(photo => !photo.hidden && (album.showCullRejectsToClient || photo.cull?.status !== "reject"));
}

function hasNonQuotaPhotoEntitlement(album, photoId, sessionKey) {
  if (album.paidPhotoIds?.includes(photoId) || album.photos?.some(photo => photo.id === photoId && photo.paid === true)) return true;
  const purchase = album.sessionPurchases?.[sessionKey];
  if (purchase?.fullAlbum === true || purchase?.photoIds?.includes(photoId)) return true;
  if (album.allUnlocked) return true;
  return (album.downloadRequests || []).some(request =>
    request.sessionKey === sessionKey && ["approved", "completed"].includes(request.status) &&
    (request.fullAlbum === true || request.photoIds?.includes(photoId))
  );
}

function saveGalleryAlbum(context) {
  context.albums[context.index] = context.album;
  context.db[context.storeKey] = JSON.stringify(context.albums);
  writeDb(context.db);
}

app.patch("/api/public-album/:albumSlug/photos/:photoId/star", galleryAccessLimiter, (req, res) => {
  const context = resolveGalleryMutation(req, res, req.params.albumSlug);
  if (!context) return;
  const album = context.album;
  if (!album.proofingEnabled || album.proofingStage !== "proofing") return res.status(409).json({ ok: false, error: "This gallery is not accepting selections" });
  if (albumAccessWindow({ expiresAt: album.proofingExpiresAt }, Date.now(), galleryTimezone(context.db, context.match.tenantSlug)).galleryExpired) return res.status(403).json({ ok: false, error: "The proofing window has expired" });
  const deliverableIds = new Set(deliverableAlbumPhotos(album).map(photo => String(photo.id)));
  const photoIndex = (album.photos || []).findIndex(photo => String(photo.id) === req.params.photoId && deliverableIds.has(String(photo.id)));
  if (photoIndex < 0) return res.status(404).json({ ok: false, error: "Photo not found" });
  album.photos[photoIndex] = { ...album.photos[photoIndex], starred: req.body?.starred === true };
  saveGalleryAlbum(context);
  res.json({ ok: true, photoId: req.params.photoId, starred: album.photos[photoIndex].starred });
});

app.post("/api/album/free-unlock", galleryAccessLimiter, (req, res) => {
  const context = resolveGalleryMutation(req, res, req.body?.albumId, { requireDownload: true });
  if (!context) return;
  if (!albumAllowsFreeFullUnlock(context.album)) {
    return res.status(409).json({ ok: false, error: "This album is not configured for a free full-album unlock" });
  }
  const sessionKey = context.session.sessionKey;
  context.album.sessionPurchases = { ...(context.album.sessionPurchases || {}), [sessionKey]: {
    ...(context.album.sessionPurchases?.[sessionKey] || {}),
    fullAlbum: true,
    photoIds: [],
    unlockedAt: new Date().toISOString(),
    method: "free",
  } };
  saveGalleryAlbum(context);
  res.json({ ok: true, fullAlbum: true });
});

app.post("/api/album/download-complete", galleryAccessLimiter, (req, res) => {
  const context = resolveGalleryMutation(req, res, req.body?.albumId, { requireDownload: true });
  if (!context) return;
  const sessionKey = context.session.sessionKey;
  const requestedIds = [...new Set((Array.isArray(req.body?.photoIds) ? req.body.photoIds : []).map(String))];
  if (requestedIds.length === 0 || requestedIds.length > MAX_ZIP_FILES) return res.status(400).json({ ok: false, error: "A valid photoIds array is required" });
  const deliverableIds = new Set(deliverableAlbumPhotos(context.album).map(photo => photo.id));
  if (requestedIds.some(id => !deliverableIds.has(id))) return res.status(400).json({ ok: false, error: "One or more photos are unavailable" });
  const policy = normalizeDownloadEmailPolicy(context.album.downloadEmailCapture);
  if (policy === "required") {
    const captureId = String(req.body?.captureId || req.body?.downloadEmailCaptureId || "").slice(0, 120);
    const validCapture = readDownloadEmailCaptures().some(record => record.id === captureId && recordMatchesRequest(record, context.album.id, sessionKey, DOWNLOAD_CAPTURE_SECRET));
    if (!validCapture) return res.status(428).json({ ok: false, error: "Email address required before downloading", code: "DOWNLOAD_EMAIL_REQUIRED" });
  }
  const sessionStoreKey = `wv_session_${sessionKey}_${context.album.id}`;
  const sessionData = dbGet(context.db, sessionStoreKey, {});
  const previouslyClaimed = new Set(Array.isArray(sessionData.unlockedPhotoIds) ? sessionData.unlockedPhotoIds : []);
  const quota = Math.max(0, Number.isFinite(Number(context.album.freeDownloads)) ? Number(context.album.freeDownloads) : 5);
  const used = Math.max(Number(context.album.usedFreeDownloads?.[sessionKey] || 0), previouslyClaimed.size);
  const unissuedIds = requestedIds.filter(id => !hasNonQuotaPhotoEntitlement(context.album, id, sessionKey) && !previouslyClaimed.has(id));
  if (unissuedIds.length) {
    return res.status(409).json({ ok: false, error: "Download entitlements must be reserved by the original or ZIP endpoint before completion is recorded" });
  }
  const quality = ["2mb", "5mb", "original"].includes(req.body?.quality) ? req.body.quality : "original";
  const method = ["zip", "individual"].includes(req.body?.method) ? req.body.method : "individual";
  context.album.downloadHistory = [...(context.album.downloadHistory || []), {
    id: `download-${crypto.randomUUID()}`,
    photoIds: requestedIds,
    downloadedAt: new Date().toISOString(),
    quality,
    method,
    sessionKey,
    email: typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 254) : undefined,
    photoCount: requestedIds.length,
  }];
  saveGalleryAlbum(context);
  const freeDownloadsUsed = used;
  res.json({ ok: true, freeDownloadsUsed, freeDownloadsRemaining: Math.max(0, quota - freeDownloadsUsed) });
});

app.post("/api/album/download-request", galleryAccessLimiter, (req, res) => {
  const context = resolveGalleryMutation(req, res, req.body?.albumId, { requireDownload: true });
  if (!context) return;
  const tenantSettings = context.match.tenantSlug ? dbGet(context.db, `t_${context.match.tenantSlug}_wv_tenant_settings`, {}) : null;
  const globalSettings = dbGet(context.db, DB_KEYS.SETTINGS, {});
  const bankEnabled = context.match.tenantSlug ? tenantSettings?.bankTransferEnabled === true : globalSettings?.bankTransfer?.enabled === true;
  if (!bankEnabled || context.album.purchasingDisabled) return res.status(403).json({ ok: false, error: "Bank transfer is not available for this gallery" });
  const sessionKey = context.session.sessionKey;
  const deliverable = deliverableAlbumPhotos(context.album);
  const deliverableById = new Map(deliverable.map(photo => [photo.id, photo]));
  const fullAlbum = req.body?.fullAlbum === true;
  const requestedIds = fullAlbum ? deliverable.map(photo => photo.id) : [...new Set((Array.isArray(req.body?.photoIds) ? req.body.photoIds : []).map(String))];
  if (requestedIds.length === 0 || requestedIds.some(id => !deliverableById.has(id))) return res.status(400).json({ ok: false, error: "Select valid photos or request the full album" });
  const sessionData = dbGet(context.db, `wv_session_${sessionKey}_${context.album.id}`, {});
  const unlockedPhotoIds = Array.isArray(sessionData.unlockedPhotoIds) ? sessionData.unlockedPhotoIds.map(String) : [];
  const entitledPhotoIds = requestedIds.filter(id => hasNonQuotaPhotoEntitlement(context.album, id, sessionKey));
  const pricing = calculateAlbumSelectionPricing({
    requestedPhotoIds: requestedIds,
    entitledPhotoIds,
    unlockedPhotoIds,
    freeDownloads: context.album.freeDownloads,
    usedFreeDownloads: context.album.usedFreeDownloads?.[sessionKey],
    pricePerPhoto: context.album.pricePerPhoto,
  });
  const fullAlbumAlreadyEntitled = requestedIds.every(id => entitledPhotoIds.includes(id));
  const amount = fullAlbum
    ? (fullAlbumAlreadyEntitled ? 0 : Number(context.album.priceFullAlbum))
    : pricing.amount;
  if (!Number.isFinite(amount) || amount <= 0) return res.status(409).json({ ok: false, error: "This request does not require a bank transfer" });
  const existing = (context.album.downloadRequests || []).find(request => request.sessionKey === sessionKey && request.status === "pending" && request.fullAlbum === fullAlbum && JSON.stringify([...(request.photoIds || [])].sort()) === JSON.stringify([...requestedIds].sort()));
  if (existing) return res.json({ ok: true, request: existing, duplicate: true });
  const request = {
    id: `download-request-${crypto.randomUUID()}`,
    sessionKey,
    photoIds: requestedIds,
    fullAlbum,
    amount: Math.round(amount * 100) / 100,
    method: "bank-transfer",
    status: "pending",
    requestedAt: new Date().toISOString(),
    email: typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 254) : undefined,
    clientNote: typeof req.body?.clientNote === "string" ? req.body.clientNote.trim().slice(0, 2000) : undefined,
  };
  context.album.downloadRequests = [...(context.album.downloadRequests || []), request];
  saveGalleryAlbum(context);
  res.status(201).json({ ok: true, request });
});

app.get("/api/public-album/:albumSlug/purchase", galleryAccessLimiter, (req, res) => {
  const context = resolveGalleryMutation(req, res, req.params.albumSlug, { requireDownload: true });
  if (!context) return;
  const sessionKey = context.session.sessionKey;
  const quota = Math.max(0, Number.isFinite(Number(context.album.freeDownloads)) ? Number(context.album.freeDownloads) : 5);
  const freeDownloadsUsed = Number(context.album.usedFreeDownloads?.[sessionKey] || 0);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    purchase: safeGalleryPurchaseDto(context.album.sessionPurchases?.[sessionKey]),
    freeDownloadsUsed,
    freeDownloadsRemaining: Math.max(0, quota - freeDownloadsUsed),
    requests: (context.album.downloadRequests || []).filter(request => request.sessionKey === sessionKey).map(request => ({
      id: request.id,
      status: request.status,
      fullAlbum: request.fullAlbum === true,
      photoIds: request.photoIds || [],
      amount: request.amount,
      requestedAt: request.requestedAt,
      approvedAt: request.approvedAt,
    })),
  });
});

// ── Tenant storage size (files referenced by this tenant) ──────────────────
app.get("/api/tenant/:slug/storage-stats", tenantLimiter, requireTenant, (req, res) => {
  const { slug } = req.params;
  const db = readDb();
  const albumsRaw = db[`t_${slug}_wv_albums`];
  const albums = albumsRaw ? (typeof albumsRaw === "string" ? JSON.parse(albumsRaw) : albumsRaw) : [];
  const libRaw = db[`t_${slug}_wv_photo_library`];
  const library = libRaw ? (typeof libRaw === "string" ? JSON.parse(libRaw) : libRaw) : [];

  const knownFiles = new Set();
  const addSrc = (src) => {
    if (src && src.startsWith("/uploads/")) {
      const fn = src.split("/").pop()?.split("?")[0];
      if (fn && !fn.startsWith("_cache")) knownFiles.add(fn);
    }
  };

  if (Array.isArray(library)) library.forEach(p => { addSrc(p.src); addSrc(p.thumbnail); });
  if (Array.isArray(albums)) albums.forEach(a => {
    addSrc(a.coverImage);
    (a.photos || []).forEach(p => { addSrc(p.src); addSrc(p.thumbnail); });
  });
  const uploadOwners = dbGet(db, "wv_upload_owners", {});
  for (const [filename, owner] of Object.entries(uploadOwners)) {
    if (owner?.tenantSlug === slug) knownFiles.add(path.basename(filename));
  }

  let totalBytes = 0;
  let fileCount = 0;
  const allFileNames = [];
  for (const fn of knownFiles) {
    try {
      const stat = fs.statSync(path.join(UPLOADS_DIR, fn));
      if (!stat.isFile()) continue;
      totalBytes += stat.size;
      fileCount++;
      allFileNames.push(fn);
    } catch {}
  }

  allFileNames.sort();
  res.json({ ok: true, totalBytes, fileCount, albumCount: Array.isArray(albums) ? albums.length : 0, allFileNames });
});

// ── Serve React app ───────────────────────────────────
const distPath = path.join(__dirname, "../dist");
const portfolioIndexPath = path.join(distPath, "index.html");
const portfolioIndexHtml = fs.existsSync(portfolioIndexPath) ? fs.readFileSync(portfolioIndexPath, "utf8") : "";

app.get(Object.keys(PORTFOLIO_SEO_ROUTES), (req, res, next) => {
  if (!isPortfolioSiteHost(req.hostname) || !portfolioIndexHtml) return next();
  const routePath = normalizedRequestPath(req.path);
  const html = portfolioIndexHtml.replace(/<!-- SEO:START -->[\s\S]*?<!-- SEO:END -->/, portfolioSeoBlock(routePath));
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  res.setHeader("Cloudflare-CDN-Cache-Control", "public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400");
  res.type("html").send(html);
});
// Hashed assets (JS/CSS chunks) are immutable — cache aggressively.
// index.html must always be re-fetched so the browser picks up new chunk names.
app.use(
  express.static(distPath, {
    index: false,
    setHeaders(res, filePath) {
      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      } else if (filePath.endsWith("robots.txt") || filePath.endsWith("sitemap.xml")) {
        res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
        res.setHeader("Cloudflare-CDN-Cache-Control", "public, max-age=86400, stale-while-revalidate=604800, stale-if-error=604800");
      } else if (filePath.endsWith("sw.js") || /downloads[\\/]+android[\\/]+latest\.(apk|json)$/.test(filePath)) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      } else if (filePath.includes(`${path.sep}portfolio${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
        res.setHeader("Cloudflare-CDN-Cache-Control", "public, max-age=86400, stale-while-revalidate=604800, stale-if-error=604800");
      } else if (/\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico|webp)$/.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.setHeader("Cloudflare-CDN-Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  })
);

// ── Email Automation Rules ─────────────────────────────────────────────────
// Rules are stored in DB under "wv_email_automations" as an array of objects:
//   { id, enabled, trigger, delayHours, reminderType, templateSubject, templateBody }
// trigger values: "after_booking" | "before_event" | "after_event" | "payment_overdue"
// reminderType: "payment" | "booking"

const { randomUUID: ruuid } = require("crypto");
const AUTOMATION_INTERVAL_MS = DEFAULT_AUTOMATION_INTERVAL_MS;
const AUTOMATION_GRACE_MS = Number(process.env.EMAIL_AUTOMATION_GRACE_HOURS || 168) * 60 * 60 * 1000;
const AUTOMATION_MAX_SENDS_PER_RUN = Math.max(1, Number(process.env.EMAIL_AUTOMATION_MAX_SENDS_PER_RUN || 25));

function getAutomationOptions() {
  return {
    intervalMs: AUTOMATION_INTERVAL_MS,
    graceMs: Number.isFinite(AUTOMATION_GRACE_MS) && AUTOMATION_GRACE_MS > 0
      ? AUTOMATION_GRACE_MS
      : DEFAULT_AUTOMATION_GRACE_MS,
    sentSet: _automationSentSet,
    makeId: ruuid,
  };
}

function readAutomationRules() {
  const db = readDb();
  if (!Object.prototype.hasOwnProperty.call(db, "wv_email_automations")) {
    return getStarterAutomationRules();
  }
  const raw = db["wv_email_automations"];
  if (!raw) return [];
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return []; }
}

function writeAutomationRules(rules) {
  const db = readDb();
  db["wv_email_automations"] = rules;
  writeDb(db);
}

function normalizeAutomationRule(rule = {}) {
  return normalizeAutomationRuleCore(rule, ruuid);
}

function readAutomationBookings() {
  const db = readDb();
  const bookingsRaw = db["wv_bookings"];
  return bookingsRaw
    ? (typeof bookingsRaw === "string" ? JSON.parse(bookingsRaw) : bookingsRaw)
    : [];
}

function buildAutomationPreview(rule, now = Date.now()) {
  return buildAutomationPreviewCore(rule, readAutomationBookings(), now, getAutomationOptions());
}

// GET automation rules
app.get("/api/email-automations", requireAuth, (_req, res) => {
  res.json({ rules: readAutomationRules() });
});

// POST automation dry-run preview
app.post("/api/email-automations/preview", requireAuth, (req, res) => {
  const rule = req.body?.rule;
  if (!rule || typeof rule !== "object") return res.status(400).json({ error: "rule is required" });
  res.json({ ok: true, ...buildAutomationPreview(rule) });
});

// PUT (replace all) automation rules
app.put("/api/email-automations", requireAuth, (req, res) => {
  const { rules } = req.body;
  if (!Array.isArray(rules)) return res.status(400).json({ error: "rules must be an array" });
  // Ensure each rule has an id
  const sanitised = rules.map(normalizeAutomationRule);
  writeAutomationRules(sanitised);
  res.json({ ok: true, rules: sanitised });
});

// ── Automation Scheduler ───────────────────────────────────────────────────
// Runs every 5 minutes and fires reminder emails for bookings that match
// enabled automation rules. Each rule specifies a trigger + delay; once due,
// the scheduler sends during the configured grace period unless the rule has
// already been sent for that booking.

// Track which (ruleId, bookingId) pairs we've already sent so we never double-send
// within the same server process lifetime.  Persistent dedup is handled by
// checking the booking's emailLog for an entry with type "auto-<ruleId>".
const _automationSentSet = new Set();

async function runEmailAutomations() {
  const rules = readAutomationRules().filter(r => r.enabled);
  if (rules.length === 0) return;

  const t = getTransporter();
  if (!t) return; // SMTP not configured — skip silently

  const bookings = readAutomationBookings();
  const automationProfile = dbGet(readDb(), DB_KEYS.PROFILE, {});
  const automationBrandName = automationProfile.businessName || automationProfile.brandName || automationProfile.name || "PhotoFlow";

  const now = Date.now();
  let anyChange = false;
  let sentThisRun = 0;

  for (const rule of rules) {
    if (sentThisRun >= AUTOMATION_MAX_SENDS_PER_RUN) break;
    for (const booking of bookings) {
      if (sentThisRun >= AUTOMATION_MAX_SENDS_PER_RUN) break;
      // Skip cancelled bookings and bookings without email
      if (!booking.clientEmail || booking.status === "cancelled") continue;
      // Respect unsubscribe flag
      if (booking.emailsDisabled) continue;

      const dedupeKey = `${rule.id}:${booking.id}`;
      if (_automationSentSet.has(dedupeKey)) continue;
      // Also check persistent emailLog for type "auto-<ruleId>" so restart-safe
      const alreadySent = (booking.emailLog || []).some(e => e.type === `auto-${rule.id}`);
      if (alreadySent) { _automationSentSet.add(dedupeKey); continue; }

      if (getAutomationDecision(rule, booking, now, getAutomationOptions()).status !== "due") continue;

      // Build the email — configured bodies remain plain text and are escaped by
      // the shared renderer before being placed in the professional shell.
      const isPaymentReminder = rule.reminderType === "payment";
      const clientName = booking.clientName || "there";
      const eventTitle = booking.type || "Booking";
      const subject = renderAutomationSubject(rule, booking);
      const body = rule.templateBody
        ? rule.templateBody
            .replace(/\{name\}/gi, clientName)
            .replace(/\{event\}/gi, eventTitle)
            .replace(/\{date\}/gi, booking.date || "")
            .replace(/\{time\}/gi, booking.time || "")
        : isPaymentReminder
          ? `Hi ${clientName}, this is a friendly reminder that payment is still pending for your ${eventTitle} booking on ${booking.date || "the scheduled date"}.`
          : `Hi ${clientName}, this is a reminder about your ${eventTitle} session on ${booking.date || "the scheduled date"}${booking.time ? ` at ${booking.time}` : ""}.`;
      const message = buildAutomationEmail({ subject, body, booking, brandName: automationBrandName });

      try {
        const info = await t.sendMail({ from: getFromAddress(), to: booking.clientEmail, ...message });
        console.log(`📧 [Automation ${rule.id}] Sent to ${booking.clientEmail}: ${info.messageId}`);
        sentThisRun++;

        // Persist log entry to booking
        const trackingId = ruuid();
        _automationSentSet.add(dedupeKey);

        // Write log entry back to DB
        const freshDb = readDb();
        const freshBookings = freshDb["wv_bookings"]
          ? (typeof freshDb["wv_bookings"] === "string" ? JSON.parse(freshDb["wv_bookings"]) : freshDb["wv_bookings"])
          : [];
        const idx = freshBookings.findIndex(b => b.id === booking.id);
        if (idx !== -1) {
          if (!freshBookings[idx].emailLog) freshBookings[idx].emailLog = [];
          freshBookings[idx].emailLog.push({
            id: trackingId,
            type: `auto-${rule.id}`,
            sentAt: new Date().toISOString(),
            subject,
            to: booking.clientEmail,
            automationRule: rule.id,
          });
          freshDb["wv_bookings"] = freshBookings;
          writeDb(freshDb);
          anyChange = true;
        }
      } catch (err) {
        console.error(`📧 [Automation ${rule.id}] Error sending to ${booking.clientEmail}:`, err.message);
      }
    }
  }

  if (anyChange) {
    console.log(`📧 Email automation run complete`);
  }
}

// Start scheduler after a 30-second warm-up delay so the server is fully ready
setTimeout(() => {
  runEmailAutomations().catch(e => console.error("Email automation error:", e.message));
  setInterval(() => {
    runEmailAutomations().catch(e => console.error("Email automation error:", e.message));
  }, AUTOMATION_INTERVAL_MS);
}, 30000);

// ═══════════════════════════════════════════════════════════════════════════════
// ── iCal Feed  (/api/ical/:token) ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function escapeIcal(str) {
  if (!str) return "";
  return String(str).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function toIcalDate(dateStr, timeStr) {
  // dateStr: YYYY-MM-DD, timeStr: HH:MM
  if (!dateStr) return null;
  const [y, m, d] = (dateStr || "").split("-");
  if (timeStr) {
    const [h, mi] = (timeStr || "00:00").split(":");
    return `${y}${m}${d}T${h}${mi}00`;
  }
  return `${y}${m}${d}`;
}

function toIcalDateEnd(dateStr, timeStr, durationMins) {
  if (!dateStr || !timeStr) return toIcalDate(dateStr, timeStr);
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  const start = new Date(y, mo - 1, d, h, mi);
  const end = new Date(start.getTime() + (durationMins || 60) * 60000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${end.getFullYear()}${pad(end.getMonth() + 1)}${pad(end.getDate())}T${pad(end.getHours())}${pad(end.getMinutes())}00`;
}

function buildIcalFeed(bookings, calName) {
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//PhotoFlow//Cosplay Booking Calendar//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcal(calName || "PhotoFlow Bookings")}`,
    `X-WR-CALDESC:Photography booking calendar`,
  ];
  for (const b of bookings) {
    if (b.status === "cancelled") continue;
    const dtstart = toIcalDate(b.date, b.time);
    const dtend = toIcalDateEnd(b.date, b.time, b.duration);
    if (!dtstart) continue;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:wv-${b.id}@photoflow`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART:${dtstart}`);
    lines.push(`DTEND:${dtend}`);
    lines.push(`SUMMARY:${escapeIcal(b.clientName)} — ${escapeIcal(b.type || b.eventTypeId)}`);
    const descParts = [];
    if (b.clientEmail) descParts.push(`Email: ${b.clientEmail}`);
    if (b.instagramHandle) descParts.push(`IG: @${b.instagramHandle}`);
    if (b.notes) descParts.push(b.notes);
    if (b.status) descParts.push(`Status: ${b.status}`);
    if (b.paymentStatus) descParts.push(`Payment: ${b.paymentStatus}`);
    lines.push(`DESCRIPTION:${escapeIcal(descParts.join("\\n"))}`);
    if (b.location) lines.push(`LOCATION:${escapeIcal(b.location)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

app.get("/api/ical/:token", (req, res) => {
  const { token } = req.params;
  const db = readDb();
  // Check main admin ical token
  const settings = db["wv_settings"] ? (typeof db["wv_settings"] === "string" ? JSON.parse(db["wv_settings"]) : db["wv_settings"]) : {};
  const profile = db["wv_profile"] ? (typeof db["wv_profile"] === "string" ? JSON.parse(db["wv_profile"]) : db["wv_profile"]) : {};
  if (settings.icalToken && settings.icalToken === token) {
    const bookings = db["wv_bookings"] ? (typeof db["wv_bookings"] === "string" ? JSON.parse(db["wv_bookings"]) : db["wv_bookings"]) : [];
    const cal = buildIcalFeed(bookings, `${profile.name || "PhotoFlow"} — Bookings`);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="bookings.ics"');
    return res.send(cal);
  }
  // Check tenant ical tokens
  const tenants = readTenants().filter(tenant => tenantIsLicensed(tenant));
  for (const tenant of tenants) {
    const ts = db[`t_${tenant.slug}_wv_tenant_settings`] ? (typeof db[`t_${tenant.slug}_wv_tenant_settings`] === "string" ? JSON.parse(db[`t_${tenant.slug}_wv_tenant_settings`]) : db[`t_${tenant.slug}_wv_tenant_settings`]) : {};
    if (ts.icalToken && ts.icalToken === token) {
      const allBookings = db["wv_bookings"] ? (typeof db["wv_bookings"] === "string" ? JSON.parse(db["wv_bookings"]) : db["wv_bookings"]) : [];
      const tenantBookings = allBookings.filter(b => b.tenantSlug === tenant.slug);
      const cal = buildIcalFeed(tenantBookings, `${tenant.displayName || tenant.slug} — Bookings`);
      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="bookings.ics"');
      return res.send(cal);
    }
  }
  res.status(404).json({ error: "Invalid or expired iCal token" });
});

// Generate / rotate ical token
app.post("/api/ical/generate", requireAuth, (req, res) => {
  const db = readDb();
  const settings = db["wv_settings"] ? (typeof db["wv_settings"] === "string" ? JSON.parse(db["wv_settings"]) : db["wv_settings"]) : {};
  settings.icalToken = crypto.randomBytes(24).toString("hex");
  db["wv_settings"] = settings;
  writeDb(db);
  res.json({ icalToken: settings.icalToken });
});

app.delete("/api/ical/token", requireAuth, (req, res) => {
  const db = readDb();
  const settings = db["wv_settings"] ? (typeof db["wv_settings"] === "string" ? JSON.parse(db["wv_settings"]) : db["wv_settings"]) : {};
  delete settings.icalToken;
  db["wv_settings"] = settings;
  writeDb(db);
  res.json({ ok: true });
});

// Tenant-scoped iCal token generate & delete (used by TenantAdmin)
app.post("/api/tenant/:slug/ical/generate", tenantLimiter, requireTenant, (req, res) => {
  const { slug } = req.params;
  const tenants = readTenants();
  if (!tenants.find(t => t.slug === slug)) return res.status(404).json({ error: "Tenant not found" });
  const db = readDb();
  const tsKey = `t_${slug}_wv_tenant_settings`;
  const ts = db[tsKey] ? (typeof db[tsKey] === "string" ? JSON.parse(db[tsKey]) : db[tsKey]) : {};
  ts.icalToken = crypto.randomBytes(24).toString("hex");
  db[tsKey] = ts;
  writeDb(db);
  res.json({ icalToken: ts.icalToken });
});

app.delete("/api/tenant/:slug/ical/token", tenantLimiter, requireTenant, (req, res) => {
  const { slug } = req.params;
  const tenants = readTenants();
  if (!tenants.find(t => t.slug === slug)) return res.status(404).json({ error: "Tenant not found" });
  const db = readDb();
  const tsKey = `t_${slug}_wv_tenant_settings`;
  const ts = db[tsKey] ? (typeof db[tsKey] === "string" ? JSON.parse(db[tsKey]) : db[tsKey]) : {};
  delete ts.icalToken;
  db[tsKey] = ts;
  writeDb(db);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ── Expenses ──────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/api/expenses", requireAuth, (req, res) => {
  const db = readDb();
  const expenses = db["wv_expenses"] ? (typeof db["wv_expenses"] === "string" ? JSON.parse(db["wv_expenses"]) : db["wv_expenses"]) : [];
  res.json(expenses);
});

app.post("/api/expenses", requireAuth, (req, res) => {
  const db = readDb();
  const expenses = db["wv_expenses"] ? (typeof db["wv_expenses"] === "string" ? JSON.parse(db["wv_expenses"]) : db["wv_expenses"]) : [];
  const expense = {
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"),
    description: req.body.description || "",
    amount: Number(req.body.amount) || 0,
    category: req.body.category || "other",
    date: req.body.date || new Date().toISOString().slice(0, 10),
    bookingId: req.body.bookingId || null,
    albumId: req.body.albumId || null,
    receiptUrl: req.body.receiptUrl || null,
    notes: req.body.notes || "",
    createdAt: new Date().toISOString(),
  };
  expenses.push(expense);
  db["wv_expenses"] = expenses;
  writeDb(db);
  res.json(expense);
});

app.put("/api/expenses/:id", requireAuth, (req, res) => {
  const db = readDb();
  const expenses = db["wv_expenses"] ? (typeof db["wv_expenses"] === "string" ? JSON.parse(db["wv_expenses"]) : db["wv_expenses"]) : [];
  const idx = expenses.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  expenses[idx] = { ...expenses[idx], ...req.body, id: expenses[idx].id };
  db["wv_expenses"] = expenses;
  writeDb(db);
  res.json(expenses[idx]);
});

app.delete("/api/expenses/:id", requireAuth, (req, res) => {
  const db = readDb();
  const expenses = db["wv_expenses"] ? (typeof db["wv_expenses"] === "string" ? JSON.parse(db["wv_expenses"]) : db["wv_expenses"]) : [];
  const filtered = expenses.filter(e => e.id !== req.params.id);
  db["wv_expenses"] = filtered;
  writeDb(db);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ── Quotes ────────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function nextQuoteNumber(db) {
  const quotes = db["wv_quotes"] ? (typeof db["wv_quotes"] === "string" ? JSON.parse(db["wv_quotes"]) : db["wv_quotes"]) : [];
  const nums = quotes.map(q => parseInt((q.number || "QUO-0000").replace(/[^\d]/g, "")) || 0);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `QUO-${String(next).padStart(4, "0")}`;
}

app.get("/api/quotes", requireAuth, (req, res) => {
  const db = readDb();
  const quotes = db["wv_quotes"] ? (typeof db["wv_quotes"] === "string" ? JSON.parse(db["wv_quotes"]) : db["wv_quotes"]) : [];
  res.json(quotes);
});

app.post("/api/quotes", requireAuth, (req, res) => {
  const db = readDb();
  const quotes = db["wv_quotes"] ? (typeof db["wv_quotes"] === "string" ? JSON.parse(db["wv_quotes"]) : db["wv_quotes"]) : [];
  const settings = db["wv_settings"] ? (typeof db["wv_settings"] === "string" ? JSON.parse(db["wv_settings"]) : db["wv_settings"]) : {};
  const quote = {
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"),
    number: nextQuoteNumber(db),
    status: "draft",
    from: req.body.from || settings.invoiceFrom || { name: "", email: "", address: "" },
    to: req.body.to || { name: "", email: "", address: "" },
    items: req.body.items || [],
    notes: req.body.notes || "",
    expiryDate: req.body.expiryDate || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
    shareToken: crypto.randomBytes(24).toString("hex"),
    bookingId: req.body.bookingId || null,
    tax: req.body.tax ?? null,
    discount: req.body.discount ?? null,
  };
  quotes.push(quote);
  db["wv_quotes"] = quotes;
  writeDb(db);
  res.json(quote);
});

app.put("/api/quotes/:id", requireAuth, (req, res) => {
  const db = readDb();
  const quotes = db["wv_quotes"] ? (typeof db["wv_quotes"] === "string" ? JSON.parse(db["wv_quotes"]) : db["wv_quotes"]) : [];
  const idx = quotes.findIndex(q => q.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  quotes[idx] = { ...quotes[idx], ...req.body, id: quotes[idx].id, number: quotes[idx].number, shareToken: quotes[idx].shareToken };
  db["wv_quotes"] = quotes;
  writeDb(db);
  res.json(quotes[idx]);
});

// Convert accepted quote to invoice
app.post("/api/quotes/:id/convert", requireAuth, (req, res) => {
  const db = readDb();
  const quotes = db["wv_quotes"] ? (typeof db["wv_quotes"] === "string" ? JSON.parse(db["wv_quotes"]) : db["wv_quotes"]) : [];
  const idx = quotes.findIndex(q => q.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  const quote = quotes[idx];
  // Build invoice from quote
  const invoices = db["wv_invoices"] ? (typeof db["wv_invoices"] === "string" ? JSON.parse(db["wv_invoices"]) : db["wv_invoices"]) : [];
  const invoice = {
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"),
    number: allocateInvoiceNumber(invoices),
    status: "draft",
    from: quote.from,
    to: quote.to,
    items: quote.items,
    notes: quote.notes,
    dueDate: req.body.dueDate || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
    shareToken: crypto.randomBytes(24).toString("hex"),
    emailLog: [],
    bookingId: quote.bookingId || null,
    tax: quote.tax,
    discount: quote.discount,
  };
  invoices.push(invoice);
  quotes[idx].status = "converted";
  quotes[idx].convertedInvoiceId = invoice.id;
  db["wv_invoices"] = invoices;
  db["wv_quotes"] = quotes;
  writeDb(db);
  res.json({ invoice, quote: quotes[idx] });
});

app.delete("/api/quotes/:id", requireAuth, (req, res) => {
  const db = readDb();
  const quotes = db["wv_quotes"] ? (typeof db["wv_quotes"] === "string" ? JSON.parse(db["wv_quotes"]) : db["wv_quotes"]) : [];
  db["wv_quotes"] = quotes.filter(q => q.id !== req.params.id);
  writeDb(db);
  res.json({ ok: true });
});

// Public quote view (share token)
const quoteShareLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false, message: { error: "Too many quote requests" } });
function safePublicQuoteDto(quote) {
  return {
    id: quote.id,
    number: quote.number,
    status: quote.status,
    from: safeInvoiceParty(quote.from),
    to: safeInvoiceParty(quote.to),
    items: (Array.isArray(quote.items) ? quote.items : []).slice(0, 500).map(item => ({
      id: item.id,
      description: String(item.description || "").slice(0, 2000),
      subdescription: item.subdescription ? String(item.subdescription).slice(0, 2000) : undefined,
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unitPrice) || 0,
    })),
    notes: String(quote.notes || "").slice(0, 10_000),
    expiryDate: quote.expiryDate,
    createdAt: quote.createdAt,
    sentAt: quote.sentAt,
    acceptedAt: quote.acceptedAt,
    declinedAt: quote.declinedAt,
    acceptedByName: quote.acceptedByName,
    tax: quote.tax,
    discount: quote.discount,
  };
}

app.get("/api/quotes/share/:token", quoteShareLimiter, (req, res) => {
  const db = readDb();
  const quotes = db["wv_quotes"] ? (typeof db["wv_quotes"] === "string" ? JSON.parse(db["wv_quotes"]) : db["wv_quotes"]) : [];
  const quote = quotes.find(q => timingSafeTextEqual(q.shareToken, req.params.token));
  if (!quote) return res.status(404).json({ error: "Not found" });
  if (!["sent", "accepted", "declined"].includes(quote.status)) return res.status(404).json({ error: "Not found" });
  if (albumAccessWindow({ expiresAt: quote.expiryDate }).galleryExpired) return res.status(410).json({ error: "This quote has expired" });
  res.setHeader("Cache-Control", "private, no-store");
  res.json(safePublicQuoteDto(quote));
});

// Client accepts/declines quote via token
app.post("/api/quotes/share/:token/respond", quoteShareLimiter, (req, res) => {
  const db = readDb();
  const quotes = db["wv_quotes"] ? (typeof db["wv_quotes"] === "string" ? JSON.parse(db["wv_quotes"]) : db["wv_quotes"]) : [];
  const idx = quotes.findIndex(q => timingSafeTextEqual(q.shareToken, req.params.token));
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  if (quotes[idx].status !== "sent") return res.status(409).json({ error: "This quote has already been actioned or is unavailable" });
  if (albumAccessWindow({ expiresAt: quotes[idx].expiryDate }).galleryExpired) return res.status(410).json({ error: "This quote has expired" });
  const { action } = req.body; // "accept" or "decline"
  if (action === "accept") {
    const acceptedByName = String(req.body?.acceptedByName || "").trim();
    if (!acceptedByName) return res.status(400).json({ error: "acceptedByName is required" });
    quotes[idx].status = "accepted";
    quotes[idx].acceptedAt = new Date().toISOString();
    quotes[idx].acceptedByName = acceptedByName.slice(0, 160);
  } else if (action === "decline") {
    quotes[idx].status = "declined";
    quotes[idx].declinedAt = new Date().toISOString();
  } else {
    return res.status(400).json({ error: "action must be accept or decline" });
  }
  db["wv_quotes"] = quotes;
  writeDb(db);
  res.json(safePublicQuoteDto(quotes[idx]));
});

// ═══════════════════════════════════════════════════════════════════════════════
// ── Booking Tasks ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// Get tasks for a booking
app.get("/api/bookings/:id/tasks", requireAuth, (req, res) => {
  const db = readDb();
  const bookings = db["wv_bookings"] ? (typeof db["wv_bookings"] === "string" ? JSON.parse(db["wv_bookings"]) : db["wv_bookings"]) : [];
  const booking = bookings.find(b => b.id === req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  res.json(booking.tasks || []);
});

// Update tasks for a booking
app.put("/api/bookings/:id/tasks", requireAuth, (req, res) => {
  const db = readDb();
  const bookings = db["wv_bookings"] ? (typeof db["wv_bookings"] === "string" ? JSON.parse(db["wv_bookings"]) : db["wv_bookings"]) : [];
  const idx = bookings.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Booking not found" });
  bookings[idx].tasks = req.body.tasks || [];
  db["wv_bookings"] = bookings;
  writeDb(db);
  res.json(bookings[idx].tasks);
});

// Toggle a single task
app.put("/api/bookings/:id/tasks/:taskId/toggle", requireAuth, (req, res) => {
  const db = readDb();
  const bookings = db["wv_bookings"] ? (typeof db["wv_bookings"] === "string" ? JSON.parse(db["wv_bookings"]) : db["wv_bookings"]) : [];
  const bIdx = bookings.findIndex(b => b.id === req.params.id);
  if (bIdx === -1) return res.status(404).json({ error: "Booking not found" });
  const tasks = bookings[bIdx].tasks || [];
  const tIdx = tasks.findIndex(t => t.id === req.params.taskId);
  if (tIdx === -1) return res.status(404).json({ error: "Task not found" });
  tasks[tIdx].completed = !tasks[tIdx].completed;
  tasks[tIdx].completedAt = tasks[tIdx].completed ? new Date().toISOString() : null;
  bookings[bIdx].tasks = tasks;
  db["wv_bookings"] = bookings;
  writeDb(db);
  res.json(tasks[tIdx]);
});

// Task templates
app.get("/api/task-templates", requireAuth, (req, res) => {
  const db = readDb();
  const templates = db["wv_task_templates"] ? (typeof db["wv_task_templates"] === "string" ? JSON.parse(db["wv_task_templates"]) : db["wv_task_templates"]) : [];
  res.json(templates);
});

app.post("/api/task-templates", requireAuth, (req, res) => {
  const db = readDb();
  const templates = db["wv_task_templates"] ? (typeof db["wv_task_templates"] === "string" ? JSON.parse(db["wv_task_templates"]) : db["wv_task_templates"]) : [];
  const template = {
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"),
    eventTypeId: req.body.eventTypeId || null,
    tasks: req.body.tasks || [],
    createdAt: new Date().toISOString(),
  };
  templates.push(template);
  db["wv_task_templates"] = templates;
  writeDb(db);
  res.json(template);
});

app.put("/api/task-templates/:id", requireAuth, (req, res) => {
  const db = readDb();
  const templates = db["wv_task_templates"] ? (typeof db["wv_task_templates"] === "string" ? JSON.parse(db["wv_task_templates"]) : db["wv_task_templates"]) : [];
  const idx = templates.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  templates[idx] = { ...templates[idx], ...req.body, id: templates[idx].id };
  db["wv_task_templates"] = templates;
  writeDb(db);
  res.json(templates[idx]);
});

app.delete("/api/task-templates/:id", requireAuth, (req, res) => {
  const db = readDb();
  const templates = db["wv_task_templates"] ? (typeof db["wv_task_templates"] === "string" ? JSON.parse(db["wv_task_templates"]) : db["wv_task_templates"]) : [];
  db["wv_task_templates"] = templates.filter(t => t.id !== req.params.id);
  writeDb(db);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ── Tags ──────────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/api/tags", requireAuth, (req, res) => {
  const db = readDb();
  const tags = db["wv_tags"] ? (typeof db["wv_tags"] === "string" ? JSON.parse(db["wv_tags"]) : db["wv_tags"]) : [];
  res.json(tags);
});

app.post("/api/tags", requireAuth, (req, res) => {
  const db = readDb();
  const tags = db["wv_tags"] ? (typeof db["wv_tags"] === "string" ? JSON.parse(db["wv_tags"]) : db["wv_tags"]) : [];
  const tag = {
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"),
    label: req.body.label || "Tag",
    color: req.body.color || "#a855f7",
  };
  tags.push(tag);
  db["wv_tags"] = tags;
  writeDb(db);
  res.json(tag);
});

app.put("/api/tags/:id", requireAuth, (req, res) => {
  const db = readDb();
  const tags = db["wv_tags"] ? (typeof db["wv_tags"] === "string" ? JSON.parse(db["wv_tags"]) : db["wv_tags"]) : [];
  const idx = tags.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  tags[idx] = { ...tags[idx], ...req.body, id: tags[idx].id };
  db["wv_tags"] = tags;
  writeDb(db);
  res.json(tags[idx]);
});

app.delete("/api/tags/:id", requireAuth, (req, res) => {
  const db = readDb();
  const tags = db["wv_tags"] ? (typeof db["wv_tags"] === "string" ? JSON.parse(db["wv_tags"]) : db["wv_tags"]) : [];
  db["wv_tags"] = tags.filter(t => t.id !== req.params.id);
  writeDb(db);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ── Gallery Share Links ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/api/albums/:id/share-links", requireAuth, (req, res) => {
  const db = readDb();
  const albums = db["wv_albums"] ? (typeof db["wv_albums"] === "string" ? JSON.parse(db["wv_albums"]) : db["wv_albums"]) : [];
  const album = albums.find(a => a.id === req.params.id);
  if (!album) return res.status(404).json({ error: "Album not found" });
  res.json(album.shareLinks || []);
});

app.post("/api/albums/:id/share-links", requireAuth, (req, res) => {
  const db = readDb();
  const albums = db["wv_albums"] ? (typeof db["wv_albums"] === "string" ? JSON.parse(db["wv_albums"]) : db["wv_albums"]) : [];
  const idx = albums.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Album not found" });
  const link = {
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"),
    albumId: req.params.id,
    token: crypto.randomBytes(20).toString("hex"),
    label: req.body.label || null,
    expiresAt: req.body.expiresAt || null,
    allowDownload: req.body.allowDownload !== false,
    createdAt: new Date().toISOString(),
    accessCount: 0,
  };
  if (!albums[idx].shareLinks) albums[idx].shareLinks = [];
  albums[idx].shareLinks.push(link);
  db["wv_albums"] = albums;
  writeDb(db);
  res.json(link);
});

app.delete("/api/albums/:id/share-links/:linkId", requireAuth, (req, res) => {
  const db = readDb();
  const albums = db["wv_albums"] ? (typeof db["wv_albums"] === "string" ? JSON.parse(db["wv_albums"]) : db["wv_albums"]) : [];
  const idx = albums.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Album not found" });
  albums[idx].shareLinks = (albums[idx].shareLinks || []).filter(l => l.id !== req.params.linkId);
  if (albums[idx].sessionPurchases && typeof albums[idx].sessionPurchases === "object") {
    for (const [sessionKey, purchase] of Object.entries(albums[idx].sessionPurchases)) {
      if (purchase?.source === "share-link" && purchase?.shareLinkId === req.params.linkId) delete albums[idx].sessionPurchases[sessionKey];
    }
  }
  db["wv_albums"] = albums;
  writeDb(db);
  res.json({ ok: true });
});

// Public share link access — resolves a token to album data (view-only)
app.get("/api/gallery/share/:token", galleryAccessLimiter, (req, res) => {
  const db = readDb();
  const albums = db["wv_albums"] ? (typeof db["wv_albums"] === "string" ? JSON.parse(db["wv_albums"]) : db["wv_albums"]) : [];
  for (const album of albums) {
    const links = album.shareLinks || [];
    const link = links.find(l => timingSafeTextEqual(l.token, req.params.token));
    if (link) {
      if (album.enabled === false) return res.status(404).json({ error: "Share link not found" });
      const accessWindow = albumAccessWindow(album, Date.now(), galleryTimezone(db, null));
      if (accessWindow.galleryExpired) return res.status(410).json({ error: "This gallery has expired" });
      if (albumAccessWindow({ expiresAt: link.expiresAt }, Date.now(), galleryTimezone(db, null)).galleryExpired) return res.status(410).json({ error: "This share link has expired" });
      // Increment access counter
      link.accessCount = (link.accessCount || 0) + 1;
      link.lastAccessedAt = new Date().toISOString();
      const sessionKey = `gallery-${crypto.randomBytes(24).toString("base64url")}`;
      const sessionToken = signSession({ purpose: "gallery", albumId: album.id, tenantSlug: null, sessionKey, shareLinkId: link.id }, SESSION_SECRET, { ttlSeconds: GALLERY_SESSION_TTL_SECONDS });
      setHttpOnlyCookie(req, res, galleryCookieName(album.id), sessionToken, GALLERY_SESSION_TTL_SECONDS);
      const allowDownload = link.allowDownload === true && !accessWindow.downloadsExpired;
      if (allowDownload) {
        album.sessionPurchases = album.sessionPurchases || {};
        album.sessionPurchases[sessionKey] = { fullAlbum: true, grantedAt: new Date().toISOString(), source: "share-link", shareLinkId: link.id };
      }
      db["wv_albums"] = albums;
      writeDb(db);
      const gallerySession = verifySession(sessionToken, SESSION_SECRET, { purpose: "gallery" });
      return res.json({
        album: publicAlbumDto(album, gallerySession),
        allowDownload,
        linkLabel: link.label,
      });
    }
  }
  res.status(404).json({ error: "Share link not found" });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ── Photo Comments / Annotations ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/api/albums/:albumId/photos/:photoId/comments", requireAuth, (req, res) => {
  const db = readDb();
  const albums = db["wv_albums"] ? (typeof db["wv_albums"] === "string" ? JSON.parse(db["wv_albums"]) : db["wv_albums"]) : [];
  const album = albums.find(a => a.id === req.params.albumId);
  if (!album) return res.status(404).json({ error: "Album not found" });
  const photo = (album.photos || []).find(p => p.id === req.params.photoId);
  if (!photo) return res.status(404).json({ error: "Photo not found" });
  res.json(photo.comments || []);
});

// Legacy comments are no longer part of the public gallery DTO/UI. Keep the
// admin workflow, but do not expose a second public gallery mutation surface.
app.post("/api/albums/:albumId/photos/:photoId/comments", requireAuth, (req, res) => {
  const db = readDb();
  const albums = db["wv_albums"] ? (typeof db["wv_albums"] === "string" ? JSON.parse(db["wv_albums"]) : db["wv_albums"]) : [];
  const aIdx = albums.findIndex(a => a.id === req.params.albumId);
  if (aIdx === -1) return res.status(404).json({ error: "Album not found" });
  const photos = albums[aIdx].photos || [];
  const pIdx = photos.findIndex(p => p.id === req.params.photoId);
  if (pIdx === -1) return res.status(404).json({ error: "Photo not found" });
  const text = String(req.body.text || "").trim().slice(0, 5000);
  if (!text) return res.status(400).json({ error: "Comment text is required" });
  const comment = {
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"),
    photoId: req.params.photoId,
    albumId: req.params.albumId,
    authorName: String(req.body.authorName || "Client").trim().slice(0, 120),
    authorEmail: typeof req.body.authorEmail === "string" ? req.body.authorEmail.trim().slice(0, 254) : null,
    text,
    xPct: Number.isFinite(Number(req.body.xPct)) ? Math.max(0, Math.min(100, Number(req.body.xPct))) : null,
    yPct: Number.isFinite(Number(req.body.yPct)) ? Math.max(0, Math.min(100, Number(req.body.yPct))) : null,
    createdAt: new Date().toISOString(),
  };
  if (!photos[pIdx].comments) photos[pIdx].comments = [];
  photos[pIdx].comments.push(comment);
  albums[aIdx].photos = photos;
  db["wv_albums"] = albums;
  writeDb(db);
  res.json(comment);
});

app.put("/api/albums/:albumId/photos/:photoId/comments/:commentId/resolve", requireAuth, (req, res) => {
  const db = readDb();
  const albums = db["wv_albums"] ? (typeof db["wv_albums"] === "string" ? JSON.parse(db["wv_albums"]) : db["wv_albums"]) : [];
  const aIdx = albums.findIndex(a => a.id === req.params.albumId);
  if (aIdx === -1) return res.status(404).json({ error: "Album not found" });
  const photos = albums[aIdx].photos || [];
  const pIdx = photos.findIndex(p => p.id === req.params.photoId);
  if (pIdx === -1) return res.status(404).json({ error: "Photo not found" });
  const comments = photos[pIdx].comments || [];
  const cIdx = comments.findIndex(c => c.id === req.params.commentId);
  if (cIdx === -1) return res.status(404).json({ error: "Comment not found" });
  comments[cIdx].resolvedAt = new Date().toISOString();
  comments[cIdx].resolvedBy = "admin";
  photos[pIdx].comments = comments;
  albums[aIdx].photos = photos;
  db["wv_albums"] = albums;
  writeDb(db);
  res.json(comments[cIdx]);
});

app.delete("/api/albums/:albumId/photos/:photoId/comments/:commentId", requireAuth, (req, res) => {
  const db = readDb();
  const albums = db["wv_albums"] ? (typeof db["wv_albums"] === "string" ? JSON.parse(db["wv_albums"]) : db["wv_albums"]) : [];
  const aIdx = albums.findIndex(a => a.id === req.params.albumId);
  if (aIdx === -1) return res.status(404).json({ error: "Album not found" });
  const photos = albums[aIdx].photos || [];
  const pIdx = photos.findIndex(p => p.id === req.params.photoId);
  if (pIdx === -1) return res.status(404).json({ error: "Photo not found" });
  photos[pIdx].comments = (photos[pIdx].comments || []).filter(c => c.id !== req.params.commentId);
  albums[aIdx].photos = photos;
  db["wv_albums"] = albums;
  writeDb(db);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ── Contracts ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const contractUpload = multer({ dest: UPLOADS_DIR, limits: { fileSize: 20 * 1024 * 1024 } });
const contractPublicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

app.post("/api/contracts", requireAuth, contractUpload.single("pdf"), (req, res) => {
  const db = readDb();
  const contracts = db["wv_contracts"] ? (typeof db["wv_contracts"] === "string" ? JSON.parse(db["wv_contracts"]) : db["wv_contracts"]) : [];
  let pdfPath = null;
  if (req.file) {
    const signature = fs.readFileSync(req.file.path).subarray(0, 5).toString("ascii");
    if (signature !== "%PDF-") {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ error: "A valid PDF file is required" });
    }
    const dest = path.join(UPLOADS_DIR, `contract_${req.file.filename}.pdf`);
    fs.renameSync(req.file.path, dest);
    pdfPath = `contract_${req.file.filename}.pdf`;
  }
  const contract = {
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"),
    bookingId: req.body.bookingId || null,
    title: req.body.title || "Photography Services Agreement",
    pdfPath,
    token: crypto.randomBytes(24).toString("hex"),
    status: "pending",
    createdAt: new Date().toISOString(),
    sentAt: null,
  };
  contracts.push(contract);
  db["wv_contracts"] = contracts;
  writeDb(db);
  res.json(contract);
});

app.get("/api/contracts", requireAuth, (req, res) => {
  const db = readDb();
  const contracts = db["wv_contracts"] ? (typeof db["wv_contracts"] === "string" ? JSON.parse(db["wv_contracts"]) : db["wv_contracts"]) : [];
  const { bookingId } = req.query;
  res.json(bookingId ? contracts.filter(c => c.bookingId === bookingId) : contracts);
});

// Public contract view + sign (via token)
app.get("/api/contracts/sign/:token/pdf", contractPublicLimiter, (req, res) => {
  const contracts = dbGet(readDb(), "wv_contracts", []);
  const contract = (Array.isArray(contracts) ? contracts : []).find(item => timingSafeTextEqual(item.token, req.params.token));
  if (!contract?.pdfPath) return res.status(404).json({ error: "Contract PDF not found" });
  const safeName = path.basename(String(contract.pdfPath));
  if (!/^contract_[a-zA-Z0-9_-]+\.pdf$/.test(safeName)) return res.status(404).json({ error: "Contract PDF not found" });
  const filePath = path.join(UPLOADS_DIR, safeName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Contract PDF not found" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Cache-Control", "private, no-store");
  return res.sendFile(filePath);
});

app.get("/api/contracts/sign/:token", contractPublicLimiter, (req, res) => {
  const db = readDb();
  const contracts = db["wv_contracts"] ? (typeof db["wv_contracts"] === "string" ? JSON.parse(db["wv_contracts"]) : db["wv_contracts"]) : [];
  const contract = contracts.find(c => timingSafeTextEqual(c.token, req.params.token));
  if (!contract) return res.status(404).json({ error: "Contract not found" });
  // Return contract info without PDF binary (client fetches PDF separately)
  res.json({
    id: contract.id,
    title: contract.title,
    status: contract.status,
    bookingId: contract.bookingId,
    pdfUrl: contract.pdfPath ? `/api/contracts/sign/${encodeURIComponent(req.params.token)}/pdf` : null,
  });
});

app.post("/api/contracts/sign/:token", rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), (req, res) => {
  const db = readDb();
  const contracts = db["wv_contracts"] ? (typeof db["wv_contracts"] === "string" ? JSON.parse(db["wv_contracts"]) : db["wv_contracts"]) : [];
  const idx = contracts.findIndex(c => timingSafeTextEqual(c.token, req.params.token));
  if (idx === -1) return res.status(404).json({ error: "Contract not found" });
  if (contracts[idx].status === "signed") return res.status(409).json({ error: "Already signed" });
  const { signedName } = req.body;
  if (!signedName || !signedName.trim()) return res.status(400).json({ error: "signedName is required" });
  contracts[idx].status = "signed";
  contracts[idx].signedAt = new Date().toISOString();
  contracts[idx].signedName = signedName.trim();
  contracts[idx].signedIp = req.ip;
  // Also mark booking contractId
  if (contracts[idx].bookingId) {
    const bookings = db["wv_bookings"] ? (typeof db["wv_bookings"] === "string" ? JSON.parse(db["wv_bookings"]) : db["wv_bookings"]) : [];
    const bIdx = bookings.findIndex(b => b.id === contracts[idx].bookingId);
    if (bIdx !== -1) {
      bookings[bIdx].contractId = contracts[idx].id;
      db["wv_bookings"] = bookings;
    }
  }
  db["wv_contracts"] = contracts;
  writeDb(db);
  res.json({ ok: true, signedAt: contracts[idx].signedAt });
});

app.delete("/api/contracts/:id", requireAuth, (req, res) => {
  const db = readDb();
  const contracts = db["wv_contracts"] ? (typeof db["wv_contracts"] === "string" ? JSON.parse(db["wv_contracts"]) : db["wv_contracts"]) : [];
  const contract = contracts.find(c => c.id === req.params.id);
  if (contract?.pdfPath) {
    try { fs.unlinkSync(path.join(UPLOADS_DIR, contract.pdfPath)); } catch {}
  }
  db["wv_contracts"] = contracts.filter(c => c.id !== req.params.id);
  writeDb(db);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ── Payment Instalments ───────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

app.get("/api/bookings/:id/instalments", requireAuth, (req, res) => {
  const db = readDb();
  const instalments = db["wv_instalments"] ? (typeof db["wv_instalments"] === "string" ? JSON.parse(db["wv_instalments"]) : db["wv_instalments"]) : [];
  res.json(instalments.filter(i => i.bookingId === req.params.id));
});

app.post("/api/bookings/:id/instalments", requireAuth, (req, res) => {
  const db = readDb();
  const instalments = db["wv_instalments"] ? (typeof db["wv_instalments"] === "string" ? JSON.parse(db["wv_instalments"]) : db["wv_instalments"]) : [];
  const instalment = {
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"),
    bookingId: req.params.id,
    invoiceId: req.body.invoiceId || null,
    dueDate: req.body.dueDate || new Date().toISOString().slice(0, 10),
    amount: Number(req.body.amount) || 0,
    status: "pending",
    note: req.body.note || null,
  };
  instalments.push(instalment);
  db["wv_instalments"] = instalments;
  writeDb(db);
  res.json(instalment);
});

app.put("/api/instalments/:id", requireAuth, (req, res) => {
  const db = readDb();
  const instalments = dbGet(db, "wv_instalments", []);
  const idx = instalments.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  // Explicit field allowlist — prevents req.body from overwriting id, bookingId, or other protected fields
  const VALID_STATUSES = ["pending", "paid", "overdue", "waived"];
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const update = {};

  if (req.body.amount !== undefined) {
    const amt = Number(req.body.amount);
    if (!isFinite(amt) || amt < 0) return res.status(400).json({ error: "Invalid amount" });
    update.amount = amt;
  }
  if (req.body.dueDate !== undefined) {
    if (!DATE_RE.test(req.body.dueDate) || isNaN(new Date(req.body.dueDate).getTime())) {
      return res.status(400).json({ error: "Invalid dueDate — expected YYYY-MM-DD" });
    }
    update.dueDate = req.body.dueDate;
  }
  if (req.body.status !== undefined) {
    if (!VALID_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ error: `Invalid status — must be one of: ${VALID_STATUSES.join(", ")}` });
    }
    update.status = req.body.status;
  }
  if (req.body.note !== undefined) {
    const note = String(req.body.note || "").slice(0, 1000);
    update.note = note || null;
  }
  if (req.body.invoiceId !== undefined) {
    update.invoiceId = req.body.invoiceId ? String(req.body.invoiceId) : null;
  }

  instalments[idx] = { ...instalments[idx], ...update, id: instalments[idx].id };
  if (update.status === "paid" && !instalments[idx].paidAt) {
    instalments[idx].paidAt = new Date().toISOString();
  }
  db["wv_instalments"] = instalments;
  writeDb(db);
  res.json(instalments[idx]);
});

// ═══════════════════════════════════════════════════════════════════════════════
// ── Auto-Overdue Invoice Detection (cron every 6 hours) ───────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function markOverdueInvoices() {
  const db = readDb();
  const invoices = db["wv_invoices"] ? (typeof db["wv_invoices"] === "string" ? JSON.parse(db["wv_invoices"]) : db["wv_invoices"]) : [];
  const today = new Date().toISOString().slice(0, 10);
  let changed = false;
  for (const inv of invoices) {
    if ((inv.status === "sent" || inv.status === "partial") && inv.dueDate && inv.dueDate < today) {
      inv.status = "overdue";
      changed = true;
    }
  }
  if (changed) {
    db["wv_invoices"] = invoices;
    writeDb(db);
    console.log("🔔 Marked overdue invoices");
  }
}

// Also mark overdue instalments
function markOverdueInstalments() {
  const db = readDb();
  const instalments = db["wv_instalments"] ? (typeof db["wv_instalments"] === "string" ? JSON.parse(db["wv_instalments"]) : db["wv_instalments"]) : [];
  const today = new Date().toISOString().slice(0, 10);
  let changed = false;
  for (const inst of instalments) {
    if (inst.status === "pending" && inst.dueDate && inst.dueDate < today) {
      inst.status = "overdue";
      changed = true;
    }
  }
  if (changed) {
    db["wv_instalments"] = instalments;
    writeDb(db);
  }
}

// Run overdue checks every 6 hours
const OVERDUE_INTERVAL_MS = 6 * 60 * 60 * 1000;
setTimeout(() => {
  markOverdueInvoices();
  markOverdueInstalments();
  setInterval(() => {
    markOverdueInvoices();
    markOverdueInstalments();
  }, OVERDUE_INTERVAL_MS);
}, 60000); // run 1 min after startup

// ═══════════════════════════════════════════════════════════════════════════════
// ── One-Click Gallery Delivery ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/albums/:id/deliver", requireAuth, async (req, res) => {
  const db = readDb();
  const albums = db["wv_albums"] ? (typeof db["wv_albums"] === "string" ? JSON.parse(db["wv_albums"]) : db["wv_albums"]) : [];
  const idx = albums.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Album not found" });

  const album = albums[idx];
  const now = new Date().toISOString();

  // 1. Disable watermarks
  album.watermarkDisabled = true;
  // 2. Mark as delivered
  album.status = "delivered";
  album.deliveredAt = now;
  // 3. Make public
  album.isPublic = true;

  db["wv_albums"] = albums;
  writeDb(db);

  // 4. Send client email if email + bookingId available
  const result = { ok: true, deliveredAt: now };
  if (album.clientEmail) {
    try {
      const galleryUrl = `${safeCheckoutReturnUrl(req, null, `/gallery/${encodeURIComponent(album.slug || album.id)}`)}${album.clientToken ? `#token=${encodeURIComponent(album.clientToken)}` : ""}`;
      const transporter = getTransporter();
      if (transporter) {
        const profile = dbGet(db, DB_KEYS.PROFILE, {});
        const message = buildGalleryDeliveryEmail({
          clientName: album.clientName,
          albumTitle: album.title,
          galleryUrl,
          accessCode: album.accessCode || "",
          photoCount: Array.isArray(album.photos) ? album.photos.length : album.photoCount,
          brandName: profile.businessName || profile.brandName || profile.name || "PhotoFlow",
        });
        await transporter.sendMail({
          from: getFromAddress(),
          to: album.clientEmail,
          ...message,
        });
        result.emailSent = true;
      }
    } catch (e) {
      result.emailError = e.message;
    }
  }

  res.json(result);
});

// ═══════════════════════════════════════════════════════════════════════════════
// ── Booking Source Tracking ───────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// PATCH a booking's source (lightweight endpoint to avoid full booking update)
app.patch("/api/bookings/:id/source", requireAuth, (req, res) => {
  const db = readDb();
  const bookings = db["wv_bookings"] ? (typeof db["wv_bookings"] === "string" ? JSON.parse(db["wv_bookings"]) : db["wv_bookings"]) : [];
  const idx = bookings.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  bookings[idx].source = req.body.source;
  db["wv_bookings"] = bookings;
  writeDb(db);
  res.json({ ok: true, source: bookings[idx].source });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ── PWA Push Notifications ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const pushSubscriptionLimiter = rateLimit({ windowMs: 15 * 60_000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many push subscription requests" } });
function validPushEndpoint(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  } catch { return false; }
}
function validPushKey(value) {
  return typeof value === "string" && value.length >= 16 && value.length <= 256 && /^[A-Za-z0-9_-]+={0,2}$/.test(value);
}

// Subscribe
app.post("/api/push/subscribe", pushSubscriptionLimiter, requireAdminOrScopedTenant, (req, res) => {
  const db = readDb();
  const subs = db["wv_push_subscriptions"] ? (typeof db["wv_push_subscriptions"] === "string" ? JSON.parse(db["wv_push_subscriptions"]) : db["wv_push_subscriptions"]) : [];
  const { endpoint, keys, tenantSlug } = req.body;
  if (!validPushEndpoint(endpoint) || !validPushKey(keys?.p256dh) || !validPushKey(keys?.auth)) return res.status(400).json({ error: "A valid push endpoint and keys are required" });
  const scopedTenantSlug = req.authContext?.type === "tenant" ? req.authContext.slug : (tenantSlug ? String(tenantSlug) : null);
  if (scopedTenantSlug && !licensedTenantBySlug(scopedTenantSlug)) return res.status(400).json({ error: "Tenant scope is invalid" });
  // Upsert by endpoint
  const existing = subs.findIndex(s => s.endpoint === endpoint && String(s.tenantSlug || "") === String(scopedTenantSlug || ""));
  const record = {
    id: existing >= 0 ? subs[existing].id : (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex")),
    endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
    tenantSlug: scopedTenantSlug,
    createdAt: existing >= 0 ? subs[existing].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 500) || null,
  };
  if (existing >= 0) subs[existing] = record;
  else subs.push(record);
  const capped = subs.sort((left, right) => Date.parse(left.updatedAt || left.createdAt || 0) - Date.parse(right.updatedAt || right.createdAt || 0)).slice(-2000);
  db["wv_push_subscriptions"] = capped;
  writeDb(db);
  res.json({ ok: true, subscriptionId: record.id });
});

// Unsubscribe
app.post("/api/push/unsubscribe", pushSubscriptionLimiter, requireAdminOrScopedTenant, (req, res) => {
  const db = readDb();
  const subs = db["wv_push_subscriptions"] ? (typeof db["wv_push_subscriptions"] === "string" ? JSON.parse(db["wv_push_subscriptions"]) : db["wv_push_subscriptions"]) : [];
  const id = String(req.body?.subscriptionId || "");
  if (!id) return res.status(400).json({ error: "subscriptionId is required" });
  db["wv_push_subscriptions"] = subs.filter(subscription => {
    if (subscription.id !== id) return true;
    return req.authContext?.type === "tenant" && subscription.tenantSlug !== req.authContext.slug;
  });
  writeDb(db);
  res.json({ ok: true });
});

app.post("/api/booking/cancel-notify", requireAuth, async (req, res) => {
  const booking = req.body?.booking || {};
  if (!booking.date) return res.status(400).json({ ok: false, error: "booking.date is required" });
  const db = readDb();
  const entries = dbGet(db, DB_KEYS.WAITLIST, []);
  if (!Array.isArray(entries) || entries.length === 0) return res.json({ ok: true, notified: 0 });

  const candidates = entries.filter(e =>
    String(e.date || "") === String(booking.date || "") &&
    !e.notifiedAt &&
    (!booking.eventTypeId || !e.eventTypeId || String(e.eventTypeId) === String(booking.eventTypeId))
  );
  if (candidates.length === 0) return res.json({ ok: true, notified: 0 });

  const transporter = getTransporter();
  if (!transporter) return res.status(503).json({ ok: false, notified: 0, error: "SMTP not configured" });
  const bookingUrl = safeCheckoutReturnUrl(req, null, "/booking");
  const profile = dbGet(db, DB_KEYS.PROFILE, {});
  const brandName = profile.businessName || profile.brandName || profile.name || "PhotoFlow";
  let notified = 0;
  let failed = 0;
  for (const entry of candidates) {
    try {
      const message = buildWaitlistEmail({
        clientName: entry.clientName,
        eventTitle: entry.eventTypeTitle || booking.type || "your requested session",
        date: entry.date || booking.date,
        bookingUrl,
        brandName,
      });
      await transporter.sendMail({
        from: getFromAddress(),
        to: entry.clientEmail,
        ...message,
      });
      entry.notifiedAt = new Date().toISOString();
      notified++;
    } catch (error) {
      failed++;
      console.error(`Waitlist email failed for ${entry.id}:`, error?.message || error);
    }
  }
  db[DB_KEYS.WAITLIST] = entries;
  writeDb(db);
  if (failed) return res.status(502).json({ ok: false, notified, failed, error: "One or more waitlist emails could not be delivered" });
  res.json({ ok: true, notified });
});

// Get VAPID public key
app.get("/api/push/vapid-public-key", (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY || null;
  res.json({ vapidPublicKey: key });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ── Booking Tags (PATCH) ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

app.patch("/api/bookings/:id/tags", requireAuth, (req, res) => {
  const db = readDb();
  const bookings = db["wv_bookings"] ? (typeof db["wv_bookings"] === "string" ? JSON.parse(db["wv_bookings"]) : db["wv_bookings"]) : [];
  const idx = bookings.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  bookings[idx].tags = req.body.tags || [];
  db["wv_bookings"] = bookings;
  writeDb(db);
  res.json({ ok: true, tags: bookings[idx].tags });
});

app.patch("/api/albums/:id/tags", requireAuth, (req, res) => {
  const db = readDb();
  const albums = db["wv_albums"] ? (typeof db["wv_albums"] === "string" ? JSON.parse(db["wv_albums"]) : db["wv_albums"]) : [];
  const idx = albums.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  albums[idx].tags = req.body.tags || [];
  db["wv_albums"] = albums;
  writeDb(db);
  res.json({ ok: true, tags: albums[idx].tags });
});

// ═══════════════════════════════════════════════════════════════════════════════

app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found", path: req.path });
});

app.get("*", (req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  if (!portfolioIndexHtml) return res.status(503).send("Application build is unavailable");
  if (!isPortfolioSiteHost(req.hostname)) {
    const galleryMatch = req.path.match(/^\/gallery\/([^/]+)\/?$/);
    if (galleryMatch) {
      let identifier = "";
      try { identifier = decodeURIComponent(galleryMatch[1]); } catch { identifier = galleryMatch[1]; }
      const db = readDb();
      const chosen = findAlbumBySlugOrId(db, identifier);
      if (chosen && chosen.album.enabled !== false && !albumAccessWindow(chosen.album, Date.now(), galleryTimezone(db, chosen.tenantSlug)).galleryExpired) {
        res.setHeader("X-Robots-Tag", "noindex, follow, max-image-preview:large");
        return res.type("html").send(portfolioIndexHtml.replace(/<!-- SEO:START -->[\s\S]*?<!-- SEO:END -->/, gallerySeoBlock(req, chosen.album, chosen.tenantSlug)));
      }
    }
    return res.type("html").send(portfolioIndexHtml.replace(/<!-- SEO:START -->[\s\S]*?<!-- SEO:END -->/, platformSeoBlock()));
  }
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  return res.status(404).type("html").send(portfolioIndexHtml.replace(
    /<meta name="robots" content="[^"]+" \/>/,
    '<meta name="robots" content="noindex, nofollow, noarchive" />',
  ));
});

bootstrapPromise.then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 PhotoFlow running on port ${PORT}`);
    console.log(`📁 Data directory: ${DATA_DIR}`);
    console.log(`🖼️  Uploads directory: ${UPLOADS_DIR}`);
  });
}).catch(err => {
  console.error("Server bootstrap failed; refusing to listen:", err);
  process.exitCode = 1;
});
