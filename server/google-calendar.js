/**
 * Google Calendar integration for Watermark Vault.
 * Two-way sync: push bookings to Calendar, pull busy times to block slots.
 */
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const TOKEN_FILE    = path.join(process.env.DATA_DIR || "/data", "google-tokens.json");
const SETTINGS_FILE = path.join(process.env.DATA_DIR || "/data", "gcal-settings.json");
const TZ = process.env.TZ || "Australia/Sydney";

// ── Credential helpers ────────────────────────────────────────
function getCredentials() {
  const raw = process.env.GOOGLE_API_CREDENTIALS;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function getOAuth2Client() {
  const creds = getCredentials();
  if (!creds?.web) return null;
  const { client_id, client_secret, redirect_uris } = creds.web;
  const redirectUri = redirect_uris?.find(u => u.includes("googlecalendar/callback")) || redirect_uris?.[0];
  return new google.auth.OAuth2(client_id, client_secret, redirectUri);
}

function loadTokens() {
  try { return fs.existsSync(TOKEN_FILE) ? JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8")) : null; }
  catch { return null; }
}
function saveTokens(tokens) { fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2)); }
function clearTokens() { try { if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE); } catch {} }

function getAuthenticatedClient() {
  const client = getOAuth2Client();
  if (!client) return null;
  const tokens = loadTokens();
  if (!tokens?.access_token) return null;
  client.setCredentials(tokens);
  client.on("tokens", t => saveTokens({ ...tokens, ...t }));
  return client;
}

// ── Calendar settings ─────────────────────────────────────────
function loadCalSettings() {
  try { return fs.existsSync(SETTINGS_FILE) ? JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")) : {}; }
  catch { return {}; }
}
function saveCalSettings(s) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...loadCalSettings(), ...s }, null, 2));
}

// ── Persist gcalEventId back to db.json ──────────────────────
function saveGcalEventId(bookingId, gcalEventId) {
  if (!bookingId || !gcalEventId) return;
  const fs = require("fs");
  const path = require("path");
  const DB_FILE = path.join(process.env.DATA_DIR || "/data", "db.json");
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    const raw = db.wv_bookings;
    const bookings = Array.isArray(raw) ? raw : (raw ? JSON.parse(raw) : []);
    const idx = bookings.findIndex(b => b.id === bookingId);
    if (idx >= 0 && bookings[idx].gcalEventId !== gcalEventId) {
      bookings[idx].gcalEventId = gcalEventId;
      db.wv_bookings = bookings; // keep as object, don't double-stringify
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    }
  } catch (e) {
    console.warn("saveGcalEventId failed:", e.message);
  }
}

// ── Event builder ─────────────────────────────────────────────
function buildEvent(booking) {
  // Build start/end as local ISO strings (no timezone offset suffix).
  // Google Calendar API interprets these as wall-clock time in the given timeZone field,
  // which is exactly what we want — no JS Date() parsing, no server-TZ issues.
  const startLocal = `${booking.date}T${booking.time}:00`;
  const [h, m] = booking.time.split(":").map(Number);
  const totalMins = h * 60 + m + (booking.duration || 60);
  const endH = String(Math.floor(totalMins / 60) % 24).padStart(2, "0");
  const endM = String(totalMins % 60).padStart(2, "0");
  // Handle sessions that cross midnight
  let endDate2 = booking.date;
  if (Math.floor(totalMins / 60) >= 24) {
    const d = new Date(`${booking.date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + Math.floor(Math.floor(totalMins / 60) / 24));
    endDate2 = d.toISOString().slice(0, 10);
  }
  const endLocal = `${endDate2}T${endH}:${endM}:00`;
  return {
    summary: `📸 ${booking.type || "Session"} — ${booking.clientName}`,
    description: [
      `Client: ${booking.clientName}`,
      booking.clientEmail     ? `Email: ${booking.clientEmail}`                              : "",
      booking.instagramHandle ? `Instagram: @${booking.instagramHandle.replace("@", "")}`   : "",
      `Duration: ${booking.duration || 60}min`,
      booking.notes           ? `Notes: ${booking.notes}`                                    : "",
      `Status: ${booking.status}`,
      booking.paymentAmount   ? `Amount: $${booking.paymentAmount}`                          : "",
      `\nRef: ${booking.id}`,
    ].filter(Boolean).join("\n"),
    start: { dateTime: startLocal, timeZone: TZ },
    end:   { dateTime: endLocal,   timeZone: TZ },
    colorId: booking.status === "confirmed" ? "2" : booking.status === "completed" ? "10" : "5",
    extendedProperties: { private: { watermarkVaultBookingId: booking.id } },
  };
}

// ── Routes ────────────────────────────────────────────────────
function registerRoutes(app) {

  // Status
  app.get("/api/integrations/googlecalendar/status", (_req, res) => {
    const tokens   = loadTokens();
    const settings = loadCalSettings();
    res.json({
      configured: !!getCredentials()?.web,
      connected:  !!tokens?.access_token,
      email:      tokens?.email || null,
      autoSync:   settings.autoSync  ?? false,
      calendarId: settings.calendarId || "primary",
    });
  });

  // Save settings
  app.post("/api/integrations/googlecalendar/settings", (req, res) => {
    saveCalSettings(req.body);
    res.json({ ok: true });
  });

  // Start OAuth
  app.get("/api/integrations/googlecalendar/auth", (_req, res) => {
    const client = getOAuth2Client();
    if (!client) return res.status(500).json({ error: "Google credentials not configured" });
    const url = client.generateAuthUrl({
      access_type: "offline", prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/spreadsheets",
      ],
    });
    res.json({ url });
  });

  // OAuth callback
  app.get("/api/integrations/googlecalendar/callback", async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send("Missing code");
    const client = getOAuth2Client();
    if (!client) return res.status(500).send("Not configured");
    try {
      const { tokens } = await client.getToken(code);
      client.setCredentials(tokens);
      const oauth2 = google.oauth2({ version: "v2", auth: client });
      tokens.email = (await oauth2.userinfo.get()).data.email;
      saveTokens(tokens);
      res.redirect("/admin/settings?gcal=connected");
    } catch (err) {
      console.error("Google OAuth error:", err);
      res.redirect("/admin/settings?gcal=error");
    }
  });

  // Disconnect
  app.post("/api/integrations/googlecalendar/disconnect", (_req, res) => {
    clearTokens(); res.json({ ok: true });
  });

  // List calendars
  app.get("/api/integrations/googlecalendar/calendars", async (_req, res) => {
    const auth = getAuthenticatedClient();
    if (!auth) return res.status(401).json({ error: "Not connected" });
    try {
      const { data } = await google.calendar({ version: "v3", auth }).calendarList.list();
      res.json({ calendars: data.items || [] });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── PULL: Busy times for a date ───────────────────────────────
  // Called by Booking.tsx when user selects a date.
  // Returns busy periods from ALL events (personal + bookings) so anything
  // already on the calendar blocks out those slots automatically.
  app.get("/api/integrations/googlecalendar/busy", async (req, res) => {
    const auth = getAuthenticatedClient();
    if (!auth) return res.json({ busy: [] }); // not connected — show all slots

    const { date, calendarId } = req.query;
    if (!date) return res.status(400).json({ error: "Missing date" });

    const settings = loadCalSettings();
    const calId = calendarId || settings.calendarId || "primary";

    const [y, mo, d] = date.split("-").map(Number);
    const dayStart = new Date(y, mo - 1, d, 0, 0, 0);
    const dayEnd   = new Date(y, mo - 1, d, 23, 59, 59);

    try {
      const { data } = await google.calendar({ version: "v3", auth }).freebusy.query({
        requestBody: {
          timeMin: dayStart.toISOString(),
          timeMax: dayEnd.toISOString(),
          timeZone: TZ,
          items: [{ id: calId }],
        },
      });
      res.json({ busy: data.calendars?.[calId]?.busy || [] });
    } catch (err) {
      console.error("Freebusy error:", err.message);
      res.json({ busy: [] }); // fail open — never break the booking page
    }
  });

  // ── PUSH: Create or update event for a single booking ─────────
  app.post("/api/integrations/googlecalendar/event", async (req, res) => {
    const auth = getAuthenticatedClient();
    if (!auth) return res.status(401).json({ error: "Not connected" });

    const { booking, calendarId } = req.body;
    if (!booking) return res.status(400).json({ error: "Missing booking" });

    const calId = calendarId || loadCalSettings().calendarId || "primary";
    const cal   = google.calendar({ version: "v3", auth });

    try {
      if (booking.gcalEventId) {
        // Already synced — update in place
        const { data } = await cal.events.update({
          calendarId: calId, eventId: booking.gcalEventId, requestBody: buildEvent(booking),
        });
        saveGcalEventId(booking.id, data.id);
        return res.json({ ok: true, eventId: data.id, updated: true });
      }
      const { data } = await cal.events.insert({ calendarId: calId, requestBody: buildEvent(booking) });
      // Persist gcalEventId back to db.json so future syncs can update instead of duplicate
      saveGcalEventId(booking.id, data.id);
      res.json({ ok: true, eventId: data.id, htmlLink: data.htmlLink });
    } catch (err) {
      console.error("Calendar event error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── PUSH: Update existing event (reschedule / status change) ──
  app.put("/api/integrations/googlecalendar/event/:eventId", async (req, res) => {
    const auth = getAuthenticatedClient();
    if (!auth) return res.status(401).json({ error: "Not connected" });
    const calId = req.body.calendarId || loadCalSettings().calendarId || "primary";
    try {
      const { data } = await google.calendar({ version: "v3", auth }).events.update({
        calendarId: calId, eventId: req.params.eventId, requestBody: buildEvent(req.body.booking),
      });
      res.json({ ok: true, eventId: data.id });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── PUSH: Delete event (booking cancelled) ────────────────────
  app.delete("/api/integrations/googlecalendar/event/:eventId", async (req, res) => {
    const auth = getAuthenticatedClient();
    if (!auth) return res.status(401).json({ error: "Not connected" });
    const calId = req.query.calendarId || loadCalSettings().calendarId || "primary";
    try {
      await google.calendar({ version: "v3", auth }).events.delete({ calendarId: calId, eventId: req.params.eventId });
      res.json({ ok: true });
    } catch (err) {
      if (err.code === 410 || err.status === 410) return res.json({ ok: true }); // already gone
      res.status(500).json({ error: err.message });
    }
  });

  // ── PUSH: Full sync — upsert active bookings, delete orphans ──
  // Strategy:
  //   1. List ALL events in a wide window (past 90d → future 2y)
  //   2. Any event whose summary contains "📸" and whose booking ref (in description)
  //      is not in our active bookings → delete it (orphan/cancelled)
  //   3. Also use extendedProperties tag (newer events) for more reliable matching
  //   4. Upsert all active bookings (create if new, update if existing event found)
  app.post("/api/integrations/googlecalendar/sync-all", async (req, res) => {
    const auth = getAuthenticatedClient();
    if (!auth) return res.status(401).json({ error: "Not connected" });

    const { bookings, calendarId } = req.body;
    if (!Array.isArray(bookings)) return res.status(400).json({ error: "Missing bookings" });

    const calId = calendarId || loadCalSettings().calendarId || "primary";
    const cal   = google.calendar({ version: "v3", auth });

    // Map of active booking IDs → booking object
    const activeBookingsById = {};
    for (const b of bookings) {
      if (b.status !== "cancelled") activeBookingsById[b.id] = b;
    }

    // Step 1: List all events in a wide window and find our events
    const existingEventIdByBookingId = {};
    let deletedOrphans = 0;
    let pageToken;
    const timeMin = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 days ago
    const timeMax = new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000).toISOString(); // 2 years ahead

    try {
      do {
        const { data } = await cal.events.list({
          calendarId: calId,
          timeMin,
          timeMax,
          pageToken,
          maxResults: 500,
          singleEvents: true,
          orderBy: "startTime",
        });

        for (const ev of data.items || []) {
          // Identify our events by:
          // a) extendedProperties tag (reliable, newer events)
          const taggedId = ev.extendedProperties?.private?.watermarkVaultBookingId;
          // b) "Ref: {bookingId}" in description (fallback for older events)
          const refMatch = ev.description?.match(/Ref:\s*([a-z0-9\-]+)/i);
          const refId = refMatch?.[1];
          // c) summary starts with 📸 (broad sweep for any we created)
          const isOurs = taggedId || refId || ev.summary?.startsWith("📸");

          if (!isOurs) continue; // personal event — leave it alone

          const bookingId = taggedId || refId;

          if (bookingId && activeBookingsById[bookingId]) {
            // Active booking — track for upsert
            existingEventIdByBookingId[bookingId] = ev.id;
          } else if (bookingId && !activeBookingsById[bookingId]) {
            // Orphan — booking cancelled or deleted
            try { await cal.events.delete({ calendarId: calId, eventId: ev.id }); deletedOrphans++; }
            catch (e) { if (e.code !== 410) console.warn("Delete orphan failed:", e.message); }
          } else if (!bookingId && ev.summary?.startsWith("📸")) {
            // Old-style event with no ID tag — delete it (will be recreated cleanly)
            try { await cal.events.delete({ calendarId: calId, eventId: ev.id }); deletedOrphans++; }
            catch {}
          }
        }
        pageToken = data.nextPageToken;
      } while (pageToken);
    } catch (err) {
      console.warn("Could not list calendar events:", err.message);
    }

    // Step 2: Upsert all active bookings and write gcalEventIds back to db
    let created = 0, updated = 0, errors = 0;
    for (const booking of Object.values(activeBookingsById)) {
      try {
        const existId = existingEventIdByBookingId[booking.id] || booking.gcalEventId;
        if (existId) {
          const { data } = await cal.events.update({ calendarId: calId, eventId: existId, requestBody: buildEvent(booking) });
          saveGcalEventId(booking.id, data.id);
          updated++;
        } else {
          const { data } = await cal.events.insert({ calendarId: calId, requestBody: buildEvent(booking) });
          // Save the new event ID so future syncs update instead of duplicate
          saveGcalEventId(booking.id, data.id);
          created++;
        }
      } catch (e) {
        console.warn("Upsert booking failed:", booking.id, e.message);
        errors++;
      }
    }

    res.json({ ok: true, created, updated, deletedOrphans, errors });
  });
}

module.exports = { registerRoutes, getAuthenticatedClient, loadCalSettings, saveCalSettings };
