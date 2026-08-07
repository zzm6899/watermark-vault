import type { Booking } from "./types";

/** A short, stable reference suitable for a bank-transfer description. */
export function bookingPaymentReference(booking: Pick<Booking, "id" | "date" | "createdAt" | "paymentReference">): string {
  if (booking.paymentReference) return booking.paymentReference;
  const date = String(booking.date || booking.createdAt || "").replace(/\D/g, "").slice(0, 8) || "BOOKING";
  const suffix = String(booking.id || "").replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase() || "REF";
  return `BK-${date}-${suffix}`;
}
