/**
 * API client for the Watermark Vault backend server.
 * When running in Docker with the Node.js backend, data persists to disk.
 * When running without backend (e.g. Lovable preview), falls back silently to localStorage-only.
 */

let serverAvailable: boolean | null = null;
let lastServerCheck = 0;

async function checkServer(): Promise<boolean> {
  const now = Date.now();
  // Cache true for 30s; always re-try false so a late server start is picked up
  if (serverAvailable === true && now - lastServerCheck < 30000) return true;
  try {
    const res = await fetch("/api/health", { signal: AbortSignal.timeout(3000) });
    serverAvailable = res.ok;
  } catch {
    serverAvailable = false;
  }
  lastServerCheck = Date.now();
  return serverAvailable ?? false;
}

/** Force a fresh reachability check — call before any critical upload */
export async function recheckServer(): Promise<boolean> {
  serverAvailable = null;
  return checkServer();
}

/** Fetch all stored data from server and populate localStorage */
export async function syncFromServer(): Promise<boolean> {
  if (!(await checkServer())) return false;
  try {
    const res = await fetch("/api/store");
    if (!res.ok) return false;
    const data = await res.json();
    for (const [key, value] of Object.entries(data)) {
      localStorage.setItem(key, JSON.stringify(value));
    }
    console.log("✅ Synced from server");
    return true;
  } catch {
    return false;
  }
}

/** Fire-and-forget persist a key to the server */
export function persistToServer(key: string, value: unknown): void {
  if (serverAvailable !== true) return;
  fetch(`/api/store/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  }).catch(() => { /* silent - localStorage is the source of truth for UI */ });
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
    } catch (err) {
      console.error("[upload] batch failed:", err);
      serverAvailable = null; // reset so next call re-checks
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

/** Fetch server-side storage stats (TrueNAS volume) */
export async function getServerStorageStats(): Promise<{
  totalBytes: number;
  photoCount: number;
  dbSizeBytes: number;
  uploadsSizeBytes: number;
  photoFiles: { name: string; size: number; modified: string }[];
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
  bookingId: string; clientName: string; clientEmail: string; amount: number; eventTitle: string;
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
