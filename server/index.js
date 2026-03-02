const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { registerRoutes: registerGoogleCalendarRoutes, autoSyncBooking } = require("./google-calendar");
const { notifyNewBooking, notifyBookingUpdate } = require("./discord");
const { registerRoutes: registerEmailRoutes, sendBookingConfirmationEmail } = require("./email");
const { registerRoutes: registerStripeRoutes } = require("./stripe");

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

function parseStoredValue(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return raw; } }
  return raw; // already parsed by express.json
}

function getDiscordWebhookUrl() {
  try {
    const db = readDb();
    const settings = parseStoredValue(db["wv_settings"]);
    return settings?.discordWebhookUrl || null;
  } catch { return null; }
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

// ── Store interface (passed to route modules that need DB access) ──
const store = {
  get: (key) => {
    const db = readDb();
    const val = db[key];
    if (val === undefined || val === null) return null;
    try { return JSON.parse(val); } catch { return val; }
  },
  set: (key, value) => {
    const db = readDb();
    db[key] = JSON.stringify(value);
    writeDb(db);
  },
};

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
  const key = req.params.key;
  const db = readDb();
  const oldValue = db[key];
  db[key] = req.body.value;
  writeDb(db);
  res.json({ ok: true });

  // Fire Discord notifications for booking changes (fire-and-forget)
  if (key === "wv_bookings") {
    try {
      // req.body.value may be already-parsed array (express.json middleware) or a string
      const newBookings = parseStoredValue(req.body.value) || [];
      const oldBookings = parseStoredValue(oldValue) || [];
      if (Array.isArray(newBookings) && newBookings.length > 0) {
        const oldMap = Object.fromEntries(oldBookings.map(b => [b.id, b]));
        const webhookUrl = getDiscordWebhookUrl();
        if (webhookUrl) {
          for (const booking of newBookings) {
            if (!oldMap[booking.id]) {
              notifyNewBooking(webhookUrl, booking).catch(() => {});
            } else if (oldMap[booking.id].status !== booking.status) {
              notifyBookingUpdate(webhookUrl, booking, oldMap[booking.id].status, booking.status).catch(() => {});
            }
          }
        }
      }
    } catch (e) {
      console.error("Discord notify error:", e.message);
    }
  }
});

// Delete single key
app.delete("/api/store/:key", (req, res) => {
  const db = readDb();
  delete db[req.params.key];
  writeDb(db);
  res.json({ ok: true });
});


// Discord webhook test
app.post("/api/discord/test", async (req, res) => {
  const { webhookUrl } = req.body;
  if (!webhookUrl || !webhookUrl.startsWith("https://discord.com/api/webhooks/")) {
    return res.status(400).json({ ok: false, error: "Invalid webhook URL" });
  }
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Watermark Vault",
        embeds: [{
          title: "✅ Webhook Connected",
          description: "Your Discord webhook is working correctly. You'll receive notifications here for new bookings, status changes, and payments.",
          color: 0x7c3aed,
          fields: [
            { name: "Events", value: "📸 New bookings\n💰 Payments received\n✅ Status changes", inline: true },
          ],
          footer: { text: "Watermark Vault · Test notification" },
          timestamp: new Date().toISOString(),
        }],
      }),
    });
    if (response.ok) {
      res.json({ ok: true });
    } else {
      const text = await response.text();
      res.status(response.status).json({ ok: false, error: text });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
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
registerEmailRoutes(app, store);

// ── Stripe Payments ──────────────────────────────────
registerStripeRoutes(app, store, sendBookingConfirmationEmail, autoSyncBooking);

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
