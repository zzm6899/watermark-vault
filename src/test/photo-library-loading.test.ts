import { describe, expect, it, vi } from "vitest";
import { hydrateStrippedAlbums } from "@/lib/photo-library-loading";
import type { Album } from "@/lib/types";

const makeAlbum = (id: string, stripped = true): Album => ({
  id,
  slug: id,
  title: id,
  description: "",
  coverImage: "",
  date: "2026-01-01",
  photoCount: 0,
  freeDownloads: 0,
  pricePerPhoto: 0,
  priceFullAlbum: 0,
  isPublic: false,
  photos: [],
  _photosStripped: stripped,
});

describe("bounded album photo hydration", () => {
  it("caps parallel requests and reports individual failures while completing the rest", async () => {
    const albums = Array.from({ length: 9 }, (_, index) => makeAlbum(`album-${index}`));
    const progress: string[] = [];
    let activeRequests = 0;
    let peakRequests = 0;
    const fetchPhotos = vi.fn(async (albumId: string) => {
      activeRequests += 1;
      peakRequests = Math.max(peakRequests, activeRequests);
      await new Promise(resolve => setTimeout(resolve, 1));
      activeRequests -= 1;
      return albumId === "album-4" ? null : [{ id: `photo-${albumId}` }];
    });

    const failed = await hydrateStrippedAlbums(albums, fetchPhotos, update => {
      progress.push(update.albumId);
    }, 4);

    expect(peakRequests).toBe(4);
    expect(fetchPhotos).toHaveBeenCalledTimes(9);
    expect(progress).toHaveLength(9);
    expect(failed).toEqual(["album-4"]);
  });

  it("skips albums that already have full photo data", async () => {
    const fetchPhotos = vi.fn(async () => []);
    const failed = await hydrateStrippedAlbums([makeAlbum("ready", false)], fetchPhotos, () => {});

    expect(failed).toEqual([]);
    expect(fetchPhotos).not.toHaveBeenCalled();
  });

  it("stops scheduling new album requests after the view is cancelled", async () => {
    let cancelled = false;
    const resolvers: Array<(photos: { id: string }[] | null) => void> = [];
    const fetchPhotos = vi.fn(() => new Promise<{ id: string }[] | null>(resolve => resolvers.push(resolve)));
    const progress = vi.fn();
    const loading = hydrateStrippedAlbums(
      Array.from({ length: 8 }, (_, index) => makeAlbum(`album-${index}`)),
      fetchPhotos,
      progress,
      2,
      () => cancelled,
    );
    await Promise.resolve();
    expect(fetchPhotos).toHaveBeenCalledTimes(2);

    cancelled = true;
    resolvers.forEach(resolve => resolve([]));
    await expect(loading).resolves.toEqual([]);
    expect(fetchPhotos).toHaveBeenCalledTimes(2);
    expect(progress).not.toHaveBeenCalled();
  });
});
