const express = require("express");
const multer = require("multer");
const cors = require("cors");
const compression = require("compression");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const archiver = require("archiver");
const rateLimit = require("express-rate-limit");
const { uploadFilesToFtp, moveFileOnFtp, testFtpConnection, sanitizeFolderName, sanitizeRemoteFilename } = require("./ftp");
const { registerRoutes: registerGoogleCalendarRoutes } = require("./google-calendar");
const { registerRoutes: registerEmailRoutes } = require("./email");
const { registerRoutes: registerStripeRoutes, registerTenantStripeRoutes } = require("./stripe");
const { registerRoutes: registerGoogleSheetsRoutes } = require("./google-sheets");
const {
  sendDiscordEmbed,
  notifyNewBooking,
  notifyNewEnquiry,
  notifyPayment,
  notifyBookingUpdate,
  notifyAlbumPurchase,
  notifyProofingSubmission,
  notifyWaitlistNotified,
  notifyInvoice,
} = require("./discord");

const app = express();
// Required for express-rate-limit to correctly identify clients behind a reverse proxy
// (nginx / Coolify / TrueNAS) that sets X-Forwarded-For.
app.set("trust proxy", 1);
const PORT = process.env.PORT || 5066;
const DATA_DIR = process.env.DATA_DIR || "/data";
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");
const MAX_ZIP_FILES = 1000; // Reasonable upper bound per request to prevent resource abuse
// Shared Cache-Control header for short-lived public read endpoints (60 s fresh, 5 min stale)
const SHORT_CACHE = "public, max-age=60, stale-while-revalidate=300";

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({}));

// ── Super Admin Bootstrap ──────────────────────────────────────────────────
// If SUPER_ADMIN_USERNAME + SUPER_ADMIN_PASSWORD are set in the environment
// (e.g. via docker-compose.yml / TrueNAS app YAML), pre-seed the admin account
// so the Setup wizard is skipped on first run.
const crypto = require("crypto");
function sha256(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}
function seedSuperAdminIfNeeded() {
  const username = (process.env.SUPER_ADMIN_USERNAME || "").trim();
  const password = (process.env.SUPER_ADMIN_PASSWORD || "").trim();
  if (!username || !password) return;
  if (password === "changeme") {
    console.warn("⚠️  SUPER_ADMIN_PASSWORD is set to the default 'changeme' — change it immediately in your docker-compose.yml!");
  }
  const db = readDbDirect(); // read directly to avoid cache bootstrap ordering issues
  if (db["wv_admin"] && db["wv_setup_complete"]) return; // already bootstrapped
  db["wv_admin"] = JSON.stringify({ username, passwordHash: sha256(password) });
  db["wv_setup_complete"] = "true";
  writeDb(db);
  console.log(`✅ Super admin '${username}' bootstrapped from SUPER_ADMIN_USERNAME env var`);
}
function readDbDirect() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf-8")); } catch { return {}; }
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
    _dbCache = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    _dbCacheTime = now;
    return _dbCache;
  } catch (err) {
    // Log the full error so administrators are aware of database read issues
    console.error("readDb error:", err);
    return _dbCache || {};
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

function _flushDbToDisk() {
  _writePending = false;
  _writeDebounceTimer = null;
  const snapshot = _dbCache;
  if (!snapshot) return;
  // Use compact JSON (no indentation) — reduces file size by ~30-40 % compared
  // to the previous pretty-printed format, which directly speeds up reads and
  // network transfer of the /api/store endpoint.
  fs.writeFile(DB_FILE, JSON.stringify(snapshot), (err) => {
    if (err) console.error("writeDb error:", err);
  });
}

function writeDb(data) {
  // Always update the in-memory cache synchronously so subsequent reads are
  // consistent with the mutation that just happened.
  _dbCache = data;
  _dbCacheTime = Date.now();
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
    try { fs.writeFileSync(DB_FILE, JSON.stringify(_dbCache)); } catch (e) { console.error("Failed to flush database to disk on shutdown:", e); }
    _writePending = false;
  }
}
process.on("exit", _flushDbSync);
process.on("SIGTERM", () => { _flushDbSync(); process.exit(0); });
process.on("SIGINT",  () => { _flushDbSync(); process.exit(0); });

// Bootstrap super admin from env vars (runs after writeDb is available)
seedSuperAdminIfNeeded();

app.use(cors());
// Compress all responses (JSON, HTML, JS, CSS, etc.) — reduces transfer size by ~70-90%
app.use(compression());
// Skip JSON body parsing for the Stripe webhook route — it requires the raw Buffer for
// signature verification.  The route itself applies express.raw() instead.
app.use((req, res, next) => {
  if (req.path === "/api/stripe/webhook") return next();
  if (req.path.startsWith("/api/tenant/") && req.path.endsWith("/stripe/webhook")) return next();
  express.json({ limit: "50mb" })(req, res, next);
});

// ── Health check ──────────────────────────────────────
// Intentionally lightweight – just confirms the server is alive.
// Heavy storage stats are available via /api/storage.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

function getStorageUsage() {
  let totalBytes = 0;
  let photoFiles = [];
  try {
    const dbSize = fs.statSync(DB_FILE).size;
    totalBytes += dbSize;
    const files = fs.readdirSync(UPLOADS_DIR);
    for (const f of files) {
      if (f.startsWith("_")) continue; // skip _cache directory and other internal entries
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
      if (parts.length >= 4) {
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

app.get("/api/storage", (_req, res) => res.json(getStorageUsage()));

// ── Baked-asset stripping ─────────────────────────────────────────────────
// thumbnailWatermarked, mediumWatermarked, and fullWatermarked are base64
// JPEG data-URLs produced client-side by the "Rebuild Watermarked Assets"
// feature (up to ~1.6 MB *per photo*).  In server mode the watermark overlay
// is already applied on the fly by /uploads/:filename, so these pre-baked
// blobs add zero value server-side.  Stripping them on both reads AND writes
// keeps db.json lean and eliminates the primary source of inflated
// /api/store payloads (100 photos × 2.4 MB each = 240 MB before this fix).
const BAKED_PHOTO_FIELDS = ["thumbnailWatermarked", "mediumWatermarked", "fullWatermarked"];
const ALBUMS_KEY        = "wv_albums";
const PHOTO_LIB_KEY     = "wv_photo_library";
const TENANT_ALBUMS_SUFFIX   = "_wv_albums";
const TENANT_PHOTO_LIB_SUFFIX = "_wv_photo_library";

function _stripBakedFromPhotos(photos) {
  if (!Array.isArray(photos)) return photos;
  return photos.map(p => {
    if (!p || typeof p !== "object") return p;
    const out = { ...p };
    for (const f of BAKED_PHOTO_FIELDS) delete out[f];
    return out;
  });
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
app.get("/api/store", (req, res) => {
  const db = readDb();
  if (req.query.keys) {
    const requested = String(req.query.keys).split(",").map(k => k.trim()).filter(Boolean);
    const subset = {};
    for (const k of requested) {
      if (Object.prototype.hasOwnProperty.call(db, k)) subset[k] = stripBakedFields(k, db[k]);
    }
    return res.json(subset);
  }
  // Strip baked fields from every key in the full-dump path too, so that
  // any existing inflated databases are immediately lean on the wire.
  const result = {};
  for (const [k, v] of Object.entries(db)) result[k] = stripBakedFields(k, v);
  res.json(result);
});
app.get("/api/store/:key", (req, res) => {
  const db = readDb();
  const key = req.params.key;
  res.json({ value: key in db ? stripBakedFields(key, db[key]) : null });
});
app.put("/api/store/:key", (req, res) => {
  const db = readDb();
  const key = req.params.key;
  // Strip baked photo blobs before persisting so they never reach db.json.
  db[key] = stripBakedFields(key, req.body.value);
  writeDb(db);
  res.json({ ok: true });
});
app.delete("/api/store/:key", (req, res) => {
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
app.get("/api/albums/stubs", (req, res) => {
  const db = readDb();
  const albums = _parseAlbumsFromDb(db[ALBUMS_KEY]);
  res.json(albums.map(_makeAlbumStub));
});

// GET /api/albums/:albumId/photos — photos for a single album, on demand
app.get("/api/albums/:albumId/photos", (req, res) => {
  const db = readDb();
  const albums = _parseAlbumsFromDb(db[ALBUMS_KEY]);
  const album = albums.find(a => a.id === req.params.albumId || a.slug === req.params.albumId);
  if (!album) return res.status(404).json({ photos: [] });
  // Apply baked-field stripping so the response stays lean.
  res.json({ photos: _stripBakedFromPhotos(album.photos || []) });
});

// PUT /api/albums/:albumId — update a single album without touching other albums.
// This prevents the full-array write via PUT /api/store/wv_albums from overwriting
// other albums' photos with stub (empty) data when only one album's metadata has changed.
app.put("/api/albums/:albumId", (req, res) => {
  const { albumId } = req.params;
  const db = readDb();
  const albums = _parseAlbumsFromDb(db[ALBUMS_KEY]);
  const idx = albums.findIndex(a => a.id === albumId);
  const incoming = { ...req.body, id: albumId };
  if (incoming.photos) incoming.photos = _stripBakedFromPhotos(incoming.photos);
  if (idx >= 0) {
    albums[idx] = { ...albums[idx], ...incoming };
  } else {
    albums.push(incoming);
  }
  db[ALBUMS_KEY] = JSON.stringify(albums);
  writeDb(db);
  res.json({ ok: true });
});

// DELETE /api/albums/:albumId — remove a single album without touching other albums.
// Using a per-album delete avoids the full-array write via PUT /api/store/wv_albums which
// would overwrite other albums' photos with stale stub data.
app.delete("/api/albums/:albumId", (req, res) => {
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

app.get("/api/settings/ftp", (req, res) => {
  const db = readDb();
  const raw = db["wv_ftp_settings"];
  const settings = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
  res.json(maskFtpSettings(settings));
});

app.put("/api/settings/ftp", (req, res) => {
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

app.post("/api/settings/ftp/test", async (req, res) => {
  const db = readDb();
  const raw = db["wv_ftp_settings"];
  const settings = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
  if (!settings.ftpHost) {
    return res.json({ ok: false, error: "FTP host not configured. Save your settings first." });
  }
  const result = await testFtpConnection(settings);
  res.json(result);
});

app.post("/api/tenant/:slug/settings/ftp/test", async (req, res) => {
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
app.post("/api/ftp/upload-album/:albumSlug", ftpUploadAlbumLimiter, async (req, res) => {
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
  const ftpEntries = photos
    .map((p, photoIdx) => {
      const src = typeof p === "string" ? p : p.src;
      if (!src) return null;
      const filename = src.split("/").pop();
      if (!filename || filename.startsWith("_cache")) return null;
      const localPath = path.join(UPLOADS_DIR, filename);
      if (!fs.existsSync(localPath)) return null;
      // Use stored originalName first, then fall back to reconstructing from title + extension.
      // sanitizeRemoteFilename strips any embedded path separators to prevent STOR from
      // trying to navigate a non-existent sub-directory (which returns 550 on many servers).
      const ext = path.extname(filename);
      const rawName = p.originalName || ((p.title && ext) ? `${p.title}${ext}` : filename);
      const remoteFilename = sanitizeRemoteFilename(rawName);
      return { localPath, remoteFilename, starred: !!p.starred, photoIdx };
    })
    .filter(Boolean);

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
  const { Client: FtpClient } = require("basic-ftp");
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
app.post("/api/ftp/move-starred", ftpMoveStarredLimiter, async (req, res) => {
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
  const localFilename = photoSrc.split("/").pop();
  if (!localFilename) return res.json({ ok: false, error: "Could not determine filename from photoSrc." });
  const localFilePath = path.join(UPLOADS_DIR, localFilename);

  // The FTP filename is the original name when available, otherwise the local filename
  const ftpFilename = originalName || localFilename;

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
    fs.existsSync(localFilePath) ? localFilePath : null,
    fromPath,
    toPath,
    ftpSettings
  );
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
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

app.post("/api/upload", upload.array("photos", 100), async (req, res) => {
  const uploadedFiles = (req.files || []).map((f) => ({
    id: path.basename(f.filename, path.extname(f.filename)),
    url: `/uploads/${f.filename}`,
    originalName: f.originalname,
    size: f.size,
    localPath: f.path,
  }));

  // ── FTP Upload (if enabled) ──────────────────────────────────────────────
  // Determine FTP settings: use tenant-specific settings when ?tenant= is provided,
  // otherwise fall back to global admin FTP settings stored in wv_ftp_settings.
  let ftpSettings = null;
  const tenantSlug = req.query.tenant;
  // albumFolder: optional sub-directory name (album title or booking type)
  const albumFolder = req.query.albumFolder ? String(req.query.albumFolder) : null;
  const db = readDb();

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
  res.json({ files });
});

// ── Delete ALL uploaded photos from disk ───────────────
const deleteAllLimiter = rateLimit({ windowMs: 10_000, max: 1, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests — please wait before retrying" } });
app.delete("/api/upload/all", deleteAllLimiter, async (_req, res) => {
  try {
    const files = fs.readdirSync(UPLOADS_DIR);
    let deleted = 0;
    for (const f of files) {
      try { fs.unlinkSync(path.join(UPLOADS_DIR, f)); deleted++; } catch {}
    }
    clearImageCache();

    // Wipe all photo records from db.json so album refs don't break
    const db = readDb();
    if (db["wv_albums"]) {
      const albums = typeof db["wv_albums"] === "string" ? JSON.parse(db["wv_albums"]) : db["wv_albums"];
      if (Array.isArray(albums)) {
        const wiped = albums.map(a => ({ ...a, photos: [], photoCount: 0, coverImage: "" }));
        db["wv_albums"] = JSON.stringify(wiped);
      }
    }
    if (db["wv_library"]) {
      db["wv_library"] = JSON.stringify([]);
    }
    writeDb(db);

    res.json({ ok: true, deleted });
  } catch (err) {
    console.error("Delete all error:", err.message);
    res.status(500).json({ error: "Failed to delete files" });
  }
});

app.delete("/api/upload/:filename", (req, res) => {
  const safeName = path.basename(req.params.filename);
  const filepath = path.join(UPLOADS_DIR, safeName);
  try {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    res.json({ ok: true });
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
  // If watermark is an image (base64 data URL)
  if (wm.imageBase64 && wm.imageBase64.startsWith("data:image/")) {
    try {
      const base64Data = wm.imageBase64.split(",")[1];
      const wmBuf = Buffer.from(base64Data, "base64");
      // For tiled: cap watermark size to reasonable max regardless of image resolution
      // CSS preview uses fixed h-8 (32px) tiles — scale proportionally but cap it
      const wmSize = wm.position === "tiled"
        ? Math.min(200, Math.round(imgWidth * 0.12))  // max 200px, ~12% width for tiled
        : Math.round(imgWidth * (wm.size / 100));     // use actual size% for positioned
      const wmResized = await sharp(wmBuf)
        .resize(wmSize, null, { fit: "inside" })
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
        return { input: tiled, blend: "over", opacity: wm.opacity };
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
  const fontSize = Math.min(48, Math.max(18, Math.round(imgWidth * 0.03)));
  const text = wm.text;
  const alpha = Math.round(wm.opacity * 255).toString(16).padStart(2, "0");

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
  // Check main store first
  const mainRaw = db["wv_albums"];
  const main = mainRaw ? (typeof mainRaw === "string" ? JSON.parse(mainRaw) : mainRaw) : [];
  if (Array.isArray(main)) {
    const found = main.find(a => a.id === albumId);
    if (found) return { album: found, tenantSlug: null };
  }
  // Check tenant stores
  for (const key of Object.keys(db)) {
    if (!key.startsWith("t_") || !key.endsWith("_wv_albums")) continue;
    const tSlug = key.slice(2, key.length - "_wv_albums".length);
    const raw = db[key];
    const parsed = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : [];
    if (Array.isArray(parsed)) {
      const found = parsed.find(a => a.id === albumId);
      if (found) return { album: found, tenantSlug: tSlug };
    }
  }
  return null;
}

function isPhotoAccessible(filename, sessionKey, albumId) {
  try {
    const db = readDb();
    const found = findAlbumById(db, albumId);
    if (!found) return false;
    const album = found.album;

    // If purchasing is disabled, all photos are free
    if (album.purchasingDisabled) return true;
    // If full album unlocked by admin
    if (album.allUnlocked) return true;

    // Session-level full-album purchase (Stripe / bank transfer)
    const sessionPurchase = album.sessionPurchases?.[sessionKey];
    if (sessionPurchase?.fullAlbum === true) return true;

    const photo = album.photos?.find(p => {
      const url = p.url || p.src || "";
      // Compare exact basename to avoid substring collisions (e.g. "photo.jpg" matching "group-photo.jpg")
      const urlBasename = url.split("?")[0].split("/").pop() || "";
      return urlBasename === filename;
    });
    if (!photo) return false;

    // Check per-photo paid flag set by admin
    if (photo.paid) return true;

    // Per-session Stripe purchase includes this photo
    if (sessionPurchase?.photoIds?.includes(photo.id)) return true;

    // Legacy global paidPhotoIds list
    if (Array.isArray(album.paidPhotoIds) && album.paidPhotoIds.includes(photo.id)) return true;

    // Bank transfer requests that have been approved/completed
    const bankApproved = (album.downloadRequests || []).some(
      r => (r.status === "approved" || r.status === "completed") &&
           Array.isArray(r.photoIds) && r.photoIds.includes(photo.id)
    );
    if (bankApproved) return true;

    // Check session-level free downloads (legacy wv_session_* key)
    const sessionData = db[`wv_session_${sessionKey}_${albumId}`];
    const sessionParsed = typeof sessionData === "string" ? JSON.parse(sessionData) : sessionData;
    if (sessionParsed?.unlockedPhotoIds?.includes(photo.id)) return true;

    // Check per-session free download quota — any photo is accessible if the
    // session still has remaining free downloads (tracked client-side via
    // usedFreeDownloads and persisted to the album on the server).
    const sessionFreeUsed = album.usedFreeDownloads?.[sessionKey] || 0;
    const freeQuota = typeof album.freeDownloads === "number" ? album.freeDownloads : 5;
    if (sessionFreeUsed < freeQuota) return true;

    return false;
  } catch {
    return false;
  }
}

/** Generate (or load from cache) a watermarked full-res buffer for a file. */
async function getWatermarkedBuffer(safeName, filepath) {
  const cacheDir = path.join(UPLOADS_DIR, "_cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const baseName = path.basename(safeName, path.extname(safeName));
  const cacheFile = path.join(cacheDir, getCacheFilename(baseName, "full", true));

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

// ── Serve watermarked / resized photo ────────────────────────
// Supports:
//   ?size=thumb   → resize to 700 px wide (for gallery grids)
//   ?size=medium  → resize to 1400 px wide (for lightbox)
//   ?wm=0         → skip watermark (admin / paid access)
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

  if (!fs.existsSync(filepath)) return res.status(404).send("Not found");

  const sizeParam = req.query.size; // 'thumb' | 'medium' | undefined
  const disableWm = req.query.wm === "0";
  // Optional tenant slug — when provided, use that tenant's watermark settings
  const tenantSlug = (req.query.tenant && typeof req.query.tenant === "string" && /^[a-z0-9][a-z0-9-]{0,28}[a-z0-9]$|^[a-z0-9]{1,2}$/.test(req.query.tenant))
    ? req.query.tenant
    : null;

  // Resize target widths
  const targetWidth = sizeParam === "thumb" ? THUMB_WIDTH : sizeParam === "medium" ? MEDIUM_WIDTH : null;

  // Check paid access via query params
  const { sessionKey, albumId, paid } = req.query;
  const hasAccess = paid === "1" && sessionKey && albumId
    ? isPhotoAccessible(safeName, sessionKey, albumId)
    : false;

  const shouldWatermark = !disableWm && !hasAccess;

  // Fast path: no resize, no watermark → serve original file directly
  if (!targetWidth && !shouldWatermark) {
    return res.sendFile(filepath);
  }

  // ── File-based cache ────────────────────────────────────────
  const cacheDir = path.join(UPLOADS_DIR, "_cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const baseName = path.basename(safeName, path.extname(safeName));
  const sizeLabel = sizeParam || "full";
  // Include tenantSlug in cache filename so each tenant gets their own cached variant
  const cacheFile = path.join(cacheDir, getCacheFilename(baseName, sizeLabel, shouldWatermark, tenantSlug));

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
        "Cache-Control": "public, max-age=86400",
        "Last-Modified": lastModified,
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
      "Cache-Control": "public, max-age=86400",
      "Last-Modified": lastModified,
      "X-Watermarked": shouldWatermark ? "true" : "false",
      "X-Cache": "MISS",
    });
    return res.send(result);
  } catch (err) {
    console.error("Image processing error for", safeName, err.message);
    // Fallback: serve original file
    return res.sendFile(filepath);
  }
});

// ── Serve original photo (paid, requires valid session) ──
app.get("/api/photo/:filename/original", async (req, res) => {
  // Strip any query-string that may have been incorporated into the filename (e.g. "photo.jpg?tenant=slug")
  const safeName = path.basename(req.params.filename.split("?")[0]);
  const filepath = path.join(UPLOADS_DIR, safeName);
  if (!fs.existsSync(filepath)) return res.status(404).send("Not found");

  const { sessionKey, albumId } = req.query;
  if (!sessionKey || !albumId) return res.status(403).send("Forbidden");

  if (!isPhotoAccessible(safeName, sessionKey, albumId)) {
    return res.status(403).send("Forbidden");
  }

  res.sendFile(filepath);
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
  const cacheDir = path.join(UPLOADS_DIR, "_cache");
  const before = getCacheBreakdown(cacheDir);
  let cleared = 0;
  if (fs.existsSync(cacheDir)) {
    cleared = countAndDeleteDir(cacheDir);
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  return { cleared, breakdown: before };
}

app.post("/api/cache/clear", (_req, res) => {
  const { cleared, breakdown } = clearImageCache();
  res.json({ ok: true, cleared, breakdown });
});

// ── Cache stats (counts without clearing) ──────────────
app.get("/api/cache/stats", (_req, res) => {
  const cacheDir = path.join(UPLOADS_DIR, "_cache");
  const breakdown = getCacheBreakdown(cacheDir);
  const total = breakdown.thumb_wm + breakdown.thumb_clean + breakdown.medium_wm + breakdown.medium_clean + breakdown.full_wm + breakdown.full_clean + breakdown.other;
  res.json({ ok: true, total, breakdown });
});

// ── Bulk-delete specific files (orphan cleanup) ──────────────
app.post("/api/upload/bulk-delete", async (req, res) => {
  const { filenames } = req.body;
  if (!Array.isArray(filenames)) {
    return res.status(400).json({ error: "filenames array required" });
  }
  // Cap the number of files per request to prevent abuse
  if (filenames.length > 500) {
    return res.status(400).json({ error: "Too many filenames in a single request (max 500)" });
  }
  let deleted = 0;
  const cacheDir = path.join(UPLOADS_DIR, "_cache");
  for (const name of filenames) {
    const safeName = path.basename(String(name));
    const filepath = path.join(UPLOADS_DIR, safeName);
    try {
      if (fs.existsSync(filepath)) { fs.unlinkSync(filepath); deleted++; }
      // Remove any cached variants for this file
      const base = path.basename(safeName, path.extname(safeName));
      for (const sizeLabel of ["thumb", "medium", "full"]) {
        for (const watermarked of [true, false]) {
          const cf = path.join(cacheDir, getCacheFilename(base, sizeLabel, watermarked));
          try { if (fs.existsSync(cf)) fs.unlinkSync(cf); } catch {}
        }
      }
    } catch { /* skip individual failures */ }
  }
  res.json({ ok: true, deleted });
});

// ── Download original photos as a zip (authenticated) ──────────
// Accepts either:
//   { filenames: string[], sessionKey, albumId }   — all clean originals (legacy)
//   { files: [{filename, clean}], sessionKey, albumId } — per-file clean/watermarked
const downloadZipLimiter = rateLimit({ windowMs: 5_000, max: 1, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests — please wait before retrying" } });
app.post("/api/download/zip", downloadZipLimiter, async (req, res) => {
  const { filenames, files, sessionKey, albumId } = req.body;

  // Normalise to a [{filename, clean}] array regardless of which format was sent
  let fileList;
  if (Array.isArray(files)) {
    fileList = files.map(f => ({ filename: String(f.filename || ""), clean: f.clean === true }));
  } else if (Array.isArray(filenames)) {
    fileList = filenames.map(n => ({ filename: String(n), clean: true }));
  } else {
    return res.status(400).json({ error: "files array (or filenames), sessionKey and albumId required" });
  }

  if (!sessionKey || !albumId) {
    return res.status(400).json({ error: "sessionKey and albumId required" });
  }
  // Reasonable upper bound to prevent resource abuse
  if (fileList.length > MAX_ZIP_FILES) {
    return res.status(400).json({ error: `Too many files in a single zip request (max ${MAX_ZIP_FILES})` });
  }

  // Collect accessible files
  const accessibleFiles = [];
  for (const { filename, clean } of fileList) {
    // Strip any query-string that may be appended (e.g. "photo.jpg?tenant=slug")
    const safeName = path.basename(filename.split("?")[0]);
    const filepath = path.join(UPLOADS_DIR, safeName);
    if (!fs.existsSync(filepath)) continue;
    if (!isPhotoAccessible(safeName, sessionKey, albumId)) continue;
    accessibleFiles.push({ safeName, filepath, clean });
  }

  if (accessibleFiles.length === 0) {
    return res.status(403).json({ error: "No accessible photos found for this session" });
  }

  // Look up a friendly album name for the zip filename
  let albumName = "photos";
  try {
    const db = readDb();
    const albums = db["wv_albums"];
    const parsed = typeof albums === "string" ? JSON.parse(albums) : albums;
    const album = Array.isArray(parsed) ? parsed.find(a => a.id === albumId) : null;
    if (album?.title) albumName = album.title.replace(/[^a-z0-9_\- ]/gi, "_").trim();
  } catch {}

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${albumName}.zip"`);

  // JPEG images are already compressed — store them as-is (level 0) to keep zip creation fast
  const archive = archiver("zip", { zlib: { level: 0 } });
  archive.on("error", (err) => {
    console.error("Zip archive error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: "Failed to create zip" });
  });

  archive.pipe(res);
  for (const { safeName, filepath, clean } of accessibleFiles) {
    if (clean) {
      // Serve the original file untouched
      archive.file(filepath, { name: safeName });
    } else {
      // Serve the server-watermarked version (from cache or generated on-the-fly)
      try {
        const buf = await getWatermarkedBuffer(safeName, filepath);
        archive.append(buf, { name: safeName });
      } catch {
        // Fallback: serve original if watermarking fails
        archive.file(filepath, { name: safeName });
      }
    }
  }
  await archive.finalize();
});

// ── Discord webhook endpoints ─────────────────────────
/** Test a Discord webhook URL by sending a sample embed. */
app.post("/api/discord/test", async (req, res) => {
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
app.post("/api/discord/notify", async (req, res) => {
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
app.get("/api/super-admin/webhooks", (req, res) => {
  if (!process.env.SUPER_ADMIN_USERNAME) return res.status(403).json({ ok: false, error: "Super admin not configured" });

  // Verify caller provides the super admin credentials via Basic auth header
  // Frontend sends: Authorization: Basic base64(username:passwordHash)
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Basic ")) return res.status(401).json({ ok: false, error: "Authentication required" });
  try {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
    const [user, ...rest] = decoded.split(":");
    const hash = rest.join(":");
    const db = readDb();
    const adminRaw = db["wv_admin"];
    const adminCreds = adminRaw ? (typeof adminRaw === "string" ? JSON.parse(adminRaw) : adminRaw) : null;
    const isAdmin = adminCreds?.username === user && adminCreds?.passwordHash === hash;
    const isSuperAdminUser = user === process.env.SUPER_ADMIN_USERNAME;
    if (!isAdmin || !isSuperAdminUser) return res.status(403).json({ ok: false, error: "Forbidden" });
  } catch {
    return res.status(401).json({ ok: false, error: "Invalid authorization" });
  }

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
    const storeKey = tenantSlug ? `t_${tenantSlug}_wv_albums` : "wv_albums";
    const raw = db[storeKey];
    const parsed = raw ? (typeof raw === "string" ? JSON.parse(raw) : (Array.isArray(raw) ? raw : [])) : [];
    const idx = parsed.findIndex(a => a.id === albumId);
    // Defensive check: findAlbumById already confirmed existence, but the parsed array
    // could be inconsistent if db was concurrently modified or corrupted.
    if (idx === -1) return res.status(500).json({ ok: false, error: "Album index inconsistency — please retry" });

    // Mark starred photos and record the round
    const updatedPhotos = (album.photos || []).map(p => ({
      ...p,
      starred: selectedPhotoIds.includes(p.id),
    }));

    const rounds = album.proofingRounds || [];
    const submissionData = { selectedPhotoIds, clientNote: clientNote || undefined, submittedAt: new Date().toISOString() };
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
          const filename = (p.src || "").split("/").pop();
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
      notifyProofingSubmission(discordUrl, updatedAlbum, selectedPhotoIds.length, clientNote).catch(() => {});
    }

    res.json({ ok: true, album: updatedAlbum });
  } catch (err) {
    console.error("Proofing submit error:", err.message);
    res.status(500).json({ ok: false, error: "Failed to save proofing picks" });
  }
});

// ── Cache warm / force-render ─────────────────────────
// mode=warm  → thumb variants only, skip files that already exist in cache
// mode=force → all variants (thumb + medium + full), overwrite everything
const cacheWarmLimiter = rateLimit({ windowMs: 60_000, max: 1, standardHeaders: true, legacyHeaders: false, message: { error: "A cache warm job is already running — please wait" } });
app.post("/api/cache/warm", cacheWarmLimiter, async (req, res) => {
  const mode = (req.query.mode || req.body?.mode || "warm");
  const forceAll = mode === "force";
  const sizesToRender = forceAll ? ["thumb", "medium", "full"] : ["thumb"];

  const cacheDir = path.join(UPLOADS_DIR, "_cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Transfer-Encoding", "chunked");

  let files;
  try {
    files = fs.readdirSync(UPLOADS_DIR).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"].includes(ext) && !f.startsWith("_");
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
        const cacheFile = path.join(cacheDir, getCacheFilename(baseName, sizeLabel, watermarked));
        // In warm mode skip existing; in force mode always overwrite
        if (!forceAll && fs.existsSync(cacheFile)) { skipped++; continue; }
        try {
          const targetSize = sizeLabel === "thumb" ? 700 : sizeLabel === "medium" ? 1400 : null;
          let pipeline = targetSize
            ? sharp(filepath).resize(targetSize, null, { fit: "inside", withoutEnlargement: true })
            : sharp(filepath);
          if (watermarked) {
            const meta = await sharp(filepath).metadata();
            const imgW = meta.width || (targetSize || 2000);
            const imgH = meta.height || (targetSize || 2000);
            const wm = getWatermarkSettings();
            const overlay = await buildWatermarkOverlay(imgW, imgH, wm);
            pipeline = pipeline.composite([overlay]);
          }
          const buf = await pipeline.jpeg({ quality: 88, progressive: true }).toBuffer();
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

// ── Integrations ──────────────────────────────────────
registerGoogleCalendarRoutes(app);
registerEmailRoutes(app);
registerStripeRoutes(app, { writeDb });
registerTenantStripeRoutes(app, { readDb, writeDb, readTenants: () => {
  try {
    if (!fs.existsSync(path.join(DATA_DIR, "tenants.json"))) return [];
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, "tenants.json"), "utf-8"));
  } catch { return []; }
}, readLicenseKeys, getLicKeyLimits, readEventSlotRequests, writeEventSlotRequests});
registerGoogleSheetsRoutes(app);

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
  app.get("/api/tenant/:slug/integrations/googlecalendar/status", tenantLimiter, (req, res) => {
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
  app.get("/api/tenant/:slug/integrations/googlecalendar/auth", tenantLimiter, (req, res) => {
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
      state: slug, // pass slug through so callback knows which tenant to save tokens for
    });
    res.json({ url });
  });

  // OAuth callback — saves tokens and redirects back to tenant admin
  app.get("/api/tenant/:slug/integrations/googlecalendar/callback", tenantLimiter, async (req, res) => {
    const { slug } = req.params;
    const { code } = req.query;
    if (!code) return res.status(400).send("Missing code");
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
  app.post("/api/tenant/:slug/integrations/googlecalendar/disconnect", tenantLimiter, (req, res) => {
    clearTenantTokens(req.params.slug);
    res.json({ ok: true });
  });

  // List calendars
  app.get("/api/tenant/:slug/integrations/googlecalendar/calendars", tenantLimiter, async (req, res) => {
    const auth = getAuthenticatedTenantClient(req.params.slug);
    if (!auth) return res.status(401).json({ error: "Not connected" });
    try {
      const { data } = await google.calendar({ version: "v3", auth }).calendarList.list();
      res.json({ calendars: data.items || [] });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Save calendar settings (autoSync, calendarId)
  app.post("/api/tenant/:slug/integrations/googlecalendar/settings", tenantLimiter, (req, res) => {
    saveTenantCalSettings(req.params.slug, req.body);
    res.json({ ok: true });
  });

  // Sync a single booking
  app.post("/api/tenant/:slug/integrations/googlecalendar/event", tenantLimiter, async (req, res) => {
    const { slug } = req.params;
    const auth = getAuthenticatedTenantClient(slug);
    if (!auth) return res.status(401).json({ error: "Not connected" });
    const { booking, calendarId } = req.body;
    if (!booking) return res.status(400).json({ error: "Missing booking" });
    const calId = calendarId || loadTenantCalSettings(slug).calendarId || "primary";
    // Reuse the event builder from the main google-calendar module
    const { getAuthenticatedClient, loadCalSettings } = require("./google-calendar");
    const TZ = process.env.TZ || "Australia/Sydney";
    function buildEvent(b) {
      const startLocal = `${b.date}T${b.time}:00`;
      const [h, m] = b.time.split(":").map(Number);
      const totalMins = h * 60 + m + (b.duration || 60);
      const endH = String(Math.floor(totalMins / 60) % 24).padStart(2, "0");
      const endM = String(totalMins % 60).padStart(2, "0");
      let endDate2 = b.date;
      if (Math.floor(totalMins / 60) >= 24) {
        const d = new Date(`${b.date}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + Math.floor(Math.floor(totalMins / 60) / 24));
        endDate2 = d.toISOString().slice(0, 10);
      }
      return {
        summary: `📸 ${b.type || "Session"} — ${b.clientName}`,
        description: [`Client: ${b.clientName}`, b.clientEmail ? `Email: ${b.clientEmail}` : "", `Duration: ${b.duration || 60}min`, b.notes ? `Notes: ${b.notes}` : "", `\nRef: ${b.id}`].filter(Boolean).join("\n"),
        start: { dateTime: `${b.date}T${b.time}:00`, timeZone: TZ },
        end:   { dateTime: `${endDate2}T${endH}:${endM}:00`, timeZone: TZ },
        extendedProperties: { private: { watermarkVaultBookingId: b.id } },
      };
    }
    try {
      const cal = google.calendar({ version: "v3", auth });
      if (booking.gcalEventId) {
        const { data } = await cal.events.update({ calendarId: calId, eventId: booking.gcalEventId, requestBody: buildEvent(booking) });
        return res.json({ ok: true, eventId: data.id, updated: true });
      }
      const { data } = await cal.events.insert({ calendarId: calId, requestBody: buildEvent(booking) });
      res.json({ ok: true, eventId: data.id, htmlLink: data.htmlLink });
    } catch (err) {
      console.error("Tenant calendar event error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });
})();

// ── Invoice share endpoint (public — no auth required) ────────
const invoiceShareLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests" } });
app.get("/api/invoice/share/:token", invoiceShareLimiter, (req, res) => {
  const db = readDb();
  const raw = db["wv_invoices"];
  const invoices = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : [];
  const invoice = invoices.find(inv => inv.shareToken === req.params.token);
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  res.json(invoice);
});

// ── Tenants ──────────────────────────────────────────
const TENANTS_FILE = path.join(DATA_DIR, "tenants.json");

/** Slugs must be lowercase alphanumeric with optional hyphens, 2-30 chars */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,28}[a-z0-9]$|^[a-z0-9]{1,2}$/;

function readTenants() {
  try {
    if (!fs.existsSync(TENANTS_FILE)) return [];
    return JSON.parse(fs.readFileSync(TENANTS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeTenants(tenants) {
  fs.writeFileSync(TENANTS_FILE, JSON.stringify(tenants, null, 2));
}

// List all tenants
app.get("/api/tenants", tenantLimiter, (_req, res) => {
  res.json(readTenants());
});

// Create tenant
app.post("/api/tenants", tenantLimiter, (req, res) => {
  const { slug, displayName, email, bio, timezone, licenseKey } = req.body || {};
  if (!slug || typeof slug !== "string" || !SLUG_RE.test(slug)) {
    return res.status(400).json({ error: "Invalid slug — use lowercase letters, numbers, and hyphens (1-30 chars)" });
  }
  if (!displayName || typeof displayName !== "string" || !displayName.trim()) {
    return res.status(400).json({ error: "displayName is required" });
  }
  const tenants = readTenants();
  if (tenants.find(t => t.slug === slug)) {
    return res.status(409).json({ error: "Slug already in use" });
  }
  const tenant = {
    slug,
    displayName: displayName.trim(),
    email: (email || "").trim(),
    bio: (bio || "").trim() || undefined,
    timezone: timezone || "Australia/Sydney",
    licenseKey: licenseKey || undefined,
    active: true,
    createdAt: new Date().toISOString(),
  };
  tenants.push(tenant);
  writeTenants(tenants);
  res.json(tenant);
});

// Update tenant
app.put("/api/tenants/:slug", tenantLimiter, (req, res) => {
  const tenants = readTenants();
  const idx = tenants.findIndex(t => t.slug === req.params.slug);
  if (idx === -1) return res.status(404).json({ error: "Tenant not found" });
  const { slug: _ignoreSlug, createdAt: _ignoreCreatedAt, ...updates } = req.body || {};
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
  tenants[idx] = { ...tenants[idx], ...updates, slug: req.params.slug };
  writeTenants(tenants);
  res.json(tenants[idx]);
});

// Delete tenant
app.delete("/api/tenants/:slug", tenantLimiter, (req, res) => {
  const tenants = readTenants();
  const slug = req.params.slug;
  const filtered = tenants.filter(t => t.slug !== slug);
  if (filtered.length === tenants.length) return res.status(404).json({ error: "Tenant not found" });
  writeTenants(filtered);
  res.json({ ok: true });
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
    t => t.active !== false && t.customDomain && t.customDomain.toLowerCase() === normalized
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
  const tenants = readTenants();
  const found = tenants.some(
    t => t.active !== false && t.customDomain && t.customDomain.toLowerCase() === normalized
  );
  res.status(found ? 200 : 404).end();
});

// Public tenant data for booking page — returns event types + profile
app.get("/api/tenant/:slug/public", tenantPublicLimiter, (req, res) => {
  const slug = req.params.slug;
  const tenants = readTenants();
  const tenant = tenants.find(t => t.slug === slug && t.active !== false);
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
        const tenantBookingCount = existingBookings.filter(b => b.tenantSlug === slug).length;
        bookingLimitReached = tenantBookingCount >= limits.maxBookings;
      }
    }
  }

  // Allow browsers and CDNs to cache for 60 s; revalidate after that.
  res.setHeader("Cache-Control", SHORT_CACHE);
  res.json({ tenant, eventTypes, bookingLimitReached });
});

// Get tenant-scoped store key (for main admin to manage tenant data)
app.get("/api/tenant/:slug/store/:key", tenantLimiter, (req, res) => {
  const db = readDb();
  const fullKey = `t_${req.params.slug}_${req.params.key}`;
  res.json({ value: db[fullKey] ?? null });
});

// Set tenant-scoped store key
app.put("/api/tenant/:slug/store/:key", tenantLimiter, (req, res) => {
  const slug = req.params.slug;
  const db = readDb();

  // ── License key enforcement for event types ────────────────────────────
  if (req.params.key === "wv_event_types") {
    const tenants = readTenants();
    const tenant = tenants.find(t => t.slug === slug);
    if (tenant && tenant.licenseKey) {
      const allKeys = readLicenseKeys();
      const licKey = allKeys.find(k => k.key === tenant.licenseKey);
      if (licKey) {
        const limits = getLicKeyLimits(licKey);
        if (limits.maxEvents !== null) {
          const newEventTypes = Array.isArray(req.body.value) ? req.body.value : [];
          // Get current stored array to detect newly added events
          const currentRaw = db[`t_${slug}_wv_event_types`];
          const currentEventTypes = currentRaw ? (typeof currentRaw === "string" ? JSON.parse(currentRaw) : (Array.isArray(currentRaw) ? currentRaw : [])) : [];
          const currentLength = currentEventTypes.length;
          // Lifetime counter — never decremented when events are deleted.
          // Bootstrap to currentLength the first time this tenant saves event types.
          const counterKey = `t_${slug}_wv_event_counter`;
          const counter = typeof db[counterKey] === "number" ? db[counterKey] : (db[counterKey] = currentLength);
          if (newEventTypes.length > currentLength) {
            const newlyAdded = newEventTypes.length - currentLength;
            const newCounter = counter + newlyAdded;
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
            db[counterKey] = newCounter;
          }
        }
      }
    }
  }

  const fullKey = `t_${slug}_${req.params.key}`;
  db[fullKey] = req.body.value;
  writeDb(db);
  res.json({ ok: true });
});

// Clear only the tenant-specific watermark cache entries for a given slug
app.post("/api/tenant/:slug/cache/clear", tenantLimiter, (req, res) => {
  const slug = req.params.slug;
  const tenants = readTenants();
  if (!tenants.find(t => t.slug === slug)) return res.status(404).json({ error: "Tenant not found" });
  const cacheDir = path.join(UPLOADS_DIR, "_cache");
  // Cache filenames are `${baseName}_${sizeLabel}_t_${slug}_wm.jpg` — use underscore-bounded match
  // to prevent slug "foo" from matching slug "foobar"'s files.
  const slugPattern = new RegExp(`_t_${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_`);
  let cleared = 0;
  if (fs.existsSync(cacheDir)) {
    try {
      for (const f of fs.readdirSync(cacheDir)) {
        if (slugPattern.test(f)) {
          try { fs.unlinkSync(path.join(cacheDir, f)); cleared++; } catch {}
        }
      }
    } catch {}
  }
  res.json({ ok: true, cleared });
});

// Return cache stats for a tenant (file count + total size)
app.get("/api/tenant/:slug/cache/stats", tenantLimiter, (req, res) => {
  const slug = req.params.slug;
  const cacheDir = path.join(UPLOADS_DIR, "_cache");
  const slugPattern = new RegExp(`_t_${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_`);
  let count = 0;
  let sizeBytes = 0;
  if (fs.existsSync(cacheDir)) {
    try {
      for (const f of fs.readdirSync(cacheDir)) {
        if (slugPattern.test(f)) {
          try {
            const stat = fs.statSync(path.join(cacheDir, f));
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
app.get("/api/booking/:token", bookingLookupLimiter, (req, res) => {
  const { token } = req.params;
  if (!token || typeof token !== "string") return res.status(400).json({ error: "Invalid token" });
  const db = readDb();
  const raw = db["wv_bookings"];
  const bookings = raw ? (typeof raw === "string" ? JSON.parse(raw) : (Array.isArray(raw) ? raw : [])) : [];
  const booking = bookings.find(b => b.modifyToken === token || b.id === token);
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  res.json({ booking });
});

// Create a booking on behalf of a tenant
app.post("/api/tenant/:slug/booking", tenantBookingLimiter, (req, res) => {
  const slug = req.params.slug;
  const tenants = readTenants();
  const tenant = tenants.find(t => t.slug === slug && t.active !== false);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });

  const { clientName, clientEmail, date, time, eventTypeId, type, duration, notes, answers } = req.body || {};
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

  // ── License key booking limit enforcement ──────────────────────────────
  if (tenant.licenseKey) {
    const allKeys = readLicenseKeys();
    const licKey = allKeys.find(k => k.key === tenant.licenseKey);
    if (licKey) {
      const limits = getLicKeyLimits(licKey);
      if (limits.maxBookings !== null) {
        const db = readDb();
        const rawBks = db["wv_bookings"];
        const existingBookings = rawBks ? (typeof rawBks === "string" ? JSON.parse(rawBks) : (Array.isArray(rawBks) ? rawBks : [])) : [];
        const tenantBookingCount = existingBookings.filter(b => b.tenantSlug === slug).length;
        if (tenantBookingCount >= limits.maxBookings) {
          return res.status(403).json({ error: `Booking limit reached (${limits.maxBookings} bookings). Contact your platform administrator to upgrade your plan.` });
        }
      }
    }
  }

  const booking = {
    id: `bk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    modifyToken: `mod-${crypto.randomUUID()}`,
    clientName: clientName.trim(),
    clientEmail: clientEmail.trim(),
    date,
    time,
    eventTypeId: eventTypeId || "",
    type: type || "",
    duration: typeof duration === "number" ? duration : 60,
    status: "pending",
    notes: (notes || "").trim(),
    answers: (answers && typeof answers === "object") ? answers : {},
    createdAt: new Date().toISOString(),
    tenantSlug: slug,
  };

  const db = readDb();
  const raw = db["wv_bookings"];
  const bookings = raw ? (typeof raw === "string" ? JSON.parse(raw) : (Array.isArray(raw) ? raw : [])) : [];
  bookings.push(booking);
  db["wv_bookings"] = JSON.stringify(bookings);
  writeDb(db);

  // Fire Discord notification — use tenant-specific webhook if configured, else fall back to global
  try {
    const tenantSettingsRaw = db[`t_${slug}_wv_tenant_settings`];
    const tenantSettings = tenantSettingsRaw ? (typeof tenantSettingsRaw === "string" ? JSON.parse(tenantSettingsRaw) : tenantSettingsRaw) : {};
    const settingsRaw = db["wv_settings"];
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

  res.json({ ok: true, booking });
});

// ── Super Admin Info ──────────────────────────────────
// Returns the username that is considered the super admin (set via env var).
// The client uses this to unlock the Platform tab for cross-tenant visibility.
app.get("/api/super-admin/info", (_req, res) => {
  res.json({ superAdminUsername: process.env.SUPER_ADMIN_USERNAME || null });
});

// ── Super Admin: Cross-Tenant Data ───────────────────
const superLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests" } });

// Aggregate stats: tenant count, total bookings, etc.
app.get("/api/super/stats", superLimiter, (_req, res) => {
  const db = readDb();
  const tenants = readTenants();
  const mainRaw = db["wv_bookings"];
  const allBookings = mainRaw ? (typeof mainRaw === "string" ? JSON.parse(mainRaw) : (Array.isArray(mainRaw) ? mainRaw : [])) : [];
  const mainBookings = allBookings.filter(b => !b.tenantSlug);
  const tenantStats = tenants.map(t => {
    const tenantBookings = allBookings.filter(b => b.tenantSlug === t.slug);
    const tenantEtRaw = db[`t_${t.slug}_wv_event_types`];
    const tenantEventTypes = tenantEtRaw ? (typeof tenantEtRaw === "string" ? JSON.parse(tenantEtRaw) : tenantEtRaw) : null;
    return {
      ...t,
      bookingCount: tenantBookings.length,
      pendingBookings: tenantBookings.filter(b => b.status === "pending").length,
      hasCustomEventTypes: !!tenantEventTypes,
    };
  });
  res.json({
    tenantCount: tenants.length,
    totalBookings: allBookings.length,
    mainBookings: mainBookings.length,
    tenants: tenantStats,
  });
});

// All bookings across all tenants
app.get("/api/super/all-bookings", superLimiter, (_req, res) => {
  const db = readDb();
  const raw = db["wv_bookings"];
  const bookings = raw ? (typeof raw === "string" ? JSON.parse(raw) : (Array.isArray(raw) ? raw : [])) : [];
  res.json(bookings);
});

// ── Super Admin: Event Slot Requests ──────────────────
// List all event slot purchase requests
app.get("/api/super/event-slot-requests", superLimiter, (_req, res) => {
  const requests = readEventSlotRequests();
  const tenants = readTenants();
  const result = requests.map(r => {
    const tenant = tenants.find(t => t.slug === r.tenantSlug);
    return { ...r, tenantDisplayName: tenant?.displayName || r.tenantSlug };
  });
  res.json(result);
});

// Confirm an event slot request — grants the tenant one extra event slot
app.post("/api/super/event-slot-requests/:id/confirm", superLimiter, (req, res) => {
  const { id } = req.params;
  const { confirmedBy } = req.body || {};
  const requests = readEventSlotRequests();
  const idx = requests.findIndex(r => r.id === id);
  if (idx < 0) return res.status(404).json({ error: "Request not found" });
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
app.post("/api/super/event-slot-requests/:id/reject", superLimiter, (req, res) => {
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
app.post("/api/tenant/:slug/event-slot-request", tenantLimiter, (req, res) => {
  const slug = req.params.slug;
  const tenants = readTenants();
  const tenant = tenants.find(t => t.slug === slug && t.active !== false);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  const { paymentMethod } = req.body || {};
  if (!paymentMethod || !["stripe", "bank"].includes(paymentMethod)) {
    return res.status(400).json({ error: "paymentMethod must be 'stripe' or 'bank'" });
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
app.get("/api/tenant/:slug/event-slot-request/pending", tenantLimiter, (req, res) => {
  const slug = req.params.slug;
  const requests = readEventSlotRequests();
  const pending = requests.find(r => r.tenantSlug === slug && ["pending", "paid"].includes(r.status));
  res.json({ request: pending || null });
});

// ── Tenant Login (for mobile app) ─────────────────────
app.post("/api/tenant/:slug/login", tenantLimiter, (req, res) => {
  const tenants = readTenants();
  const tenant = tenants.find(t => t.slug === req.params.slug && t.active !== false);
  if (!tenant) return res.status(404).json({ ok: false, error: "Tenant not found" });
  if (!tenant.passwordHash) return res.status(400).json({ ok: false, error: "No password set for this tenant — ask the admin to set one" });
  const { passwordHash } = req.body || {};
  if (!passwordHash || typeof passwordHash !== "string") {
    return res.status(400).json({ ok: false, error: "passwordHash is required" });
  }
  if (tenant.passwordHash !== passwordHash) {
    return res.status(401).json({ ok: false, error: "Invalid credentials" });
  }
  res.json({ ok: true, tenant: { slug: tenant.slug, displayName: tenant.displayName, email: tenant.email, timezone: tenant.timezone } });
});

// ── Tenant Mobile Data (bookings + albums for mobile app) ─────────────────
app.get("/api/tenant/:slug/mobile-data", tenantPublicLimiter, (req, res) => {
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
  const leanAlbums = albums.map(a => ({ ...a, photos: _stripBakedFromPhotos(a.photos || []) }));
  res.json({ tenant, bookings: tenantBookings, albums: leanAlbums });
});

// Create or update a tenant album (used by mobile app in tenant mode)
app.put("/api/tenant/:slug/albums/:albumId", tenantLimiter, (req, res) => {
  const { slug, albumId } = req.params;
  const db = readDb();
  const key = `t_${slug}_wv_albums`;
  const raw = db[key];
  const albums = raw ? (typeof raw === "string" ? JSON.parse(raw) : (Array.isArray(raw) ? raw : [])) : [];
  const idx = albums.findIndex(a => a.id === albumId);
  // Strip baked watermark fields before persisting to keep db.json lean.
  const incoming = { ...req.body, id: albumId };
  if (incoming.photos) incoming.photos = _stripBakedFromPhotos(incoming.photos);
  if (idx >= 0) {
    albums[idx] = { ...albums[idx], ...incoming };
  } else {
    albums.push(incoming);
  }
  db[key] = JSON.stringify(albums);
  writeDb(db);
  res.json({ ok: true });
});

// Upsert a booking that belongs to a tenant (create if new, update if existing; used by tenant admin)
app.put("/api/tenant/:slug/bookings/:bookingId", tenantLimiter, (req, res) => {
  const { slug, bookingId } = req.params;
  const tenants = readTenants();
  const tenant = tenants.find(t => t.slug === slug && t.active !== false);
  if (!tenant) return res.status(404).json({ ok: false, error: "Tenant not found" });
  const db = readDb();
  const allBookingsRaw = db["wv_bookings"];
  const allBookings = allBookingsRaw ? (typeof allBookingsRaw === "string" ? JSON.parse(allBookingsRaw) : (Array.isArray(allBookingsRaw) ? allBookingsRaw : [])) : [];
  const idx = allBookings.findIndex(b => b.id === bookingId && b.tenantSlug === slug);
  // Allow full updates from tenant admin; always keep id and tenantSlug immutable
  const { id: _id, tenantSlug: _ts, ...updates } = req.body || {};
  if (idx < 0) {
    // New booking — insert it
    allBookings.push({ ...updates, id: bookingId, tenantSlug: slug });
  } else {
    // Existing booking — update it
    allBookings[idx] = { ...allBookings[idx], ...updates, id: bookingId, tenantSlug: slug };
  }
  db["wv_bookings"] = JSON.stringify(allBookings);
  writeDb(db);
  res.json({ ok: true });
});

// Delete a booking that belongs to a tenant (tenant admin)
app.delete("/api/tenant/:slug/bookings/:bookingId", tenantLimiter, (req, res) => {
  const { slug, bookingId } = req.params;
  const tenants = readTenants();
  const tenant = tenants.find(t => t.slug === slug && t.active !== false);
  if (!tenant) return res.status(404).json({ ok: false, error: "Tenant not found" });
  const db = readDb();
  const allBookingsRaw = db["wv_bookings"];
  const allBookings = allBookingsRaw ? (typeof allBookingsRaw === "string" ? JSON.parse(allBookingsRaw) : (Array.isArray(allBookingsRaw) ? allBookingsRaw : [])) : [];
  const filtered = allBookings.filter(b => !(b.id === bookingId && b.tenantSlug === slug));
  if (filtered.length === allBookings.length) return res.status(404).json({ ok: false, error: "Booking not found" });
  db["wv_bookings"] = JSON.stringify(filtered);
  writeDb(db);
  res.json({ ok: true });
});

// Delete a tenant album (tenant admin)
app.delete("/api/tenant/:slug/albums/:albumId", tenantLimiter, (req, res) => {
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
app.get("/api/tenant/:slug/license-info", tenantLimiter, (req, res) => {
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
app.get("/api/tenant/:slug/settings", tenantLimiter, (req, res) => {
  const slug = req.params.slug;
  const tenants = readTenants();
  if (!tenants.find(t => t.slug === slug)) return res.status(404).json({ error: "Tenant not found" });
  const db = readDb();
  const raw = db[`t_${slug}_wv_tenant_settings`];
  const settings = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
  res.json(maskTenantSettings(settings));
});

// Send email via tenant's own SMTP settings
app.post("/api/tenant/:slug/email/send", tenantLimiter, async (req, res) => {
  const { slug } = req.params;
  const tenants = readTenants();
  if (!tenants.find(t => t.slug === slug)) return res.status(404).json({ ok: false, error: "Tenant not found" });
  const db = readDb();
  const raw = db[`t_${slug}_wv_tenant_settings`];
  const tenantSettings = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
  const { buildTenantTransporter, getTenantFromAddress, getTransporter, getFromAddress } = require("./email");
  // Prefer tenant SMTP, fall back to global SMTP
  const t = buildTenantTransporter(tenantSettings) || getTransporter();
  const from = buildTenantTransporter(tenantSettings) ? getTenantFromAddress(tenantSettings) : getFromAddress();
  if (!t) return res.status(400).json({ ok: false, error: "SMTP not configured" });
  const { to, subject, html, text } = req.body;
  if (!to || !subject) return res.status(400).json({ ok: false, error: "Missing to/subject" });
  try {
    const info = await t.sendMail({ from, to, subject, html, text });
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
app.put("/api/tenant/:slug/settings", tenantLimiter, (req, res) => {
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
  res.json(readLicensePlans().filter(p => p.active !== false));
});

// List ALL plans including inactive (admin only)
app.get("/api/license-plans/all", planLimiter, (_req, res) => {
  res.json(readLicensePlans());
});

// List all purchases
app.get("/api/license-plans/purchases", planLimiter, (_req, res) => {
  const db = readDb();
  const raw = db["wv_license_purchases"];
  const purchases = raw ? (typeof raw === "string" ? JSON.parse(raw) : (Array.isArray(raw) ? raw : [])) : [];
  res.json(purchases);
});

// Create a plan
app.post("/api/license-plans", planLimiter, (req, res) => {
  const { name, type, price, currency, durationDays, description, features } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (!["monthly", "yearly", "one-time"].includes(type)) {
    return res.status(400).json({ error: "type must be monthly, yearly, or one-time" });
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
app.put("/api/license-plans/:id", planLimiter, (req, res) => {
  const plans = readLicensePlans();
  const idx = plans.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Plan not found" });
  const { id: _ignoreId, createdAt: _ignoredAt, ...updates } = req.body || {};
  plans[idx] = { ...plans[idx], ...updates, id: req.params.id };
  writeLicensePlans(plans);
  res.json(plans[idx]);
});

// Delete a plan
app.delete("/api/license-plans/:id", planLimiter, (req, res) => {
  const plans = readLicensePlans();
  const filtered = plans.filter(p => p.id !== req.params.id);
  if (filtered.length === plans.length) return res.status(404).json({ error: "Plan not found" });
  writeLicensePlans(filtered);
  res.json({ ok: true });
});

// Create Stripe checkout for a license plan purchase
app.post("/api/license-plans/:planId/checkout", planLimiter, async (req, res) => {
  const plans = readLicensePlans();
  const plan = plans.find(p => p.id === req.params.planId && p.active !== false);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const { buyerEmail, buyerName, successUrl, cancelUrl } = req.body || {};
  if (!buyerEmail || typeof buyerEmail !== "string" || !buyerEmail.trim()) {
    return res.status(400).json({ error: "buyerEmail is required" });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(400).json({ error: "Stripe not configured — add STRIPE_SECRET_KEY to your docker-compose.yml" });

  try {
    const Stripe = require("stripe");
    const stripe = Stripe(stripeKey);
    const origin = req.headers.origin || `http://localhost:${PORT}`;
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
      success_url: successUrl || `${origin}?plan_success=1`,
      cancel_url: cancelUrl || `${origin}?plan_cancelled=1`,
      metadata: {
        type: "license-plan",
        planId: plan.id,
        planName: plan.name,
        buyerEmail: buyerEmail.trim(),
        buyerName: buyerName || "",
        durationDays: String(plan.durationDays || 365),
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
  const plans = readLicensePlans();
  const plan = plans.find(p => p.id === req.params.planId && p.active !== false);
  if (!plan) return res.status(404).json({ error: "Plan not found" });
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
app.post("/api/license-plans/purchases/:purchaseId/activate", planLimiter, (req, res) => {
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
    return JSON.parse(fs.readFileSync(LICENSE_KEYS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeLicenseKeys(keys) {
  fs.writeFileSync(LICENSE_KEYS_FILE, JSON.stringify(keys, null, 2));
}

function readEventSlotRequests() {
  try {
    if (!fs.existsSync(EVENT_SLOT_REQUESTS_FILE)) return [];
    return JSON.parse(fs.readFileSync(EVENT_SLOT_REQUESTS_FILE, "utf-8"));
  } catch { return []; }
}

function writeEventSlotRequests(requests) {
  fs.writeFileSync(EVENT_SLOT_REQUESTS_FILE, JSON.stringify(requests, null, 2));
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
app.get("/api/license-keys", licenseKeyLimiter, (_req, res) => {
  res.json(readLicenseKeys());
});

// Generate a new key
app.post("/api/license-keys/generate", licenseKeyLimiter, (req, res) => {
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
  const { key, usedBy } = req.body || {};
  if (!key || typeof key !== "string") {
    return res.status(400).json({ ok: false, error: "key is required" });
  }
  const keys = readLicenseKeys();
  const idx = keys.findIndex(k => k.key === key.trim().toUpperCase());
  if (idx === -1) return res.status(404).json({ ok: false, error: "License key not found" });
  if (keys[idx].usedAt) return res.status(400).json({ ok: false, error: "License key already used" });
  if (keys[idx].expiresAt && new Date(keys[idx].expiresAt) < new Date()) {
    return res.status(400).json({ ok: false, error: "License key has expired" });
  }
  keys[idx] = { ...keys[idx], usedAt: new Date().toISOString(), ...(usedBy ? { usedBy } : {}) };
  writeLicenseKeys(keys);
  res.json({ ok: true });
});

// Revoke a key
app.delete("/api/license-keys/:key", licenseKeyLimiter, (req, res) => {
  const keys = readLicenseKeys();
  const keyStr = decodeURIComponent(req.params.key).trim().toUpperCase();
  const filtered = keys.filter(k => k.key !== keyStr);
  if (filtered.length === keys.length) return res.status(404).json({ ok: false, error: "Key not found" });
  writeLicenseKeys(filtered);
  res.json({ ok: true });
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
app.post("/api/tenant-setup/:token/complete", tenantSetupLimiter, (req, res) => {
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
  if (!passwordHash || typeof passwordHash !== "string") {
    return res.status(400).json({ error: "A password is required" });
  }

  // Verify the setup token
  const keys = readLicenseKeys();
  const keyIdx = keys.findIndex(k => k.setupToken === token);
  if (keyIdx === -1) return res.status(404).json({ error: "Setup link not found or already used" });
  const licKey = keys[keyIdx];
  if (licKey.usedAt) return res.status(410).json({ error: "This setup link has already been used" });
  if (licKey.expiresAt && new Date(licKey.expiresAt) < new Date()) {
    return res.status(410).json({ error: "This setup link has expired" });
  }

  // Check slug uniqueness
  const tenants = readTenants();
  if (tenants.find(t => t.slug === slug)) {
    return res.status(409).json({ error: "That URL slug is already taken — please choose another" });
  }

  // Create the tenant
  const tenant = {
    slug,
    displayName: displayName.trim(),
    email: (email || "").trim(),
    bio: (bio || "").trim() || undefined,
    timezone: timezone || "Australia/Sydney",
    licenseKey: licKey.key,
    passwordHash,
    active: true,
    createdAt: new Date().toISOString(),
  };
  tenants.push(tenant);
  writeTenants(tenants);

  // Activate the license key (mark as used)
  keys[keyIdx] = { ...licKey, usedAt: new Date().toISOString(), usedBy: slug };
  writeLicenseKeys(keys);

  res.json({ ok: true, tenant });
});

// ── Public album lookup (cross-store, used by gallery) ─────────────────────
app.get("/api/public-album/:albumSlug", (req, res) => {
  const { albumSlug } = req.params;
  const db = readDb();

  // Helper: find by slug or id in an array
  const findIn = (arr) => Array.isArray(arr) ? arr.find(a => a.slug === albumSlug || a.id === albumSlug) : null;

  // Check main albums first
  const mainRaw = db["wv_albums"];
  const main = mainRaw ? (typeof mainRaw === "string" ? JSON.parse(mainRaw) : mainRaw) : [];
  const mainAlbum = findIn(main);
  if (mainAlbum) {
    const album = { ...mainAlbum, photos: _stripBakedFromPhotos(mainAlbum.photos || []) };
    res.setHeader("Cache-Control", SHORT_CACHE);
    return res.json({ album, tenantSlug: null });
  }

  // Check all tenant album stores
  for (const key of Object.keys(db)) {
    if (!key.startsWith("t_") || !key.endsWith("_wv_albums")) continue;
    const tSlug = key.slice(2, key.length - "_wv_albums".length);
    const raw = db[key];
    const parsed = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : [];
    const found = findIn(parsed);
    if (found) {
      const album = { ...found, photos: _stripBakedFromPhotos(found.photos || []) };
      res.setHeader("Cache-Control", SHORT_CACHE);
      return res.json({ album, tenantSlug: tSlug });
    }
  }

  return res.status(404).json({ error: "Album not found" });
});

// ── Tenant storage size (files referenced by this tenant) ──────────────────
app.get("/api/tenant/:slug/storage-stats", tenantLimiter, (req, res) => {
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

  let totalBytes = 0;
  let fileCount = 0;
  for (const fn of knownFiles) {
    try {
      const stat = fs.statSync(path.join(UPLOADS_DIR, fn));
      totalBytes += stat.size;
      fileCount++;
    } catch {}
  }

  res.json({ ok: true, totalBytes, fileCount, albumCount: Array.isArray(albums) ? albums.length : 0 });
});

// ── Serve React app ───────────────────────────────────
const distPath = path.join(__dirname, "../dist");
// Hashed assets (JS/CSS chunks) are immutable — cache aggressively.
// index.html must always be re-fetched so the browser picks up new chunk names.
app.use(
  express.static(distPath, {
    setHeaders(res, filePath) {
      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      } else if (/\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico|webp)$/.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  })
);
app.get("*", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 PhotoFlow running on port ${PORT}`);
  console.log(`📁 Data directory: ${DATA_DIR}`);
  console.log(`🖼️  Uploads directory: ${UPLOADS_DIR}`);
});
