import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Album } from "@/lib/types";

const apiMocks = vi.hoisted(() => ({
  persistAlbumToServer: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  createAdminBooking: vi.fn(),
  deleteAdminBooking: vi.fn(),
  patchAdminBooking: vi.fn(),
  persistToServer: vi.fn(),
  persistAlbumToServer: apiMocks.persistAlbumToServer,
  deleteAlbumFromServer: vi.fn(),
  createAdminInvoice: vi.fn(),
  updateAdminInvoice: vi.fn(),
  deleteAdminInvoice: vi.fn(),
}));

import { getAlbums, updateAlbum } from "@/lib/storage";

const album: Album = {
  id: "album-1",
  slug: "album-1",
  title: "Upload Test",
  description: "",
  coverImage: "/uploads/photo-1.jpg",
  date: "2026-09-10",
  photoCount: 1,
  freeDownloads: 0,
  pricePerPhoto: 0,
  priceFullAlbum: 0,
  isPublic: true,
  photos: [{ id: "photo-1", src: "/uploads/photo-1.jpg", title: "Photo 1", width: 1200, height: 800 }],
};

describe("album transport markers", () => {
  beforeEach(() => {
    localStorage.clear();
    apiMocks.persistAlbumToServer.mockClear();
  });

  it("sends one-shot merge controls to the server without storing them locally", () => {
    const update = { ...album, _replacePhotos: true, _removedPhotoIds: ["old-photo"], _basePhotoIds: ["photo-1"] };

    updateAlbum(update);

    expect(apiMocks.persistAlbumToServer).toHaveBeenCalledWith(album.id, update);
    expect(getAlbums()).toEqual([album]);
    expect(getAlbums()[0]._replacePhotos).toBeUndefined();
    expect(getAlbums()[0]._removedPhotoIds).toBeUndefined();
    expect(getAlbums()[0]._basePhotoIds).toBeUndefined();
  });
});
