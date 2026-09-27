const crypto = require("crypto");

const DEFAULT_PIXEL_ID = "765594655944429";
const GRAPH_API_VERSION = "v26.0";

function cookieValue(req, name) {
  const cookie = String(req.headers.cookie || "").split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  if (!cookie) return "";
  try { return decodeURIComponent(cookie.slice(name.length + 1)).slice(0, 500); }
  catch { return ""; }
}

function captureMetaCapiContext(req, enabled = !!String(process.env.META_CAPI_ACCESS_TOKEN || "").trim()) {
  if (!enabled) return null;
  let appUrl;
  try { appUrl = new URL(String(process.env.APP_BASE_URL || "https://book.zacmclients.photos")); }
  catch { appUrl = new URL("https://book.zacmclients.photos"); }
  let eventSourceUrl = `${appUrl.origin}/`;
  try {
    const referer = new URL(String(req.get("referer") || ""));
    const allowedHosts = new Set([
      ...String(process.env.APP_HOSTS || "book.zacmclients.photos").split(","),
      ...String(process.env.PUBLIC_SITE_HOSTS || "").split(","),
    ].map(host => host.trim().toLowerCase()).filter(Boolean));
    if (allowedHosts.has(referer.hostname.toLowerCase()) && ["http:", "https:"].includes(referer.protocol)) {
      eventSourceUrl = `${referer.origin}${referer.pathname}`;
    }
  } catch {}
  return {
    eventSourceUrl,
    clientIpAddress: req.ips?.length ? String(req.ip || "").slice(0, 100) : "",
    clientUserAgent: String(req.get("user-agent") || "").slice(0, 1000),
    fbp: cookieValue(req, "_fbp"),
    fbc: cookieValue(req, "_fbc"),
  };
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function sendScheduleEvent(booking, configuredAccessToken = process.env.META_CAPI_ACCESS_TOKEN) {
  const pixelId = String(process.env.META_PIXEL_ID || DEFAULT_PIXEL_ID).trim();
  const accessToken = String(configuredAccessToken || "").trim();
  const context = booking?.metaCapiContext;
  if (!pixelId || !accessToken || !context?.eventSourceUrl || !context.clientUserAgent) return false;

  const email = String(booking.clientEmail || "").trim().toLowerCase();
  const phone = String(booking.phone || "").replace(/\D/g, "");
  const userData = {
    ...(email ? { em: [hash(email)] } : {}),
    ...(phone ? { ph: [hash(phone)] } : {}),
    ...(context.clientIpAddress ? { client_ip_address: context.clientIpAddress } : {}),
    client_user_agent: context.clientUserAgent,
    ...(context.fbp ? { fbp: context.fbp } : {}),
    ...(context.fbc ? { fbc: context.fbc } : {}),
  };
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(pixelId)}/events`);
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      data: [{
        event_name: "Schedule",
        event_time: Math.floor(Date.now() / 1000),
        event_id: booking.id,
        action_source: "website",
        event_source_url: context.eventSourceUrl,
        user_data: userData,
      }],
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Meta Conversions API returned HTTP ${response.status}`);
  const result = await response.json();
  if (result.events_received !== 1) throw new Error("Meta did not accept the Schedule event");
  return true;
}

async function sendTestPurchaseEvent(accessToken, testEventCode) {
  const pixelId = String(process.env.META_PIXEL_ID || DEFAULT_PIXEL_ID).trim();
  if (!pixelId || !String(accessToken || "").trim() || !String(testEventCode || "").trim()) return false;
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(pixelId)}/events`);
  url.searchParams.set("access_token", String(accessToken).trim());
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      data: [{
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        event_id: `test-purchase-${crypto.randomUUID()}`,
        action_source: "website",
        event_source_url: String(process.env.APP_BASE_URL || "https://book.zacmclients.photos"),
        user_data: { em: [hash("test@example.com")], client_user_agent: "PhotoFlow Meta CAPI test" },
        custom_data: { currency: "AUD", value: 1 },
      }],
      test_event_code: String(testEventCode).trim(),
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Meta Conversions API returned HTTP ${response.status}`);
  const result = await response.json();
  if (result.events_received !== 1) throw new Error("Meta did not accept the test Purchase event");
  return true;
}

module.exports = { captureMetaCapiContext, sendScheduleEvent, sendTestPurchaseEvent };
