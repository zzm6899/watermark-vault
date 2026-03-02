/**
 * Google Sheets integration for Watermark Vault.
 * Exports bookings to a live-updating Google Sheet using the same Google OAuth credentials.
 */
const { google } = require("googleapis");
const { getAuthenticatedClient, loadCalSettings, saveCalSettings } = require("./google-calendar");

const SHEET_TITLE = "Watermark Vault Bookings";

const HEADERS = [
  "ID", "Date", "Time", "Duration (min)", "Client Name", "Email",
  "Instagram", "Event Type", "Status", "Payment Status", "Amount ($)",
  "Deposit ($)", "Location", "Notes", "Created At",
];

function bookingToRow(b) {
  return [
    b.id || "",
    b.date || "",
    b.time || "",
    b.duration || "",
    b.clientName || "",
    b.clientEmail || "",
    b.instagramHandle ? `@${b.instagramHandle.replace("@", "")}` : "",
    b.type || "",
    b.status || "",
    b.paymentStatus || "",
    b.paymentAmount != null ? b.paymentAmount : "",
    b.depositAmount != null ? b.depositAmount : "",
    b.location || "",
    b.notes || "",
    b.createdAt || "",
  ];
}

function registerRoutes(app) {
  // Get sheets status
  app.get("/api/integrations/sheets/status", (_req, res) => {
    const auth = getAuthenticatedClient();
    const settings = loadCalSettings();
    res.json({
      connected: !!auth,
      spreadsheetId: settings.sheetsSpreadsheetId || null,
      spreadsheetUrl: settings.sheetsSpreadsheetId
        ? `https://docs.google.com/spreadsheets/d/${settings.sheetsSpreadsheetId}`
        : null,
    });
  });

  // Sync bookings → Google Sheet
  app.post("/api/integrations/sheets/sync", async (req, res) => {
    const auth = getAuthenticatedClient();
    if (!auth) return res.status(401).json({ error: "Google not connected. Connect via Google Calendar first." });

    const { bookings } = req.body;
    if (!Array.isArray(bookings)) return res.status(400).json({ error: "Missing bookings array" });

    const sheets = google.sheets({ version: "v4", auth });
    const settings = loadCalSettings();
    let spreadsheetId = settings.sheetsSpreadsheetId;

    try {
      if (!spreadsheetId) {
        const { data } = await sheets.spreadsheets.create({
          requestBody: {
            properties: { title: SHEET_TITLE },
            sheets: [{ properties: { title: "Bookings" } }],
          },
        });
        spreadsheetId = data.spreadsheetId;
        saveCalSettings({ sheetsSpreadsheetId: spreadsheetId });
      }

      // Clear and rewrite
      await sheets.spreadsheets.values.clear({ spreadsheetId, range: "Bookings!A:Z" });

      const rows = [HEADERS, ...bookings.map(bookingToRow)];
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "Bookings!A1",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: rows },
      });

      // Format header
      try {
        const sheetData = await sheets.spreadsheets.get({ spreadsheetId });
        const sheetId = sheetData.data.sheets?.[0]?.properties?.sheetId || 0;
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                repeatCell: {
                  range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                  cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.9, green: 0.9, blue: 0.95 } } },
                  fields: "userEnteredFormat(textFormat,backgroundColor)",
                },
              },
              {
                autoResizeDimensions: {
                  dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: HEADERS.length },
                },
              },
            ],
          },
        });
      } catch {}

      res.json({ ok: true, spreadsheetId, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`, rows: bookings.length });
    } catch (err) {
      console.error("Sheets sync error:", err.message);
      if (err.message?.includes("insufficient") || err.code === 403) {
        return res.status(403).json({ error: "Google Sheets scope not authorized. Please reconnect Google with Sheets permission.", needsReauth: true });
      }
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerRoutes };
