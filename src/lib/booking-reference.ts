import type { Booking } from "./types";

/** A short, stable reference suitable for a bank-transfer description. */
export function bookingPaymentReference(booking: Pick<Booking, "id" | "date" | "createdAt" | "paymentReference">): string {
  const supplied = String(booking.paymentReference || "").trim();
  // Keep deliberately entered short references, but compact the older
  // date-based format automatically so clients never receive a long string.
  if (supplied && !/^BK-\d{8}-/i.test(supplied)) return supplied;
  const source = supplied || String(booking.id || "");
  const suffix = source.replace(/[^a-z0-9]/gi, "").slice(-5).toUpperCase() || "REF";
  return `BK-${suffix}`;
}
