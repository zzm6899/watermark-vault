import { getBookings, getEventTypes, getSettings } from "./storage";
import type { Album, Booking } from "./types";
import { proofingSelectionGuidance } from "./proofing-email";

export function configuredProofingMessage(album: Pick<Album, "id" | "bookingId">, booking?: Booking) {
  const linked = booking || getBookings().find(item => item.id === album.bookingId || item.albumId === album.id);
  const event = getEventTypes().find(item => item.id === linked?.eventTypeId);
  return proofingSelectionGuidance(linked?.duration, getSettings().proofingMessages, event?.proofingMessages);
}
