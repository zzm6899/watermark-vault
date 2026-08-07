const nodemailer = require("nodemailer");
const { randomUUID } = require("crypto");
const rateLimit = require("express-rate-limit");
const express = require("express");
const { timingSafeTextEqual } = require("./security-core");

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

/**
 * Build a one-off transporter from per-tenant SMTP settings.
 * Returns null if the settings are incomplete.
 * @param {object} tenantSettings - TenantSettings object
 */
function buildTenantTransporter(tenantSettings) {
  if (!tenantSettings) return null;
  const { smtpHost, smtpPort, smtpUser, smtpPassword } = tenantSettings;
  if (!smtpHost || !smtpUser || !smtpPassword) return null;
  const port = smtpPort || 587;
  const secure = tenantSettings.smtpSecure === true;
  return nodemailer.createTransport({ host: smtpHost, port, secure, auth: { user: smtpUser, pass: smtpPassword } });
}

function getTenantFromAddress(tenantSettings) {
  if (!tenantSettings) return getFromAddress();
  return tenantSettings.smtpFrom || tenantSettings.smtpUser || getFromAddress();
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
  const [year, month, day] = String(dateStr || "").split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (![year, month, day].every(Number.isFinite) || !Number.isFinite(date.getTime())) return String(dateStr || "");
  return date.toLocaleDateString("en-AU", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

function formatTime12(t) {
  const [h, m] = String(t || "").split(":").map(Number);
  if (![h, m].every(Number.isFinite)) return String(t || "");
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function formatDuration(mins) {
  mins = Math.max(0, Number(mins) || 0);
  if (mins >= 60) { const h = Math.floor(mins / 60); const rm = mins % 60; return rm > 0 ? `${h}h ${rm}m` : `${h}h`; }
  return `${mins}m`;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const DEFAULT_EMAIL_BRAND = process.env.EMAIL_BRAND_NAME || "PhotoFlow";

function storeBrandName(store) {
  try {
    const profile = store?.get?.("wv_profile") || {};
    return profile.businessName || profile.brandName || profile.name || DEFAULT_EMAIL_BRAND;
  } catch {
    return DEFAULT_EMAIL_BRAND;
  }
}

function cleanPlainText(value) {
  return String(value == null ? "" : value).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function cleanEmailSubject(value, fallback = "Message") {
  return cleanPlainText(value).replace(/\n+/g, " ").trim().slice(0, 200) || fallback;
}

function safeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function formatMoney(value, currency = "AUD") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat("en-AU", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function buildSummaryCard(rows = []) {
  const visibleRows = rows.filter(row => row && row.value !== undefined && row.value !== null && String(row.value) !== "");
  if (!visibleRows.length) return "";
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:separate;border-spacing:0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin:0 0 24px;">
    ${visibleRows.map((row, index) => `<tr>
      <td style="padding:${index === 0 ? "16px" : "10px"} 16px ${index === visibleRows.length - 1 ? "16px" : "10px"};color:#64748b;font-family:Arial,sans-serif;font-size:13px;line-height:1.45;${index ? "border-top:1px solid #e2e8f0;" : ""}">${escapeHtml(row.label)}</td>
      <td align="right" style="padding:${index === 0 ? "16px" : "10px"} 16px ${index === visibleRows.length - 1 ? "16px" : "10px"};color:${row.tone === "success" ? "#15803d" : row.tone === "warning" ? "#a16207" : "#0f172a"};font-family:Arial,sans-serif;font-size:13px;font-weight:${row.emphasis ? "700" : "600"};line-height:1.45;text-align:right;${index ? "border-top:1px solid #e2e8f0;" : ""}">${escapeHtml(row.value)}</td>
    </tr>`).join("")}
  </table>`;
}

function buildCallout(title, message, tone = "info") {
  const palette = tone === "success"
    ? { background: "#f0fdf4", border: "#bbf7d0", title: "#166534", body: "#166534" }
    : tone === "warning"
      ? { background: "#fffbeb", border: "#fde68a", title: "#92400e", body: "#92400e" }
      : { background: "#f5f3ff", border: "#ddd6fe", title: "#5b21b6", body: "#5b21b6" };
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:separate;border-spacing:0;background:${palette.background};border:1px solid ${palette.border};border-radius:12px;margin:0 0 24px;"><tr><td style="padding:16px;font-family:Arial,sans-serif;">
    <p style="margin:0 0 4px;color:${palette.title};font-size:14px;font-weight:700;line-height:1.4;">${escapeHtml(title)}</p>
    <p style="margin:0;color:${palette.body};font-size:13px;line-height:1.6;">${escapeHtml(message).replace(/\n/g, "<br>")}</p>
  </td></tr></table>`;
}

function buildEmailButton(label, url, secondary = false) {
  const href = safeHttpUrl(url);
  if (!href) return "";
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:separate;margin:${secondary ? "10px" : "0"} auto 0;"><tr><td bgcolor="${secondary ? "#ffffff" : "#6d28d9"}" style="border:${secondary ? "1px solid #cbd5e1" : "1px solid #6d28d9"};border-radius:8px;text-align:center;"><a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;color:${secondary ? "#334155" : "#ffffff"};font-family:Arial,sans-serif;font-size:14px;font-weight:700;line-height:1.2;text-decoration:none;">${escapeHtml(label)}</a></td></tr></table>`;
}

function buildEmailDocument({
  title,
  preheader = "",
  greeting = "",
  intro = "",
  bodyHtml = "",
  primaryAction = null,
  secondaryAction = null,
  reference = "",
  brandName = DEFAULT_EMAIL_BRAND,
  footerNote = "Questions? Reply to this email and we’ll be happy to help.",
  unsubscribeUrl = "",
  trackingPixelUrl = "",
}) {
  const primaryButton = primaryAction ? buildEmailButton(primaryAction.label, primaryAction.url) : "";
  const secondaryButton = secondaryAction ? buildEmailButton(secondaryAction.label, secondaryAction.url, true) : "";
  const unsubscribeHref = safeHttpUrl(unsubscribeUrl);
  const trackingHref = safeHttpUrl(trackingPixelUrl);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${escapeHtml(title)}</title>
<style>@media only screen and (max-width:620px){.email-shell{width:100%!important}.email-pad{padding-left:20px!important;padding-right:20px!important}.email-outer{padding:12px!important}}a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}</style></head>
<body style="margin:0;padding:0;background:#f1f5f9;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(preheader || intro || title)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f1f5f9" style="width:100%;border-collapse:collapse;background:#f1f5f9;"><tr><td class="email-outer" align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" class="email-shell" data-photoflow-email="true" style="width:600px;max-width:600px;border-collapse:separate;border-spacing:0;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
      <tr><td class="email-pad" bgcolor="#18181b" style="padding:24px 32px;background:#18181b;border-bottom:4px solid #7c3aed;">
        <p style="margin:0 0 10px;color:#c4b5fd;font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.8px;line-height:1.2;text-transform:uppercase;">${escapeHtml(brandName)}</p>
        <h1 style="margin:0;color:#ffffff;font-family:Arial,sans-serif;font-size:26px;font-weight:700;line-height:1.25;">${escapeHtml(title)}</h1>
      </td></tr>
      <tr><td class="email-pad" style="padding:30px 32px;color:#334155;font-family:Arial,sans-serif;">
        ${greeting ? `<p style="margin:0 0 12px;color:#0f172a;font-size:16px;font-weight:700;line-height:1.5;">${escapeHtml(greeting)}</p>` : ""}
        ${intro ? `<p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.7;">${escapeHtml(intro).replace(/\n/g, "<br>")}</p>` : ""}
        ${bodyHtml}
        ${(primaryButton || secondaryButton) ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-top:8px;"><tr><td align="center">${primaryButton}${secondaryButton}</td></tr></table>` : ""}
      </td></tr>
      <tr><td class="email-pad" bgcolor="#f8fafc" style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
        <p style="margin:0;color:#64748b;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;">${escapeHtml(footerNote)}</p>
        ${reference ? `<p style="margin:6px 0 0;color:#94a3b8;font-family:Arial,sans-serif;font-size:11px;line-height:1.5;">Reference: ${escapeHtml(reference)}</p>` : ""}
        ${unsubscribeHref ? `<p style="margin:8px 0 0;font-family:Arial,sans-serif;font-size:11px;line-height:1.5;"><a href="${escapeHtml(unsubscribeHref)}" style="color:#64748b;text-decoration:underline;">Unsubscribe from booking emails</a></p>` : ""}
      </td></tr>
    </table>
  </td></tr></table>
  ${trackingHref ? `<img src="${escapeHtml(trackingHref)}" width="1" height="1" style="display:none;border:0;" alt="">` : ""}
</body></html>`;
}

function buildEmailText({ title, greeting = "", intro = "", rows = [], sections = [], actions = [], reference = "", footerNote = "Questions? Reply to this email.", unsubscribeUrl = "" }) {
  return cleanPlainText([
    title,
    greeting,
    intro,
    ...rows.filter(row => row && row.value !== undefined && row.value !== null && String(row.value) !== "").map(row => `${row.label}: ${row.value}`),
    ...sections,
    ...actions.map(action => `${action.label}: ${safeHttpUrl(action.url)}`).filter(line => !line.endsWith(": ")),
    reference ? `Reference: ${reference}` : "",
    footerNote,
    safeHttpUrl(unsubscribeUrl) ? `Unsubscribe: ${safeHttpUrl(unsubscribeUrl)}` : "",
  ].filter(Boolean).join("\n\n"));
}

function decodeHtmlText(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Math.min(Number(code) || 0, 0x10ffff)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Math.min(parseInt(code, 16) || 0, 0x10ffff)));
}

function htmlToPlainText(html) {
  const htmlWithLinks = String(html || "").replace(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_match, _quote, href, label) => {
    const safeHref = safeHttpUrl(decodeHtmlText(href));
    return safeHref ? `${label} (${safeHref})` : label;
  });
  return cleanPlainText(decodeHtmlText(htmlWithLinks
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/div>|<\/tr>|<\/li>|<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n").trim()));
}

function prepareCustomEmail({ subject, html, text, brandName = DEFAULT_EMAIL_BRAND }) {
  const plainText = cleanPlainText(text || htmlToPlainText(html));
  const sourceHtml = String(html || "");
  const isProfessionalDocument = /^\s*<!doctype html>/i.test(sourceHtml)
    && sourceHtml.includes('class="email-shell" data-photoflow-email="true"');
  if (isProfessionalDocument) return { html: sourceHtml, text: plainText };
  const bodyHtml = html
    ? `<div style="color:#334155;font-family:Arial,sans-serif;font-size:15px;line-height:1.7;">${html}</div>`
    : cleanPlainText(text).split(/\n{2,}/).filter(Boolean).map(paragraph => `<p style="margin:0 0 16px;color:#334155;font-family:Arial,sans-serif;font-size:15px;line-height:1.7;">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("");
  return {
    html: buildEmailDocument({ title: String(subject || "Message"), preheader: plainText.slice(0, 140), bodyHtml, brandName }),
    text: plainText,
  };
}

// ── Email HTML builder ────────────────────────────────────────
function buildBookingEmailHtml({ clientName, eventTitle, date, time, duration, location,
  price, depositAmount, paymentMethod, remainingAmount, isFree, modifyUrl, bookingId,
  calendarUrl, trackingPixelUrl, unsubscribeUrl, status, paymentKind, brandName }) {
  const rows = bookingSummaryRows({ eventTitle, date, time, duration, location, price, depositAmount, paymentMethod, remainingAmount, isFree, paymentKind });
  const isConfirmed = status === "confirmed";
  const bankNote = paymentMethod === "bank"
    ? buildCallout("Bank transfer pending", `Use booking reference ${bookingId} as the payment description. Your booking will be confirmed once payment is received.`, "warning")
    : "";
  return buildEmailDocument({
    title: isConfirmed ? "Booking confirmed" : "Booking received",
    preheader: `${eventTitle} on ${formatDateNice(date)} at ${formatTime12(time)}`,
    greeting: `Hi ${clientName || "there"},`,
    intro: isConfirmed
      ? "Your session is confirmed. Keep this email handy for the date, time, payment status and booking link."
      : "We’ve received your booking. The summary below shows the current details and payment status.",
    bodyHtml: `${buildSummaryCard(rows)}${bankNote}`,
    primaryAction: safeHttpUrl(modifyUrl)
      ? { label: "View or manage booking", url: modifyUrl }
      : safeHttpUrl(calendarUrl) ? { label: "Add to Google Calendar", url: calendarUrl } : null,
    secondaryAction: safeHttpUrl(modifyUrl) && safeHttpUrl(calendarUrl)
      ? { label: "Add to Google Calendar", url: calendarUrl }
      : null,
    reference: bookingId,
    brandName,
    unsubscribeUrl,
    trackingPixelUrl,
  });
}

function bookingSummaryRows({ eventTitle, date, time, duration, location, price, depositAmount, paymentMethod, remainingAmount, isFree, paymentKind }) {
  const money = value => `$${Number(value) || 0}`;
  const rows = [
    { label: "Session", value: eventTitle || "Booking", emphasis: true },
    { label: "Date", value: formatDateNice(date) },
    { label: "Time", value: formatTime12(time), emphasis: true },
    { label: "Duration", value: formatDuration(duration) },
    location ? { label: "Location", value: location } : null,
  ];
  if (isFree) rows.push({ label: "Payment", value: "Free ✓", tone: "success", emphasis: true });
  else if (paymentMethod === "stripe" && paymentKind === "deposit" && Number(depositAmount) > 0) {
    rows.push({ label: "Deposit Paid", value: `${money(depositAmount)} ✓ Card`, tone: "success", emphasis: true });
    if (Number(remainingAmount) > 0) rows.push({ label: "Remaining Balance", value: money(remainingAmount), tone: "warning", emphasis: true });
  } else if (paymentMethod === "stripe" && paymentKind === "balance") {
    rows.push({ label: "Remaining Balance Paid", value: `${money(remainingAmount)} ✓ Card`, tone: "success", emphasis: true });
  } else if (paymentMethod === "bank" && Number(depositAmount) > 0) {
    rows.push({ label: "Deposit", value: `${money(depositAmount)} · Bank transfer pending`, tone: "warning", emphasis: true });
    if (Number(remainingAmount) > 0) rows.push({ label: "Remaining balance", value: money(remainingAmount), tone: "warning" });
  } else if (paymentMethod === "stripe") {
    rows.push({ label: "Payment", value: `${money(price)} ✓ Paid in Full`, tone: "success", emphasis: true });
  } else if (paymentMethod === "bank") {
    rows.push({ label: "Payment", value: `${money(price)} · Bank transfer pending`, tone: "warning", emphasis: true });
  } else {
    rows.push({ label: "Payment", value: "Not required or not yet selected" });
  }
  return rows.filter(Boolean);
}

function buildBookingEmailText(params) {
  const isConfirmed = params.status === "confirmed";
  const rows = bookingSummaryRows(params);
  const sections = params.paymentMethod === "bank"
    ? [`Bank transfer pending. Use booking reference ${params.bookingId} as the payment description. Your booking will be confirmed once payment is received.`]
    : [];
  return buildEmailText({
    title: isConfirmed ? "Booking confirmed" : "Booking received",
    greeting: `Hi ${params.clientName || "there"},`,
    intro: isConfirmed ? "Your session is confirmed." : "We’ve received your booking.",
    rows,
    sections,
    actions: [
      safeHttpUrl(params.modifyUrl) ? { label: "View or manage booking", url: params.modifyUrl } : null,
      safeHttpUrl(params.calendarUrl) ? { label: "Add to Google Calendar", url: params.calendarUrl } : null,
    ].filter(Boolean),
    reference: params.bookingId,
    unsubscribeUrl: params.unsubscribeUrl,
  });
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
  paymentKind = null,
  modifyToken, bookingId, appBaseUrl, store, status = "pending", paymentStatus = "unpaid",
  transport = null, fromAddress = null, brandName = DEFAULT_EMAIL_BRAND,
}) {
  const t = transport || getTransporter();
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

  const subject = cleanEmailSubject(status === "confirmed"
    ? `Booking Confirmed — ${eventTitle}`
    : `Booking Received — ${eventTitle}${paymentStatus === "pending-confirmation" || paymentStatus === "unpaid" ? " (payment pending)" : ""}`);

  const unsubscribeUrl = baseUrl && modifyToken
    ? `${baseUrl}/api/email/unsubscribe/${encodeURIComponent(bookingId)}?token=${encodeURIComponent(modifyToken)}`
    : null;

  const messageParams = {
    clientName, eventTitle, date, time, duration, location,
    price, depositAmount, paymentMethod, remainingAmount,
    isFree, modifyUrl, bookingId, calendarUrl, trackingPixelUrl, unsubscribeUrl, status, paymentKind, brandName,
  };
  const html = buildBookingEmailHtml(messageParams);
  const text = buildBookingEmailText(messageParams);

  try {
    const info = await t.sendMail({ from: fromAddress || getFromAddress(), to, subject, html, text });
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
function registerRoutes(app, store, options = {}) {
  const requireAuth = options.requireAuth || ((_req, _res, next) => next());
  const bookingConfirmationLimiter = rateLimit({
    windowMs: 15 * 60_000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: "Too many confirmation requests" },
  });
  app.get("/api/email/status", requireAuth, (_req, res) => {
    const configured = !!(process.env.EMAIL_SERVER_HOST && process.env.EMAIL_SERVER_USER && process.env.EMAIL_SERVER_PASSWORD);
    res.json({ configured, host: process.env.EMAIL_SERVER_HOST, user: process.env.EMAIL_SERVER_USER, from: getFromAddress() });
  });

  app.post("/api/email/test", requireAuth, async (_req, res) => {
    const t = getTransporter();
    if (!t) return res.status(400).json({ ok: false, error: "SMTP not configured" });
    try { await t.verify(); res.json({ ok: true }); }
    catch (err) { res.status(500).json({ ok: false, error: err.message }); }
  });

  app.post("/api/email/send", requireAuth, async (req, res) => {
    const t = getTransporter();
    if (!t) return res.status(400).json({ ok: false, error: "SMTP not configured" });
    const { to, subject, html, text, bookingId } = req.body;
    if (!to || !subject) return res.status(400).json({ ok: false, error: "Missing to/subject" });
    const recipient = String(to).trim().toLowerCase();
    if (recipient.length > 254 || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(recipient)) {
      return res.status(400).json({ ok: false, error: "A single valid recipient is required" });
    }
    if (String(html || "").length > 100_000 || String(text || "").length > 100_000) {
      return res.status(413).json({ ok: false, error: "Email content is too large" });
    }
    const safeSubject = cleanEmailSubject(subject, "");
    if (!safeSubject) return res.status(400).json({ ok: false, error: "Invalid subject" });
    const message = prepareCustomEmail({ subject: safeSubject, html, text, brandName: storeBrandName(store) });
    try {
      const info = await t.sendMail({ from: getFromAddress(), to: recipient, subject: safeSubject, ...message });
      if (bookingId && store) {
        appendEmailLog(store, bookingId, {
          id: randomUUID(),
          type: "custom-email",
          sentAt: new Date().toISOString(),
          subject: safeSubject,
          to: recipient,
        });
      }
      res.json({ ok: true, messageId: info.messageId });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
  });

  // Called by frontend after bank transfer or by Stripe webhook after card payment
  app.post("/api/email/booking-confirmation", bookingConfirmationLimiter, async (req, res) => {
    const bookings = store?.get("wv_bookings") || [];
    const booking = bookings.find(item => item.id === req.body?.bookingId && timingSafeTextEqual(item.modifyToken, req.body?.modifyToken));
    if (!booking) return res.status(401).json({ ok: false, error: "A valid booking capability is required" });
    const configuredBaseUrl = String(process.env.APP_BASE_URL || "").trim().replace(/\/$/, "");
    const appHost = String(process.env.APP_HOSTS || "book.zacmclients.photos").split(",")[0].trim();
    const appBaseUrl = configuredBaseUrl || `https://${appHost}`;
    const result = await sendBookingConfirmationEmail({
      to: booking.clientEmail,
      clientName: booking.clientName,
      eventTitle: booking.type,
      date: booking.date,
      time: booking.time,
      duration: booking.duration,
      location: booking.location || "",
      price: booking.paymentAmount || 0,
      depositAmount: booking.depositAmount || 0,
      paymentMethod: booking.paymentMethod || booking.depositMethod || "none",
      paymentKind: booking.lastPaymentKind || (booking.paymentStatus === "deposit-paid" ? "deposit" : booking.paymentStatus === "paid" ? "full" : null),
      modifyToken: booking.modifyToken,
      bookingId: booking.id,
      appBaseUrl,
      store,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      brandName: storeBrandName(store),
    });
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

  // ── Email unsubscribe ──────────────────────────────────────────────────────
  const unsubscribeLimiter = rateLimit({ windowMs: 15 * 60_000, max: 20, standardHeaders: true, legacyHeaders: false });
  const unsubscribePage = ({ bookingId, token, complete = false }) => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="robots" content="noindex"><title>${complete ? "Unsubscribed" : "Confirm unsubscribe"}</title>
<style>body{font-family:Georgia,serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0a;color:#d1d5db}.card{max-width:420px;text-align:center;padding:48px 32px;border:1px solid #1f2937;border-radius:12px;background:#111827}h1{font-size:1.5rem;margin-bottom:.5rem;color:#f9fafb}p{font-size:.9rem;line-height:1.6;color:#9ca3af}button{padding:12px 20px;border:0;border-radius:8px;background:#7c3aed;color:white;font-weight:700;cursor:pointer}</style></head>
<body><div class="card"><h1>${complete ? "You've been unsubscribed" : "Stop booking emails?"}</h1><p>${complete ? "You won't receive any more booking update emails for this session." : "Confirm that you no longer want reminders or updates for this booking."}</p>${complete ? "" : `<form method="post" action="/api/email/unsubscribe/${encodeURIComponent(bookingId)}"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit">Confirm unsubscribe</button></form>`}</div></body></html>`;

  // GET is deliberately read-only so email security scanners cannot unsubscribe.
  app.get("/api/email/unsubscribe/:bookingId", unsubscribeLimiter, (req, res) => {
    const { bookingId } = req.params;
    const bookings = store?.get("wv_bookings") || [];
    const booking = bookings.find(item => item.id === bookingId);
    const token = String(req.query.token || "");
    if (!booking || !token || !timingSafeTextEqual(token, booking.modifyToken)) return res.status(404).send("Unsubscribe link is invalid or expired");
    res.set({ "Content-Type": "text/html", "Cache-Control": "no-store" });
    res.send(unsubscribePage({ bookingId, token }));
  });

  app.post("/api/email/unsubscribe/:bookingId", unsubscribeLimiter, express.urlencoded({ extended: false, limit: "2kb" }), (req, res) => {
    const { bookingId } = req.params;
    const bookings = store?.get("wv_bookings") || [];
    const index = bookings.findIndex(item => item.id === bookingId);
    const token = String(req.body?.token || "");
    if (index < 0 || !token || !timingSafeTextEqual(token, bookings[index].modifyToken)) return res.status(404).send("Unsubscribe link is invalid or expired");
    if (!bookings[index].emailsDisabled) {
      bookings[index].emailsDisabled = true;
      store.set("wv_bookings", bookings);
      console.log(`📧 Unsubscribe: disabled emails for booking ${bookingId}`);
    }
    res.set({ "Content-Type": "text/html", "Cache-Control": "no-store" });
    res.send(unsubscribePage({ bookingId, token, complete: true }));
  });

  // Get email log for a booking (used by Admin page)
  app.get("/api/email/log/:bookingId", requireAuth, (req, res) => {
    const { bookingId } = req.params;
    if (!store) return res.json({ log: [] });
    try {
      const bookings = store.get("wv_bookings") || [];
      const booking = bookings.find(b => b.id === bookingId);
      res.json({ log: booking?.emailLog || [] });
    } catch { res.json({ log: [] }); }
  });

  // Send a reminder email for a booking
  app.post("/api/email/reminder", requireAuth, async (req, res) => {
    const t = getTransporter();
    if (!t) return res.status(400).json({ ok: false, error: "SMTP not configured" });

    const { bookingId, reminderType } = req.body; // reminderType: "payment" | "booking"
    if (!bookingId) return res.status(400).json({ ok: false, error: "Missing bookingId" });
    if (!store) return res.status(400).json({ ok: false, error: "No store" });

    const bookings = store.get("wv_bookings") || [];
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return res.status(404).json({ ok: false, error: "Booking not found" });

    // Respect the client's unsubscribe preference
    if (booking.emailsDisabled) {
      return res.status(200).json({ ok: false, reason: "unsubscribed", message: "Client has unsubscribed from booking emails" });
    }

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

    const subject = cleanEmailSubject(isPaymentReminder
      ? `Payment Reminder — ${booking.type || "Booking"}`
      : `Booking Reminder — ${booking.type || "Booking"} on ${formatDateNice(booking.date)}`);

    const trackingId = randomUUID();
    const trackingPixelUrl = appBaseUrl ? `${appBaseUrl}/api/email/open/${trackingId}` : null;
    const reminderParams = {
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
      trackingPixelUrl,
      brandName: storeBrandName(store),
    };
    const html = buildReminderEmailHtml(reminderParams);
    const text = buildReminderEmailText(reminderParams);

    try {
      const info = await t.sendMail({ from: getFromAddress(), to: booking.clientEmail, subject, html, text });
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
  app.post("/api/email/enquiry-received", requireAuth, async (req, res) => {
    const t = getTransporter();
    if (!t) return res.status(503).json({ ok: false, error: "SMTP not configured" });
    const { to, clientName, eventTitle, preferredDate, preferredStartTime, preferredEndTime, message } = req.body;
    if (!to || !clientName) return res.status(400).json({ ok: false, error: "Missing required fields" });
    const params = { clientName, eventTitle, preferredDate, preferredStartTime, preferredEndTime, message: message || "", brandName: storeBrandName(store) };
    const html = buildEnquiryReceivedHtml(params);
    const text = buildEnquiryEmailText("received", params);
    try {
      const info = await t.sendMail({ from: getFromAddress(), to, subject: "We've received your enquiry!", html, text });
      console.log(`📧 Enquiry received auto-reply sent to ${to}: ${info.messageId}`);
      res.json({ ok: true, messageId: info.messageId });
    } catch (err) {
      console.error("📧 Enquiry received email error:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Notify client when enquiry is accepted and booking created
  app.post("/api/email/enquiry-accepted", requireAuth, async (req, res) => {
    const t = getTransporter();
    if (!t) return res.status(503).json({ ok: false, error: "SMTP not configured" });
    const { to, clientName, eventTitle, preferredDate, preferredStartTime, preferredEndTime, bookingId, modifyToken } = req.body;
    if (!to || !clientName) return res.status(400).json({ ok: false, error: "Missing required fields" });
    const appBaseUrl = req.body.appBaseUrl || `${req.protocol}://${req.get("host")}`;
    const modifyUrl = modifyToken && appBaseUrl ? `${appBaseUrl}/booking/modify/${modifyToken}` : null;
    const params = { clientName, eventTitle, preferredDate, preferredStartTime, preferredEndTime, bookingId, modifyUrl, brandName: storeBrandName(store) };
    const html = buildEnquiryAcceptedHtml(params);
    const text = buildEnquiryEmailText("accepted", params);
    try {
      const info = await t.sendMail({ from: getFromAddress(), to, subject: "Your enquiry has been accepted!", html, text });
      console.log(`📧 Enquiry accepted email sent to ${to}: ${info.messageId}`);
      res.json({ ok: true, messageId: info.messageId });
    } catch (err) {
      console.error("📧 Enquiry accepted email error:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Notify client when enquiry is declined
  app.post("/api/email/enquiry-declined", requireAuth, async (req, res) => {
    const t = getTransporter();
    if (!t) return res.status(503).json({ ok: false, error: "SMTP not configured" });
    const { to, clientName, adminNote } = req.body;
    if (!to || !clientName) return res.status(400).json({ ok: false, error: "Missing required fields" });
    const params = { clientName, adminNote: adminNote || "", brandName: storeBrandName(store) };
    const html = buildEnquiryDeclinedHtml(params);
    const text = buildEnquiryEmailText("declined", params);
    try {
      const info = await t.sendMail({ from: getFromAddress(), to, subject: "Update on your photography enquiry", html, text });
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
  bookingId, modifyUrl, calendarUrl, trackingPixelUrl, brandName }) {
  const due = Number(remaining) > 0 ? Number(remaining) : Number(totalPrice) || 0;
  const rows = [
    { label: "Session", value: eventTitle || "Booking", emphasis: true },
    { label: "Date", value: formatDateNice(date) },
    { label: "Time", value: formatTime12(time), emphasis: true },
    { label: "Duration", value: formatDuration(duration) },
    isPaymentReminder ? { label: "Total", value: formatMoney(totalPrice) } : null,
    isPaymentReminder && Number(depositPaid) > 0 ? { label: "Deposit received", value: formatMoney(depositPaid), tone: "success" } : null,
    isPaymentReminder ? { label: "Amount due", value: formatMoney(due), tone: "warning", emphasis: true } : null,
  ].filter(Boolean);
  const callout = isPaymentReminder
    ? buildCallout("Payment outstanding", `Please use booking reference ${bookingId} as the payment description. If you’ve already paid, no action is needed.`, "warning")
    : buildCallout("Your session is coming up", "We’re looking forward to seeing you. Please review the date and time below and arrive ready for your session.", "success");
  return buildEmailDocument({
    title: isPaymentReminder ? "Payment reminder" : "Booking reminder",
    preheader: isPaymentReminder ? `${formatMoney(due)} remains due for ${eventTitle}` : `${eventTitle} is coming up on ${formatDateNice(date)}`,
    greeting: `Hi ${clientName || "there"},`,
    intro: isPaymentReminder
      ? "This is a friendly reminder that payment is still outstanding for your booking."
      : "A quick reminder with the details for your upcoming photography session.",
    bodyHtml: `${buildSummaryCard(rows)}${callout}`,
    primaryAction: safeHttpUrl(modifyUrl)
      ? { label: isPaymentReminder ? "View payment and booking" : "View or manage booking", url: modifyUrl }
      : safeHttpUrl(calendarUrl) ? { label: "Add to Google Calendar", url: calendarUrl } : null,
    secondaryAction: !isPaymentReminder && safeHttpUrl(modifyUrl) && safeHttpUrl(calendarUrl)
      ? { label: "Add to Google Calendar", url: calendarUrl }
      : null,
    reference: bookingId,
    trackingPixelUrl,
    brandName,
  });
}

function buildReminderEmailText(params) {
  const due = Number(params.remaining) > 0 ? Number(params.remaining) : Number(params.totalPrice) || 0;
  const rows = [
    { label: "Session", value: params.eventTitle || "Booking" },
    { label: "Date", value: formatDateNice(params.date) },
    { label: "Time", value: formatTime12(params.time) },
    { label: "Duration", value: formatDuration(params.duration) },
    params.isPaymentReminder ? { label: "Total", value: formatMoney(params.totalPrice) } : null,
    params.isPaymentReminder && Number(params.depositPaid) > 0 ? { label: "Deposit received", value: formatMoney(params.depositPaid) } : null,
    params.isPaymentReminder ? { label: "Amount due", value: formatMoney(due) } : null,
  ].filter(Boolean);
  return buildEmailText({
    title: params.isPaymentReminder ? "Payment reminder" : "Booking reminder",
    greeting: `Hi ${params.clientName || "there"},`,
    intro: params.isPaymentReminder ? "Payment is still outstanding for your booking." : "Your photography session is coming up.",
    rows,
    sections: params.isPaymentReminder ? [`Please use booking reference ${params.bookingId} as the payment description.`] : [],
    actions: [
      safeHttpUrl(params.modifyUrl) ? { label: "View or manage booking", url: params.modifyUrl } : null,
      !params.isPaymentReminder && safeHttpUrl(params.calendarUrl) ? { label: "Add to Google Calendar", url: params.calendarUrl } : null,
    ].filter(Boolean),
    reference: params.bookingId,
  });
}

// ── Enquiry Email HTML builders ───────────────────────────────

function buildEnquiryReceivedHtml({ clientName, eventTitle, preferredDate, preferredStartTime, preferredEndTime, message, brandName }) {
  const rows = enquirySummaryRows({ eventTitle, preferredDate, preferredStartTime, preferredEndTime });
  return buildEmailDocument({
    title: "Enquiry received",
    preheader: "We’ve received your photography enquiry.",
    greeting: `Hi ${clientName || "there"},`,
    intro: "Thanks for getting in touch. We’ve received your enquiry and will review the details shortly.",
    bodyHtml: `${buildSummaryCard(rows)}${message ? buildCallout("Your message", message) : ""}${buildCallout("What happens next", "We’ll confirm availability and contact you with the next steps.", "success")}`,
    brandName,
  });
}

function buildEnquiryAcceptedHtml({ clientName, eventTitle, preferredDate, preferredStartTime, preferredEndTime, bookingId, modifyUrl, brandName }) {
  const rows = enquirySummaryRows({ eventTitle, preferredDate, preferredStartTime, preferredEndTime });
  return buildEmailDocument({
    title: "Enquiry accepted",
    preheader: "Good news — your enquiry has been accepted.",
    greeting: `Hi ${clientName || "there"},`,
    intro: "Good news — we’d love to work with you. Your booking has been created with the details below.",
    bodyHtml: `${buildSummaryCard(rows)}${buildCallout("Next steps", "We’ll be in touch to confirm the remaining details and payment arrangements.", "success")}`,
    primaryAction: safeHttpUrl(modifyUrl) ? { label: "View your booking", url: modifyUrl } : null,
    reference: bookingId,
    brandName,
  });
}

function buildEnquiryDeclinedHtml({ clientName, adminNote, brandName }) {
  return buildEmailDocument({
    title: "An update on your enquiry",
    preheader: "An update from the photography team.",
    greeting: `Hi ${clientName || "there"},`,
    intro: "Thank you for considering us. Unfortunately, we’re unable to accommodate your enquiry at this time.",
    bodyHtml: `${adminNote ? buildCallout("A note from us", adminNote) : ""}<p style="margin:0;color:#475569;font-family:Arial,sans-serif;font-size:14px;line-height:1.7;">We hope to work with you in the future. You’re welcome to contact us again with different dates or requirements.</p>`,
    brandName,
  });
}

function enquirySummaryRows({ eventTitle, preferredDate, preferredStartTime, preferredEndTime }) {
  return [
    eventTitle ? { label: "Session", value: eventTitle, emphasis: true } : null,
    preferredDate ? { label: "Preferred date", value: formatDateNice(preferredDate) } : null,
    preferredStartTime || preferredEndTime
      ? { label: "Preferred time", value: [preferredStartTime, preferredEndTime].filter(Boolean).map(formatTime12).join(" – ") }
      : null,
  ].filter(Boolean);
}

function buildEnquiryEmailText(kind, params) {
  const rows = enquirySummaryRows(params);
  if (kind === "received") return buildEmailText({
    title: "Enquiry received",
    greeting: `Hi ${params.clientName || "there"},`,
    intro: "Thanks for getting in touch. We’ve received your enquiry and will contact you with the next steps.",
    rows,
    sections: params.message ? [`Your message:\n${cleanPlainText(params.message)}`] : [],
  });
  if (kind === "accepted") return buildEmailText({
    title: "Enquiry accepted",
    greeting: `Hi ${params.clientName || "there"},`,
    intro: "Good news — we’d love to work with you. Your booking has been created.",
    rows,
    actions: safeHttpUrl(params.modifyUrl) ? [{ label: "View your booking", url: params.modifyUrl }] : [],
    reference: params.bookingId,
  });
  return buildEmailText({
    title: "An update on your enquiry",
    greeting: `Hi ${params.clientName || "there"},`,
    intro: "Thank you for considering us. Unfortunately, we’re unable to accommodate your enquiry at this time.",
    sections: params.adminNote ? [`A note from us:\n${cleanPlainText(params.adminNote)}`] : [],
  });
}

// ── Invoice Paid Confirmation Email ──────────────────────────
async function sendInvoicePaidEmail(invoice, shareUrl) {
  const t = getTransporter();
  if (!t || !invoice?.to?.email) return { ok: false, reason: "not_configured" };

  const message = buildInvoicePaidEmail(invoice, shareUrl);

  try {
    const info = await t.sendMail({ from: getFromAddress(), to: invoice.to.email, ...message });
    console.log(`📧 Invoice paid confirmation sent to ${invoice.to.email}: ${info.messageId}`);
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error("📧 Invoice paid email error:", err.message);
    return { ok: false, error: err.message };
  }
}

function buildInvoicePaidEmail(invoice, shareUrl) {

  const sub = (invoice.items || []).reduce((s, it) => s + it.quantity * it.unitPrice, 0);
  const disc = invoice.discount || 0;
  const taxRate = invoice.tax || 0;
  const taxAmt = (sub - disc) * (taxRate / 100);
  const total = sub - disc + taxAmt;

  const paidAt = invoice.paidAt
    ? new Date(invoice.paidAt).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })
    : new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  const safeShareUrl = safeHttpUrl(shareUrl);
  const clientName = invoice.to?.name || "there";
  const invoiceNumber = String(invoice.number || "");
  const currency = String(invoice.currency || "AUD").toUpperCase().slice(0, 3);
  const rows = [
    { label: "Invoice", value: invoiceNumber, emphasis: true },
    { label: "Paid on", value: paidAt },
    { label: "Total paid", value: formatMoney(total, currency), tone: "success", emphasis: true },
  ];
  const subject = cleanEmailSubject(`Payment Received — ${invoiceNumber}`);
  const html = buildEmailDocument({
    title: "Payment received",
    preheader: `${formatMoney(total, currency)} received for invoice ${invoiceNumber}`,
    greeting: `Hi ${clientName},`,
    intro: "Thank you. We’ve received your payment and marked the invoice as paid.",
    bodyHtml: `${buildSummaryCard(rows)}${buildCallout("Payment complete", "No further action is required. Keep this email for your records.", "success")}`,
    primaryAction: safeShareUrl ? { label: "View invoice", url: safeShareUrl } : null,
    reference: invoiceNumber,
    brandName: invoice.from?.name || DEFAULT_EMAIL_BRAND,
  });
  const text = buildEmailText({
    title: "Payment received",
    greeting: `Hi ${clientName},`,
    intro: "Thank you. We’ve received your payment and marked the invoice as paid.",
    rows,
    actions: safeShareUrl ? [{ label: "View invoice", url: safeShareUrl }] : [],
    reference: invoiceNumber,
  });
  return { subject, html, text };
}

function buildBookingUpdateEmail({
  updateType,
  clientName,
  eventTitle,
  date,
  time,
  duration,
  location,
  bookingId,
  modifyUrl,
  previousDate,
  previousTime,
  brandName = DEFAULT_EMAIL_BRAND,
}) {
  const cancelled = updateType === "cancel" || updateType === "cancelled";
  const title = cancelled ? "Booking cancelled" : "Booking rescheduled";
  const rows = [
    { label: "Session", value: eventTitle || "Booking", emphasis: true },
    !cancelled && previousDate ? { label: "Previous date", value: formatDateNice(previousDate) } : null,
    !cancelled && previousTime ? { label: "Previous time", value: formatTime12(previousTime) } : null,
    { label: cancelled ? "Cancelled session date" : "New date", value: formatDateNice(date) },
    { label: cancelled ? "Cancelled session time" : "New time", value: formatTime12(time), emphasis: !cancelled },
    Number(duration) > 0 ? { label: "Duration", value: formatDuration(duration) } : null,
    location ? { label: "Location", value: location } : null,
  ].filter(Boolean);
  const intro = cancelled
    ? "Your booking has been cancelled. The session details are included below for your records."
    : "Your booking has been moved. Please review the updated date and time below.";
  const callout = cancelled
    ? buildCallout("Cancellation confirmed", "No further action is required. If a payment was made, reply to this email with any refund questions.", "warning")
    : buildCallout("Schedule updated", "Please update any personal calendar entries. The booking link always shows the latest details.", "success");
  const subject = cleanEmailSubject(`${title} — ${eventTitle || "Booking"}`);
  return {
    subject,
    html: buildEmailDocument({
      title,
      preheader: cancelled ? `${eventTitle || "Your session"} has been cancelled.` : `${eventTitle || "Your session"} is now ${formatDateNice(date)} at ${formatTime12(time)}.`,
      greeting: `Hi ${clientName || "there"},`,
      intro,
      bodyHtml: `${buildSummaryCard(rows)}${callout}`,
      primaryAction: safeHttpUrl(modifyUrl) ? { label: "View booking details", url: modifyUrl } : null,
      reference: bookingId,
      brandName,
    }),
    text: buildEmailText({
      title,
      greeting: `Hi ${clientName || "there"},`,
      intro,
      rows,
      actions: safeHttpUrl(modifyUrl) ? [{ label: "View booking details", url: modifyUrl }] : [],
      reference: bookingId,
    }),
  };
}

async function sendBookingUpdateEmail({ transport = null, fromAddress = null, to, store = null, ...params }) {
  const t = transport || getTransporter();
  if (!t) return { ok: false, reason: "not_configured" };
  const message = buildBookingUpdateEmail(params);
  try {
    const info = await t.sendMail({ from: fromAddress || getFromAddress(), to, ...message });
    if (store && params.bookingId) {
      appendEmailLog(store, params.bookingId, {
        id: randomUUID(),
        type: params.updateType === "cancel" || params.updateType === "cancelled" ? "booking-cancelled" : "booking-rescheduled",
        sentAt: new Date().toISOString(),
        subject: message.subject,
        to,
      });
    }
    return { ok: true, messageId: info.messageId };
  } catch (error) {
    return { ok: false, error: error?.message || "Email delivery failed" };
  }
}

function buildGalleryDeliveryEmail({ clientName, albumTitle, galleryUrl, accessCode = "", photoCount, brandName = DEFAULT_EMAIL_BRAND }) {
  const safeGalleryUrl = safeHttpUrl(galleryUrl);
  const rows = [
    { label: "Gallery", value: albumTitle || "Photo gallery", emphasis: true },
    Number(photoCount) > 0 ? { label: "Photos", value: String(Math.floor(Number(photoCount))) } : null,
    accessCode ? { label: "Access code", value: accessCode, emphasis: true } : null,
  ].filter(Boolean);
  const subject = cleanEmailSubject(`Your gallery is ready — ${albumTitle || "Photo gallery"}`);
  return {
    subject,
    html: buildEmailDocument({
      title: "Your gallery is ready",
      preheader: `${albumTitle || "Your photo gallery"} is ready to view.`,
      greeting: `Hi ${clientName || "there"},`,
      intro: "Your photographs are ready. Use the secure gallery link below to view and download the available images.",
      bodyHtml: `${buildSummaryCard(rows)}${accessCode ? buildCallout("Keep your access code private", "Enter the code shown above when the gallery asks for it. Please do not post it publicly.") : ""}`,
      primaryAction: safeGalleryUrl ? { label: "View and download gallery", url: safeGalleryUrl } : null,
      brandName,
    }),
    text: buildEmailText({
      title: "Your gallery is ready",
      greeting: `Hi ${clientName || "there"},`,
      intro: "Your photographs are ready to view and download.",
      rows,
      actions: safeGalleryUrl ? [{ label: "Open gallery", url: safeGalleryUrl }] : [],
    }),
  };
}

function buildClientPortalEmail({ albums = [], brandName = DEFAULT_EMAIL_BRAND }) {
  const safeAlbums = albums.map(album => ({ title: String(album?.title || "Photo gallery"), url: safeHttpUrl(album?.url) })).filter(album => album.url);
  const linksHtml = safeAlbums.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:separate;border-spacing:0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">${safeAlbums.map((album, index) => `<tr><td style="padding:14px 16px;${index ? "border-top:1px solid #e2e8f0;" : ""}"><a href="${escapeHtml(album.url)}" style="color:#6d28d9;font-family:Arial,sans-serif;font-size:14px;font-weight:700;line-height:1.5;text-decoration:none;">${escapeHtml(album.title)} →</a></td></tr>`).join("")}</table>`
    : buildCallout("No active galleries", "There are currently no active galleries available from this photographer.");
  const subject = cleanEmailSubject(`Your galleries from ${brandName}`);
  return {
    subject,
    html: buildEmailDocument({
      title: "Your client galleries",
      preheader: `${safeAlbums.length} secure ${safeAlbums.length === 1 ? "gallery is" : "galleries are"} available.`,
      intro: "Use the secure links below to return to your available galleries. These links are intended only for you.",
      bodyHtml: linksHtml,
      brandName,
      footerNote: "If you did not request these links, you can safely ignore this email.",
    }),
    text: buildEmailText({
      title: "Your client galleries",
      intro: "Use the secure links below to return to your available galleries. These links are intended only for you.",
      actions: safeAlbums.map(album => ({ label: album.title, url: album.url })),
      footerNote: "If you did not request these links, you can safely ignore this email.",
    }),
  };
}

function buildWaitlistEmail({ clientName, eventTitle, date, bookingUrl, brandName = DEFAULT_EMAIL_BRAND }) {
  const safeBookingUrl = safeHttpUrl(bookingUrl);
  const rows = [
    { label: "Session", value: eventTitle || "Requested session", emphasis: true },
    date ? { label: "Date", value: formatDateNice(date) || date } : null,
  ].filter(Boolean);
  const subject = cleanEmailSubject(`A spot opened up for ${eventTitle || "your session"}`);
  return {
    subject,
    html: buildEmailDocument({
      title: "A spot is available",
      preheader: `Availability opened for ${eventTitle || "your requested session"}.`,
      greeting: `Hi ${clientName || "there"},`,
      intro: "A spot has opened for a session you joined the waitlist for. Availability may be limited and is not held until booking is completed.",
      bodyHtml: buildSummaryCard(rows),
      primaryAction: safeBookingUrl ? { label: "Check availability and book", url: safeBookingUrl } : null,
      brandName,
    }),
    text: buildEmailText({
      title: "A spot is available",
      greeting: `Hi ${clientName || "there"},`,
      intro: "A spot has opened for a session you joined the waitlist for. Availability is not held until booking is completed.",
      rows,
      actions: safeBookingUrl ? [{ label: "Check availability and book", url: safeBookingUrl }] : [],
    }),
  };
}

function buildAdminAlertEmail({ title, intro = "", rows = [], message = "", actionUrl = "", actionLabel = "Open in admin", brandName = DEFAULT_EMAIL_BRAND }) {
  const safeActionUrl = safeHttpUrl(actionUrl);
  return {
    html: buildEmailDocument({
      title: title || "New notification",
      preheader: intro || title,
      intro,
      bodyHtml: `${buildSummaryCard(rows)}${message ? buildCallout("Message", message) : ""}`,
      primaryAction: safeActionUrl ? { label: actionLabel, url: safeActionUrl } : null,
      brandName,
      footerNote: "This administrative notification was generated by your photography platform.",
    }),
    text: buildEmailText({
      title: title || "New notification",
      intro,
      rows,
      sections: message ? [`Message:\n${cleanPlainText(message)}`] : [],
      actions: safeActionUrl ? [{ label: actionLabel, url: safeActionUrl }] : [],
      footerNote: "This administrative notification was generated by your photography platform.",
    }),
  };
}

function buildAutomationEmail({ subject, body, booking = {}, brandName = DEFAULT_EMAIL_BRAND }) {
  const safeSubject = cleanEmailSubject(subject || "Booking update", "Booking update");
  const safeBody = cleanPlainText(body || `Hi ${booking.clientName || "there"}, this is a reminder about your ${booking.type || "booking"}.`);
  const rows = [
    booking.type ? { label: "Session", value: booking.type, emphasis: true } : null,
    booking.date ? { label: "Date", value: formatDateNice(booking.date) } : null,
    booking.time ? { label: "Time", value: formatTime12(booking.time) } : null,
  ].filter(Boolean);
  return {
    subject: safeSubject,
    html: buildEmailDocument({
      title: safeSubject,
      preheader: safeBody.slice(0, 140),
      bodyHtml: `${buildCallout("Message", safeBody)}${buildSummaryCard(rows)}`,
      reference: booking.id,
      brandName,
    }),
    text: buildEmailText({ title: safeSubject, sections: [safeBody], rows, reference: booking.id }),
  };
}

/**
 * Send an email using the provided SMTP configuration.
 * This is a low-level helper used by routes that need to send a one-off email
 * with explicit SMTP credentials (e.g. tenant email send, album delivery).
 *
 * @param {{ host, port, user, pass, secure, from }} smtpConfig
 * @param {{ to, subject, html, text }} message
 */
async function sendEmail(smtpConfig, message) {
  const { host, port, user, pass, secure, from } = smtpConfig || {};
  if (!host || !user || !pass) throw new Error("SMTP not configured");
  const transporter = nodemailer.createTransport({
    host,
    port: Number(port) || 587,
    secure: !!secure,
    auth: { user, pass },
  });
  const subject = cleanEmailSubject(message?.subject || "Message");
  const prepared = prepareCustomEmail({
    subject,
    html: message?.html,
    text: message?.text,
    brandName: smtpConfig?.brandName || DEFAULT_EMAIL_BRAND,
  });
  return transporter.sendMail({
    from: from || user,
    to: message?.to,
    subject,
    ...prepared,
  });
}

module.exports = {
  registerRoutes,
  getTransporter,
  getFromAddress,
  buildTenantTransporter,
  getTenantFromAddress,
  escapeHtml,
  safeHttpUrl,
  buildEmailDocument,
  prepareCustomEmail,
  buildBookingEmailHtml,
  buildBookingEmailText,
  sendBookingConfirmationEmail,
  buildReminderEmailHtml,
  buildReminderEmailText,
  buildEnquiryReceivedHtml,
  buildEnquiryAcceptedHtml,
  buildEnquiryDeclinedHtml,
  buildEnquiryEmailText,
  buildInvoicePaidEmail,
  sendInvoicePaidEmail,
  buildBookingUpdateEmail,
  sendBookingUpdateEmail,
  buildGalleryDeliveryEmail,
  buildClientPortalEmail,
  buildWaitlistEmail,
  buildAdminAlertEmail,
  buildAutomationEmail,
  sendEmail,
};
