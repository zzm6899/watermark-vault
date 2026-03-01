const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { registerRoutes: registerGoogleCalendarRoutes } = require("./google-calendar");
const { registerRoutes: registerEmailRoutes } = require("./email");

const app = express();
const PORT = process.env.PORT || 5066;
const DATA_DIR = process.env.DATA_DIR || "/data";
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");

// Ensure directories exist
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Initialize DB file if not exists
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({}));
}

function readDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// ── Health check ──────────────────────────────────────
app.get("/api/health", (_req, res) => {
  const usage = getStorageUsage();
  res.json({ ok: true, storage: usage });
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

  // Try to get disk-level stats for the volume
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
    photoFiles: photoFiles.sort((a, b) => b.size - a.size).slice(0, 50), // top 50 by size
    disk: diskStats,
    dataDir: DATA_DIR,
  };
}

// ── Storage stats endpoint ────────────────────────────
app.get("/api/storage", (_req, res) => {
  res.json(getStorageUsage());
});

// ── Key-Value Store (mirrors localStorage) ────────────
// Get all data
app.get("/api/store", (_req, res) => {
  res.json(readDb());
});

// Get single key
app.get("/api/store/:key", (req, res) => {
  const db = readDb();
  res.json({ value: db[req.params.key] ?? null });
});

// Set single key
app.put("/api/store/:key", (req, res) => {
  const db = readDb();
  db[req.params.key] = req.body.value;
  writeDb(db);
  res.json({ ok: true });
});

// Delete single key
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
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per file
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
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
  const safeName = path.basename(req.params.filename); // prevent path traversal
  const filepath = path.join(UPLOADS_DIR, safeName);
  try {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete file" });
  }
});

// ── Google Calendar Integration ───────────────────────
registerGoogleCalendarRoutes(app);

// ── Email (SMTP) Integration ─────────────────────────
registerEmailRoutes(app);

// ── Serve uploaded photos ─────────────────────────────
app.use("/uploads", express.static(UPLOADS_DIR, { maxAge: "7d" }));

// ── Serve React app ───────────────────────────────────
const distPath = path.join(__dirname, "../dist");
app.use(express.static(distPath));
app.get("*", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

// ── Start ─────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🔒 Watermark Vault running on port ${PORT}`);
  console.log(`📁 Data directory: ${DATA_DIR}`);
  console.log(`🖼️  Uploads directory: ${UPLOADS_DIR}`);
});
