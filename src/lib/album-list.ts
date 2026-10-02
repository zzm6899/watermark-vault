import type { Album, Booking } from "@/lib/types";

export type AlbumListFilter = "all" | "requests" | "picks" | "delivered" | "hidden";

export function filterAlbumsForAdmin(albums: Album[], bookings: Booking[], filter: AlbumListFilter, search: string): Album[] {
  const bookingMap = new Map(bookings.map((booking) => [booking.id, booking]));
  const query = search.trim().toLowerCase();

  return albums.filter((album) => {
    if (filter === "requests" && !(album.downloadRequests || []).some((request) => request.status === "pending")) return false;
    if (filter === "picks" && album.proofingStage !== "selections-submitted") return false;
    if (filter === "hidden" && album.enabled !== false) return false;
    if (filter === "delivered" && album.status !== "delivered" && album.proofingStage !== "finals-delivered") return false;
    if (!query) return true;

    const linkedBooking = bookingMap.get(album.bookingId || "") || bookings.find((booking) => booking.albumId === album.id);
    const searchableFields = [
      album.title,
      album.clientName,
      album.clientEmail,
      album.description,
      album.slug,
      album.instagramHandle,
      linkedBooking?.instagramHandle,
    ];
    return searchableFields.some((value) => value?.toLowerCase().includes(query));
  });
}
