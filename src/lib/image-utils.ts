/**
 * Read the EXIF orientation tag from a JPEG ArrayBuffer.
 * Returns 1 (normal) if not found or not applicable.
 * Orientations 1-8 correspond to the EXIF spec; we only care about
 * rotation/flip combinations (1=0°, 3=180°, 6=90°CW, 8=90°CCW).
 */
function readExifOrientation(buffer: ArrayBuffer): number {
  try {
    const view = new DataView(buffer);
    // JPEG SOI marker
    if (view.getUint16(0) !== 0xffd8) return 1;
    let offset = 2;
    while (offset < view.byteLength - 2) {
      const marker = view.getUint16(offset);
      offset += 2;
      if (marker === 0xffe1) {
        // APP1 — check for "Exif\0\0"
        const segLen = view.getUint16(offset);
        if (view.getUint32(offset + 2) === 0x45786966 && view.getUint16(offset + 6) === 0x0000) {
          const tiffOffset = offset + 8;
          const littleEndian = view.getUint16(tiffOffset) === 0x4949;
          const ifdOffset = tiffOffset + view.getUint32(tiffOffset + 4, littleEndian);
          const numEntries = view.getUint16(ifdOffset, littleEndian);
          for (let i = 0; i < numEntries; i++) {
            const entryOffset = ifdOffset + 2 + i * 12;
            if (view.getUint16(entryOffset, littleEndian) === 0x0112) {
              return view.getUint16(entryOffset + 8, littleEndian);
            }
          }
        }
        offset += segLen;
      } else if ((marker & 0xff00) === 0xff00) {
        offset += view.getUint16(offset);
      } else {
        break;
      }
    }
  } catch { /* noop */ }
  return 1;
}

/**
 * Apply EXIF orientation to a canvas context before drawing.
 * Rotates/flips the canvas so the image appears upright.
 */
function applyExifOrientation(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, orientation: number, w: number, h: number) {
  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;
    case 3: ctx.transform(-1, 0, 0, -1, w, h); break;
    case 4: ctx.transform(1, 0, 0, -1, 0, h); break;
    case 5: canvas.width = h; canvas.height = w; ctx.transform(0, 1, 1, 0, 0, 0); break;
    case 6: canvas.width = h; canvas.height = w; ctx.transform(0, 1, -1, 0, h, 0); break;
    case 7: canvas.width = h; canvas.height = w; ctx.transform(0, -1, -1, 0, h, w); break;
    case 8: canvas.width = h; canvas.height = w; ctx.transform(0, -1, 1, 0, 0, w); break;
    default: break; // 1 = normal, no transform needed
  }
}

/**
 * Compress an image file to a smaller base64 data URL using canvas.
 * Automatically corrects EXIF orientation so portrait photos from phones
 * appear upright. This also prevents localStorage quota issues.
 */
export function compressImage(
  file: File,
  maxWidth = 1600,
  quality = 0.7
): Promise<{ src: string; width: number; height: number; originalSize: number; compressedSize: number }> {
  return new Promise((resolve, reject) => {
    // Read raw bytes first to extract EXIF orientation (JPEG only)
    const rawReader = new FileReader();
    rawReader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    rawReader.onload = () => {
      const orientation = file.type === "image/jpeg" || file.name.toLowerCase().endsWith(".jpg") || file.name.toLowerCase().endsWith(".jpeg")
        ? readExifOrientation(rawReader.result as ArrayBuffer)
        : 1;
      const isRotated90 = orientation >= 5 && orientation <= 8;

      const dataReader = new FileReader();
      dataReader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
      dataReader.onload = () => {
        const img = new window.Image();
        img.onerror = () => reject(new Error(`Failed to load image: ${file.name}`));
        img.onload = () => {
          // Natural dimensions (before rotation)
          const natW = img.width;
          const natH = img.height;
          // Logical dimensions after rotation
          let logW = isRotated90 ? natH : natW;
          let logH = isRotated90 ? natW : natH;

          // Scale down to maxWidth based on logical width
          if (logW > maxWidth) {
            const scale = maxWidth / logW;
            logW = maxWidth;
            logH = Math.round(logH * scale);
          }
          // Canvas physical size (before orientation transform)
          const canvW = isRotated90 ? logH : logW;
          const canvH = isRotated90 ? logW : logH;

          const canvas = document.createElement("canvas");
          canvas.width = canvW;
          canvas.height = canvH;
          const ctx = canvas.getContext("2d");
          if (!ctx) { reject(new Error("Canvas not supported")); return; }

          applyExifOrientation(ctx, canvas, orientation, canvW, canvH);
          // After transform, canvas dimensions may have swapped (handled in applyExifOrientation)
          ctx.drawImage(img, 0, 0, isRotated90 ? logH : logW, isRotated90 ? logW : logH);

          const src = canvas.toDataURL("image/jpeg", quality);
          resolve({
            src,
            width: canvas.width,
            height: canvas.height,
            originalSize: file.size,
            compressedSize: Math.round(src.length * 0.75),
          });
        };
        img.src = dataReader.result as string;
      };
      dataReader.readAsDataURL(file);
    };
    rawReader.readAsArrayBuffer(file);
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
