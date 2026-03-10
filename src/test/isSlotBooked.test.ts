import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Inline minimal storage helpers so the test doesn't need a real DOM
// ---------------------------------------------------------------------------
type Booking = {
  id: string;
  date: string;
  time: string;
  duration: number;
  status: string;
};

function isSlotBooked(
  date: string,
  time: string,
  duration: number,
  bookings: Booking[],
  excludeBookingId?: string,
): boolean {
  const relevant = bookings.filter(
    (b) => b.date === date && b.status !== "cancelled" && b.id !== excludeBookingId,
  );

  if (!time || !/^\d{2}:\d{2}$/.test(time)) return false;
  const [h, m] = time.split(":").map(Number);
  const slotStart = h * 60 + m;
  const slotEnd = slotStart + duration;

  for (const bk of relevant) {
    if (!bk.time || !/^\d{2}:\d{2}$/.test(bk.time)) continue; // skip malformed booking times
    const [bh, bm] = bk.time.split(":").map(Number);
    const bookingStart = bh * 60 + bm;
    const bookingEnd = bookingStart + bk.duration;
    if (slotStart < bookingEnd && slotEnd > bookingStart) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("isSlotBooked", () => {
  const baseBooking: Booking = {
    id: "bk-1",
    date: "2024-06-01",
    time: "10:00",
    duration: 60,
    status: "confirmed",
  };

  it("returns false when there are no bookings on that date", () => {
    expect(isSlotBooked("2024-06-01", "10:00", 60, [])).toBe(false);
  });

  it("returns true for an exact overlapping slot", () => {
    expect(isSlotBooked("2024-06-01", "10:00", 60, [baseBooking])).toBe(true);
  });

  it("returns true for a slot that partially overlaps at the start", () => {
    // new slot 09:30-10:30 overlaps existing 10:00-11:00
    expect(isSlotBooked("2024-06-01", "09:30", 60, [baseBooking])).toBe(true);
  });

  it("returns true for a slot that partially overlaps at the end", () => {
    // new slot 10:30-11:30 overlaps existing 10:00-11:00
    expect(isSlotBooked("2024-06-01", "10:30", 60, [baseBooking])).toBe(true);
  });

  it("returns false for a slot that ends exactly when existing starts", () => {
    // new slot 09:00-10:00 butts up against existing 10:00-11:00 (no overlap)
    expect(isSlotBooked("2024-06-01", "09:00", 60, [baseBooking])).toBe(false);
  });

  it("returns false for a slot that starts exactly when existing ends", () => {
    // new slot 11:00-12:00 starts right when existing 10:00-11:00 ends
    expect(isSlotBooked("2024-06-01", "11:00", 60, [baseBooking])).toBe(false);
  });

  it("ignores cancelled bookings", () => {
    const cancelled = { ...baseBooking, status: "cancelled" };
    expect(isSlotBooked("2024-06-01", "10:00", 60, [cancelled])).toBe(false);
  });

  it("ignores the excluded booking id", () => {
    expect(isSlotBooked("2024-06-01", "10:00", 60, [baseBooking], "bk-1")).toBe(false);
  });

  it("does not throw and returns false when a stored booking has a malformed time", () => {
    const malformed: Booking = { ...baseBooking, id: "bk-bad", time: "not-a-time" };
    // Should not throw — the malformed booking is skipped
    expect(() => isSlotBooked("2024-06-01", "10:00", 60, [malformed])).not.toThrow();
    expect(isSlotBooked("2024-06-01", "10:00", 60, [malformed])).toBe(false);
  });

  it("does not throw and returns false when a stored booking has an empty time", () => {
    const emptyTime: Booking = { ...baseBooking, id: "bk-empty", time: "" };
    expect(() => isSlotBooked("2024-06-01", "10:00", 60, [emptyTime])).not.toThrow();
    expect(isSlotBooked("2024-06-01", "10:00", 60, [emptyTime])).toBe(false);
  });

  it("correctly identifies overlap when valid and malformed bookings coexist", () => {
    const malformed: Booking = { ...baseBooking, id: "bk-bad", time: "abc:def" };
    // malformed is skipped; valid baseBooking at 10:00 should still be detected
    expect(isSlotBooked("2024-06-01", "10:15", 30, [malformed, baseBooking])).toBe(true);
  });
});
