import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { calculateAlbumCheckout } = require("../../server/stripe.js") as {
  calculateAlbumCheckout: (album: Record<string, unknown>, request: Record<string, unknown>) => Record<string, any>;
};

function albumFixture() {
  return {
    id: "album-1",
    title: "Client Gallery",
    enabled: true,
    freeDownloads: 2,
    pricePerPhoto: 5,
    priceFullAlbum: 120,
    photos: Array.from({ length: 24 }, (_, index) => ({ id: `photo-${index + 1}`, src: `/uploads/${index + 1}.jpg` })),
    sessionPurchases: { viewer: { photoIds: ["photo-1"] } },
    usedFreeDownloads: { viewer: 1 },
  };
}

describe("album checkout pricing", () => {
  it("derives the amount from stored prices and retains large selections", () => {
    const photoIds = Array.from({ length: 20 }, (_, index) => `photo-${index + 1}`);
    const result = calculateAlbumCheckout(albumFixture(), { sessionKey: "viewer", photoIds, amount: 0.01 });

    expect(result.error).toBeUndefined();
    expect(result.photoIds).toHaveLength(18);
    expect(result.amount).toBe(90);
  });

  it("rejects hidden and rejected photos", () => {
    const album = albumFixture();
    album.photos[2].hidden = true;
    album.photos[3].cull = { status: "reject" };

    expect(calculateAlbumCheckout(album, { sessionKey: "viewer", photoIds: ["photo-3"] }).error).toContain("unavailable");
    expect(calculateAlbumCheckout(album, { sessionKey: "viewer", photoIds: ["photo-4"] }).error).toContain("unavailable");
  });

  it("uses the stored full-album price", () => {
    const result = calculateAlbumCheckout(albumFixture(), { sessionKey: "viewer", isFullAlbum: true, amount: 1 });
    expect(result.amount).toBe(120);
    expect(result.photoCount).toBe(24);
  });
});
