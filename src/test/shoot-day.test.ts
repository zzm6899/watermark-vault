import { describe, expect, it } from "vitest";
import {
  getAlbumCaptureStats,
  getBookingAlbum,
  getReadinessWarnings,
  getSessionStatus,
  getShootDayBookings,
} from "@/lib/shoot-day";
import type { Album, Booking } from "@/lib/types";

const booking = (overrides: Partial<Booking> = {}): Booking => ({
  id: "booking-1",
  clientName: "Client One",
  clientEmail: "client@example.com",
  date: "2026-05-22",
  time: "10:00",
  eventTypeId: "event-1",
  type: "Portrait",
  duration: 30,
  status: "confirmed",
  notes: "",
  createdAt: "2026-05-01T00:00:00.000Z",
  paymentStatus: "paid",
  ...overrides,
});

const album = (overrides: Partial<Album> = {}): Album => ({
  id: "album-1",
  slug: "album-1",
  title: "Album One",
  description: "",
  coverImage: "",
  date: "2026-05-22",
  photoCount: 0,
  freeDownloads: 0,
  pricePerPhoto: 0,
  priceFullAlbum: 0,
  isPublic: false,
  photos: [],
  bookingId: "booking-1",
  ...overrides,
});

describe("shoot-day selectors", () => {
  it("returns same-day non-cancelled bookings sorted by time", () => {
    const result = getShootDayBookings([
      booking({ id: "late", time: "14:00" }),
      booking({ id: "cancelled", time: "09:00", status: "cancelled" }),
      booking({ id: "early", time: "08:30" }),
      booking({ id: "other-day", date: "2026-05-23" }),
    ], "2026-05-22");

    expect(result.map((item) => item.id)).toEqual(["early", "late"]);
  });

  it("finds linked albums by bookingId or albumId", () => {
    expect(getBookingAlbum(booking(), [album()])?.id).toBe("album-1");
    expect(getBookingAlbum(booking({ id: "other", albumId: "album-1" }), [album({ bookingId: "different" })])?.id).toBe("album-1");
  });

  it("summarizes capture status counts", () => {
    const stats = getAlbumCaptureStats(album({
      photos: [
        { id: "p1", src: "/uploads/1.jpg", title: "1", width: 1, height: 1, starred: true, uploadedAt: "2026-05-22T01:00:00.000Z" },
        { id: "p2", src: "/uploads/2.jpg", title: "2", width: 1, height: 1, cull: { status: "review" }, uploadedAt: "2026-05-22T02:00:00.000Z" },
        { id: "p3", src: "/uploads/3.jpg", title: "3", width: 1, height: 1, cull: { status: "reject" } },
      ],
    }));

    expect(stats).toMatchObject({ total: 3, picks: 1, review: 1, rejects: 1, latestCaptureAt: "2026-05-22T02:00:00.000Z" });
  });

  it("flags readiness warnings and blockers", () => {
    const readiness = getReadinessWarnings(booking({
      clientEmail: "",
      paymentStatus: "unpaid",
      tasks: [{ id: "task-1", label: "Cull", completed: false }],
    }), null);

    expect(readiness.blockers).toContain("Client email missing");
    expect(readiness.warnings).toContain("Payment not marked paid");
    expect(readiness.warnings).toContain("No linked album yet");
    expect(readiness.warnings).toContain("1 checklist item open");
  });

  it("marks a photo-backed current-day booking as in progress", () => {
    const status = getSessionStatus(
      booking(),
      album({ photoCount: 1 }),
      new Date("2026-05-22T00:00:00.000Z"),
    );
    expect(status).toBe("in-progress");
  });
});
