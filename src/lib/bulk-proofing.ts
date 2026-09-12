import type { Album } from "./types";
import { fetchAlbumPhotos, saveAlbumToServer, ensurePublicAlbumAvailable, publicGalleryUrl, sendEmail } from "./api";
import { cacheAlbumLocally } from "./storage";
import { generateCapabilityToken } from "./capability-token";
import { buildProofingEmail, proofingEmailSubject } from "./proofing-email";

export function proofingInviteAction(album: Album): string {
  if (!album.clientEmail?.trim()) return "Missing client email";
  if (!(album._photosStripped ? album.photoCount : album.photos?.length)) return "No photos";
  if (album.status === "archived") return "Album archived";
  if (album.expiresAt && new Date(`${album.expiresAt.slice(0, 10)}T23:59:59`).getTime() < Date.now()) return "Gallery expired";
  if (["selections-submitted", "editing", "finals-delivered"].includes(album.proofingStage || "")) return "Review the current round individually";
  if (album.status === "delivered") return "Already delivered";
  if (album.proofingEnabled && album.proofingStage === "proofing") {
    if (album.proofingExpiresAt && new Date(album.proofingExpiresAt).getTime() <= Date.now()) return "Proofing window expired";
    if (!album.clientToken || album.enabled === false) return "Review gallery access individually";
    return "Resend invite";
  }
  return "Start proofing";
}

export const canSendProofingInvite = (album: Album) => ["Start proofing", "Resend invite"].includes(proofingInviteAction(album));

/** Caller supplies fresh server metadata. Save and verify before sending any email. */
export async function sendAlbumProofingInvite(album: Album, hours: number, note: string, durationMinutes?: number): Promise<Album> {
  const action = proofingInviteAction(album);
  if (!canSendProofingInvite(album)) throw new Error(action);
  let updated = album;
  if (action === "Start proofing") {
    if (!Number.isFinite(hours) || hours < 1 || hours > 720) throw new Error("Choose a proofing window from 1 to 720 hours");
    const photos = await fetchAlbumPhotos(album.id);
    if (!photos?.some(photo => !photo.hidden && photo.cull?.status !== "reject")) throw new Error("No visible photos available for proofing");
    updated = {
      ...album, photos: photos.map(photo => photo.cull?.status === "reject" ? { ...photo, hidden: true } : photo),
      photoCount: photos.length, _photosStripped: false, enabled: true, proofingEnabled: true,
      proofingStage: "proofing", status: "proofing", purchasingDisabled: true, allUnlocked: false,
      clientToken: album.clientToken || generateCapabilityToken("ct"),
      proofingExpiresAt: new Date(Date.now() + hours * 3600000).toISOString(),
      proofingRounds: [...(album.proofingRounds || []), { roundNumber: (album.proofingRounds?.length || 0) + 1, sentAt: new Date().toISOString(), selectedPhotoIds: [], adminNote: note.trim() || undefined }],
    };
    const saved = await saveAlbumToServer(updated.id, updated);
    if (!saved.ok) throw new Error(saved.error || "Could not save proofing");
    cacheAlbumLocally(updated);
  }
  const published = await ensurePublicAlbumAvailable(updated);
  if (!published.ok) throw new Error(published.error || "Gallery link could not be verified");
  const galleryUrl = publicGalleryUrl(updated);
  const result = await sendEmail(updated.clientEmail!.trim(), proofingEmailSubject(updated.title), buildProofingEmail({
    albumTitle: updated.title, clientName: updated.clientName, galleryUrl, durationMinutes,
    expiryDate: updated.proofingExpiresAt ? new Date(updated.proofingExpiresAt).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : undefined,
    note: updated.proofingRounds?.at(-1)?.adminNote,
  }));
  if (!result.ok) throw new Error(result.error || "Proofing saved, but email failed. Retry to resend the invite.");
  return updated;
}
