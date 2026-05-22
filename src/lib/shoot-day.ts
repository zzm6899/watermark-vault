import type { Album, Booking, EventType } from "./types";

export type ShootDaySessionStatus = "next-up" | "in-progress" | "upcoming" | "done" | "past";

export type ShootDayAlbumStats = {
  total: number;
  picks: number;
  review: number;
  rejects: number;
  latestCaptureAt: string | null;
};

export type ShootDayReadiness = {
  warnings: string[];
  blockers: string[];
};

export function localDateString(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function timeToMinutes(time: string): number {
  const [h, m] = (time || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function getShootDayBookings(bookings: Booking[], date = localDateString()): Booking[] {
  return bookings
    .filter((booking) => booking.status !== "cancelled" && booking.date === date)
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
}

export function getBookingAlbum(booking: Booking, albums: Album[]): Album | null {
  return albums.find((album) => album.bookingId === booking.id || album.id === booking.albumId) || null;
}

export function getSessionStatus(booking: Booking, album: Album | null, now = new Date()): ShootDaySessionStatus {
  const today = localDateString(now);
  const hasPhotos = !!album && ((album.photos?.length || 0) > 0 || (album.photoCount || 0) > 0);
  if (booking.status === "completed" || (hasPhotos && booking.date < today)) return "done";
  if (booking.date < today) return "past";
  if (hasPhotos && booking.date === today) return "in-progress";
  if (booking.date === today) {
    const startMins = timeToMinutes(booking.time);
    const endMins = startMins + (booking.duration || 60);
    const nowMins = now.getHours() * 60 + now.getMinutes();
    if (nowMins >= startMins - 30 && nowMins <= endMins + 60) return "next-up";
  }
  return "upcoming";
}

export function getAlbumCaptureStats(album: Album | null): ShootDayAlbumStats {
  const photos = album?.photos || [];
  const latestCaptureAt = photos
    .map((photo) => photo.uploadedAt || photo.takenAt || "")
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  return {
    total: album?.photoCount || photos.length,
    picks: photos.filter((photo) => photo.starred || photo.cull?.status === "pick").length,
    review: photos.filter((photo) => !photo.starred && (!photo.cull?.status || photo.cull.status === "review" || photo.cull.status === "unscored")).length,
    rejects: photos.filter((photo) => photo.cull?.status === "reject").length,
    latestCaptureAt,
  };
}

export function getReadinessWarnings(booking: Booking, album: Album | null, eventType?: EventType): ShootDayReadiness {
  const warnings: string[] = [];
  const blockers: string[] = [];

  if (booking.status === "pending") warnings.push("Booking pending confirmation");
  if (booking.paymentStatus === "unpaid" || !booking.paymentStatus) warnings.push("Payment not marked paid");
  if (!booking.clientEmail) blockers.push("Client email missing");
  if (!album) warnings.push("No linked album yet");
  if (album && (album.photoCount || album.photos?.length || 0) === 0) warnings.push("Album has no photos");
  if (album?.proofingEnabled && album.proofingStage === "selections-submitted") warnings.push("Client selections ready");
  if (album?.status === "delivered") warnings.push("Gallery already delivered");
  if (eventType?.requiresConfirmation && booking.status !== "confirmed" && booking.status !== "completed") {
    warnings.push("Session type requires confirmation");
  }
  const incompleteTasks = (booking.tasks || []).filter((task) => !task.completed).length;
  if (incompleteTasks > 0) warnings.push(`${incompleteTasks} checklist item${incompleteTasks !== 1 ? "s" : ""} open`);

  return { warnings, blockers };
}
