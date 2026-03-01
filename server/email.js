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

function registerRoutes(app) {
  // ── SMTP status ──────────────────────────────────────
  app.get("/api/email/status", (_req, res) => {
    const host = process.env.EMAIL_SERVER_HOST;
    const user = process.env.EMAIL_SERVER_USER;
    const from = getFromAddress();
    const configured = !!(host && user && process.env.EMAIL_SERVER_PASSWORD);
    res.json({ configured, host, user, from });
  });

  // ── Test connection ──────────────────────────────────
  app.post("/api/email/test", async (_req, res) => {
    const t = getTransporter();
    if (!t) return res.status(400).json({ ok: false, error: "SMTP not configured" });
    try {
      await t.verify();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Send email ───────────────────────────────────────
  app.post("/api/email/send", async (req, res) => {
    const t = getTransporter();
    if (!t) return res.status(400).json({ ok: false, error: "SMTP not configured" });

    const { to, subject, html, text } = req.body;
    if (!to || !subject) return res.status(400).json({ ok: false, error: "Missing 'to' or 'subject'" });

    try {
      const info = await t.sendMail({
        from: getFromAddress(),
        to,
        subject,
        html: html || undefined,
        text: text || undefined,
      });
      console.log(`📧 Email sent to ${to}: ${info.messageId}`);
      res.json({ ok: true, messageId: info.messageId });
    } catch (err) {
      console.error("Email send error:", err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}

module.exports = { registerRoutes, getTransporter, getFromAddress };
