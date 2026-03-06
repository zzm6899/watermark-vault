const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const { registerRoutes: registerGoogleCalendarRoutes } = require("./google-calendar");
const { registerRoutes: registerEmailRoutes } = require("./email");
const { registerRoutes: registerStripeRoutes } = require("./stripe");

const app = express();
const PORT = process.env.PORT || 5066;
const DATA_DIR = process.env.DATA_DIR || "/data";
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({}));

function readDb() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf-8")); } catch { return {}; }
}
function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

app.use(cors());
app.use(express.json({ limit: "50mb" }));

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
    // If full album unlocked
    if (album.allUnlocked) return true;

    const photo = album.photos?.find(p => p.url && p.url.includes(filename));
    if (!photo) return false;

    // Check per-photo paid status
    if (photo.paid) return true;

    // Check session-level free downloads
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

app.get("/uploads/:filename", async (req, res) => {
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
      res.set({
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=7200",
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
    try { fs.writeFileSync(cacheFile, result); } catch { /* non-critical */ }

    res.set({
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=7200",
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
function clearImageCache() {
  const cacheDir = path.join(UPLOADS_DIR, "_cache");
  if (fs.existsSync(cacheDir)) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.mkdirSync(cacheDir, { recursive: true });
  }
}

app.post("/api/cache/clear", (_req, res) => {
  clearImageCache();
  res.json({ ok: true });
});

// ── Delete ALL uploaded photos from disk ───────────────
app.delete("/api/upload/all", async (req, res) => {
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

// ── Integrations ──────────────────────────────────────
registerGoogleCalendarRoutes(app);
registerEmailRoutes(app);
registerStripeRoutes(app);

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
