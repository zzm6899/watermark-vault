import { describe, expect, it } from "vitest";
import { filterAlbumsForAdmin } from "@/lib/album-list";
import type { Album, Booking } from "@/lib/types";

const baseAlbum = (overrides: Partial<Album> = {}): Album => ({
  id: "album-1", slug: "gallery-1", title: "Convention Portraits", description: "Cosplay portraits", coverImage: "", date: "2026-09-01",
  photoCount: 2, freeDownloads: 0, pricePerPhoto: 2, priceFullAlbum: 20, isPublic: true, photos: [], ...overrides,
});

const albums = [
  baseAlbum({ id: "picked", bookingId: "booking-1", proofingEnabled: true, proofingStage: "selections-submitted" }),
  baseAlbum({ id: "request", title: "Market Portraits", downloadRequests: [{ id: "request-1", status: "pending", method: "bank-transfer", photoIds: ["photo-1"], requestedAt: "2026-09-01T00:00:00Z" }] }),
  baseAlbum({ id: "hidden", enabled: false, status: "delivered" }),
] as Album[];
const bookings = [{ id: "booking-1", instagramHandle: "@cosplay.client" }] as Booking[];

describe("admin album filters", () => {
  it("returns only matching workflow states and supports a clean empty result", () => {
    expect(filterAlbumsForAdmin(albums, bookings, "picks", "").map(album => album.id)).toEqual(["picked"]);
    expect(filterAlbumsForAdmin(albums, bookings, "requests", "").map(album => album.id)).toEqual(["request"]);
    expect(filterAlbumsForAdmin(albums, bookings, "delivered", "").map(album => album.id)).toEqual(["hidden"]);
    expect(filterAlbumsForAdmin(albums, bookings, "all", "no match")).toEqual([]);
  });

  it("searches linked client handles and album metadata without depending on result casing", () => {
    expect(filterAlbumsForAdmin(albums, bookings, "all", "COSPLAY.CLIENT").map(album => album.id)).toEqual(["picked"]);
    expect(filterAlbumsForAdmin(albums, bookings, "all", " market ").map(album => album.id)).toEqual(["request"]);
  });
});
