/**
 * Google Calendar integration for Watermark Vault.
 * Handles OAuth flow and calendar event CRUD.
 */
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const TOKEN_FILE = path.join(process.env.DATA_DIR || "/data", "google-tokens.json");

function getCredentials() {
  const raw = process.env.GOOGLE_API_CREDENTIALS;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    console.error("Failed to parse GOOGLE_API_CREDENTIALS");
    return null;
  }
}

function getOAuth2Client() {
  const creds = getCredentials();
  if (!creds?.web) return null;
  const { client_id, client_secret, redirect_uris } = creds.web;
  // Use the first redirect URI that contains "googlecalendar/callback"
  const redirectUri = redirect_uris?.find(u => u.includes("googlecalendar/callback")) || redirect_uris?.[0];
  return new google.auth.OAuth2(client_id, client_secret, redirectUri);
}

function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
    }
  } catch {}
  return null;
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

function clearTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
  } catch {}
}

function getAuthenticatedClient() {
  const client = getOAuth2Client();
  if (!client) return null;
  const tokens = loadTokens();
  if (!tokens) return null;
  client.setCredentials(tokens);
  // Auto-refresh
  client.on("tokens", (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    saveTokens(merged);
  });
  return client;
}

/**
 * Register Google Calendar routes on the Express app.
 */
function registerRoutes(app) {
  // Check connection status
  app.get("/api/integrations/googlecalendar/status", (_req, res) => {
    const creds = getCredentials();
    const tokens = loadTokens();
    res.json({
      configured: !!creds?.web,
      connected: !!tokens?.access_token,
      email: tokens?.email || null,
    });
  });

  // Start OAuth flow
  app.get("/api/integrations/googlecalendar/auth", (_req, res) => {
    const client = getOAuth2Client();
    if (!client) {
      return res.status(500).json({ error: "Google credentials not configured" });
    }
    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/userinfo.email",
      ],
    });
    res.json({ url });
  });

  // OAuth callback
  app.get("/api/integrations/googlecalendar/callback", async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send("Missing authorization code");

    const client = getOAuth2Client();
    if (!client) return res.status(500).send("Google credentials not configured");

    try {
      const { tokens } = await client.getToken(code);
      client.setCredentials(tokens);

      // Get user email
      const oauth2 = google.oauth2({ version: "v2", auth: client });
      const userInfo = await oauth2.userinfo.get();
      tokens.email = userInfo.data.email;

      saveTokens(tokens);
      // Redirect back to admin settings
      res.redirect("/admin?tab=settings&gcal=connected");
    } catch (err) {
      console.error("Google OAuth error:", err);
      res.redirect("/admin?tab=settings&gcal=error");
    }
  });

  // Disconnect
  app.post("/api/integrations/googlecalendar/disconnect", (_req, res) => {
    clearTokens();
    res.json({ ok: true });
  });

  // List calendars
  app.get("/api/integrations/googlecalendar/calendars", async (_req, res) => {
    const auth = getAuthenticatedClient();
    if (!auth) return res.status(401).json({ error: "Not connected" });
    try {
      const calendar = google.calendar({ version: "v3", auth });
      const { data } = await calendar.calendarList.list();
      res.json({ calendars: data.items || [] });
    } catch (err) {
      console.error("Calendar list error:", err);
      res.status(500).json({ error: "Failed to list calendars" });
    }
  });

  // Create calendar event from booking
  app.post("/api/integrations/googlecalendar/event", async (req, res) => {
    const auth = getAuthenticatedClient();
    if (!auth) return res.status(401).json({ error: "Not connected" });

    const { booking, calendarId = "primary" } = req.body;
    if (!booking) return res.status(400).json({ error: "Missing booking data" });

    try {
      const calendar = google.calendar({ version: "v3", auth });
      const startDateTime = `${booking.date}T${booking.time}:00`;
      const endMinutes = booking.duration || 60;
      const startDate = new Date(startDateTime);
      const endDate = new Date(startDate.getTime() + endMinutes * 60000);

      const event = {
        summary: `📸 ${booking.type} — ${booking.clientName}`,
        description: [
          `Client: ${booking.clientName}`,
          booking.clientEmail ? `Email: ${booking.clientEmail}` : "",
          booking.instagramHandle ? `Instagram: @${booking.instagramHandle.replace("@", "")}` : "",
          `Duration: ${endMinutes}min`,
          booking.notes ? `Notes: ${booking.notes}` : "",
          `Status: ${booking.status}`,
          booking.paymentAmount ? `Amount: $${booking.paymentAmount}` : "",
        ].filter(Boolean).join("\n"),
        start: {
          dateTime: startDate.toISOString(),
          timeZone: process.env.TZ || "Australia/Sydney",
        },
        end: {
          dateTime: endDate.toISOString(),
          timeZone: process.env.TZ || "Australia/Sydney",
        },
        colorId: booking.status === "confirmed" ? "2" : booking.status === "completed" ? "10" : "5",
      };

      const { data } = await calendar.events.insert({
        calendarId,
        requestBody: event,
      });

      res.json({ ok: true, eventId: data.id, htmlLink: data.htmlLink });
    } catch (err) {
      console.error("Calendar event create error:", err);
      res.status(500).json({ error: "Failed to create calendar event" });
    }
  });

  // Sync all bookings
  app.post("/api/integrations/googlecalendar/sync-all", async (req, res) => {
    const auth = getAuthenticatedClient();
    if (!auth) return res.status(401).json({ error: "Not connected" });

    const { bookings, calendarId = "primary" } = req.body;
    if (!bookings || !Array.isArray(bookings)) return res.status(400).json({ error: "Missing bookings" });

    const calendar = google.calendar({ version: "v3", auth });
    let created = 0;
    let errors = 0;

    for (const booking of bookings) {
      if (booking.status === "cancelled") continue;
      try {
        const startDateTime = `${booking.date}T${booking.time}:00`;
        const startDate = new Date(startDateTime);
        const endDate = new Date(startDate.getTime() + (booking.duration || 60) * 60000);

        await calendar.events.insert({
          calendarId,
          requestBody: {
            summary: `📸 ${booking.type} — ${booking.clientName}`,
            description: `Client: ${booking.clientName}\nEmail: ${booking.clientEmail || ""}`,
            start: { dateTime: startDate.toISOString(), timeZone: process.env.TZ || "Australia/Sydney" },
            end: { dateTime: endDate.toISOString(), timeZone: process.env.TZ || "Australia/Sydney" },
          },
        });
        created++;
      } catch {
        errors++;
      }
    }
    res.json({ ok: true, created, errors });
  });
}

module.exports = { registerRoutes };
