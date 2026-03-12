import { useEffect, useRef } from "react";
import { generateThumbnail } from "@/lib/image-utils";
import { isServerMode } from "@/lib/api";
import type { Photo } from "@/lib/types";

/**
 * Background-generates missing thumbnails for photos that don't have them.
 * Calls onUpdate(photoId, thumbnailDataUrl) for each generated thumbnail.
 *
 * In server mode: assigns ?size=thumb&wm=0 URLs instantly (no canvas work).
 *   Also fixes existing thumbnails that are missing the ?wm=0 flag so that
 *   admin views always display clean (un-watermarked) images.
 * In localStorage mode: generates canvas-based thumbnails in batches of 3.
 */
export function useBackfillThumbnails(
  photos: Photo[],
  onUpdate: (photoId: string, thumbnail: string) => void
) {
  const processedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (isServerMode()) {
      // Server mode: fix thumbnails that are missing or are server URLs lacking ?wm=0
      const toFix = photos.filter(
        (p) =>
          (
            !p.thumbnail ||
            (p.thumbnail.startsWith("/uploads/") && !/[?&]wm=0(&|$)/.test(p.thumbnail))
          ) &&
          p.src &&
          !p.src.startsWith("data:") &&
          !processedRef.current.has(p.id)
      );
      for (const photo of toFix) {
        processedRef.current.add(photo.id);
        onUpdate(photo.id, photo.src + "?size=thumb&wm=0");
      }
      return;
    }

    // localStorage mode: generate canvas-based thumbnails in batches to avoid blocking
    let cancelled = false;
    const missing = photos.filter(
      (p) => !p.thumbnail && p.src && !processedRef.current.has(p.id)
    );
    if (missing.length === 0) return;

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
  }, [photos, onUpdate]);
}
