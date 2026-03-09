/**
 * Google Sheets integration for PhotoFlow.
 * Exports bookings to a live-updating Google Sheet using the same Google OAuth credentials.
 * Includes all questionnaire answers as dynamic columns.
 */
const { google } = require("googleapis");
const { getAuthenticatedClient, loadCalSettings, saveCalSettings } = require("./google-calendar");

const SHEET_TITLE = "PhotoFlow Bookings";

const STATIC_HEADERS = [
  "ID", "Date", "Time", "Duration (min)", "Client Name", "Email",
  "Instagram", "Event Type", "Status", "Payment Status", "Amount ($)",
  "Deposit ($)", "Location", "Notes", "Created At",
];

// Build dynamic headers + rows from bookings and their event type questions
function buildSheetData(bookings, eventTypes) {
  // Collect all unique question IDs + labels across all event types
  // Preserve insertion order so questions group by event type
  const questionMap = new Map(); // id -> label
  for (const et of (eventTypes || [])) {
    for (const q of (et.questions || [])) {
      if (!questionMap.has(q.id)) {
        questionMap.set(q.id, q.label || q.id);
      }
    }
  }

  // Also sweep bookings.answers for any question IDs not in event types
  // (handles deleted event types or renamed questions)
  for (const b of bookings) {
    if (b.answers && typeof b.answers === "object") {
      for (const qId of Object.keys(b.answers)) {
        if (!questionMap.has(qId)) {
          questionMap.set(qId, qId); // fallback: use ID as label
        }
      }
    }
  }

  const questionIds = [...questionMap.keys()];
  const questionLabels = questionIds.map(id => questionMap.get(id));

  const headers = [...STATIC_HEADERS, ...questionLabels];

  const rows = bookings.map(b => {
    const staticRow = [
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

    // Append answer for each question in order (empty string if not answered)
    const answerRow = questionIds.map(qId => {
      const val = b.answers?.[qId];
      if (val == null) return "";
      if (typeof val === "boolean") return val ? "Yes" : "No";
      return String(val);
    });

    return [...staticRow, ...answerRow];
  });

  return { headers, rows };
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

    const { bookings, eventTypes } = req.body;
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

      // Build dynamic headers + rows including all questionnaire answers
      const { headers, rows } = buildSheetData(bookings, eventTypes || []);

      // Clear and rewrite
      await sheets.spreadsheets.values.clear({ spreadsheetId, range: "Bookings!A:ZZ" });

      const allRows = [headers, ...rows];
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "Bookings!A1",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: allRows },
      });

      // Format header row — bold + light background + auto-resize
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
                  cell: {
                    userEnteredFormat: {
                      textFormat: { bold: true },
                      backgroundColor: { red: 0.88, green: 0.88, blue: 0.96 },
                    },
                  },
                  fields: "userEnteredFormat(textFormat,backgroundColor)",
                },
              },
              {
                autoResizeDimensions: {
                  dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: headers.length },
                },
              },
              // Freeze header row
              {
                updateSheetProperties: {
                  properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
                  fields: "gridProperties.frozenRowCount",
                },
              },
            ],
          },
        });
      } catch {}

      res.json({
        ok: true,
        spreadsheetId,
        url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
        rows: bookings.length,
        columns: headers.length,
      });
    } catch (err) {
      console.error("Sheets sync error:", err.message);
      if (err.message?.includes("insufficient") || err.code === 403) {
        return res.status(403).json({
          error: "Google Sheets scope not authorized. Please reconnect Google with Sheets permission.",
          needsReauth: true,
        });
      }
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerRoutes };
