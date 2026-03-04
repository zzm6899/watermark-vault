const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { registerRoutes: registerGoogleCalendarRoutes } = require("./google-calendar");
const { registerRoutes: registerGoogleSheetsRoutes } = require("./google-sheets");
const { registerRoutes: registerEmailRoutes, getTransporter, getFromAddress } = require("./email");
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

// ── Magic link token verify ───────────────────────────────
// Called by AlbumDetail on load when ?token= is in the URL.
// Returns the album if the token matches — grants access without PIN.
app.get("/api/album-token/:albumId", (req, res) => {
  const { albumId } = req.params;
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Missing token" });
  const db = readDb();
  const albums = JSON.parse(db["wv_albums"] || "[]");
  const album = albums.find(a => a.id === albumId);
  if (!album) return res.status(404).json({ error: "Album not found" });
  try {
    if (album.clientToken && album.clientToken === token) {
      return res.json({ valid: true });
    }
    return res.status(403).json({ valid: false, error: "Invalid token" });
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

// ── Client portal — send magic links for all albums by email ─
// Client enters their email → we look up all albums with that email
// and send them a personalised link to each one.
app.post("/api/client-portal/request", async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes("@")) return res.status(400).json({ error: "Invalid email" });

  const db = readDb();
  // Find all albums belonging to this email
  const matchingAlbums = [];
  for (const key of Object.keys(db)) {
    if (!key.startsWith("album_")) continue;
    try {
      const album = JSON.parse(db[key]);
      if (album.clientEmail?.toLowerCase() === email.toLowerCase() && album.enabled !== false) {
        // Generate or reuse token
        if (!album.clientToken) {
          album.clientToken = `ct-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          db[key] = JSON.stringify(album);
        }
        matchingAlbums.push({ id: album.id, slug: album.slug, title: album.title, date: album.date, photoCount: album.photos?.length || 0, proofingStage: album.proofingStage, clientToken: album.clientToken });
      }
    } catch {}
  }

  if (matchingAlbums.length > 0) {
    writeDb(db);
  }

  // Always respond the same way to prevent email enumeration
  res.json({ ok: true, count: matchingAlbums.length });

  // Send email if we found albums
  if (matchingAlbums.length === 0) return;

  const origin = process.env.APP_URL || `http://localhost:${process.env.PORT || 5066}`;
  const albumLinks = matchingAlbums.map(a => {
    const url = `${origin}/gallery/${a.slug}?token=${a.clientToken}`;
    const stage = a.proofingStage === "proofing" ? " 🌟 <strong>Proofing ready — your picks needed!</strong>" :
                  a.proofingStage === "finals-delivered" ? " ✨ Finals ready" : "";
    return `<div style="margin-bottom:16px;padding:16px;background:#1a1a1a;border-radius:8px;border:1px solid #2a2a2a;">
      <p style="margin:0 0 4px;font-size:15px;color:#e5e7eb;font-weight:600;">${a.title}${stage}</p>
      <p style="margin:0 0 12px;font-size:12px;color:#6b7280;">${a.date} · ${a.photoCount} photos</p>
      <a href="${url}" style="display:inline-block;background:#7c3aed;color:#fff;padding:8px 18px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">View Gallery →</a>
    </div>`;
  }).join("");

  try {
    await fetch(`http://localhost:${process.env.PORT || 5066}/api/email/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: email,
        subject: `Your photo galleries (${matchingAlbums.length} album${matchingAlbums.length !== 1 ? "s" : ""})`,
        html: `<div style="font-family:sans-serif;max-width:560px;margin:40px auto;background:#111;border-radius:16px;padding:32px;color:#e5e7eb;border:1px solid #1f1f1f;">
          <h2 style="margin:0 0 8px;font-size:20px;">Your photo galleries</h2>
          <p style="color:#6b7280;margin:0 0 24px;font-size:14px;">Here are your personal links. Each link gives you direct access — no password needed.</p>
          ${albumLinks}
          <p style="color:#374151;margin-top:24px;font-size:11px;">These links are personal to you. If you didn't request this email, you can ignore it.</p>
        </div>`,
      }),
    }).catch(() => {});
  } catch {}
});

// ── Waitlist ──────────────────────────────────────────────────
// POST /api/waitlist/join — client joins waitlist for an event type + date
app.post("/api/waitlist/join", (req, res) => {
  const { eventTypeId, eventTypeTitle, date, clientName, clientEmail, note } = req.body;
  if (!eventTypeId || !date || !clientName || !clientEmail) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  const db = readDb();
  const listRaw = db["wv_waitlist"];
  const list = listRaw ? JSON.parse(listRaw) : [];

  // Prevent duplicate entries for same person + event + date
  const exists = list.some(e =>
    e.eventTypeId === eventTypeId &&
    e.date === date &&
    e.clientEmail.toLowerCase() === clientEmail.toLowerCase()
  );
  if (exists) return res.json({ ok: true, duplicate: true });

  const entry = {
    id: `wl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    eventTypeId, eventTypeTitle: eventTypeTitle || "", date,
    clientName, clientEmail, note: note || "",
    createdAt: new Date().toISOString(),
  };
  list.push(entry);
  db["wv_waitlist"] = JSON.stringify(list);
  writeDb(db);
  res.json({ ok: true });
});

// GET /api/waitlist — admin fetches all waitlist entries
app.get("/api/waitlist", (_req, res) => {
  const db = readDb();
  const listRaw = db["wv_waitlist"];
  res.json({ entries: listRaw ? JSON.parse(listRaw) : [] });
});

// DELETE /api/waitlist/:id — admin removes one entry
app.delete("/api/waitlist/:id", (req, res) => {
  const db = readDb();
  const list = db["wv_waitlist"] ? JSON.parse(db["wv_waitlist"]) : [];
  db["wv_waitlist"] = JSON.stringify(list.filter(e => e.id !== req.params.id));
  writeDb(db);
  res.json({ ok: true });
});

// Internal helper — called when a booking is cancelled
// Finds waitlist entries for that event type + date and sends them a slot-opened email
async function notifyWaitlistOnCancellation(cancelledBooking) {
  const db = readDb();
  const listRaw = db["wv_waitlist"];
  if (!listRaw) return;
  const list = JSON.parse(listRaw);
  const dateStr = cancelledBooking.date;
  const eventTypeId = cancelledBooking.eventTypeId;

  const toNotify = list.filter(e =>
    e.eventTypeId === eventTypeId &&
    e.date === dateStr &&
    !e.notifiedAt
  );
  if (!toNotify.length) return;

  const settings = db["wv_settings"] ? JSON.parse(db["wv_settings"]) : {};
  const origin = process.env.APP_URL || `http://localhost:${process.env.PORT || 5066}`;
  const bookingUrl = origin + "/";

  for (const entry of toNotify) {
    try {
      const formattedDate = new Date(dateStr + "T12:00:00").toLocaleDateString("en-AU", {
        weekday: "long", day: "numeric", month: "long",
      });
      await fetch(`http://localhost:${process.env.PORT || 5066}/api/email/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: entry.clientEmail,
          subject: `📸 A spot just opened up — ${entry.eventTypeTitle || "Session"} on ${formattedDate}`,
          html: `<div style="font-family:sans-serif;max-width:560px;margin:40px auto;background:#111;border-radius:16px;padding:32px;color:#e5e7eb;border:1px solid #1f1f1f;">
            <h2 style="margin:0 0 16px;font-size:20px;">Good news, ${entry.clientName?.split(" ")[0] || "there"}! 🎉</h2>
            <p style="color:#9ca3af;margin:0 0 12px;">A spot has just opened up for <strong style="color:#e5e7eb;">${entry.eventTypeTitle || "your requested session"}</strong> on <strong style="color:#e5e7eb;">${formattedDate}</strong>.</p>
            <p style="color:#9ca3af;margin:0 0 20px;">Spots go fast — click below to book before it's taken.</p>
            <a href="${bookingUrl}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Book Now →</a>
            <p style="color:#374151;margin-top:24px;font-size:11px;">You received this because you joined the waitlist. If you're no longer interested, simply ignore this email.</p>
          </div>`,
        }),
      });
      // Mark as notified
      entry.notifiedAt = new Date().toISOString();
      console.log(`📧 Waitlist notification sent to ${entry.clientEmail} for ${eventTypeId} on ${dateStr}`);
    } catch (e) {
      console.error("Waitlist notify error:", e.message);
    }
  }

  // Persist notifiedAt updates
  const updatedList = list.map(e => toNotify.find(n => n.id === e.id) || e);
  db["wv_waitlist"] = JSON.stringify(updatedList);
  writeDb(db);

  // Discord notification if configured
  if (settings.discordWebhookUrl && toNotify.length > 0) {
    const names = toNotify.map(e => e.clientName).join(", ");
    fetch(settings.discordWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: "📋 Waitlist notified",
          description: `Cancellation opened a slot for **${cancelledBooking.type || "Session"}** on **${dateStr}**. Notified ${toNotify.length} person${toNotify.length !== 1 ? "s" : ""}: ${names}`,
          color: 0x10b981,
          timestamp: new Date().toISOString(),
        }],
      }),
    }).catch(() => {});
  }
}

// Hook into the store PUT to detect booking cancellations and trigger waitlist
// We intercept wv_bookings writes and compare status changes
const _originalPut = app._router.stack.find(l => l.route?.path === "/api/store/:key" && l.route?.methods?.put);

app.put("/api/store/:key/waitlist-hook", async (req, res, next) => { next(); });

// Override the store PUT to also check for cancellations
app.post("/api/booking/cancel-notify", async (req, res) => {
  const { booking } = req.body;
  if (!booking) return res.status(400).json({ error: "Missing booking" });
  try {
    await notifyWaitlistOnCancellation(booking);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Proofing — client submits selections ─────────────────────
// No auth needed — album slug acts as the access token.
// Writes selected photo IDs into the latest proofing round and
// sends an email notification to the photographer.
app.post("/api/proofing/submit", async (req, res) => {
  const { albumId, selectedPhotoIds, clientNote } = req.body;
  if (!albumId || !Array.isArray(selectedPhotoIds)) {
    return res.status(400).json({ error: "Missing albumId or selectedPhotoIds" });
  }
  const db = readDb();
  const albums = JSON.parse(db["wv_albums"] || "[]");
  const albumIdx = albums.findIndex(a => a.id === albumId);
  if (albumIdx === -1) return res.status(404).json({ error: "Album not found" });

  try {
    const album = albums[albumIdx];
    const rounds = album.proofingRounds || [];
    const latest = rounds[rounds.length - 1];
    if (!latest) return res.status(400).json({ error: "No active proofing round" });
    if (album.proofingStage !== "proofing") {
      return res.status(400).json({ error: "Album is not in proofing stage" });
    }

    // Write selections into the current round
    latest.submittedAt = new Date().toISOString();
    latest.selectedPhotoIds = selectedPhotoIds;
    if (clientNote) latest.clientNote = clientNote;
    album.proofingStage = "selections-submitted";
    albums[albumIdx] = album;
    db["wv_albums"] = JSON.stringify(albums);
    writeDb(db);

    // Notify photographer via email if SMTP is configured
    try {
      const adminRaw = db["wv_admin"];
      const adminEmail = adminRaw ? JSON.parse(adminRaw)?.email : null;
      const notifyEmail = adminEmail || process.env.NOTIFY_EMAIL;
      const transporter = getTransporter();
      if (notifyEmail && transporter) {
        await transporter.sendMail({
          from: getFromAddress(),
          to: notifyEmail,
          subject: `📸 ${album.clientName || "Client"} submitted proofing picks — ${album.title}`,
          html: `<div style="font-family:sans-serif;max-width:560px;margin:40px auto;background:#111;border-radius:16px;padding:32px;color:#e5e7eb;border:1px solid #1f1f1f;">
            <h2 style="margin:0 0 16px;font-size:20px;">New Proofing Selections</h2>
            <p style="color:#9ca3af;margin:0 0 12px;"><strong style="color:#e5e7eb;">${album.clientName || "Client"}</strong> has submitted their picks for <strong style="color:#e5e7eb;">${album.title}</strong>.</p>
            <p style="color:#9ca3af;margin:0 0 20px;">They selected <strong style="color:#a78bfa;">${selectedPhotoIds.length} photo${selectedPhotoIds.length !== 1 ? "s" : ""}</strong> out of ${album.photos?.length || "?"} total.${clientNote ? `<br>Client note: <em>"${clientNote}"</em>` : ""}</p>
            <a href="${process.env.APP_URL || ""}/admin" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Review in Admin →</a>
          </div>`,
        }).catch(() => {});
      }
    } catch {}

    // Also send Discord webhook if configured — rich embed
    try {
      const settingsRaw = db["wv_settings"];
      const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
      if (settings.discordWebhookUrl) {
        const adminUrl = `${process.env.APP_URL || ""}/admin`;
        const fields = [
          { name: "Album", value: album.title || "—", inline: true },
          { name: "Client", value: album.clientName || "—", inline: true },
          { name: "Photos selected", value: `${selectedPhotoIds.length} of ${album.photos?.length || "?"}`, inline: true },
        ];
        if (clientNote) fields.push({ name: "Client note", value: `"${clientNote}"`, inline: false });
        await fetch(settings.discordWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            embeds: [{
              title: "📸 Proofing picks submitted",
              description: `**${album.clientName || "Client"}** has submitted their selections for **${album.title}**.`,
              color: 0xf59e0b, // amber
              fields,
              footer: { text: "Watermark Vault · Proofing" },
              timestamp: new Date().toISOString(),
            }],
            components: [{
              type: 1,
              components: [{
                type: 2,
                style: 5,
                label: "Review in Admin",
                url: adminUrl,
              }],
            }],
          }),
        }).catch(() => {});
      }
    } catch {}

    res.json({ ok: true });
  } catch (err) {
    console.error("Proofing submit error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Google Calendar Integration ───────────────────────
registerGoogleCalendarRoutes(app);
registerGoogleSheetsRoutes(app);

// ── Email (SMTP) Integration ─────────────────────────
registerEmailRoutes(app);

// ── Stripe Payments ──────────────────────────────────
registerStripeRoutes(app);

// ── Serve uploaded photos ─────────────────────────────
app.use("/uploads", express.static(UPLOADS_DIR, { maxAge: "7d" }));

// ── Serve React app ───────────────────────────────────
const distPath = path.join(__dirname, "../dist");
app.use(express.static(distPath));
app.get("*", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

// ── Booking reminders ────────────────────────────────────────
// Runs every hour. Sends an email reminder at ~24h and ~1h before each session.
// Uses a "remindersSent" field on each booking to avoid duplicate sends.
async function sendBookingReminders() {
  const db = readDb();
  const bookingsRaw = db["wv_bookings"];
  const settingsRaw = db["wv_settings"];
  if (!bookingsRaw) return;

  let bookings;
  try { bookings = JSON.parse(bookingsRaw); } catch { return; }

  const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
  const now = Date.now();
  let changed = false;

  // Load saved email templates (keyed by name for easy lookup)
  let emailTemplates = [];
  try {
    const tplRaw = db["wv_email_templates"];
    if (tplRaw) emailTemplates = JSON.parse(tplRaw);
  } catch {}

  // Find a template whose name contains "reminder" (case-insensitive), fallback to null
  const reminderTemplate = emailTemplates.find(t =>
    t.name?.toLowerCase().includes("reminder")
  ) || null;

  // Default fallback subject/body if no template found
  const DEFAULT_SUBJECT = "📸 Reminder: your session is {label} — {type}";
  const DEFAULT_HTML = `<div style="font-family:sans-serif;max-width:560px;margin:40px auto;background:#111;border-radius:16px;padding:32px;color:#e5e7eb;border:1px solid #1f1f1f;">
    <h2 style="margin:0 0 16px;font-size:20px;">See you {label}! 📸</h2>
    <p style="color:#9ca3af;margin:0 0 8px;">Hi {name},</p>
    <p style="color:#9ca3af;margin:0 0 20px;">Just a reminder about your upcoming session:</p>
    <div style="background:#1a1a1a;border-radius:8px;padding:16px;margin-bottom:20px;">
      <p style="margin:0 0 6px;font-size:14px;color:#e5e7eb;font-weight:600;">{type}</p>
      <p style="margin:0 0 4px;font-size:13px;color:#9ca3af;">📅 {date}</p>
      <p style="margin:0;font-size:13px;color:#9ca3af;">⏱ {duration}</p>
    </div>
    {reschedule_link}
  </div>`;

  for (const bk of bookings) {
    if (!bk.clientEmail) continue;
    if (bk.status === "cancelled" || bk.status === "completed") continue;
    if (!bk.date || !bk.time) continue;

    const sessionMs = new Date(`${bk.date}T${bk.time}:00`).getTime();
    if (isNaN(sessionMs)) continue;

    const minsUntil = (sessionMs - now) / 60000;
    const sent = bk.remindersSent || {};

    const reminders = [
      { key: "24h", minLow: 23 * 60, minHigh: 25 * 60, label: "tomorrow" },
      { key: "1h",  minLow: 45,      minHigh: 75,       label: "in 1 hour" },
    ];

    for (const { key, minLow, minHigh, label } of reminders) {
      if (sent[key]) continue;
      if (minsUntil < minLow || minsUntil > minHigh) continue;

      sent[key] = new Date().toISOString();
      bk.remindersSent = sent;
      changed = true;

      const sessionDate = new Date(`${bk.date}T${bk.time}:00`).toLocaleString("en-AU", {
        weekday: "long", day: "numeric", month: "long",
        hour: "numeric", minute: "2-digit", hour12: true,
      });

      const rescheduleHtml = bk.modifyToken
        ? `<a href="${process.env.APP_URL || ""}/booking/modify/${bk.modifyToken}" style="display:inline-block;background:#1f1f1f;color:#9ca3af;border:1px solid #2a2a2a;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;">Need to reschedule?</a>`
        : "";

      // Token replacements — available in both template and default
      const replacements = {
        "{name}":           bk.clientName || "there",
        "{label}":          label,
        "{type}":           bk.type || "Photography Session",
        "{date}":           sessionDate,
        "{duration}":       bk.duration ? `${bk.duration} minutes` : "",
        "{reschedule_link}": rescheduleHtml,
        "{link}":           bk.modifyToken ? `${process.env.APP_URL || ""}/booking/modify/${bk.modifyToken}` : "",
      };

      const applyTokens = (str) => Object.entries(replacements).reduce((s, [k, v]) => s.replaceAll(k, v), str);

      // Build subject and html — use saved template if found, otherwise use defaults
      let subject, html;
      if (reminderTemplate) {
        subject = applyTokens(reminderTemplate.subject || DEFAULT_SUBJECT);
        // Template body is plain text — wrap it in the styled email container
        const bodyText = applyTokens(reminderTemplate.body || "");
        html = `<div style="font-family:sans-serif;max-width:560px;margin:40px auto;background:#111;border-radius:16px;padding:32px;color:#e5e7eb;border:1px solid #1f1f1f;">
          <p style="color:#9ca3af;white-space:pre-line;line-height:1.7;">${bodyText.replace(/\n/g, "<br>")}</p>
          ${rescheduleHtml ? `<div style="margin-top:20px;">${rescheduleHtml}</div>` : ""}
        </div>`;
      } else {
        subject = applyTokens(DEFAULT_SUBJECT);
        html = applyTokens(DEFAULT_HTML);
      }

      try {
        await fetch(`http://localhost:${PORT}/api/email/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: bk.clientEmail, subject, html }),
        });
        console.log(`📧 ${key} reminder sent to ${bk.clientEmail} for booking ${bk.id}${reminderTemplate ? " (using template)" : " (using default)"}`);
      } catch (e) {
        console.error(`Failed to send ${key} reminder for ${bk.id}:`, e.message);
      }
    }
  }

  if (changed) {
    db["wv_bookings"] = JSON.stringify(bookings);
    writeDb(db);
  }
}

// Run once on startup (catches any missed reminders after a restart), then every hour
setTimeout(sendBookingReminders, 30000); // 30s delay so SMTP is ready
setInterval(sendBookingReminders, 60 * 60 * 1000);

// ── Start ─────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🔒 Watermark Vault running on port ${PORT}`);
  console.log(`📁 Data directory: ${DATA_DIR}`);
  console.log(`🖼️  Uploads directory: ${UPLOADS_DIR}`);
});
