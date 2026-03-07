const nodemailer = require("nodemailer");
const { randomUUID } = require("crypto");

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.EMAIL_SERVER_HOST;
  const port = parseInt(process.env.EMAIL_SERVER_PORT || "587", 10);
  const secure = process.env.EMAIL_SERVER_SECURE === "true";
  const user = process.env.EMAIL_SERVER_USER;
  const pass = process.env.EMAIL_SERVER_PASSWORD;
  if (!host || !user || !pass) return null;
  transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
  return transporter;
}

function getFromAddress() {
  return process.env.EMAIL_FROM || process.env.EMAIL_SERVER_USER || "";
}

// ── Helpers ───────────────────────────────────────────────────
function buildGoogleCalendarUrl({ title, date, time, duration, description = "", location = "" }) {
  const [year, month, day] = date.split("-").map(Number);
  const [h, m] = time.split(":").map(Number);
  const start = new Date(year, month - 1, day, h, m);
  const end = new Date(start.getTime() + duration * 60000);
  const fmt = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return `https://calendar.google.com/calendar/render?${new URLSearchParams({
    action: "TEMPLATE", text: title,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: description, location,
  })}`;
}

function formatDateNice(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-AU", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

function formatTime12(t) {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function formatDuration(mins) {
  if (mins >= 60) { const h = Math.floor(mins / 60); const rm = mins % 60; return rm > 0 ? `${h}h ${rm}m` : `${h}h`; }
  return `${mins}m`;
}

// ── Email HTML builder ────────────────────────────────────────
function buildBookingEmailHtml({ clientName, eventTitle, date, time, duration, location,
  price, depositAmount, paymentMethod, remainingAmount, isFree, modifyUrl, bookingId,
  calendarUrl, trackingPixelUrl }) {

  const paymentRows = () => {
    if (isFree) return `<tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;border-top:1px solid #1f1f1f;">Payment</td><td style="padding:6px 0;color:#22c55e;font-size:14px;text-align:right;font-weight:600;border-top:1px solid #1f1f1f;">Free ✓</td></tr>`;
    if (paymentMethod === "stripe" && depositAmount > 0) return `
      <tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;border-top:1px solid #1f1f1f;">Deposit Paid</td><td style="padding:6px 0;color:#22c55e;font-size:14px;text-align:right;font-weight:600;border-top:1px solid #1f1f1f;">$${depositAmount} ✓ Card</td></tr>
      ${remainingAmount > 0 ? `<tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Remaining (due on day)</td><td style="padding:6px 0;color:#facc15;font-size:14px;text-align:right;font-weight:600;">$${remainingAmount}</td></tr>` : ""}`;
    if (paymentMethod === "bank" && depositAmount > 0) return `
      <tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;border-top:1px solid #1f1f1f;">Deposit</td><td style="padding:6px 0;color:#facc15;font-size:14px;text-align:right;font-weight:600;border-top:1px solid #1f1f1f;">$${depositAmount} · Bank Transfer Pending</td></tr>
      ${remainingAmount > 0 ? `<tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Remaining (due on day)</td><td style="padding:6px 0;color:#facc15;font-size:14px;text-align:right;font-weight:600;">$${remainingAmount}</td></tr>` : ""}`;
    if (paymentMethod === "stripe") return `<tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;border-top:1px solid #1f1f1f;">Payment</td><td style="padding:6px 0;color:#22c55e;font-size:14px;text-align:right;font-weight:600;border-top:1px solid #1f1f1f;">$${price} ✓ Paid in Full</td></tr>`;
    if (paymentMethod === "bank") return `<tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;border-top:1px solid #1f1f1f;">Payment</td><td style="padding:6px 0;color:#facc15;font-size:14px;text-align:right;font-weight:600;border-top:1px solid #1f1f1f;">$${price} · Bank Transfer Pending</td></tr>`;
    return `<tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;border-top:1px solid #1f1f1f;">Payment</td><td style="padding:6px 0;color:#9ca3af;font-size:14px;text-align:right;border-top:1px solid #1f1f1f;">—</td></tr>`;
  };

  const bankNote = paymentMethod === "bank" ? `
    <div style="background:#451a03;border:1px solid #78350f;border-radius:8px;padding:14px;margin:20px 0;">
      <p style="color:#fbbf24;font-size:13px;margin:0;line-height:1.5;">
        <strong>⏳ Bank Transfer Pending</strong><br>
        Please use booking ref <strong style="color:#f59e0b;">${bookingId}</strong> as the payment description.
        Your booking will be confirmed once payment is received.
      </p>
    </div>` : "";

  const isConfirmed = paymentMethod === "stripe" || paymentMethod === "none";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#111111;border-radius:16px;overflow:hidden;border:1px solid #1f1f1f;">
    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:32px 32px 24px;text-align:center;border-bottom:1px solid #1f1f1f;">
      <div style="width:52px;height:52px;background:rgba(139,92,246,0.2);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;font-size:24px;">📷</div>
      <h1 style="color:#e5e7eb;font-size:22px;font-weight:700;margin:0 0 6px;">${isConfirmed ? "Booking Confirmed!" : "Booking Received!"}</h1>
      <p style="color:#6b7280;font-size:14px;margin:0;">Hi ${clientName}, here's your booking summary.</p>
    </div>
    <div style="padding:28px 32px;">
      <table style="width:100%;border-collapse:collapse;">
        <tbody>
          <tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;border-top:1px solid #1f1f1f;">Event</td><td style="padding:6px 0;color:#e5e7eb;font-size:14px;text-align:right;font-weight:600;border-top:1px solid #1f1f1f;">${eventTitle}</td></tr>
          <tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Duration</td><td style="padding:6px 0;color:#e5e7eb;font-size:14px;text-align:right;">${formatDuration(duration)}</td></tr>
          <tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Date</td><td style="padding:6px 0;color:#e5e7eb;font-size:14px;text-align:right;">${formatDateNice(date)}</td></tr>
          <tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Time</td><td style="padding:6px 0;color:#8b5cf6;font-size:14px;text-align:right;font-weight:600;">${formatTime12(time)}</td></tr>
          ${location ? `<tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Location</td><td style="padding:6px 0;color:#e5e7eb;font-size:14px;text-align:right;">${location}</td></tr>` : ""}
          ${paymentRows()}
        </tbody>
      </table>
      ${bankNote}
      <div style="margin-top:24px;">
        <a href="${calendarUrl}" style="display:block;background:#8b5cf6;color:#ffffff;text-decoration:none;text-align:center;padding:14px 20px;border-radius:10px;font-size:14px;font-weight:600;margin-bottom:10px;">📅 Add to Google Calendar</a>
        ${modifyUrl ? `<a href="${modifyUrl}" style="display:block;background:transparent;color:#9ca3af;text-decoration:none;text-align:center;padding:12px 20px;border-radius:10px;font-size:13px;border:1px solid #374151;">View Booking &amp; Manage →</a>` : ""}
      </div>
    </div>
    <div style="padding:20px 32px;border-top:1px solid #1f1f1f;text-align:center;">
      <p style="color:#4b5563;font-size:12px;margin:0;">Questions? Simply reply to this email.<br>Ref: <span style="color:#6b7280;">${bookingId}</span></p>
    </div>
  </div>
  ${trackingPixelUrl ? `<img src="${trackingPixelUrl}" width="1" height="1" style="display:none;" alt="">` : ""}
</body></html>`;
}

// ── Write email log entry to booking storage ──────────────────
// store is the in-memory store object passed from the main server
function appendEmailLog(store, bookingId, logEntry) {
  try {
    const data = store.get("wv_bookings") || [];
    const idx = data.findIndex(b => b.id === bookingId);
    if (idx === -1) return;
    if (!data[idx].emailLog) data[idx].emailLog = [];
    data[idx].emailLog.push(logEntry);
    store.set("wv_bookings", data);
  } catch (e) {
    console.warn("Could not append email log:", e.message);
  }
}

// ── Main send function ─────────────────────────────────────────
async function sendBookingConfirmationEmail({
  to, clientName, eventTitle, date, time, duration, location = "",
  price = 0, depositAmount = 0, paymentMethod = "none",
  modifyToken, bookingId, appBaseUrl, store,
}) {
  const t = getTransporter();
  if (!t) { console.warn("📧 SMTP not configured"); return { ok: false, reason: "not_configured" }; }

  const isFree = price === 0;
  const hasDeposit = depositAmount > 0;
  const remainingAmount = hasDeposit ? Math.max(0, price - depositAmount) : 0;
  const baseUrl = appBaseUrl || process.env.APP_BASE_URL || "";

  // The modify link now goes to /booking/modify/:modifyToken which is the full status page
  const modifyUrl = modifyToken && baseUrl ? `${baseUrl}/booking/modify/${modifyToken}` : null;
  const calendarUrl = buildGoogleCalendarUrl({ title: eventTitle, date, time, duration, location });

  // Open-tracking pixel
  const trackingId = randomUUID();
  const trackingPixelUrl = baseUrl ? `${baseUrl}/api/email/open/${trackingId}` : null;

  const subject = paymentMethod === "bank"
    ? `Booking Received — ${eventTitle} (payment pending)`
    : `Booking Confirmed — ${eventTitle}`;

  const html = buildBookingEmailHtml({
    clientName, eventTitle, date, time, duration, location,
    price, depositAmount, paymentMethod, remainingAmount,
    isFree, modifyUrl, bookingId, calendarUrl, trackingPixelUrl,
  });

  try {
    const info = await t.sendMail({ from: getFromAddress(), to, subject, html });
    console.log(`📧 Confirmation sent to ${to}: ${info.messageId}`);

    // Write log entry to booking
    if (store) {
      appendEmailLog(store, bookingId, {
        id: trackingId,
        type: "booking-confirmation",
        sentAt: new Date().toISOString(),
        subject,
        to,
      });
    }

    return { ok: true, messageId: info.messageId, trackingId };
  } catch (err) {
    console.error("📧 Email error:", err.message);
    return { ok: false, error: err.message };
  }
}

// ── Routes ─────────────────────────────────────────────────────
function registerRoutes(app, store) {
  app.get("/api/email/status", (_req, res) => {
    const configured = !!(process.env.EMAIL_SERVER_HOST && process.env.EMAIL_SERVER_USER && process.env.EMAIL_SERVER_PASSWORD);
    res.json({ configured, host: process.env.EMAIL_SERVER_HOST, user: process.env.EMAIL_SERVER_USER, from: getFromAddress() });
  });

  app.post("/api/email/test", async (_req, res) => {
    const t = getTransporter();
    if (!t) return res.status(400).json({ ok: false, error: "SMTP not configured" });
    try { await t.verify(); res.json({ ok: true }); }
    catch (err) { res.status(500).json({ ok: false, error: err.message }); }
  });

  app.post("/api/email/send", async (req, res) => {
    const t = getTransporter();
    if (!t) return res.status(400).json({ ok: false, error: "SMTP not configured" });
    const { to, subject, html, text } = req.body;
    if (!to || !subject) return res.status(400).json({ ok: false, error: "Missing to/subject" });
    try {
      const info = await t.sendMail({ from: getFromAddress(), to, subject, html, text });
      res.json({ ok: true, messageId: info.messageId });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
  });

  // Called by frontend after bank transfer or by Stripe webhook after card payment
  app.post("/api/email/booking-confirmation", async (req, res) => {
    const appBaseUrl = req.body.appBaseUrl || `${req.protocol}://${req.get("host")}`;
    const result = await sendBookingConfirmationEmail({ ...req.body, appBaseUrl, store });
    if (!result.ok && result.reason === "not_configured") return res.status(503).json({ ok: false, error: "SMTP not configured" });
    if (!result.ok) return res.status(500).json({ ok: false, error: result.error });
    res.json({ ok: true, messageId: result.messageId });
  });

  // Open-tracking pixel — 1x1 transparent GIF
  app.get("/api/email/open/:trackingId", (req, res) => {
    const { trackingId } = req.params;

    // Mark as opened in booking's emailLog
    if (store) {
      try {
        const bookings = store.get("wv_bookings") || [];
        let found = false;
        for (const booking of bookings) {
          if (!booking.emailLog) continue;
          const entry = booking.emailLog.find(e => e.id === trackingId);
          if (entry && !entry.openedAt) {
            entry.openedAt = new Date().toISOString();
            found = true;
            break;
          }
        }
        if (found) store.set("wv_bookings", bookings);
      } catch (e) {
        console.warn("Email open tracking error:", e.message);
      }
    }

    // Return 1x1 transparent GIF
    const pixel = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
    res.writeHead(200, { "Content-Type": "image/gif", "Content-Length": pixel.length, "Cache-Control": "no-store" });
    res.end(pixel);
  });

  // Get email log for a booking (used by Admin page)
  app.get("/api/email/log/:bookingId", (req, res) => {
    const { bookingId } = req.params;
    if (!store) return res.json({ log: [] });
    try {
      const bookings = store.get("wv_bookings") || [];
      const booking = bookings.find(b => b.id === bookingId);
      res.json({ log: booking?.emailLog || [] });
    } catch { res.json({ log: [] }); }
  });

  // Send a reminder email for a booking
  app.post("/api/email/reminder", async (req, res) => {
    const t = getTransporter();
    if (!t) return res.status(400).json({ ok: false, error: "SMTP not configured" });

    const { bookingId, reminderType } = req.body; // reminderType: "payment" | "booking"
    if (!bookingId) return res.status(400).json({ ok: false, error: "Missing bookingId" });
    if (!store) return res.status(400).json({ ok: false, error: "No store" });

    const bookings = store.get("wv_bookings") || [];
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return res.status(404).json({ ok: false, error: "Booking not found" });

    const appBaseUrl = req.body.appBaseUrl || `${req.protocol}://${req.get("host")}`;
    const modifyUrl = booking.modifyToken && appBaseUrl ? `${appBaseUrl}/booking/modify/${booking.modifyToken}` : null;
    const calendarUrl = buildGoogleCalendarUrl({
      title: booking.type || "Booking",
      date: booking.date, time: booking.time,
      duration: booking.duration || 60,
      location: booking.location || "",
    });

    const isPaymentReminder = reminderType === "payment";
    const remaining = (booking.paymentAmount || 0) - (booking.depositAmount || 0);

    const subject = isPaymentReminder
      ? `Payment Reminder — ${booking.type || "Booking"}`
      : `Booking Reminder — ${booking.type || "Booking"} on ${formatDateNice(booking.date)}`;

    const html = buildReminderEmailHtml({
      clientName: booking.clientName,
      eventTitle: booking.type || "Booking",
      date: booking.date,
      time: booking.time,
      duration: booking.duration || 60,
      isPaymentReminder,
      paymentStatus: booking.paymentStatus || "unpaid",
      totalPrice: booking.paymentAmount || 0,
      depositPaid: booking.depositPaidAt ? (booking.depositAmount || 0) : 0,
      remaining,
      bookingId: booking.id,
      modifyUrl,
      calendarUrl,
    });

    const trackingId = randomUUID();
    const trackingPixelUrl = appBaseUrl ? `${appBaseUrl}/api/email/open/${trackingId}` : null;
    const finalHtml = html + (trackingPixelUrl ? `<img src="${trackingPixelUrl}" width="1" height="1" style="display:none;" alt="">` : "");

    try {
      const info = await t.sendMail({ from: getFromAddress(), to: booking.clientEmail, subject, html: finalHtml });
      console.log(`📧 Reminder sent to ${booking.clientEmail}: ${info.messageId}`);

      appendEmailLog(store, bookingId, {
        id: trackingId,
        type: isPaymentReminder ? "payment-reminder" : "booking-reminder",
        sentAt: new Date().toISOString(),
        subject,
        to: booking.clientEmail,
      });

      res.json({ ok: true, messageId: info.messageId });
    } catch (err) {
      console.error("📧 Reminder error:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Enquiry email notifications ──────────────────────────────

  // Auto-reply to client when enquiry is submitted
  app.post("/api/email/enquiry-received", async (req, res) => {
    const t = getTransporter();
    if (!t) return res.status(503).json({ ok: false, error: "SMTP not configured" });
    const { to, clientName, eventTitle, preferredDate, preferredStartTime, preferredEndTime, message } = req.body;
    if (!to || !clientName) return res.status(400).json({ ok: false, error: "Missing required fields" });
    const html = buildEnquiryReceivedHtml({ clientName, eventTitle, preferredDate, preferredStartTime, preferredEndTime, message: message || "" });
    try {
      const info = await t.sendMail({ from: getFromAddress(), to, subject: "We've received your enquiry!", html });
      console.log(`📧 Enquiry received auto-reply sent to ${to}: ${info.messageId}`);
      res.json({ ok: true, messageId: info.messageId });
    } catch (err) {
      console.error("📧 Enquiry received email error:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Notify client when enquiry is accepted and booking created
  app.post("/api/email/enquiry-accepted", async (req, res) => {
    const t = getTransporter();
    if (!t) return res.status(503).json({ ok: false, error: "SMTP not configured" });
    const { to, clientName, eventTitle, preferredDate, preferredStartTime, preferredEndTime, bookingId, modifyToken } = req.body;
    if (!to || !clientName) return res.status(400).json({ ok: false, error: "Missing required fields" });
    const appBaseUrl = req.body.appBaseUrl || `${req.protocol}://${req.get("host")}`;
    const modifyUrl = modifyToken && appBaseUrl ? `${appBaseUrl}/booking/modify/${modifyToken}` : null;
    const html = buildEnquiryAcceptedHtml({ clientName, eventTitle, preferredDate, preferredStartTime, preferredEndTime, bookingId, modifyUrl });
    try {
      const info = await t.sendMail({ from: getFromAddress(), to, subject: "Your enquiry has been accepted!", html });
      console.log(`📧 Enquiry accepted email sent to ${to}: ${info.messageId}`);
      res.json({ ok: true, messageId: info.messageId });
    } catch (err) {
      console.error("📧 Enquiry accepted email error:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Notify client when enquiry is declined
  app.post("/api/email/enquiry-declined", async (req, res) => {
    const t = getTransporter();
    if (!t) return res.status(503).json({ ok: false, error: "SMTP not configured" });
    const { to, clientName, adminNote } = req.body;
    if (!to || !clientName) return res.status(400).json({ ok: false, error: "Missing required fields" });
    const html = buildEnquiryDeclinedHtml({ clientName, adminNote: adminNote || "" });
    try {
      const info = await t.sendMail({ from: getFromAddress(), to, subject: "Update on your photography enquiry", html });
      console.log(`📧 Enquiry declined email sent to ${to}: ${info.messageId}`);
      res.json({ ok: true, messageId: info.messageId });
    } catch (err) {
      console.error("📧 Enquiry declined email error:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}

// ── Reminder Email HTML ───────────────────────────────────
function buildReminderEmailHtml({ clientName, eventTitle, date, time, duration,
  isPaymentReminder, paymentStatus, totalPrice, depositPaid, remaining,
  bookingId, modifyUrl, calendarUrl }) {

  const paymentSection = isPaymentReminder ? `
    <div style="background:#451a03;border:1px solid #78350f;border-radius:8px;padding:14px;margin:20px 0;">
      <p style="color:#fbbf24;font-size:13px;margin:0;line-height:1.5;">
        <strong>💰 Payment Outstanding</strong><br>
        Total: <strong>$${totalPrice}</strong>${depositPaid > 0 ? ` · Deposit paid: <strong>$${depositPaid}</strong>` : ""}<br>
        <strong style="color:#f59e0b;">Amount due: $${remaining > 0 ? remaining : totalPrice}</strong><br>
        Please use booking ref <strong>${bookingId}</strong> as the payment description.
      </p>
    </div>` : "";

  const bookingSection = !isPaymentReminder ? `
    <div style="background:#1a2e1a;border:1px solid #166534;border-radius:8px;padding:14px;margin:20px 0;">
      <p style="color:#86efac;font-size:13px;margin:0;line-height:1.5;">
        <strong>📅 Your session is coming up!</strong><br>
        We look forward to seeing you. Please arrive on time.
      </p>
    </div>` : "";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#111111;border-radius:16px;overflow:hidden;border:1px solid #1f1f1f;">
    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:32px 32px 24px;text-align:center;border-bottom:1px solid #1f1f1f;">
      <div style="width:52px;height:52px;background:rgba(139,92,246,0.2);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;font-size:24px;">${isPaymentReminder ? "💰" : "📷"}</div>
      <h1 style="color:#e5e7eb;font-size:22px;font-weight:700;margin:0 0 6px;">${isPaymentReminder ? "Payment Reminder" : "Booking Reminder"}</h1>
      <p style="color:#6b7280;font-size:14px;margin:0;">Hi ${clientName}, this is a friendly reminder.</p>
    </div>
    <div style="padding:28px 32px;">
      <table style="width:100%;border-collapse:collapse;">
        <tbody>
          <tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;border-top:1px solid #1f1f1f;">Event</td><td style="padding:6px 0;color:#e5e7eb;font-size:14px;text-align:right;font-weight:600;border-top:1px solid #1f1f1f;">${eventTitle}</td></tr>
          <tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Date</td><td style="padding:6px 0;color:#e5e7eb;font-size:14px;text-align:right;">${formatDateNice(date)}</td></tr>
          <tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Time</td><td style="padding:6px 0;color:#8b5cf6;font-size:14px;text-align:right;font-weight:600;">${formatTime12(time)}</td></tr>
          <tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Duration</td><td style="padding:6px 0;color:#e5e7eb;font-size:14px;text-align:right;">${formatDuration(duration)}</td></tr>
        </tbody>
      </table>
      ${paymentSection}
      ${bookingSection}
      <div style="margin-top:24px;">
        ${!isPaymentReminder ? `<a href="${calendarUrl}" style="display:block;background:#8b5cf6;color:#ffffff;text-decoration:none;text-align:center;padding:14px 20px;border-radius:10px;font-size:14px;font-weight:600;margin-bottom:10px;">📅 Add to Google Calendar</a>` : ""}
        ${modifyUrl ? `<a href="${modifyUrl}" style="display:block;background:transparent;color:#9ca3af;text-decoration:none;text-align:center;padding:12px 20px;border-radius:10px;font-size:13px;border:1px solid #374151;">View Booking &amp; Manage →</a>` : ""}
      </div>
    </div>
    <div style="padding:20px 32px;border-top:1px solid #1f1f1f;text-align:center;">
      <p style="color:#4b5563;font-size:12px;margin:0;">Questions? Simply reply to this email.<br>Ref: <span style="color:#6b7280;">${bookingId}</span></p>
    </div>
  </div>
</body></html>`;
}

// ── Enquiry Email HTML builders ───────────────────────────────

function buildEnquiryReceivedHtml({ clientName, eventTitle, preferredDate, preferredStartTime, preferredEndTime, message }) {
  const detailRows = [
    eventTitle ? `<tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;border-top:1px solid #1f1f1f;">Event type</td><td style="padding:6px 0;color:#e5e7eb;font-size:14px;text-align:right;font-weight:600;border-top:1px solid #1f1f1f;">${eventTitle}</td></tr>` : "",
    preferredDate ? `<tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Preferred date</td><td style="padding:6px 0;color:#e5e7eb;font-size:14px;text-align:right;">${formatDateNice(preferredDate)}</td></tr>` : "",
    (preferredStartTime || preferredEndTime) ? `<tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Preferred time</td><td style="padding:6px 0;color:#8b5cf6;font-size:14px;text-align:right;font-weight:600;">${[preferredStartTime, preferredEndTime].filter(Boolean).map(formatTime12).join(" – ")}</td></tr>` : "",
  ].filter(Boolean).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#111111;border-radius:16px;overflow:hidden;border:1px solid #1f1f1f;">
    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:32px 32px 24px;text-align:center;border-bottom:1px solid #1f1f1f;">
      <div style="width:52px;height:52px;background:rgba(139,92,246,0.2);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;font-size:24px;">📬</div>
      <h1 style="color:#e5e7eb;font-size:22px;font-weight:700;margin:0 0 6px;">Enquiry Received!</h1>
      <p style="color:#6b7280;font-size:14px;margin:0;">Hi ${clientName}, we've received your enquiry and will get back to you shortly.</p>
    </div>
    <div style="padding:28px 32px;">
      ${detailRows ? `<table style="width:100%;border-collapse:collapse;margin-bottom:20px;"><tbody>${detailRows}</tbody></table>` : ""}
      <div style="background:#1a1a2e;border:1px solid #2d2d4e;border-radius:8px;padding:14px;margin-bottom:20px;">
        <p style="color:#9ca3af;font-size:12px;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.05em;">Your message</p>
        <p style="color:#e5e7eb;font-size:13px;margin:0;white-space:pre-line;">${message}</p>
      </div>
      <div style="background:#1a2e1a;border:1px solid #166534;border-radius:8px;padding:14px;">
        <p style="color:#86efac;font-size:13px;margin:0;line-height:1.5;">
          <strong>✅ What happens next?</strong><br>
          We'll review your enquiry and reach out to confirm availability and next steps.
        </p>
      </div>
    </div>
    <div style="padding:20px 32px;border-top:1px solid #1f1f1f;text-align:center;">
      <p style="color:#4b5563;font-size:12px;margin:0;">Questions? Simply reply to this email.</p>
    </div>
  </div>
</body></html>`;
}

function buildEnquiryAcceptedHtml({ clientName, eventTitle, preferredDate, preferredStartTime, preferredEndTime, bookingId, modifyUrl }) {
  const detailRows = [
    eventTitle ? `<tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;border-top:1px solid #1f1f1f;">Event type</td><td style="padding:6px 0;color:#e5e7eb;font-size:14px;text-align:right;font-weight:600;border-top:1px solid #1f1f1f;">${eventTitle}</td></tr>` : "",
    preferredDate ? `<tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Date</td><td style="padding:6px 0;color:#e5e7eb;font-size:14px;text-align:right;">${formatDateNice(preferredDate)}</td></tr>` : "",
    (preferredStartTime || preferredEndTime) ? `<tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Time</td><td style="padding:6px 0;color:#8b5cf6;font-size:14px;text-align:right;font-weight:600;">${[preferredStartTime, preferredEndTime].filter(Boolean).map(formatTime12).join(" – ")}</td></tr>` : "",
  ].filter(Boolean).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#111111;border-radius:16px;overflow:hidden;border:1px solid #1f1f1f;">
    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:32px 32px 24px;text-align:center;border-bottom:1px solid #1f1f1f;">
      <div style="width:52px;height:52px;background:rgba(34,197,94,0.15);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;font-size:24px;">✅</div>
      <h1 style="color:#e5e7eb;font-size:22px;font-weight:700;margin:0 0 6px;">Enquiry Accepted!</h1>
      <p style="color:#6b7280;font-size:14px;margin:0;">Hi ${clientName}, great news — we'd love to work with you!</p>
    </div>
    <div style="padding:28px 32px;">
      ${detailRows ? `<table style="width:100%;border-collapse:collapse;margin-bottom:20px;"><tbody>${detailRows}</tbody></table>` : ""}
      <div style="background:#1a2e1a;border:1px solid #166534;border-radius:8px;padding:14px;margin-bottom:20px;">
        <p style="color:#86efac;font-size:13px;margin:0;line-height:1.5;">
          <strong>🎉 Your booking has been created!</strong><br>
          We'll be in touch shortly to confirm all the details and arrange payment.
        </p>
      </div>
      ${modifyUrl ? `<a href="${modifyUrl}" style="display:block;background:#8b5cf6;color:#ffffff;text-decoration:none;text-align:center;padding:14px 20px;border-radius:10px;font-size:14px;font-weight:600;">View Your Booking →</a>` : ""}
    </div>
    <div style="padding:20px 32px;border-top:1px solid #1f1f1f;text-align:center;">
      <p style="color:#4b5563;font-size:12px;margin:0;">Questions? Simply reply to this email.${bookingId ? `<br>Ref: <span style="color:#6b7280;">${bookingId}</span>` : ""}</p>
    </div>
  </div>
</body></html>`;
}

function buildEnquiryDeclinedHtml({ clientName, adminNote }) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#111111;border-radius:16px;overflow:hidden;border:1px solid #1f1f1f;">
    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:32px 32px 24px;text-align:center;border-bottom:1px solid #1f1f1f;">
      <div style="width:52px;height:52px;background:rgba(107,114,128,0.15);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;font-size:24px;">📋</div>
      <h1 style="color:#e5e7eb;font-size:22px;font-weight:700;margin:0 0 6px;">Enquiry Update</h1>
      <p style="color:#6b7280;font-size:14px;margin:0;">Hi ${clientName}, thank you for reaching out.</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="color:#9ca3af;font-size:14px;line-height:1.6;margin:0 0 16px;">
        Unfortunately we're unable to accommodate your enquiry at this time.
      </p>
      ${adminNote ? `
      <div style="background:#1f1f1f;border:1px solid #374151;border-radius:8px;padding:14px;margin-bottom:20px;">
        <p style="color:#9ca3af;font-size:12px;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.05em;">Note from us</p>
        <p style="color:#e5e7eb;font-size:13px;margin:0;white-space:pre-line;">${adminNote}</p>
      </div>` : ""}
      <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:0;">
        We hope to work with you in the future. Feel free to reach out again for different dates or requirements.
      </p>
    </div>
    <div style="padding:20px 32px;border-top:1px solid #1f1f1f;text-align:center;">
      <p style="color:#4b5563;font-size:12px;margin:0;">Questions? Simply reply to this email.</p>
    </div>
  </div>
</body></html>`;
}

// ── Invoice Paid Confirmation Email ──────────────────────────
function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendInvoicePaidEmail(invoice, shareUrl) {
  const t = getTransporter();
  if (!t || !invoice?.to?.email) return { ok: false, reason: "not_configured" };

  const sub = (invoice.items || []).reduce((s, it) => s + it.quantity * it.unitPrice, 0);
  const disc = invoice.discount || 0;
  const taxRate = invoice.tax || 0;
  const taxAmt = (sub - disc) * (taxRate / 100);
  const total = sub - disc + taxAmt;

  const paidAt = invoice.paidAt
    ? new Date(invoice.paidAt).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })
    : new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  // Validate shareUrl to only allow known-safe https:// links
  const safeShareUrl = shareUrl && /^https?:\/\//.test(shareUrl) ? shareUrl : null;

  const clientName = escapeHtml(invoice.to?.name || "there");
  const invoiceNumber = escapeHtml(invoice.number || "");

  const subject = `Payment Received — ${invoice.number}`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#111111;border-radius:16px;overflow:hidden;border:1px solid #1f1f1f;">
    <div style="background:linear-gradient(135deg,#052e16 0%,#14532d 100%);padding:32px 32px 24px;text-align:center;border-bottom:1px solid #166534;">
      <div style="width:52px;height:52px;background:rgba(34,197,94,0.2);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;font-size:28px;">✅</div>
      <h1 style="color:#22c55e;font-size:22px;font-weight:700;margin:0 0 6px;">Payment Received</h1>
      <p style="color:#86efac;font-size:14px;margin:0;">Thank you — your invoice has been paid.</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="color:#9ca3af;font-size:14px;margin:0 0 20px;">Hi ${clientName},<br>We've received your payment for invoice <strong style="color:#e5e7eb;">${invoiceNumber}</strong>. Paid on ${escapeHtml(paidAt)}.</p>
      <table style="width:100%;border-collapse:collapse;background:#1a1a1a;border-radius:8px;overflow:hidden;margin-bottom:24px;">
        <tr><td style="padding:10px 16px;color:#9ca3af;font-size:14px;">Invoice</td><td style="padding:10px 16px;color:#e5e7eb;font-size:14px;text-align:right;">${invoiceNumber}</td></tr>
        <tr style="border-top:1px solid #333;"><td style="padding:10px 16px;color:#9ca3af;font-size:14px;font-weight:bold;">Total Paid</td><td style="padding:10px 16px;color:#22c55e;font-size:18px;font-weight:bold;text-align:right;">$${total.toFixed(2)}</td></tr>
      </table>
      ${safeShareUrl ? `<a href="${safeShareUrl}" style="display:inline-block;padding:12px 24px;background:#7c3aed;color:#ffffff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600;">View Invoice →</a>` : ""}
    </div>
    <div style="padding:20px 32px;border-top:1px solid #1f1f1f;text-align:center;">
      <p style="color:#4b5563;font-size:12px;margin:0;">Questions? Simply reply to this email.<br>Ref: <span style="color:#6b7280;">${invoiceNumber}</span></p>
    </div>
  </div>
</body></html>`;

  try {
    const info = await t.sendMail({ from: getFromAddress(), to: invoice.to.email, subject, html });
    console.log(`📧 Invoice paid confirmation sent to ${invoice.to.email}: ${info.messageId}`);
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error("📧 Invoice paid email error:", err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { registerRoutes, getTransporter, getFromAddress, sendBookingConfirmationEmail, sendInvoicePaidEmail };
