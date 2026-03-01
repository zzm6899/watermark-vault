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

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
