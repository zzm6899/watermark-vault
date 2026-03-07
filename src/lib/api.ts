/**
 * API client for the Watermark Vault backend server.
 * When running in Docker with the Node.js backend, data persists to disk.
 * When running without backend (e.g. Lovable preview), falls back silently to localStorage-only.
 */

let serverAvailable: boolean | null = null;

async function checkServer(): Promise<boolean> {
  if (serverAvailable !== null) return serverAvailable;
  try {
    const res = await fetch("/api/health", { signal: AbortSignal.timeout(2000) });
    serverAvailable = res.ok;
  } catch {
    serverAvailable = false;
  }
  return serverAvailable;
}

/** Fetch all stored data from server and populate localStorage */
export async function syncFromServer(): Promise<boolean> {
  if (!(await checkServer())) return false;
  try {
    const res = await fetch("/api/store");
    if (!res.ok) return false;
    const data = await res.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    const SESSION_KEY = "wv_session";
    for (const [key, value] of Object.entries(data)) {
      // Never restore session from server — auth must always be re-done per browser
      if (key === SESSION_KEY) continue;
      // Server store values are often already JSON strings
      localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    console.log("✅ Synced from server");
    return true;
  } catch {
    return false;
  }
}

// Queue for writes that arrive before server availability is confirmed
const _writeQueue: Array<{ key: string; value: unknown }> = [];
let _flushScheduled = false;

async function _flushQueue() {
  if (!(await checkServer())) { _writeQueue.length = 0; return; }
  while (_writeQueue.length > 0) {
    const item = _writeQueue.shift()!;
    fetch(`/api/store/${encodeURIComponent(item.key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: item.value }),
    }).catch(() => {});
  }
  _flushScheduled = false;
}

/** Fire-and-forget persist a key to the server.
 *  If the server check hasn't completed yet, queues the write and flushes once it has. */
export function persistToServer(key: string, value: unknown): void {
  if (serverAvailable === true) {
    // Fast path — server known available
    fetch(`/api/store/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    }).catch(() => {});
    return;
  }
  if (serverAvailable === false) return; // No server, drop write

  // serverAvailable is null — queue and flush once check completes
  // Deduplicate: if same key is already queued, replace it
  const existing = _writeQueue.findIndex(w => w.key === key);
  if (existing >= 0) _writeQueue[existing].value = value;
  else _writeQueue.push({ key, value });

  if (!_flushScheduled) {
    _flushScheduled = true;
    _flushQueue();
  }
}

/** Fire-and-forget delete a key from the server */
export function deleteFromServer(key: string): void {
  if (serverAvailable !== true) return;
  fetch(`/api/store/${encodeURIComponent(key)}`, {
    method: "DELETE",
  }).catch(() => {});
}

/** Upload photo files to the server. Returns URLs, or empty array if server unavailable. */
export async function uploadPhotosToServer(
  files: File[],
  onProgress?: (done: number, total: number) => void
): Promise<{ id: string; url: string; originalName: string; size: number }[]> {
  if (!(await checkServer())) return [];
  const results: { id: string; url: string; originalName: string; size: number }[] = [];

  // Upload in batches of 10 for progress feedback
  const batchSize = 10;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const form = new FormData();
    batch.forEach((f) => form.append("photos", f));
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (res.ok) {
        const data = await res.json();
        results.push(...data.files);
      }
    } catch {
      // skip failed batch
    }
    onProgress?.(Math.min(i + batchSize, files.length), files.length);
  }
  return results;
}

/** Delete a photo file from the server */
export function deletePhotoFromServer(url: string): void {
  if (serverAvailable !== true) return;
  const filename = url.split("/").pop();
  if (!filename) return;
  fetch(`/api/upload/${encodeURIComponent(filename)}`, { method: "DELETE" }).catch(() => {});
}

/** Check if the backend server is available */
export function isServerMode(): boolean {
  return serverAvailable === true;
}

export async function recheckServer(): Promise<boolean> {
  try {
    const res = await fetch("/api/health", { method: "GET", signal: AbortSignal.timeout(3000) });
    serverAvailable = res.ok;
    return res.ok;
  } catch {
    serverAvailable = false;
    return false;
  }
}

/** Fetch server-side storage stats (TrueNAS volume) */
export async function getServerStorageStats(): Promise<{
  totalBytes: number;
  photoCount: number;
  dbSizeBytes: number;
  uploadsSizeBytes: number;
  photoFiles: { name: string; size: number; modified: string }[];
  allFileNames: string[];
  disk: { totalBytes: number; usedBytes: number; availableBytes: number; mountPoint: string } | null;
  dataDir: string;
} | null> {
  if (!(await checkServer())) return null;
  try {
    const res = await fetch("/api/storage");
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export type CacheBreakdown = {
  thumb_wm: number; thumb_clean: number;
  medium_wm: number; medium_clean: number;
  full_wm: number; full_clean: number;
  other: number; totalBytes: number;
};

/** Fetch server-side image cache stats (counts per variant type, no clearing). */
export async function getCacheStats(): Promise<{ total: number; breakdown: CacheBreakdown } | null> {
  if (!(await checkServer())) return null;
  try {
    const res = await fetch("/api/cache/stats");
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Stream warm-cache progress. Calls onProgress for each chunk until done.
 *  mode="warm"  → thumbnails only, skip already-cached files
 *  mode="force" → all variants (thumb + medium + full), overwrite everything
 */
export async function warmCache(
  mode: "warm" | "force",
  onProgress: (p: { done: number; total: number; generated: number; skipped: number; failed: number; stage: string }) => void
): Promise<{ ok: boolean; generated: number; skipped: number; failed: number } | null> {
  if (!(await checkServer())) return null;
  try {
    const res = await fetch(`/api/cache/warm?mode=${mode}`, { method: "POST" });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let last = { ok: false, generated: 0, skipped: 0, failed: 0 };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.progress) onProgress(data);
          else last = data;
        } catch { /* ignore malformed */ }
      }
    }
    return last;
  } catch {
    return null;
  }
}

// ── Stripe ──────────────────────────────────────────────

export async function getStripeStatus(): Promise<{ configured: boolean; publishableKey: string | null }> {
  if (!(await checkServer())) return { configured: false, publishableKey: null };
  try {
    const res = await fetch("/api/stripe/status");
    if (!res.ok) return { configured: false, publishableKey: null };
    return await res.json();
  } catch {
    return { configured: false, publishableKey: null };
  }
}

export async function createBookingCheckout(params: {
  bookingId: string;
  clientName: string;
  clientEmail: string;
  amount: number;
  eventTitle: string;
  modifyToken?: string;   // used to build the Stripe success redirect URL
}): Promise<{ url?: string; error?: string }> {
  try {
    const res = await fetch("/api/stripe/checkout/booking", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
    });
    return await res.json();
  } catch { return { error: "Network error" }; }
}

export async function createAlbumCheckout(params: {
  albumId: string; albumTitle: string; photoCount: number; amount: number; clientEmail?: string;
  photoIds?: string[];
  isFullAlbum?: boolean;
  sessionKey?: string;
}): Promise<{ url?: string; error?: string }> {
  try {
    const res = await fetch("/api/stripe/checkout/album", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
    });
    return await res.json();
  } catch { return { error: "Network error" }; }
}

// ── Email (SMTP) ───────────────────────────────────────

export async function getEmailStatus(): Promise<{ configured: boolean; host: string | null; user: string | null; from: string | null }> {
  if (!(await checkServer())) return { configured: false, host: null, user: null, from: null };
  try {
    const res = await fetch("/api/email/status");
    if (!res.ok) return { configured: false, host: null, user: null, from: null };
    return await res.json();
  } catch {
    return { configured: false, host: null, user: null, from: null };
  }
}

export async function testEmailConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/email/test", { method: "POST" });
    return await res.json();
  } catch {
    return { ok: false, error: "Network error" };
  }
}

export async function sendEmail(to: string, subject: string, html?: string, text?: string): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const res = await fetch("/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, html, text }),
    });
    return await res.json();
  } catch {
    return { ok: false, error: "Network error" };
  }
}

// ── Google Calendar ─────────────────────────────────────

export async function getGoogleCalendarStatus(): Promise<{ configured: boolean; connected: boolean; email: string | null }> {
  if (!(await checkServer())) return { configured: false, connected: false, email: null };
  try {
    const res = await fetch("/api/integrations/googlecalendar/status");
    if (!res.ok) return { configured: false, connected: false, email: null };
    return await res.json();
  } catch {
    return { configured: false, connected: false, email: null };
  }
}

export async function startGoogleCalendarAuth(): Promise<string | null> {
  try {
    const res = await fetch("/api/integrations/googlecalendar/auth");
    if (!res.ok) return null;
    const data = await res.json();
    return data.url || null;
  } catch {
    return null;
  }
}

export async function disconnectGoogleCalendar(): Promise<boolean> {
  try {
    const res = await fetch("/api/integrations/googlecalendar/disconnect", { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getGoogleCalendars(): Promise<{ id: string; summary: string; primary?: boolean }[]> {
  try {
    const res = await fetch("/api/integrations/googlecalendar/calendars");
    if (!res.ok) return [];
    const data = await res.json();
    return data.calendars || [];
  } catch {
    return [];
  }
}

export async function syncBookingToCalendar(booking: unknown, calendarId = "primary"): Promise<{ ok: boolean; eventId?: string }> {
  try {
    const res = await fetch("/api/integrations/googlecalendar/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ booking, calendarId }),
    });
    return await res.json();
  } catch {
    return { ok: false };
  }
}

export async function syncAllBookingsToCalendar(bookings: unknown[], calendarId = "primary"): Promise<{ ok: boolean; created?: number; errors?: number }> {
  try {
    const res = await fetch("/api/integrations/googlecalendar/sync-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookings, calendarId }),
    });
    return await res.json();
  } catch {
    return { ok: false };
  }
}

export async function sendBookingConfirmationEmail(params: {
  to: string;
  clientName: string;
  eventTitle: string;
  date: string;
  time: string;
  duration: number;
  location?: string;
  price: number;
  depositAmount?: number;
  paymentMethod: "stripe" | "bank" | "none";
  modifyToken?: string;
  bookingId: string;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  if (!(await checkServer())) return { ok: false, error: "Server unavailable" };
  try {
    const res = await fetch("/api/email/booking-confirmation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch {
    return { ok: false, error: "Network error" };
  }
}

// ── Email log ───────────────────────────────────────────────

/** Fetch the email log for a specific booking (admin use) */
export async function getBookingEmailLog(bookingId: string): Promise<{
  id: string; type: string; sentAt: string; openedAt?: string; subject: string; to: string;
}[]> {
  if (!(await checkServer())) return [];
  try {
    const res = await fetch(`/api/email/log/${encodeURIComponent(bookingId)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.log || [];
  } catch { return []; }
}

/** Send a payment or booking reminder email */
export async function sendBookingReminder(bookingId: string, reminderType: "payment" | "booking"): Promise<{ ok: boolean; error?: string }> {
  if (!(await checkServer())) return { ok: false, error: "Server unavailable" };
  try {
    const res = await fetch("/api/email/reminder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId, reminderType }),
    });
    return await res.json();
  } catch { return { ok: false, error: "Network error" }; }
}

/** Send a custom email to a client */
export async function sendCustomEmail(to: string, subject: string, html: string, text?: string, bookingId?: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await checkServer())) return { ok: false, error: "Server unavailable" };
  try {
    const res = await fetch("/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, html, text, bookingId }),
    });
    return await res.json();
  } catch { return { ok: false, error: "Network error" }; }
}

/** Send an auto-reply to a client when their enquiry is received */
export async function sendEnquiryReceivedEmail(params: {
  to: string;
  clientName: string;
  eventTitle?: string;
  preferredDate?: string;
  preferredStartTime?: string;
  preferredEndTime?: string;
  message: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!(await checkServer())) return { ok: false, error: "Server unavailable" };
  try {
    const res = await fetch("/api/email/enquiry-received", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch { return { ok: false, error: "Network error" }; }
}

/** Notify client that their enquiry has been accepted and a booking created */
export async function sendEnquiryAcceptedEmail(params: {
  to: string;
  clientName: string;
  eventTitle?: string;
  preferredDate?: string;
  preferredStartTime?: string;
  preferredEndTime?: string;
  bookingId: string;
  modifyToken?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!(await checkServer())) return { ok: false, error: "Server unavailable" };
  try {
    const res = await fetch("/api/email/enquiry-accepted", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch { return { ok: false, error: "Network error" }; }
}

/** Notify client that their enquiry has been declined */
export async function sendEnquiryDeclinedEmail(params: {
  to: string;
  clientName: string;
  adminNote?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!(await checkServer())) return { ok: false, error: "Server unavailable" };
  try {
    const res = await fetch("/api/email/enquiry-declined", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch { return { ok: false, error: "Network error" }; }
}

/** Get busy time blocks from Google Calendar for a date (YYYY-MM-DD).
 *  Booking page uses this to grey out already-occupied slots. */
export async function getGoogleBusyTimes(date: string): Promise<{ start: string; end: string }[]> {
  try {
    const res = await fetch(`/api/integrations/googlecalendar/busy?date=${encodeURIComponent(date)}`);
    if (!res.ok) return [];
    return (await res.json()).busy || [];
  } catch { return []; }
}

/** Update an existing Google Calendar event (booking rescheduled / status changed) */
export async function updateCalendarEvent(eventId: string, booking: unknown, calendarId = "primary"): Promise<{ ok: boolean }> {
  try {
    const res = await fetch(`/api/integrations/googlecalendar/event/${encodeURIComponent(eventId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ booking, calendarId }),
    });
    return await res.json();
  } catch { return { ok: false }; }
}

/** Delete a Google Calendar event (booking cancelled) */
export async function deleteCalendarEvent(eventId: string, calendarId = "primary"): Promise<{ ok: boolean }> {
  try {
    const res = await fetch(`/api/integrations/googlecalendar/event/${encodeURIComponent(eventId)}?calendarId=${encodeURIComponent(calendarId)}`, {
      method: "DELETE",
    });
    return await res.json();
  } catch { return { ok: false }; }
}

/** Save calendar settings (autoSync toggle, target calendar, timezone) */
export async function saveCalendarSettings(settings: { autoSync?: boolean; calendarId?: string; timeZone?: string }): Promise<{ ok: boolean }> {
  try {
    const res = await fetch("/api/integrations/googlecalendar/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    return await res.json();
  } catch { return { ok: false }; }
}

// ── Bulk file delete (orphan cleanup) ──────────────────

const BULK_DELETE_CHUNK_SIZE = 500;

export async function bulkDeleteFiles(filenames: string[]): Promise<{ ok: boolean; deleted: number }> {
  if (!(await checkServer())) return { ok: false, deleted: 0 };
  let totalDeleted = 0;
  try {
    for (let i = 0; i < filenames.length; i += BULK_DELETE_CHUNK_SIZE) {
      const chunk = filenames.slice(i, i + BULK_DELETE_CHUNK_SIZE);
      const res = await fetch("/api/upload/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filenames: chunk }),
      });
      const data = await res.json();
      if (data.deleted) totalDeleted += data.deleted;
    }
    return { ok: true, deleted: totalDeleted };
  } catch { return { ok: false, deleted: 0 }; }
}

// ── Google Sheets ──────────────────────────────────────

export async function getSheetsStatus(): Promise<{ connected: boolean; spreadsheetId: string | null; spreadsheetUrl: string | null }> {
  if (!(await checkServer())) return { connected: false, spreadsheetId: null, spreadsheetUrl: null };
  try {
    const res = await fetch("/api/integrations/sheets/status");
    if (!res.ok) return { connected: false, spreadsheetId: null, spreadsheetUrl: null };
    return await res.json();
  } catch { return { connected: false, spreadsheetId: null, spreadsheetUrl: null }; }
}

export async function syncBookingsToSheet(bookings: unknown[], eventTypes?: unknown[]): Promise<{ ok: boolean; url?: string; rows?: number; columns?: number; error?: string; needsReauth?: boolean }> {
  try {
    const res = await fetch("/api/integrations/sheets/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookings, eventTypes: eventTypes || [] }),
    });
    return await res.json();
  } catch { return { ok: false, error: "Network error" }; }
}
// ── Waitlist ────────────────────────────────────────────────
export async function joinWaitlist(entry: {
  eventTypeId: string;
  eventTypeTitle: string;
  date: string;
  clientName: string;
  clientEmail: string;
  note?: string;
}): Promise<{ ok: boolean; duplicate?: boolean; error?: string }> {
  try {
    const res = await fetch("/api/waitlist/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
    return await res.json();
  } catch { return { ok: false, error: "Network error" }; }
}

export async function getWaitlistEntries(): Promise<{ entries: import("./types").WaitlistEntry[] }> {
  try {
    const res = await fetch("/api/waitlist");
    return await res.json();
  } catch { return { entries: [] }; }
}

export async function deleteWaitlistEntry(id: string): Promise<{ ok: boolean }> {
  try {
    const res = await fetch(`/api/waitlist/${id}`, { method: "DELETE" });
    return await res.json();
  } catch { return { ok: false }; }
}

export async function notifyWaitlistOnCancel(booking: unknown): Promise<{ ok: boolean }> {
  try {
    const res = await fetch("/api/booking/cancel-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ booking }),
    });
    return await res.json();
  } catch { return { ok: false }; }
}

// ── Discord notifications ──────────────────────────────────
export async function notifyDiscord(payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch("/api/discord/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch { /* non-critical, swallow errors */ }
}

/** Send a Discord notification scoped to a specific tenant's webhook settings. */
export async function notifyTenantDiscord(slug: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch("/api/discord/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, tenantSlug: slug }),
    });
  } catch { /* non-critical, swallow errors */ }
}

/** Fetch all tenant webhook configurations (super admin only). */
export async function getSuperAdminWebhooks(): Promise<{
  ok: boolean;
  webhooks?: {
    tenantSlug: string;
    displayName: string;
    discordWebhookUrl: string | null;
    discordNotifyBookings: boolean;
    discordNotifyDownloads: boolean;
    discordNotifyProofing: boolean;
    discordNotifyInvoices: boolean;
  }[];
  error?: string;
}> {
  try {
    const res = await fetch("/api/super-admin/webhooks");
    if (!res.ok) return { ok: false, error: "Failed to fetch webhooks" };
    return await res.json();
  } catch {
    return { ok: false, error: "Network error" };
  }
}

// ── Invoices ───────────────────────────────────────────────────

/** Fetch a public invoice by its share token (server-only). */
export async function getInvoiceByToken(token: string): Promise<{ invoice?: import("./types").Invoice; error?: string }> {
  try {
    const res = await fetch(`/api/invoice/share/${encodeURIComponent(token)}`);
    if (!res.ok) return { error: "Invoice not found" };
    const invoice = await res.json();
    return { invoice };
  } catch {
    return { error: "Network error" };
  }
}

/** Create a Stripe Checkout session for an invoice. */
export async function createInvoiceCheckout(params: {
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  clientEmail?: string;
  amount: number;
  description?: string;
  shareToken: string;
}): Promise<{ url?: string; sessionId?: string; error?: string }> {
  try {
    const res = await fetch("/api/stripe/checkout/invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch {
    return { error: "Network error" };
  }
}

/** Send an invoice or payment-reminder email. The HTML body is built client-side. */
export async function sendInvoiceEmail(
  to: string,
  subject: string,
  html: string,
  text?: string,
): Promise<{ ok: boolean; error?: string }> {
  return sendEmail(to, subject, html, text);
}

// ── License Keys ───────────────────────────────────────────────

/** Fetch all license keys (admin only). */
export async function getLicenseKeys(): Promise<import("./types").LicenseKey[]> {
  try {
    const res = await fetch("/api/license-keys");
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/** Generate a new license key. */
export async function generateLicenseKey(
  issuedTo: string,
  expiresAt?: string,
  notes?: string,
  trialOptions?: { isTrial: boolean; trialMaxEvents?: number; trialMaxBookings?: number },
): Promise<{ key?: import("./types").LicenseKey; error?: string }> {
  try {
    const res = await fetch("/api/license-keys/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issuedTo, expiresAt, notes, ...trialOptions }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || "Failed to generate key" };
    return { key: data };
  } catch {
    return { error: "Network error" };
  }
}

/** Validate a license key during setup. Returns true if the key is valid and unused. */
export async function validateLicenseKey(
  key: string,
): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch("/api/license-keys/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    const data = await res.json();
    return { valid: !!data.valid, error: data.error };
  } catch {
    return { valid: false, error: "Network error" };
  }
}

/** Mark a license key as used after successful setup. */
export async function activateLicenseKey(
  key: string,
  usedBy: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/license-keys/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, usedBy }),
    });
    const data = await res.json();
    return { ok: !!data.ok, error: data.error };
  } catch {
    return { ok: false, error: "Network error" };
  }
}

/** Revoke (delete) a license key. */
export async function revokeLicenseKey(
  key: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/license-keys/${encodeURIComponent(key)}`, {
      method: "DELETE",
    });
    const data = await res.json();
    return { ok: !!data.ok, error: data.error };
  } catch {
    return { ok: false, error: "Network error" };
  }
}

// ── Tenants ────────────────────────────────────────────────────

/** Fetch all tenants. */
export async function getTenants(): Promise<import("./types").Tenant[]> {
  try {
    const res = await fetch("/api/tenants");
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

/** Create a tenant. */
export async function createTenant(data: {
  slug: string; displayName: string; email: string;
  bio?: string; timezone?: string; licenseKey?: string; passwordHash?: string;
}): Promise<{ tenant?: import("./types").Tenant; error?: string }> {
  try {
    const res = await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) return { error: json.error || "Failed to create tenant" };
    return { tenant: json };
  } catch { return { error: "Network error" }; }
}

/** Update a tenant. */
export async function updateTenant(slug: string, data: Partial<import("./types").Tenant>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/tenants/${encodeURIComponent(slug)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    return { ok: res.ok, error: json.error };
  } catch { return { ok: false, error: "Network error" }; }
}

/** Delete a tenant. */
export async function deleteTenant(slug: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/tenants/${encodeURIComponent(slug)}`, { method: "DELETE" });
    const json = await res.json();
    return { ok: !!json.ok, error: json.error };
  } catch { return { ok: false, error: "Network error" }; }
}

/** Fetch a tenant's public data (event types + profile) for the booking page. */
export async function getTenantPublicData(slug: string): Promise<{
  tenant: import("./types").Tenant;
  eventTypes: import("./types").EventType[];
} | null> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/public`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** Create a booking for a tenant's public page. */
export async function createTenantBooking(slug: string, booking: {
  clientName: string; clientEmail: string; date: string; time: string;
  eventTypeId?: string; type?: string; duration?: number; notes?: string;
  answers?: Record<string, string>;
}): Promise<{ ok: boolean; booking?: import("./types").Booking; error?: string }> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/booking`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(booking),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error };
    return { ok: true, booking: json.booking };
  } catch { return { ok: false, error: "Network error" }; }
}

/** Set tenant-specific event types (stored separately from main admin's event types). */
export async function setTenantEventTypes(slug: string, eventTypes: import("./types").EventType[]): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/store/wv_event_types`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: eventTypes }),
    });
    const json = await res.json();
    return { ok: !!json.ok, error: json.error };
  } catch { return { ok: false, error: "Network error" }; }
}

// ── Super Admin ────────────────────────────────────────────────

/** Get the super admin username configured via env vars. */
export async function getSuperAdminInfo(): Promise<{ superAdminUsername: string | null }> {
  try {
    const res = await fetch("/api/super-admin/info");
    if (!res.ok) return { superAdminUsername: null };
    return await res.json();
  } catch { return { superAdminUsername: null }; }
}

/** Get aggregate cross-tenant stats (super admin only). */
export async function getSuperStats(): Promise<{
  tenantCount: number; totalBookings: number; mainBookings: number;
  tenants: (import("./types").Tenant & { bookingCount: number; pendingBookings: number })[];
} | null> {
  try {
    const res = await fetch("/api/super/stats");
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** Get all bookings across all tenants (super admin only). */
export async function getAllBookings(): Promise<import("./types").Booking[]> {
  try {
    const res = await fetch("/api/super/all-bookings");
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

// ── Tenant Mobile Auth ─────────────────────────────────────────

/** Log in as a tenant (for mobile app). Returns the tenant profile on success. */
export async function tenantLogin(slug: string, passwordHash: string): Promise<{
  ok: boolean;
  tenant?: { slug: string; displayName: string; email: string; timezone?: string };
  error?: string;
}> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passwordHash }),
    });
    const json = await res.json();
    return { ok: !!json.ok, tenant: json.tenant, error: json.error };
  } catch { return { ok: false, error: "Network error" }; }
}

/** Fetch bookings + albums for a tenant (mobile app use). */
export async function fetchTenantMobileData(slug: string): Promise<{
  tenant: import("./types").Tenant;
  bookings: import("./types").Booking[];
  albums: import("./types").Album[];
} | null> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/mobile-data`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** Save (create or update) a tenant album from the mobile app. */
export async function saveTenantAlbum(slug: string, album: import("./types").Album): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/albums/${encodeURIComponent(album.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(album),
    });
    const json = await res.json();
    return { ok: !!json.ok, error: json.error };
  } catch { return { ok: false, error: "Network error" }; }
}

// ── License Plans ──────────────────────────────────────────────

/** Fetch all active license plans. */
export async function getLicensePlans(): Promise<import("./types").LicensePlan[]> {
  try {
    const res = await fetch("/api/license-plans/all");
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

/** Create a license plan. */
export async function createLicensePlan(data: {
  name: string; type: import("./types").LicensePlanType; price: number;
  currency?: string; durationDays?: number; description?: string; features?: string[];
}): Promise<{ plan?: import("./types").LicensePlan; error?: string }> {
  try {
    const res = await fetch("/api/license-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) return { error: json.error || "Failed to create plan" };
    return { plan: json };
  } catch { return { error: "Network error" }; }
}

/** Update a license plan. */
export async function updateLicensePlan(id: string, data: Partial<import("./types").LicensePlan>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/license-plans/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    return { ok: res.ok, error: json.error };
  } catch { return { ok: false, error: "Network error" }; }
}

/** Delete a license plan. */
export async function deleteLicensePlan(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/license-plans/${encodeURIComponent(id)}`, { method: "DELETE" });
    const json = await res.json();
    return { ok: !!json.ok, error: json.error };
  } catch { return { ok: false, error: "Network error" }; }
}

/** Create a Stripe checkout session for a license plan purchase. */
export async function getLicensePlanCheckout(planId: string, buyerEmail: string, buyerName?: string): Promise<{ url?: string; error?: string }> {
  try {
    const res = await fetch(`/api/license-plans/${encodeURIComponent(planId)}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buyerEmail, buyerName }),
    });
    const json = await res.json();
    if (!res.ok) return { error: json.error || "Checkout failed" };
    return { url: json.url };
  } catch { return { error: "Network error" }; }
}

/** Get all license plan purchases (admin only). */
export async function getLicensePurchases(): Promise<import("./types").LicensePurchase[]> {
  try {
    const res = await fetch("/api/license-plans/purchases");
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

/** Activate a pending bank-transfer license purchase (admin: confirm payment received). */
export async function activateBankPurchase(purchaseId: string): Promise<{ ok: boolean; key?: string; error?: string }> {
  try {
    const res = await fetch(`/api/license-plans/purchases/${encodeURIComponent(purchaseId)}/activate`, {
      method: "POST",
    });
    const json = await res.json();
    return { ok: !!json.ok, key: json.key, error: json.error };
  } catch { return { ok: false, error: "Network error" }; }
}

/** Create a pending bank-transfer license purchase (buyer pays manually; admin activates). */
export async function createBankLicensePurchase(planId: string, buyerEmail: string, buyerName?: string): Promise<{ ok: boolean; purchase?: import("./types").LicensePurchase; error?: string }> {
  try {
    const res = await fetch(`/api/license-plans/${encodeURIComponent(planId)}/bank-purchase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buyerEmail, buyerName }),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error || "Failed to create bank purchase" };
    return { ok: true, purchase: json.purchase };
  } catch { return { ok: false, error: "Network error" }; }
}

// ── Tenant Settings ────────────────────────────────────────────

/** Fetch per-tenant integration settings (Stripe, SMTP, Discord, bank). */
export async function getTenantSettings(slug: string): Promise<import("./types").TenantSettings> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/settings`);
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

/** Save per-tenant integration settings. */
export async function saveTenantSettings(
  slug: string,
  settings: import("./types").TenantSettings,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    const json = await res.json();
    return { ok: !!json.ok, error: json.error };
  } catch { return { ok: false, error: "Network error" }; }
}

/** Get the Stripe publishable key and configured status for a tenant. */
export async function getTenantStripeStatus(slug: string): Promise<{ configured: boolean; publishableKey?: string }> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/stripe/status`);
    if (!res.ok) return { configured: false };
    return await res.json();
  } catch { return { configured: false }; }
}


// ── Tenant Setup (via setup token) ─────────────────────────────────────────

/** Look up license key info by setup token. */
export async function getTenantSetupInfo(token: string): Promise<{
  key?: string;
  issuedTo?: string;
  isTrial?: boolean;
  trialMaxEvents?: number;
  trialMaxBookings?: number;
  expiresAt?: string;
  error?: string;
}> {
  try {
    const res = await fetch(`/api/tenant-setup/${encodeURIComponent(token)}`);
    const json = await res.json();
    if (!res.ok) return { error: json.error || "Invalid setup link" };
    return json;
  } catch { return { error: "Network error" }; }
}

/** Complete tenant setup: create tenant and activate license key. */
export async function completeTenantSetup(
  token: string,
  data: { slug: string; displayName: string; email: string; bio?: string; timezone?: string; passwordHash?: string },
): Promise<{ ok: boolean; tenant?: import("./types").Tenant; error?: string }> {
  try {
    const res = await fetch(`/api/tenant-setup/${encodeURIComponent(token)}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error || "Failed to complete setup" };
    return { ok: true, tenant: json.tenant };
  } catch { return { ok: false, error: "Network error" }; }
}

/** Delete a tenant booking (tenant admin). */
export async function deleteTenantBooking(slug: string, bookingId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/bookings/${encodeURIComponent(bookingId)}`, { method: "DELETE" });
    const json = await res.json();
    return { ok: !!json.ok, error: json.error };
  } catch { return { ok: false, error: "Network error" }; }
}

/** Full update of a tenant booking (tenant admin). */
export async function updateTenantBookingFull(slug: string, bookingId: string, data: Partial<import("./types").Booking>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/bookings/${encodeURIComponent(bookingId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    return { ok: !!json.ok, error: json.error };
  } catch { return { ok: false, error: "Network error" }; }
}

/** Delete a tenant album (tenant admin). */
export async function deleteTenantAlbum(slug: string, albumId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/albums/${encodeURIComponent(albumId)}`, { method: "DELETE" });
    const json = await res.json();
    return { ok: !!json.ok, error: json.error };
  } catch { return { ok: false, error: "Network error" }; }
}

/** Get tenant license key info (tenant admin). */
export async function getTenantLicenseInfo(slug: string): Promise<{
  key: string | null;
  issuedTo?: string;
  isTrial?: boolean;
  trialMaxEvents?: number;
  trialMaxBookings?: number;
  expiresAt?: string;
  usedAt?: string;
}> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/license-info`);
    if (!res.ok) return { key: null };
    return res.json();
  } catch { return { key: null }; }
}

/** Read any generic tenant store key (tenant admin). */
export async function getTenantStoreKey<T>(slug: string, key: string): Promise<T | null> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/store/${encodeURIComponent(key)}`);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.value === null) return null;
    return typeof json.value === "string" ? JSON.parse(json.value) : json.value;
  } catch { return null; }
}

/** Write any generic tenant store key (tenant admin). */
export async function saveTenantStoreKey(slug: string, key: string, value: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/store/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    const json = await res.json();
    return { ok: !!json.ok, error: json.error };
  } catch { return { ok: false, error: "Network error" }; }
}

/** Clear the tenant-specific watermark image cache so photos re-render with new watermark settings. */
export async function clearTenantImageCache(slug: string): Promise<{ ok: boolean; cleared?: number; error?: string }> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/cache/clear`, { method: "POST" });
    const json = await res.json();
    return { ok: !!json.ok, cleared: json.cleared, error: json.error };
  } catch { return { ok: false, error: "Network error" }; }
}

/** Return a photo src URL with ?tenant=slug appended (for tenant-specific watermark). */
export function tenantPhotoSrc(src: string, slug: string): string {
  if (!src || src.startsWith("data:") || !src.startsWith("/uploads/")) return src;
  const sep = src.includes("?") ? "&" : "?";
  if (src.includes(`tenant=${slug}`)) return src;
  return `${src}${sep}tenant=${encodeURIComponent(slug)}`;
}
