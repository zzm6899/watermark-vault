import { expect, it } from "vitest";
import { selectRenderedPhotos, sortGalleryPhotos } from "@/lib/gallery-display";
import type { Photo } from "@/lib/types";

it("preserves photographer order, including legacy photos without titles", () => {
  const photos = [{ id: "b", src: "b.jpg" }, { id: "a", src: "a.jpg", title: "First" }] as Photo[];
  expect(sortGalleryPhotos(photos, "default").map(photo => photo.id)).toEqual(["b", "a"]);
});

it("sorts invalid or missing dates and titles deterministically without changing the source", () => {
  const photos = [
    { id: "new", title: "New", takenAt: "2026-09-01" },
    { id: "ten", originalName: "IMG_10.jpg", takenAt: "invalid" },
    { id: "two", originalName: "IMG_2.jpg" },
  ] as Photo[];
  expect(sortGalleryPhotos(photos, "asc").map(photo => photo.id)).toEqual(["two", "ten", "new"]);
  expect(sortGalleryPhotos(photos, "desc").map(photo => photo.id)).toEqual(["new", "ten", "two"]);
  expect(photos[0].id).toBe("new");
});

it("selects the rendered batch without losing selections in another filter", () => {
  const photos = Array.from({ length: 60 }, (_, index) => ({ id: String(index) })) as Photo[];
  const previous = new Set(["elsewhere", "1"]);
  const selected = selectRenderedPhotos(previous, photos, 36);
  expect(selected.size).toBe(37);
  expect(selected.has("elsewhere")).toBe(true);
  expect(selected.has("35")).toBe(true);
  expect(selected.has("36")).toBe(false);
  expect(previous.size).toBe(2);
});
