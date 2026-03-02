import { useEffect, useRef } from "react";
import { generateThumbnail } from "@/lib/image-utils";
import type { Photo } from "@/lib/types";

/**
 * Background-generates missing thumbnails for photos that don't have them.
 * Calls onUpdate(photoId, thumbnailDataUrl) for each generated thumbnail.
 * Runs once per mount (or when photos array reference changes).
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

    // Process in batches of 3 to avoid blocking
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
