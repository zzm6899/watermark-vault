import type { Photo } from "./types";

/** Keep the photographer's order unless the visitor explicitly requests a date sort. */
export function sortGalleryPhotos(photos: Photo[], order: "default" | "asc" | "desc"): Photo[] {
  if (order === "default") return [...photos];
  const time = (photo: Photo) => {
    const value = Date.parse(photo.takenAt || photo.uploadedAt || "");
    return Number.isFinite(value) ? value : 0;
  };
  return [...photos].sort((a, b) => {
    const difference = time(a) - time(b) || (a.title || a.originalName || "").localeCompare(b.title || b.originalName || "", undefined, { numeric: true });
    return order === "asc" ? difference : -difference;
  });
}

export function selectRenderedPhotos(selected: Set<string>, photos: Photo[], visibleCount: number) {
  return new Set([...selected, ...photos.slice(0, visibleCount).map(photo => photo.id)]);
}
