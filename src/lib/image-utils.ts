/**
 * Compress an image file to a smaller base64 data URL using canvas.
 * This prevents localStorage quota issues when storing photos.
 */
export function compressImage(
  file: File,
  maxWidth = 1600,
  quality = 0.7
): Promise<{ src: string; width: number; height: number; originalSize: number; compressedSize: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error(`Failed to load image: ${file.name}`));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let w = img.width;
        let h = img.height;

        if (w > maxWidth) {
          h = Math.round((h * maxWidth) / w);
          w = maxWidth;
        }

        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Canvas not supported")); return; }
        ctx.drawImage(img, 0, 0, w, h);

        const src = canvas.toDataURL("image/jpeg", quality);
        resolve({
          src,
          width: w,
          height: h,
          originalSize: file.size,
          compressedSize: Math.round(src.length * 0.75), // approximate bytes
        });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Generate a small thumbnail from a data URL or image source.
 * Used for fast grid rendering in admin and gallery views.
 */
export function generateThumbnail(
  src: string,
  maxSize = 300,
  quality = 0.6
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onerror = () => reject(new Error("Failed to load image for thumbnail"));
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w = img.width;
      let h = img.height;
      if (w > h) {
        if (w > maxSize) { h = Math.round((h * maxSize) / w); w = maxSize; }
      } else {
        if (h > maxSize) { w = Math.round((w * maxSize) / h); h = maxSize; }
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(src); return; }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = src;
  });
}

/**
 * Resize an image to a target file size (approximate).
 * Returns a blob URL for download.
 */
export function resizeToTargetSize(
  src: string,
  targetBytes: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onerror = () => reject(new Error("Failed to load image"));
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas not supported")); return; }
      ctx.drawImage(img, 0, 0);

      // Binary search for quality that gets close to target size
      let lo = 0.1, hi = 1.0, bestBlob: Blob | null = null;
      const attempt = (quality: number): Promise<Blob> =>
        new Promise((res) => canvas.toBlob((b) => res(b!), "image/jpeg", quality));

      (async () => {
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          const blob = await attempt(mid);
          bestBlob = blob;
          if (blob.size > targetBytes) hi = mid;
          else lo = mid;
        }
        // If still too large, scale down dimensions
        if (bestBlob && bestBlob.size > targetBytes * 1.2) {
          const scale = Math.sqrt(targetBytes / bestBlob.size);
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          bestBlob = await attempt(0.85);
        }
        resolve(bestBlob!);
      })();
    };
    img.src = src;
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Format a bytes-per-second value as a human-readable speed string (e.g. "2.4 MB/s"). */
export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

/** Check approximate localStorage usage */
export function getLocalStorageUsage(): { used: number; limit: number } {
  let used = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
      used += (localStorage.getItem(key) || "").length * 2; // UTF-16
    }
  }
  return { used, limit: 5 * 1024 * 1024 }; // ~5MB typical limit
}

export function trySaveToLocalStorage(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.error("localStorage quota exceeded:", e);
    return false;
  }
}
