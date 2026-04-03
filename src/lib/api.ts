/**
 * API client for the PhotoFlow backend server.
 * When running in Docker with the Node.js backend, data persists to disk.
 * When running without backend (e.g. Lovable preview), falls back silently to localStorage-only.
 */

let serverAvailable: boolean | null = null;

/**
 * Returns Authorization header for admin-protected endpoints.
 * Reads stored credentials synchronously so it can be used inline.
 *
 * The server expects Basic auth where the password field is the SHA-256 hash
 * of the user's password (NOT the bcrypt hash stored in wv_admin). After login,
 * LoginPage stores the sha256 hash in sessionStorage under "wv_admin_session_hash"
 * so we can reconstruct the correct credential here.
 */
function adminAuthHeaders(): Record<string, string> {
  try {
    // Read username from localStorage (synced from server, always available after login)
    const raw = localStorage.getItem("wv_admin");
    if (!raw) return {};
    const creds = JSON.parse(raw) as { username: string; passwordHash: string };
    if (!creds?.username) return {};

    // Prefer the sha256 hash stored in localStorage at login time — this is what
    // the server's verifyPasswordHash() expects as the "incoming" value.
    // Falls back to creds.passwordHash only if the hash was never stored (pre-fix sessions).
    const sessionHash = localStorage.getItem("wv_admin_session_hash");
    const passwordHash = sessionHash || creds.passwordHash;
    if (!passwordHash) return {};

    return { Authorization: "Basic " + btoa(`${creds.username}:${passwordHash}`) };
  } catch { return {}; }
}

/**
 * Wraps fetch with simple exponential-backoff retry logic.
 * Retries only on network errors (not on HTTP error statuses).
 * @param url      - URL to fetch
 * @param options  - standard RequestInit options
 * @param maxRetries - max additional attempts after the first (default 2 → 3 total)
 */
async function fetchWithRetry(url: string, options?: RequestInit, maxRetries = 2): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      return res; // return on any HTTP response (caller checks res.ok)
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        // Exponential backoff: 500 ms, 1 s, 2 s, …
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 500));
      }
    }
  }
  throw lastError;
}

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

// Keys that are small and required before the UI can render anything useful.
// These are fetched synchronously during app startup.
const CRITICAL_STORE_KEYS = [
  "wv_setup_complete",
  "wv_admin",
  "wv_profile",
  "wv_settings",
  "wv_event_types",
  "wv_email_templates",
  "wv_ftp_settings",
];

// Keys that can be large (contain full photo metadata, etc.) and are
// loaded in the background after the app is already interactive.
// NOTE: wv_albums is intentionally excluded — even stripped of baked assets
// the photos[] arrays (one entry per photo) are large and are needed only in
// the admin Albums tab.  Album stubs (no photos) are fetched by the admin via
// fetchAlbumStubs() so the booking page and other non-album routes never pay
// the download cost.
const LAZY_STORE_KEYS = [
  "wv_bookings",
  "wv_photo_library",
  "wv_invoices",
  "wv_contacts",
  "wv_enquiries",
  "wv_waitlist",
];

const SESSION_KEY = "wv_session";

/** Write a batch of key/value pairs from the server response into localStorage. */
function _applyStoreData(data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    // Never restore session from server — auth must always be re-done per browser
    if (key === SESSION_KEY) continue;

    // For the photo library, merge server data with any locally-added photos that
    // haven't been persisted to the server yet (e.g. uploaded just before the lazy
    // sync response arrived).  We take the server list as the authoritative base and
    // append any local photo entries whose IDs are not present on the server.  This
    // prevents the background sync from silently discarding photos that were uploaded
    // in the brief window between page load and the lazy-sync response arriving.
    if (key === "wv_photo_library") {
      try {
        const serverPhotos = (typeof value === "string" ? JSON.parse(value) : value) as Array<{ id: string }>;
        if (Array.isArray(serverPhotos)) {
          const localRaw = localStorage.getItem(key);
          const localPhotos = localRaw ? (JSON.parse(localRaw) as Array<{ id: string }>) : [];
          if (Array.isArray(localPhotos) && localPhotos.length > 0) {
            const serverIds = new Set(serverPhotos.map(p => p.id));
            const localOnly = localPhotos.filter(p => !serverIds.has(p.id));
            if (localOnly.length > 0) {
              localStorage.setItem(key, JSON.stringify([...serverPhotos, ...localOnly]));
              continue;
            }
          }
        }
      } catch { /* JSON.parse failure on corrupt data — fall through to normal write */ }
    }

    // Server store values are often already JSON strings
    localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  }
}

/**
 * Load a subset of store keys from the server and apply them to localStorage.
 * Returns false on any error.
 */
async function _fetchStoreKeys(keys: string[]): Promise<boolean> {
  try {
    const param = keys.map(encodeURIComponent).join(",");
    const res = await fetch(`/api/store?keys=${param}`);
    if (!res.ok) return false;
    const data = await res.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    _applyStoreData(data as Record<string, unknown>);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch all stored data from server and populate localStorage.
 *
 * Phase 1 (awaited): loads only small/critical keys so the app becomes
 *   interactive as fast as possible.
 * Phase 2 (background): loads large keys (albums, bookings, photo library, …)
 *   without blocking the caller.  These will be available in localStorage
 *   shortly after the UI first renders.
 */
export async function syncFromServer(): Promise<boolean> {
  if (!(await checkServer())) return false;
  // Phase 1 — critical keys only (fast)
  const ok = await _fetchStoreKeys(CRITICAL_STORE_KEYS);
  if (!ok) return false;
  console.log("✅ Synced critical keys from server");
  // Phase 2 — heavy keys in background (non-blocking)
  _fetchStoreKeys(LAZY_STORE_KEYS).then((lazyOk) => {
    if (lazyOk) console.log("✅ Synced lazy keys from server");
    else console.warn("⚠️ Failed to sync lazy keys from server");
  });
  return true;
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

// Separate queue for album writes (use the per-album PUT endpoint)
const _albumWriteQueue: Array<{ albumId: string; album: import("./types").Album }> = [];
let _albumFlushScheduled = false;

async function _flushAlbumQueue() {
  if (!(await checkServer())) { _albumWriteQueue.length = 0; return; }
  while (_albumWriteQueue.length > 0) {
    const item = _albumWriteQueue.shift()!;
    fetch(`/api/albums/${encodeURIComponent(item.albumId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item.album),
      keepalive: true,
    }).catch(() => {});
  }
  _albumFlushScheduled = false;
}

/** Fire-and-forget persist a key to the server.
 *  If the server check hasn't completed yet, queues the write and flushes once it has. */
export function persistToServer(key: string, value: unknown): void {
  if (serverAvailable === true) {
    // Fast path — server known available.
    // keepalive: true ensures the request survives a page unload / navigation
    // so that data written just before a reload is not silently dropped.
    fetch(`/api/store/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
      keepalive: true,
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

/** Fire-and-forget persist a single album to the server via the per-album endpoint.
 *  Unlike persistToServer("wv_albums", allAlbums), this only updates the one album
 *  so other albums' photos are never overwritten with stale stub (empty) data.
 *  keepalive: true ensures the request is not cancelled on page unload.
 *  If the server check has not yet completed, queues the write and flushes once it has. */
export function persistAlbumToServer(albumId: string, album: import("./types").Album): void {
  if (serverAvailable === false) return;
  if (serverAvailable === true) {
    fetch(`/api/albums/${encodeURIComponent(albumId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(album),
      keepalive: true,
    }).catch(() => {});
    return;
  }
  // serverAvailable is null — queue and flush once check completes.
  // Deduplicate: if the same album is already queued, replace it.
  const existing = _albumWriteQueue.findIndex(w => w.albumId === albumId);
  if (existing >= 0) _albumWriteQueue[existing].album = album;
  else _albumWriteQueue.push({ albumId, album });

  if (!_albumFlushScheduled) {
    _albumFlushScheduled = true;
    _flushAlbumQueue();
  }
}

/** Fire-and-forget delete a single album from the server. */
export function deleteAlbumFromServer(albumId: string): void {
  if (serverAvailable !== true) return;
  fetch(`/api/albums/${encodeURIComponent(albumId)}`, {
    method: "DELETE",
    keepalive: true,
  }).catch(() => {});
}

/** Fire-and-forget delete a key from the server */
export function deleteFromServer(key: string): void {
  if (serverAvailable !== true) return;
  fetch(`/api/store/${encodeURIComponent(key)}`, {
    method: "DELETE",
  }).catch(() => {});
}

export type UploadedPhotoResult = {
  id: string;
  url: string;
  originalName: string;
  size: number;
  ftpUploaded?: boolean;
  /** Actual image width extracted from server-side metadata (pixels). */
  width?: number;
  /** Actual image height extracted from server-side metadata (pixels). */
  height?: number;
  /** EXIF DateTimeOriginal as ISO-8601 string, when available. */
  takenAt?: string | null;
};

/** Upload photo files to the server. Returns URLs, or empty array if server unavailable.
 *  Uploads are split into batches and sent concurrently to maximise throughput. */
export async function uploadPhotosToServer(
  files: File[],
  onProgress?: (done: number, total: number, bytesPerSecond?: number) => void,
  tenantSlug?: string,
  concurrency = 3,
  albumFolder?: string,
): Promise<UploadedPhotoResult[]> {
  if (!(await checkServer())) return [];

  let uploadUrl = tenantSlug
    ? `/api/upload?tenant=${encodeURIComponent(tenantSlug)}`
    : "/api/upload";
  if (albumFolder) {
    uploadUrl += (uploadUrl.includes("?") ? "&" : "?") + `albumFolder=${encodeURIComponent(albumFolder)}`;
  }

  // Smaller batches improve granular progress feedback and concurrent throughput
  const batchSize = 5;
  const batches: File[][] = [];
  for (let i = 0; i < files.length; i += batchSize) {
    batches.push(files.slice(i, i + batchSize));
  }

  const results: UploadedPhotoResult[] = [];
  let done = 0;
  let doneBytes = 0;
  let batchIndex = 0;
  const startTime = Date.now();

  // Worker that keeps consuming batches until they're all dispatched
  const runWorker = async () => {
    while (batchIndex < batches.length) {
      const idx = batchIndex++;
      const batch = batches[idx];
      const batchBytes = batch.reduce((sum, f) => sum + f.size, 0);
      const form = new FormData();
      batch.forEach((f) => form.append("photos", f));
      try {
        const res = await fetch(uploadUrl, { method: "POST", body: form });
        if (res.ok) {
          const data = await res.json();
          results.push(...data.files);
        }
      } catch {
        // skip failed batch
      }
      done += batch.length;
      doneBytes += batchBytes;
      const elapsedSec = (Date.now() - startTime) / 1000;
      const bytesPerSecond = elapsedSec > 0 ? doneBytes / elapsedSec : 0;
      onProgress?.(Math.min(done, files.length), files.length, bytesPerSecond);
    }
  };

  // Run up to `concurrency` workers in parallel
  const workers = Array.from(
    { length: Math.min(concurrency, batches.length) },
    () => runWorker(),
  );
  await Promise.all(workers);

  return results;
}

/** Delete a photo file from the server */
export function deletePhotoFromServer(url: string): void {
  if (serverAvailable !== true) return;
  const filename = url.split("/").pop();
  if (!filename) return;
  fetch(`/api/upload/${encodeURIComponent(filename)}`, { method: "DELETE" }).catch(() => {});
}

/** Auto-enhance multipliers (legacy / "AI Enhance" button) */
export interface AIEnhanceParams {
  /** 0–200: scales adaptive brightness boost. 100 = full auto, 0 = no boost, 200 = double boost */
  brightness?: number;
  saturation?: number;
  contrast?: number;
  sharpness?: number;
}

/** Manual edit sliders — all values -100…+100 (denoise/sharpness 0–100) */
export interface ManualEditParams {
  mode: "manual";
  exposure?: number;    // -100…+100
  highlights?: number;  // -100…+100
  shadows?: number;     // -100…+100
  contrast?: number;    // -100…+100
  vibrance?: number;    // -100…+100
  saturation?: number;  // -100…+100
  warmth?: number;      // -100…+100  (negative = cool)
  clarity?: number;     // -100…+100
  denoise?: number;     // 0…100
  sharpness?: number;   // 0…100
}

/** Preset edit request */
export interface PresetEditParams {
  mode: "preset";
  preset: "moody" | "bright" | "film" | "bw" | "fade" | "pop" | "golden" | "cool";
}

/** Uploaded XMP preset by server-assigned id */
export interface XmpEditParams {
  mode: "xmp";
  xmpId: string;
}

/** Adobe-style Auto: server analyses image and picks optimal params */
export interface AdobeAutoParams {
  mode: "adobe-auto";
}

/** Natural language prompt edit */
export interface PromptEditParams {
  mode: "prompt";
  prompt: string;
}

export type PhotoEditRequest = AIEnhanceParams | ManualEditParams | PresetEditParams | XmpEditParams | AdobeAutoParams | PromptEditParams;

/** A stored XMP preset returned by the server */
export interface XmpPreset {
  id: string;
  name: string;
  params: Omit<ManualEditParams, "mode">;
}

/** List all uploaded XMP presets */
export async function listXmpPresets(): Promise<XmpPreset[]> {
  const res = await fetch("/api/xmp-presets", { headers: adminAuthHeaders() });
  if (!res.ok) return [];
  return res.json();
}

/** Upload XMP files and return the newly created presets */
export async function uploadXmpPresets(files: File[]): Promise<XmpPreset[]> {
  const formData = new FormData();
  for (const f of files) formData.append("presets", f);
  const res = await fetch("/api/xmp-presets", { method: "POST", headers: adminAuthHeaders(), body: formData });
  if (!res.ok) throw new Error(`XMP upload failed (${res.status})`);
  const { added } = await res.json();
  return added;
}

/** Delete an uploaded XMP preset */
export async function deleteXmpPreset(id: string): Promise<void> {
  await fetch(`/api/xmp-presets/${encodeURIComponent(id)}`, { method: "DELETE", headers: adminAuthHeaders() });
}

/** Fetch the edited version of a photo and return a local blob URL for display.
 *
 * The server endpoint requires admin auth — we use fetch() + blob URL to bypass
 * the <img src> header limitation.
 */
export async function aiEnhancePhoto(photoSrc: string, params?: PhotoEditRequest): Promise<string> {
  const filename = photoSrc.split("/").pop()?.split("?")[0]?.trim();
  if (!filename) throw new Error("Invalid photo URL");

  const qs = new URLSearchParams({ force: "1" });

  if (!params || !("mode" in params)) {
    // Legacy auto mode with optional multipliers
    const p = params as AIEnhanceParams | undefined;
    if (p?.brightness != null) qs.set("brightness", String(p.brightness));
    if (p?.saturation != null) qs.set("saturation", String(p.saturation));
    if (p?.contrast   != null) qs.set("contrast",   String(p.contrast));
    if (p?.sharpness  != null) qs.set("sharpness",  String(p.sharpness));
  } else if (params.mode === "preset") {
    qs.set("mode", "preset");
    qs.set("preset", params.preset);
  } else if (params.mode === "xmp") {
    qs.set("mode", "xmp");
    qs.set("xmpId", params.xmpId);
  } else if (params.mode === "adobe-auto") {
    qs.set("mode", "adobe-auto");
  } else if (params.mode === "prompt") {
    qs.set("mode", "prompt");
    qs.set("prompt", params.prompt.slice(0, 200));
  } else if (params.mode === "manual") {
    qs.set("mode", "manual");
    const mp = params as ManualEditParams;
    const keys = ["exposure","highlights","shadows","contrast","vibrance","saturation","warmth","clarity","denoise","sharpness"] as const;
    for (const k of keys) { if (mp[k] != null) qs.set(k, String(mp[k])); }
  }

  const url = `/api/photo/${encodeURIComponent(filename)}/ai-enhanced?${qs.toString()}`;
  const res = await fetch(url, { headers: adminAuthHeaders() });
  if (!res.ok) throw new Error(`Edit failed (${res.status})`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/** Permanently apply the cached AI enhancement to the original file on disk.
 *  Must be called after aiEnhancePhoto() so the server has a cached version to commit.
 *  Returns true on success.
 */
export async function applyAIEnhancement(photoSrc: string): Promise<boolean> {
  const filename = photoSrc.split("/").pop()?.split("?")[0]?.trim();
  if (!filename) return false;
  const res = await fetch(`/api/photo/${encodeURIComponent(filename)}/apply-enhancement`, {
    method: "POST",
    headers: adminAuthHeaders(),
  });
  return res.ok;
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
    const { getAdminCredentials } = await import("./storage");
    const creds = getAdminCredentials();
    const authHeader = creds ? "Basic " + btoa(`${creds.username}:${creds.passwordHash}`) : "";
    const res = await fetch("/api/storage", {
      headers: authHeader ? { Authorization: authHeader } : {},
    });
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

// Cache Stripe status for 5 minutes — it rarely changes and is called on every
// admin page mount, so skipping the round-trip on repeat visits cuts latency.
let _stripeStatusCache: { configured: boolean; publishableKey: string | null } | null = null;
let _stripeStatusCacheTs = 0;
const STRIPE_STATUS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getStripeStatus(): Promise<{ configured: boolean; publishableKey: string | null }> {
  if (!(await checkServer())) return { configured: false, publishableKey: null };
  const now = Date.now();
  if (_stripeStatusCache && now - _stripeStatusCacheTs < STRIPE_STATUS_CACHE_TTL) {
    return _stripeStatusCache;
  }
  try {
    const res = await fetchWithRetry("/api/stripe/status");
    if (!res.ok) return { configured: false, publishableKey: null };
    const data = await res.json();
    _stripeStatusCache = data;
    _stripeStatusCacheTs = now;
    return data;
  } catch {
    return { configured: false, publishableKey: null };
  }
}

/** Invalidate the Stripe status cache (call after changing Stripe settings). */
export function invalidateStripeStatusCache() {
  _stripeStatusCache = null;
  _stripeStatusCacheTs = 0;
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
    if (!res.ok) {
      try { const e = await res.json(); return { error: e.error || `Request failed (${res.status})` }; }
      catch { return { error: `Request failed (${res.status})` }; }
    }
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
    if (!res.ok) {
      try { const e = await res.json(); return { error: e.error || `Request failed (${res.status})` }; }
      catch { return { error: `Request failed (${res.status})` }; }
    }
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

// ── Per-tenant Google Calendar ─────────────────────────────────

export async function getTenantGoogleCalendarStatus(slug: string): Promise<{
  configured: boolean; connected: boolean; email: string | null; autoSync: boolean; calendarId: string;
}> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/integrations/googlecalendar/status`);
    if (!res.ok) return { configured: false, connected: false, email: null, autoSync: false, calendarId: "primary" };
    return await res.json();
  } catch { return { configured: false, connected: false, email: null, autoSync: false, calendarId: "primary" }; }
}

export async function startTenantGoogleCalendarAuth(slug: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/integrations/googlecalendar/auth`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.url || null;
  } catch { return null; }
}

export async function disconnectTenantGoogleCalendar(slug: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/integrations/googlecalendar/disconnect`, { method: "POST" });
    return res.ok;
  } catch { return false; }
}

export async function getTenantGoogleCalendars(slug: string): Promise<{ id: string; summary: string; primary?: boolean }[]> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/integrations/googlecalendar/calendars`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.calendars || [];
  } catch { return []; }
}

export async function saveTenantCalendarSettings(slug: string, settings: { autoSync?: boolean; calendarId?: string }): Promise<{ ok: boolean }> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/integrations/googlecalendar/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    return await res.json();
  } catch { return { ok: false }; }
}

export async function syncTenantBookingToCalendar(slug: string, booking: unknown, calendarId = "primary"): Promise<{ ok: boolean; eventId?: string }> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/integrations/googlecalendar/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ booking, calendarId }),
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
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
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
    // Send admin credentials via Basic auth so the server can verify the caller is super admin
    const { getAdminCredentials } = await import("./storage");
    const creds = getAdminCredentials();
    const authHeader = creds
      ? "Basic " + btoa(`${creds.username}:${creds.passwordHash}`)
      : "";
    const res = await fetch("/api/super-admin/webhooks", {
      headers: authHeader ? { Authorization: authHeader } : {},
    });
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
  options?: { isTrial?: boolean; maxEvents?: number; maxBookings?: number; extraEventPrice?: number },
): Promise<{ key?: import("./types").LicenseKey; error?: string }> {
  try {
    const res = await fetch("/api/license-keys/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ issuedTo, expiresAt, notes, ...options }),
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

/** Resolve a hostname to a tenant slug (used for custom-domain support). */
export async function getTenantByDomain(domain: string): Promise<{ slug: string; displayName: string } | null> {
  try {
    const res = await fetch(`/api/tenant/by-domain?domain=${encodeURIComponent(domain)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** Fetch a tenant's public data (event types + profile) for the booking page. */
export async function getTenantPublicData(slug: string): Promise<{
  tenant: import("./types").Tenant;
  eventTypes: import("./types").EventType[];
  bookingLimitReached?: boolean;
  enquiryEnabled?: boolean;
  enquiryLabel?: string;
  brandColor?: string | null;
  cosplayFieldsEnabled?: boolean;
  conventionFieldEnabled?: boolean;
  bankTransfer?: {
    enabled: boolean;
    accountName: string | null;
    bsb: string | null;
    accountNumber: string | null;
    payId: string | null;
    payIdType: string | null;
    instructions: string | null;
  } | null;
} | null> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/public`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** Submit an enquiry to a tenant's public page. */
export async function createTenantEnquiry(slug: string, enquiry: {
  name: string; email: string; phone?: string;
  eventTypeId?: string; eventTypeTitle?: string;
  preferredDate?: string; preferredStartTime?: string; preferredEndTime?: string;
  message: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/enquiry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(enquiry),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error };
    return { ok: true };
  } catch { return { ok: false, error: "Network error" }; }
}

/** Create a booking for a tenant's public page. */
export async function createTenantBooking(slug: string, booking: {
  clientName: string; clientEmail: string; date: string; time: string;
  eventTypeId?: string; type?: string; duration?: number; notes?: string;
  phone?: string;
  answers?: Record<string, string>;
  cosplayCharacter?: string;
  cosplayCostume?: string;
  conventionName?: string;
}): Promise<{ ok: boolean; booking?: import("./types").Booking; error?: string; statusCode?: number }> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/booking`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(booking),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error, statusCode: res.status };
    return { ok: true, booking: json.booking };
  } catch { return { ok: false, error: "Network error" }; }
}

/** Look up a booking by its modifyToken or id from the server (for the reschedule page). */
export async function fetchBookingByToken(token: string): Promise<import("./types").Booking | null> {
  try {
    const res = await fetch(`/api/booking/${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.booking ?? null;
  } catch { return null; }
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

/** Verify super-admin credentials server-side (supports bcrypt and legacy SHA-256 hashes). */
export async function verifyAdminCredentials(username: string, passwordHash: string): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, passwordHash }),
    });
    if (!res.ok) return false;
    const json = await res.json();
    return !!json.ok;
  } catch { return false; }
}

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

/** Fetch all active license plans (public, for tenant self-service). */
export async function getActiveLicensePlans(): Promise<import("./types").LicensePlan[]> {
  try {
    const res = await fetch("/api/license-plans");
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

/** Fetch all license plans (admin). */
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
    // Strip server-computed *Set indicator fields before sending.
    // These are read-only booleans returned by the API to indicate whether a
    // secret is configured; they must not be written back as data.
    const payload = { ...settings } as Record<string, unknown>;
    const SET_INDICATORS = [
      "stripeSecretKeySet",
      "stripeWebhookSecretSet",
      "smtpPasswordSet",
      "googleApiCredentialsSet",
      "discordWebhookUrlSet",
      "ftpPasswordSet",
    ] as const;
    for (const key of SET_INDICATORS) {
      delete payload[key];
    }
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    return { ok: !!json.ok, error: json.error };
  } catch { return { ok: false, error: "Network error" }; }
}

/** Fetch global FTP settings (password is masked — only ftpPasswordSet boolean is returned). */
export async function getGlobalFtpSettings(): Promise<{ ftpEnabled?: boolean; ftpHost?: string; ftpPort?: number; ftpUser?: string; ftpRemotePath?: string; ftpPasswordSet?: boolean }> {
  try {
    const res = await fetch("/api/settings/ftp");
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

/** Save global FTP settings. Send ftpPassword as empty string to clear it. */
export async function saveGlobalFtpSettings(settings: {
  ftpEnabled?: boolean;
  ftpHost?: string;
  ftpPort?: number;
  ftpUser?: string;
  ftpPassword?: string;
  ftpRemotePath?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const payload = { ...settings } as Record<string, unknown>;
    delete payload["ftpPasswordSet"];
    const res = await fetch("/api/settings/ftp", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    return { ok: !!json.ok, error: json.error };
  } catch { return { ok: false, error: "Network error" }; }
}

/** Test the saved FTP connection. Uses credentials stored on the server (password is never sent to the browser). */
export async function testFtpConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/settings/ftp/test", { method: "POST" });
    const json = await res.json();
    return { ok: !!json.ok, error: json.error };
  } catch { return { ok: false, error: "Network error" }; }
}

/** Test the saved FTP connection for a specific tenant. Uses credentials stored on the server. */
export async function testTenantFtpConnection(slug: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/settings/ftp/test`, { method: "POST" });
    const json = await res.json();
    return { ok: !!json.ok, error: json.error };
  } catch { return { ok: false, error: "Network error" }; }
}

/**
 * Bulk-upload an album's photos to FTP with real-time SSE progress.
 * Calls `onProgress(done, total, failed)` for each file uploaded.
 * Returns when all uploads are complete (or the stream ends).
 */
export async function ftpUploadAlbum(
  albumSlug: string,
  onProgress: (done: number, total: number, failed: number) => void,
  tenantSlug?: string,
): Promise<{ ok: boolean; done: number; total: number; failed: number; error?: string }> {
  const url = tenantSlug
    ? `/api/ftp/upload-album/${encodeURIComponent(albumSlug)}?tenant=${encodeURIComponent(tenantSlug)}`
    : `/api/ftp/upload-album/${encodeURIComponent(albumSlug)}`;

  try {
    const res = await fetch(url, { method: "POST" });

    // Non-SSE fast responses (errors, empty albums)
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream")) {
      const json = await res.json();
      return { ok: !!json.ok, done: json.done ?? 0, total: json.total ?? 0, failed: json.failed ?? 0, error: json.error };
    }

    if (!res.body) {
      return { ok: false, done: 0, total: 0, failed: 0, error: "Empty response body" };
    }

    return await new Promise<{ ok: boolean; done: number; total: number; failed: number; error?: string }>((resolve) => {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastEvent = { done: 0, total: 0, failed: 0 };

      const pump = async () => {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            resolve({ ok: lastEvent.failed === 0, ...lastEvent });
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            try {
              const evt = JSON.parse(line.slice(5).trim());
              lastEvent = { done: evt.done ?? lastEvent.done, total: evt.total ?? lastEvent.total, failed: evt.failed ?? lastEvent.failed };
              onProgress(lastEvent.done, lastEvent.total, lastEvent.failed);
              if (evt.complete) {
                resolve({ ok: (evt.failed ?? 0) === 0 && !evt.error, ...lastEvent, error: evt.error });
                return;
              }
            } catch { /* skip malformed lines */ }
          }
        }
      };
      pump().catch((err) => resolve({ ok: false, done: lastEvent.done, total: lastEvent.total, failed: lastEvent.failed, error: err.message }));
    });
  } catch (err: any) {
    return { ok: false, done: 0, total: 0, failed: 0, error: err?.message ?? "Network error" };
  }
}

/**
 * Move a photo to or from the "{albumName}-starred" FTP sub-folder.
 * Pass `starred: true` (default) to move into the starred folder when starring,
 * or `starred: false` to move back to the regular album folder when unstarring.
 * Only works when the ftpStarredFolder setting is enabled server-side.
 */
export async function ftpMoveToStarred(params: {
  photoSrc: string;
  albumTitle: string;
  albumSlug: string;
  tenantSlug?: string;
  originalName?: string;
  starred?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/ftp/move-starred", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
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

/** Create a Stripe checkout session for a tenant album purchase. */
export async function createTenantAlbumCheckout(slug: string, params: {
  albumId: string; albumTitle: string; photoCount: number; amount: number; clientEmail?: string;
  photoIds?: string[];
  isFullAlbum?: boolean;
  sessionKey?: string;
}): Promise<{ url?: string; error?: string }> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/stripe/checkout/album`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
    });
    if (!res.ok) {
      try { const e = await res.json(); return { error: e.error || `Request failed (${res.status})` }; }
      catch { return { error: `Request failed (${res.status})` }; }
    }
    return await res.json();
  } catch { return { error: "Network error" }; }
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
  maxEvents?: number | null;
  maxBookings?: number | null;
  extraEventPrice?: number | null;
  extraEventSlots?: number;
  eventCount?: number;
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
export async function saveTenantStoreKey(slug: string, key: string, value: unknown): Promise<{ ok: boolean; error?: string; limitReached?: boolean; extraEventPrice?: number | null }> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/store/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    const json = await res.json();
    return { ok: !!json.ok, error: json.error, limitReached: !!json.limitReached, extraEventPrice: json.extraEventPrice ?? null };
  } catch { return { ok: false, error: "Network error" }; }
}

/** Submit a request for an extra event type slot (tenant). */
export async function submitEventSlotRequest(slug: string, paymentMethod: "stripe" | "bank"): Promise<{ ok: boolean; request?: import("./types").EventSlotRequest; error?: string }> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/event-slot-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentMethod }),
    });
    const json = await res.json();
    return { ok: !!json.ok, request: json.request, error: json.error };
  } catch { return { ok: false, error: "Network error" }; }
}

/** Get the tenant's current pending event slot request (if any). */
export async function getTenantEventSlotRequest(slug: string): Promise<import("./types").EventSlotRequest | null> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/event-slot-request/pending`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.request || null;
  } catch { return null; }
}

/** Create a Stripe checkout session for an event slot purchase (tenant). */
export async function createEventSlotCheckout(slug: string, successUrl?: string, cancelUrl?: string): Promise<{ url?: string; sessionId?: string; error?: string }> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/stripe/checkout/event-slot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ successUrl, cancelUrl }),
    });
    return await res.json();
  } catch { return { error: "Network error" }; }
}

/** Get all event slot requests (super admin). */
export async function getEventSlotRequests(): Promise<(import("./types").EventSlotRequest & { tenantDisplayName?: string })[]> {
  try {
    const res = await fetch("/api/super/event-slot-requests");
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

/** Confirm an event slot request and grant the slot (super admin). */
export async function confirmEventSlotRequest(id: string, confirmedBy?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/super/event-slot-requests/${encodeURIComponent(id)}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmedBy }),
    });
    const json = await res.json();
    return { ok: !!json.ok, error: json.error };
  } catch { return { ok: false, error: "Network error" }; }
}

/** Reject an event slot request (super admin). */
export async function rejectEventSlotRequest(id: string, rejectedBy?: string, notes?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/super/event-slot-requests/${encodeURIComponent(id)}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rejectedBy, notes }),
    });
    const json = await res.json();
    return { ok: !!json.ok, error: json.error };
  } catch { return { ok: false, error: "Network error" }; }
}

/** Send an email using the tenant's own SMTP settings (falls back to global SMTP). */
export async function sendTenantEmail(slug: string, to: string, subject: string, html?: string, text?: string): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/email/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, html, text }),
    });
    const json = await res.json();
    return { ok: !!json.ok, messageId: json.messageId, error: json.error };
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

/** Fetch an album by slug/id from any store (main or tenant). Returns the album and tenantSlug (null if main). */
export async function fetchPublicAlbum(albumSlug: string): Promise<{ album: import("./types").Album; tenantSlug: string | null } | null> {
  try {
    // Use no-store so the browser never serves a cached copy — gallery photo
    // changes (additions, deletions) must always reflect the current server state.
    const res = await fetch(`/api/public-album/${encodeURIComponent(albumSlug)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** Get storage stats for a tenant's files (total bytes and file count). */
export async function getTenantStorageStats(slug: string): Promise<{ ok: boolean; totalBytes: number; fileCount: number; albumCount: number } | null> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/storage-stats`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** Admin-create or update a tenant booking, bypassing public booking flow. */
export async function upsertTenantBookingAdmin(slug: string, booking: import("./types").Booking): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/bookings/${encodeURIComponent(booking.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(booking),
    });
    const json = await res.json();
    return { ok: !!json.ok, error: json.error };
  } catch { return { ok: false, error: "Network error" }; }
}

/**
 * Fetch album stubs (album metadata without the photos array) from the server.
 * Stubs are suitable for displaying the albums list in the admin UI without
 * incurring the cost of downloading every photo entry.  Albums returned carry
 * `_photosStripped: true` so callers can distinguish stubs from full albums.
 *
 * Returns null when the server is unavailable.
 */
export async function fetchAlbumStubs(): Promise<import("./types").Album[] | null> {
  if (serverAvailable !== true) return null;
  try {
    const res = await fetch("/api/albums/stubs");
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch the photos array for a single album from the server.
 * Use this when the album editor is opened so photo data is loaded on demand
 * rather than being included in the initial page sync.
 *
 * Returns null when the server is unavailable or the album is not found.
 */
export async function fetchAlbumPhotos(albumId: string): Promise<import("./types").Photo[] | null> {
  if (serverAvailable !== true) return null;
  try {
    const res = await fetch(`/api/albums/${encodeURIComponent(albumId)}/photos`);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data?.photos) ? data.photos : null;
  } catch {
    return null;
  }
}

// ─── iCal Feed ────────────────────────────────────────────────────────────────

export async function generateIcalToken(): Promise<{ icalToken: string } | null> {
  try {
    const { getAdminCredentials } = await import("./storage");
    const creds = getAdminCredentials();
    const authHeader = creds ? "Basic " + btoa(`${creds.username}:${creds.passwordHash}`) : "";
    const res = await fetch("/api/ical/generate", {
      method: "POST",
      headers: authHeader ? { Authorization: authHeader } : {},
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function deleteIcalToken(): Promise<boolean> {
  try {
    const { getAdminCredentials } = await import("./storage");
    const creds = getAdminCredentials();
    const authHeader = creds ? "Basic " + btoa(`${creds.username}:${creds.passwordHash}`) : "";
    const res = await fetch("/api/ical/token", {
      method: "DELETE",
      headers: authHeader ? { Authorization: authHeader } : {},
    });
    return res.ok;
  } catch { return false; }
}

// ─── Expenses ─────────────────────────────────────────────────────────────────

export async function getExpenses(): Promise<import("./types").Expense[]> {
  try {
    const res = await fetch("/api/expenses", { headers: adminAuthHeaders() });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

export async function createExpense(data: Partial<import("./types").Expense>): Promise<import("./types").Expense | null> {
  try {
    const res = await fetch("/api/expenses", { method: "POST", headers: { "Content-Type": "application/json", ...adminAuthHeaders() }, body: JSON.stringify(data) });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function updateExpense(id: string, data: Partial<import("./types").Expense>): Promise<import("./types").Expense | null> {
  try {
    const res = await fetch(`/api/expenses/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json", ...adminAuthHeaders() }, body: JSON.stringify(data) });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function deleteExpense(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/expenses/${encodeURIComponent(id)}`, { method: "DELETE", headers: adminAuthHeaders() });
    return res.ok;
  } catch { return false; }
}

// ─── Quotes ───────────────────────────────────────────────────────────────────

export async function getQuotes(): Promise<import("./types").Quote[]> {
  try {
    const res = await fetch("/api/quotes", { headers: adminAuthHeaders() });
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

export async function createQuote(data: Partial<import("./types").Quote>): Promise<import("./types").Quote | null> {
  try {
    const res = await fetch("/api/quotes", { method: "POST", headers: { "Content-Type": "application/json", ...adminAuthHeaders() }, body: JSON.stringify(data) });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function updateQuote(id: string, data: Partial<import("./types").Quote>): Promise<import("./types").Quote | null> {
  try {
    const res = await fetch(`/api/quotes/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json", ...adminAuthHeaders() }, body: JSON.stringify(data) });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function convertQuoteToInvoice(id: string, dueDate?: string): Promise<{ invoice: import("./types").Invoice; quote: import("./types").Quote } | null> {
  try {
    const res = await fetch(`/api/quotes/${encodeURIComponent(id)}/convert`, { method: "POST", headers: { "Content-Type": "application/json", ...adminAuthHeaders() }, body: JSON.stringify({ dueDate }) });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function deleteQuote(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/quotes/${encodeURIComponent(id)}`, { method: "DELETE", headers: adminAuthHeaders() });
    return res.ok;
  } catch { return false; }
}

export async function getPublicQuote(token: string): Promise<import("./types").Quote | null> {
  try {
    const res = await fetch(`/api/quotes/share/${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function respondToQuote(token: string, action: "accept" | "decline"): Promise<import("./types").Quote | null> {
  try {
    const res = await fetch(`/api/quotes/share/${encodeURIComponent(token)}/respond`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

// ─── Booking Tasks ────────────────────────────────────────────────────────────

export async function getBookingTasks(bookingId: string): Promise<import("./types").BookingTask[]> {
  try {
    const res = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/tasks`, { headers: adminAuthHeaders() });
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

export async function updateBookingTasks(bookingId: string, tasks: import("./types").BookingTask[]): Promise<import("./types").BookingTask[]> {
  try {
    const res = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/tasks`, { method: "PUT", headers: { "Content-Type": "application/json", ...adminAuthHeaders() }, body: JSON.stringify({ tasks }) });
    if (!res.ok) return tasks;
    return res.json();
  } catch { return tasks; }
}

export async function toggleBookingTask(bookingId: string, taskId: string): Promise<import("./types").BookingTask | null> {
  try {
    const res = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/tasks/${encodeURIComponent(taskId)}/toggle`, { method: "PUT", headers: adminAuthHeaders() });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function getTaskTemplates(): Promise<import("./types").BookingTaskTemplate[]> {
  try {
    const res = await fetch("/api/task-templates", { headers: adminAuthHeaders() });
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

export async function createTaskTemplate(data: Partial<import("./types").BookingTaskTemplate>): Promise<import("./types").BookingTaskTemplate | null> {
  try {
    const res = await fetch("/api/task-templates", { method: "POST", headers: { "Content-Type": "application/json", ...adminAuthHeaders() }, body: JSON.stringify(data) });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function updateTaskTemplate(id: string, data: Partial<import("./types").BookingTaskTemplate>): Promise<import("./types").BookingTaskTemplate | null> {
  try {
    const res = await fetch(`/api/task-templates/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json", ...adminAuthHeaders() }, body: JSON.stringify(data) });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function deleteTaskTemplate(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/task-templates/${encodeURIComponent(id)}`, { method: "DELETE", headers: adminAuthHeaders() });
    return res.ok;
  } catch { return false; }
}

// ─── Tags ─────────────────────────────────────────────────────────────────────

export async function getTags(): Promise<import("./types").Tag[]> {
  try {
    const res = await fetch("/api/tags", { headers: adminAuthHeaders() });
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

export async function createTag(data: Pick<import("./types").Tag, "label" | "color">): Promise<import("./types").Tag | null> {
  try {
    const res = await fetch("/api/tags", { method: "POST", headers: { "Content-Type": "application/json", ...adminAuthHeaders() }, body: JSON.stringify(data) });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function updateTag(id: string, data: Partial<import("./types").Tag>): Promise<import("./types").Tag | null> {
  try {
    const res = await fetch(`/api/tags/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json", ...adminAuthHeaders() }, body: JSON.stringify(data) });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function deleteTag(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/tags/${encodeURIComponent(id)}`, { method: "DELETE", headers: adminAuthHeaders() });
    return res.ok;
  } catch { return false; }
}

export async function setBookingTags(bookingId: string, tags: string[]): Promise<boolean> {
  try {
    const res = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/tags`, { method: "PATCH", headers: { "Content-Type": "application/json", ...adminAuthHeaders() }, body: JSON.stringify({ tags }) });
    return res.ok;
  } catch { return false; }
}

export async function setAlbumTags(albumId: string, tags: string[]): Promise<boolean> {
  try {
    const res = await fetch(`/api/albums/${encodeURIComponent(albumId)}/tags`, { method: "PATCH", headers: { "Content-Type": "application/json", ...adminAuthHeaders() }, body: JSON.stringify({ tags }) });
    return res.ok;
  } catch { return false; }
}

// ─── Gallery Share Links ──────────────────────────────────────────────────────

export async function getAlbumShareLinks(albumId: string): Promise<import("./types").GalleryShareLink[]> {
  try {
    const res = await fetch(`/api/albums/${encodeURIComponent(albumId)}/share-links`, { headers: adminAuthHeaders() });
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

export async function createAlbumShareLink(albumId: string, data: { label?: string; expiresAt?: string; allowDownload?: boolean }): Promise<import("./types").GalleryShareLink | null> {
  try {
    const res = await fetch(`/api/albums/${encodeURIComponent(albumId)}/share-links`, { method: "POST", headers: { "Content-Type": "application/json", ...adminAuthHeaders() }, body: JSON.stringify(data) });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function deleteAlbumShareLink(albumId: string, linkId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/albums/${encodeURIComponent(albumId)}/share-links/${encodeURIComponent(linkId)}`, { method: "DELETE", headers: adminAuthHeaders() });
    return res.ok;
  } catch { return false; }
}

export async function getGalleryByShareToken(token: string): Promise<{ album: import("./types").Album; allowDownload: boolean; linkLabel?: string } | null> {
  try {
    const res = await fetch(`/api/gallery/share/${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

// ─── Photo Comments ───────────────────────────────────────────────────────────

export async function getPhotoComments(albumId: string, photoId: string): Promise<import("./types").PhotoComment[]> {
  try {
    const res = await fetch(`/api/albums/${encodeURIComponent(albumId)}/photos/${encodeURIComponent(photoId)}/comments`, { headers: adminAuthHeaders() });
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

export async function addPhotoComment(albumId: string, photoId: string, data: { authorName: string; authorEmail?: string; text: string; xPct?: number; yPct?: number }): Promise<import("./types").PhotoComment | null> {
  try {
    const res = await fetch(`/api/albums/${encodeURIComponent(albumId)}/photos/${encodeURIComponent(photoId)}/comments`, { method: "POST", headers: { "Content-Type": "application/json", ...adminAuthHeaders() }, body: JSON.stringify(data) });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function resolvePhotoComment(albumId: string, photoId: string, commentId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/albums/${encodeURIComponent(albumId)}/photos/${encodeURIComponent(photoId)}/comments/${encodeURIComponent(commentId)}/resolve`, { method: "PUT", headers: adminAuthHeaders() });
    return res.ok;
  } catch { return false; }
}

export async function deletePhotoComment(albumId: string, photoId: string, commentId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/albums/${encodeURIComponent(albumId)}/photos/${encodeURIComponent(photoId)}/comments/${encodeURIComponent(commentId)}`, { method: "DELETE", headers: adminAuthHeaders() });
    return res.ok;
  } catch { return false; }
}

// ─── Contracts ────────────────────────────────────────────────────────────────

export async function getContracts(bookingId?: string): Promise<import("./types").BookingContract[]> {
  try {
    const url = bookingId ? `/api/contracts?bookingId=${encodeURIComponent(bookingId)}` : "/api/contracts";
    const res = await fetch(url, { headers: adminAuthHeaders() });
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

export async function createContract(formData: FormData): Promise<import("./types").BookingContract | null> {
  try {
    const res = await fetch("/api/contracts", { method: "POST", body: formData, headers: adminAuthHeaders() });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function getContractByToken(token: string): Promise<Pick<import("./types").BookingContract, "id" | "title" | "status" | "bookingId" | "pdfPath"> | null> {
  try {
    const res = await fetch(`/api/contracts/sign/${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function signContract(token: string, signedName: string): Promise<{ ok: boolean; signedAt: string } | null> {
  try {
    const res = await fetch(`/api/contracts/sign/${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signedName }) });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function deleteContract(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/contracts/${encodeURIComponent(id)}`, { method: "DELETE", headers: adminAuthHeaders() });
    return res.ok;
  } catch { return false; }
}

// ─── Payment Instalments ──────────────────────────────────────────────────────

export async function getInstalments(bookingId: string): Promise<import("./types").PaymentInstalment[]> {
  try {
    const res = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/instalments`, { headers: adminAuthHeaders() });
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

export async function createInstalment(bookingId: string, data: Partial<import("./types").PaymentInstalment>): Promise<import("./types").PaymentInstalment | null> {
  try {
    const res = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/instalments`, { method: "POST", headers: { "Content-Type": "application/json", ...adminAuthHeaders() }, body: JSON.stringify(data) });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function updateInstalment(id: string, data: Partial<import("./types").PaymentInstalment>): Promise<import("./types").PaymentInstalment | null> {
  try {
    const res = await fetch(`/api/instalments/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json", ...adminAuthHeaders() }, body: JSON.stringify(data) });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

// ─── Booking Source ───────────────────────────────────────────────────────────

export async function setBookingSource(bookingId: string, source: import("./types").BookingSource): Promise<boolean> {
  try {
    const res = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/source`, { method: "PATCH", headers: { "Content-Type": "application/json", ...adminAuthHeaders() }, body: JSON.stringify({ source }) });
    return res.ok;
  } catch { return false; }
}

// ─── One-Click Gallery Delivery ───────────────────────────────────────────────

export async function deliverAlbum(albumId: string): Promise<{ ok: boolean; deliveredAt: string; emailSent?: boolean; emailError?: string } | null> {
  try {
    const res = await fetch(`/api/albums/${encodeURIComponent(albumId)}/deliver`, { method: "POST", headers: adminAuthHeaders() });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

// ─── PWA Push Subscriptions ───────────────────────────────────────────────────

export async function subscribePush(subscription: PushSubscription, tenantSlug?: string): Promise<boolean> {
  try {
    const sub = subscription.toJSON();
    const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys, tenantSlug }) });
    return res.ok;
  } catch { return false; }
}

export async function unsubscribePush(endpoint: string): Promise<boolean> {
  try {
    const res = await fetch("/api/push/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint }) });
    return res.ok;
  } catch { return false; }
}

export async function getVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch("/api/push/vapid-public-key");
    if (!res.ok) return null;
    const data = await res.json();
    return data.vapidPublicKey || null;
  } catch { return null; }
}

// ─── Tenant iCal ──────────────────────────────────────────────────────────────

export async function generateTenantIcalToken(slug: string): Promise<{ icalToken: string } | null> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/ical/generate`, { method: "POST" });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function deleteTenantIcalToken(slug: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/tenant/${encodeURIComponent(slug)}/ical/token`, { method: "DELETE" });
    return res.ok;
  } catch { return false; }
}
