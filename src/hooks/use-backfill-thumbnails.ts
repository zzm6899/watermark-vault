import { useEffect, useRef } from "react";
import { generateThumbnail } from "@/lib/image-utils";
import { isServerMode } from "@/lib/api";
import type { Photo } from "@/lib/types";

/**
 * Background-generates missing thumbnails for photos that don't have them.
 * Calls onUpdate(photoId, thumbnailDataUrl) for each generated thumbnail.
 *
 * In server mode: assigns ?w=200&wm=0 URLs instantly (no canvas work).
 * In localStorage mode: generates canvas-based thumbnails in batches of 3.
 */
export function useBackfillThumbnails(
  photos: Photo[],
  onUpdate: (photoId: string, thumbnail: string) => void
) {
  const processedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const missing = photos.filter(
      (p) => !p.thumbnail && p.src && !processedRef.current.has(p.id)
    );
    if (missing.length === 0) return;

    if (isServerMode()) {
      // Server mode: immediately assign server-served thumbnails, no canvas needed
      for (const photo of missing) {
        if (photo.src.startsWith("data:")) continue; // skip base64 blobs
        processedRef.current.add(photo.id);
        onUpdate(photo.id, photo.src + "?w=200&wm=0");
      }
      return;
    }

    // localStorage mode: generate canvas-based thumbnails in batches to avoid blocking
    (async () => {
      for (let i = 0; i < missing.length; i += 3) {
        if (cancelled) break;
        const batch = missing.slice(i, i + 3);
        await Promise.all(
          batch.map(async (photo) => {
            if (cancelled || processedRef.current.has(photo.id)) return;
            processedRef.current.add(photo.id);
            try {
              const thumb = await generateThumbnail(photo.src);
              if (!cancelled) onUpdate(photo.id, thumb);
            } catch {
              // skip failed thumbnails
            }
          })
        );
      }
    })();

    return () => { cancelled = true; };
  }, [photos]);
}
