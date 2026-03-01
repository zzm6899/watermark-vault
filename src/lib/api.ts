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
