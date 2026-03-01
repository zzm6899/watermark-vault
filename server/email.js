const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.EMAIL_SERVER_HOST;
  const port = parseInt(process.env.EMAIL_SERVER_PORT || "587", 10);
  const secure = process.env.EMAIL_SERVER_SECURE === "true";
  const user = process.env.EMAIL_SERVER_USER;
  const pass = process.env.EMAIL_SERVER_PASSWORD;

  if (!host || !user || !pass) return null;

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  return transporter;
}

function getFromAddress() {
  return process.env.EMAIL_FROM || process.env.EMAIL_SERVER_USER || "";
}

function buildGoogleCalendarUrl({ title, date, time, duration, description = "", location = "" }) {
  const [year, month, day] = date.split("-").map(Number);
  const [h, m] = time.split(":").map(Number);
  const start = new Date(year, month - 1, day, h, m);
  const end = new Date(start.getTime() + duration * 60000);
  const fmt = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: description,
    location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function formatDateNice(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-AU", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

function formatTime12(t) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function formatDuration(mins) {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const rm = mins % 60;
    return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
  }
  return `${mins}m`;
}

function buildBookingEmailHtml({ clientName, eventTitle, date, time, duration, location,
  price, depositAmount, paymentMethod, remainingAmount, isFree, modifyUrl, bookingId, calendarUrl }) {
  const dateNice = formatDateNice(date);
  const timeNice = formatTime12(time);
  const durationNice = formatDuration(duration);

  let paymentSection = "";
  if (isFree) {
    paymentSection = `<tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Payment</td><td style="padding:6px 0;color:#22c55e;font-size:14px;text-align:right;font-weight:600;">Free ✓</td></tr>`;
  } else if (paymentMethod === "stripe" && depositAmount > 0) {
    paymentSection = `
      <tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Deposit Paid</td><td style="padding:6px 0;color:#22c55e;font-size:14px;text-align:right;font-weight:600;">$${depositAmount} ✓ Card</td></tr>
      ${remainingAmount > 0 ? `<tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Remaining Balance</td><td style="padding:6px 0;color:#facc15;font-size:14px;text-align:right;font-weight:600;">$${remainingAmount} due on the day</td></tr>` : ""}`;
  } else if (paymentMethod === "bank" && depositAmount > 0) {
    paymentSection = `
      <tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Deposit</td><td style="padding:6px 0;color:#facc15;font-size:14px;text-align:right;font-weight:600;">$${depositAmount} · Awaiting bank transfer</td></tr>
      ${remainingAmount > 0 ? `<tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Remaining Balance</td><td style="padding:6px 0;color:#facc15;font-size:14px;text-align:right;font-weight:600;">$${remainingAmount} due on the day</td></tr>` : ""}`;
  } else if (paymentMethod === "stripe") {
    paymentSection = `<tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Payment</td><td style="padding:6px 0;color:#22c55e;font-size:14px;text-align:right;font-weight:600;">$${price} ✓ Paid</td></tr>`;
  } else if (paymentMethod === "bank") {
    paymentSection = `<tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Payment</td><td style="padding:6px 0;color:#facc15;font-size:14px;text-align:right;font-weight:600;">$${price} · Awaiting bank transfer</td></tr>`;
  }

  const bankPendingNote = (paymentMethod === "bank") ? `
    <div style="background:#451a03;border:1px solid #78350f;border-radius:8px;padding:14px;margin:20px 0;">
      <p style="color:#fbbf24;font-size:13px;margin:0;">
        <strong>Bank Transfer Pending</strong><br>
        Please include your booking reference <strong style="color:#f59e0b;">${bookingId}</strong> as the payment description.
        Your booking will be confirmed once payment is received.
      </p>
    </div>` : "";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#111111;border-radius:16px;overflow:hidden;border:1px solid #1f1f1f;">
    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:32px 32px 24px;text-align:center;border-bottom:1px solid #1f1f1f;">
      <div style="width:52px;height:52px;background:rgba(139,92,246,0.2);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;font-size:24px;">📷</div>
      <h1 style="color:#e5e7eb;font-size:22px;font-weight:700;margin:0 0 6px;">Booking ${paymentMethod === "bank" ? "Received" : "Confirmed"}!</h1>
      <p style="color:#6b7280;font-size:14px;margin:0;">Hi ${clientName}, here's your booking summary.</p>
    </div>
    <div style="padding:28px 32px;">
      <table style="width:100%;border-collapse:collapse;">
        <tbody>
          <tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;border-top:1px solid #1f1f1f;">Event</td><td style="padding:6px 0;color:#e5e7eb;font-size:14px;text-align:right;font-weight:600;border-top:1px solid #1f1f1f;">${eventTitle}</td></tr>
          <tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Duration</td><td style="padding:6px 0;color:#e5e7eb;font-size:14px;text-align:right;">${durationNice}</td></tr>
          <tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Date</td><td style="padding:6px 0;color:#e5e7eb;font-size:14px;text-align:right;">${dateNice}</td></tr>
          <tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Time</td><td style="padding:6px 0;color:#8b5cf6;font-size:14px;text-align:right;font-weight:600;">${timeNice}</td></tr>
          ${location ? `<tr><td style="padding:6px 0;color:#9ca3af;font-size:14px;">Location</td><td style="padding:6px 0;color:#e5e7eb;font-size:14px;text-align:right;">${location}</td></tr>` : ""}
          ${paymentSection}
        </tbody>
      </table>
      ${bankPendingNote}
      <div style="margin-top:24px;">
        <a href="${calendarUrl}" style="display:block;background:#8b5cf6;color:#ffffff;text-decoration:none;text-align:center;padding:14px 20px;border-radius:10px;font-size:14px;font-weight:600;margin-bottom:10px;">📅 Add to Google Calendar</a>
        ${modifyUrl ? `<a href="${modifyUrl}" style="display:block;background:transparent;color:#9ca3af;text-decoration:none;text-align:center;padding:12px 20px;border-radius:10px;font-size:13px;border:1px solid #374151;">✏️ Modify or Cancel Booking</a>` : ""}
      </div>
    </div>
    <div style="padding:20px 32px;border-top:1px solid #1f1f1f;text-align:center;">
      <p style="color:#4b5563;font-size:12px;margin:0;">Questions? Simply reply to this email.<br>Booking ref: <span style="color:#6b7280;">${bookingId}</span></p>
    </div>
  </div>
</body></html>`;
}

async function sendBookingConfirmationEmail({
  to, clientName, eventTitle, date, time, duration,
  location = "", price = 0, depositAmount = 0,
  paymentMethod = "none", modifyToken, bookingId, appBaseUrl,
}) {
  const t = getTransporter();
  if (!t) {
    console.warn("📧 SMTP not configured — skipping booking confirmation email");
    return { ok: false, reason: "not_configured" };
  }

  const isFree = price === 0;
  const hasDeposit = depositAmount > 0;
  const remainingAmount = hasDeposit ? Math.max(0, price - depositAmount) : 0;
  const baseUrl = appBaseUrl || process.env.APP_BASE_URL || "";
  const modifyUrl = modifyToken && baseUrl ? `${baseUrl}/booking/modify/${modifyToken}` : null;
  const calendarUrl = buildGoogleCalendarUrl({ title: eventTitle, date, time, duration, location });

  const html = buildBookingEmailHtml({
    clientName, eventTitle, date, time, duration, location,
    price, depositAmount, paymentMethod, remainingAmount,
    isFree, modifyUrl, bookingId, calendarUrl,
  });

  const subjects = {
    bank: `Booking Received — ${eventTitle} (payment pending)`,
    stripe: `Booking Confirmed — ${eventTitle}`,
    none: `Booking Confirmed — ${eventTitle}`,
  };

  try {
    const info = await t.sendMail({
      from: getFromAddress(),
      to,
      subject: subjects[paymentMethod] || `Booking Confirmed — ${eventTitle}`,
      html,
    });
    console.log(`📧 Booking confirmation sent to ${to}: ${info.messageId}`);
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error("📧 Booking email error:", err.message);
    return { ok: false, error: err.message };
  }
}

function registerRoutes(app) {
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
    if (!to || !subject) return res.status(400).json({ ok: false, error: "Missing 'to' or 'subject'" });
    try {
      const info = await t.sendMail({ from: getFromAddress(), to, subject, html: html || undefined, text: text || undefined });
      console.log(`📧 Email sent to ${to}: ${info.messageId}`);
      res.json({ ok: true, messageId: info.messageId });
    } catch (err) {
      console.error("Email send error:", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Called by frontend after bank transfer confirmation, and by Stripe webhook after card payment
  app.post("/api/email/booking-confirmation", async (req, res) => {
    const result = await sendBookingConfirmationEmail({
      ...req.body,
      appBaseUrl: req.body.appBaseUrl || `${req.protocol}://${req.get("host")}`,
    });
    if (!result.ok && result.reason === "not_configured") return res.status(503).json({ ok: false, error: "SMTP not configured" });
    if (!result.ok) return res.status(500).json({ ok: false, error: result.error });
    res.json({ ok: true, messageId: result.messageId });
  });
}

module.exports = { registerRoutes, getTransporter, getFromAddress, sendBookingConfirmationEmail };
