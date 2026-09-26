const KEY = "wv_pending_writes_v1";
const secrets = /^(password|passwordHash|smtpPassword|ftpPassword|stripeSecretKey|stripeWebhookSecret|discordWebhookUrl|googleApiCredentials|access_token|refresh_token|sessionToken)$/i;
export type PendingWrite = { key: string; value: unknown; error?: string; requiresCredentials?: boolean };

export function readPendingWrites(): PendingWrite[] {
  try {
    const rows = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(rows) ? rows.filter(row => row && typeof row.key === "string" && row.key !== "wv_admin" && row.key !== "wv_session") : [];
  } catch { return []; }
}

export function storePendingWrites(rows: PendingWrite[]) {
  // Credentials stay in memory only. A failed credential save must be retried
  // explicitly; an offline draft must never become a password store.
  const safe = rows.map(row => {
    let omitted = false;
    const value = JSON.parse(JSON.stringify(row.value, (key, value) => { if (secrets.test(key) && value) { omitted = true; return undefined; } return value; }));
    return omitted ? { ...row, value, requiresCredentials: true, error: "Re-enter changed credentials and save again; credentials are not stored in offline drafts" } : { ...row, value };
  });
  localStorage.setItem(KEY, JSON.stringify(safe));
  window.dispatchEvent(new Event("pending-writes-changed"));
}

export function hasPendingWrite(key: string) { return readPendingWrites().some(row => row.key === key); }
