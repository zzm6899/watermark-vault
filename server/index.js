const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const archiver = require("archiver");
const rateLimit = require("express-rate-limit");
const { registerRoutes: registerGoogleCalendarRoutes } = require("./google-calendar");
const { registerRoutes: registerEmailRoutes } = require("./email");
const { registerRoutes: registerStripeRoutes } = require("./stripe");
const { registerRoutes: registerGoogleSheetsRoutes } = require("./google-sheets");
const {
  sendDiscordEmbed,
  notifyNewBooking,
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

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({}));

// ── In-memory DB cache (avoids disk reads on every request) ──
let _dbCache = null;
let _dbCacheTime = 0;
const DB_CACHE_TTL = 5000; // 5 seconds

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
function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  // Invalidate cache immediately so the next read reflects the new data
  _dbCache = data;
  _dbCacheTime = Date.now();
}

app.use(cors());
// Skip JSON body parsing for the Stripe webhook route — it requires the raw Buffer for
// signature verification.  The route itself applies express.raw() instead.
app.use((req, res, next) => {
  if (req.path === "/api/stripe/webhook") return next();
  express.json({ limit: "50mb" })(req, res, next);
});

// ── Health check ──────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, storage: getStorageUsage() });
});

function getStorageUsage() {
  let totalBytes = 0;
  let photoFiles = [];
  try {
    const dbSize = fs.statSync(DB_FILE).size;
    totalBytes += dbSize;
    const files = fs.readdirSync(UPLOADS_DIR);
    for (const f of files) {
      try {
        const stat = fs.statSync(path.join(UPLOADS_DIR, f));
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

// ── Key-Value Store ────────────────────────────────────
app.get("/api/store", (_req, res) => res.json(readDb()));
app.get("/api/store/:key", (req, res) => {
  const db = readDb();
  res.json({ value: db[req.params.key] ?? null });
});
app.put("/api/store/:key", (req, res) => {
  const db = readDb();
  db[req.params.key] = req.body.value;
  writeDb(db);
  res.json({ ok: true });
});
app.delete("/api/store/:key", (req, res) => {
  const db = readDb();
  delete db[req.params.key];
  writeDb(db);
  res.json({ ok: true });
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

app.post("/api/upload", upload.array("photos", 100), (req, res) => {
  const files = (req.files || []).map((f) => ({
    id: path.basename(f.filename, path.extname(f.filename)),
    url: `/uploads/${f.filename}`,
    originalName: f.originalname,
    size: f.size,
  }));
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
function getWatermarkSettings() {
  try {
    const db = readDb();
    const settings = db["wv_settings"];
    const parsed = typeof settings === "string" ? JSON.parse(settings) : settings;
    return {
      text: parsed?.watermarkText || "ZAC MORGAN PHOTOGRAPHY",
      opacity: Math.min(1, Math.max(0, (parsed?.watermarkOpacity ?? 20) / 100)),
      position: parsed?.watermarkPosition || "tiled",
      imageBase64: parsed?.watermarkImage || null, // base64 data URL
      size: parsed?.watermarkSize ?? 40,
    };
  } catch {
    return { text: "ZAC MORGAN PHOTOGRAPHY", opacity: 0.2, position: "tiled", imageBase64: null, size: 40 };
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
function isPhotoAccessible(filename, sessionKey, albumId) {
  try {
    const db = readDb();
    const albums = db["wv_albums"];
    const parsed = typeof albums === "string" ? JSON.parse(albums) : albums;
    if (!Array.isArray(parsed)) return false;

    const album = parsed.find(a => a.id === albumId);
    if (!album) return false;

    // If purchasing is disabled, all photos are free
    if (album.purchasingDisabled) return true;
    // If full album unlocked by admin
    if (album.allUnlocked) return true;

    // Session-level full-album purchase (Stripe / bank transfer)
    const sessionPurchase = album.sessionPurchases?.[sessionKey];
    if (sessionPurchase?.fullAlbum === true) return true;

    const photo = album.photos?.find(p => {
      const url = p.url || p.src || "";
      return url.includes(filename);
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

    // Check free remaining — first N photos in album are free
    const freeRemaining = typeof album.freeDownloads === "number" ? album.freeDownloads : 5;
    const photoIndex = album.photos.indexOf(photo);
    if (photoIndex >= 0 && photoIndex < freeRemaining) return true;

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

function getCacheFilename(baseName, sizeLabel, watermarked) {
  return `${baseName}_${sizeLabel}_${watermarked ? "wm" : "clean"}.jpg`;
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
  const cacheFile = path.join(cacheDir, getCacheFilename(baseName, sizeLabel, shouldWatermark));

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
      const wm = getWatermarkSettings();
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
  const safeName = path.basename(req.params.filename);
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
    const safeName = path.basename(filename);
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
        title: "✅ Watermark Vault — Connection Test",
        color: 0x7c3aed,
        description: "Your Discord webhook is connected and working correctly.",
        fields: [
          { name: "Status", value: "✅ Connected", inline: true },
          { name: "Service", value: "Watermark Vault", inline: true },
        ],
        footer: { text: "Watermark Vault · Discord Integration" },
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
  const settings = db["wv_settings"];
  const parsed = typeof settings === "string" ? JSON.parse(settings) : (settings || {});
  const webhookUrl = parsed?.discordWebhookUrl;
  if (!webhookUrl) return res.json({ ok: true, skipped: true });

  const { event, type, booking, album, payment, photoCount, clientNote } = req.body || {};
  const eventType = event || type;

  try {
    switch (eventType) {
      case "new-booking":
        if (parsed?.discordNotifyBookings !== false && booking) await notifyNewBooking(webhookUrl, booking);
        break;
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

// ── Proofing submission endpoint ──────────────────────
app.post("/api/proofing/submit", async (req, res) => {
  const { albumId, selectedPhotoIds, clientNote } = req.body || {};
  if (!albumId || !Array.isArray(selectedPhotoIds)) {
    return res.status(400).json({ ok: false, error: "albumId and selectedPhotoIds required" });
  }
  try {
    const db = readDb();
    const albums = db["wv_albums"];
    const parsed = typeof albums === "string" ? JSON.parse(albums) : (Array.isArray(albums) ? albums : []);
    const idx = parsed.findIndex(a => a.id === albumId);
    if (idx === -1) return res.status(404).json({ ok: false, error: "Album not found" });

    const album = parsed[idx];

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
    db["wv_albums"] = JSON.stringify(parsed);
    writeDb(db);

    // Fire discord notification if configured
    const settings = db["wv_settings"];
    const settingsParsed = typeof settings === "string" ? JSON.parse(settings) : (settings || {});
    if (settingsParsed?.discordWebhookUrl && settingsParsed?.discordNotifyProofing !== false) {
      notifyProofingSubmission(settingsParsed.discordWebhookUrl, updatedAlbum, selectedPhotoIds.length, clientNote).catch(() => {});
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
registerGoogleSheetsRoutes(app);

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

// ── Serve React app ───────────────────────────────────
const distPath = path.join(__dirname, "../dist");
app.use(express.static(distPath));
app.get("*", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🔒 Watermark Vault running on port ${PORT}`);
  console.log(`📁 Data directory: ${DATA_DIR}`);
  console.log(`🖼️  Uploads directory: ${UPLOADS_DIR}`);
});
