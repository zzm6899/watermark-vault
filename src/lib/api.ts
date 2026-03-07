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
