const crypto = require("crypto");

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

// Reconcile an editor's photo snapshot without deleting photos that another
// device added after that editor was opened. A replacement may only remove
// photos that were present in the editor's base snapshot; concurrent additions
// remain in the album. Legacy replacements without a base retain their previous
// full-replacement behaviour.
function dedupeAlbumPhotos(photos) {
  const seenIds = new Set();
  const seenSources = new Set();
  return (Array.isArray(photos) ? photos : []).filter(photo => {
    const id = String(photo?.id || "");
    const src = String(photo?.src || "");
    if ((id && seenIds.has(id)) || (src && seenSources.has(src))) return false;
    if (id) seenIds.add(id);
    if (src) seenSources.add(src);
    return true;
  });
}

function mergeAlbumPhotos(existingPhotos, incomingPhotos, { replacePhotos = false, basePhotoIds } = {}) {
  const existing = dedupeAlbumPhotos(existingPhotos);
  const incoming = dedupeAlbumPhotos(incomingPhotos);
  if (replacePhotos && !Array.isArray(basePhotoIds)) return [...incoming];

  const incomingIds = new Set(incoming.map(photo => String(photo?.id || "")).filter(Boolean));
  const removedBaseIds = replacePhotos
    ? new Set(basePhotoIds.map(String).filter(id => id && !incomingIds.has(id)))
    : new Set();
  const merged = existing.filter(photo => !removedBaseIds.has(String(photo?.id || ""))).map(photo => ({ ...photo }));

  for (const photo of incoming) {
    if (!photo || typeof photo !== "object") continue;
    let idx = photo.id ? merged.findIndex(candidate => candidate?.id === photo.id) : -1;
    if (idx < 0 && photo.src) idx = merged.findIndex(candidate => candidate?.src === photo.src);
    if (idx >= 0) merged[idx] = { ...merged[idx], ...photo };
    else merged.push(photo);
  }
  return merged;
}

function markAlbumDelivered(album, deliveredAt = new Date().toISOString()) {
  const delivered = {
    ...album,
    watermarkDisabled: true,
    status: "delivered",
    deliveredAt,
    isPublic: true,
  };
  if (album?.proofingEnabled) {
    delivered.proofingStage = "finals-delivered";
    delivered.proofingExpiresAt = undefined;
    // Starting proofing disables purchasing. Delivery must release that
    // temporary workflow lock so the normal free/paid download rules apply.
    delivered.purchasingDisabled = false;
  }
  return delivered;
}

function repairDeliveredAlbumWorkflows(albums) {
  let repaired = 0;
  const next = (Array.isArray(albums) ? albums : []).map(album => {
    if (album?.status !== "delivered" || !album.proofingEnabled || album.proofingStage === "finals-delivered") return album;
    repaired += 1;
    return markAlbumDelivered(album, album.deliveredAt || new Date().toISOString());
  });
  return { albums: next, repaired };
}

const ALBUM_STATUSES = new Set(["editing", "proofing", "delivered", "archived"]);
const PROOFING_STAGES = new Set(["not-started", "proofing", "selections-submitted", "editing", "finals-delivered"]);

/** Apply an explicit admin status change without replacing client proofing rounds or photo data. */
function updateManualAlbumStatus(album, input, updatedAt = new Date().toISOString()) {
  if (!album) return { error: "Album not found", status: 404 };
  const status = String(input?.status || "");
  const proofingStage = input?.proofingStage == null ? undefined : String(input.proofingStage);
  if (!ALBUM_STATUSES.has(status)) return { error: "Invalid album status", status: 400 };
  if (proofingStage !== undefined && !PROOFING_STAGES.has(proofingStage)) return { error: "Invalid proofing stage", status: 400 };
  return {
    album: {
      ...album,
      status,
      ...(proofingStage !== undefined ? { proofingStage } : {}),
      updatedAt,
    },
  };
}

function recoverablePurchase(album, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const purchases = Object.values(album.sessionPurchases || {}).filter(purchase =>
    purchase && purchase.source !== "email-recovery" && purchase.source !== "share-link" &&
    normalizeEmail(purchase.purchaserEmail) === normalized && purchase.purchaserEmailVerified === true &&
    (purchase.fullAlbum === true || purchase.photoIds?.length));
  if (!purchases.length) return null;
  return { fullAlbum: purchases.some(purchase => purchase.fullAlbum === true),
    photoIds: [...new Set(purchases.flatMap(purchase => purchase.photoIds || []))] };
}

function stripePurchaseIdentity(session, order, current = {}) {
  const email = (current.purchaserEmailVerified && (current.fullAlbum || current.photoIds?.length) && normalizeEmail(current.purchaserEmail)) ||
    normalizeEmail(session.customer_details?.email) || normalizeEmail(session.customer_email) || normalizeEmail(order.clientEmail);
  return { source: "stripe", purchaserEmail: email || "", purchaserEmailVerified: !!email,
    emailVerifiedAt: current.emailVerifiedAt };
}

// Admin saves often contain old album snapshots. Payment records are owned by
// payment endpoints; unseen client submissions must survive those stale saves.
function preserveGalleryServerState(existing, incoming) {
  if (!existing) return incoming;
  const merged = { ...existing, ...incoming };
  for (const key of ["sessionPurchases", "usedFreeDownloads", "proofingNotifications", "downloadRequests"]) {
    if (existing[key] !== undefined) merged[key] = existing[key];
    else delete merged[key];
  }
  const submitted = (existing.proofingRounds || []).filter(round => round.submittedAt);
  const incomingRounds = incoming.proofingRounds || [];
  const unseen = submitted.some(round => !incomingRounds.some(candidate =>
    candidate.roundNumber === round.roundNumber && candidate.submittedAt === round.submittedAt));
  if (existing.proofingRevision) merged.proofingRevision = existing.proofingRevision;
  const staleRevision = existing.proofingRevision && incoming.proofingRevision !== existing.proofingRevision;
  if (staleRevision || (unseen && !existing.proofingRevision)) {
    merged.proofingStage = existing.proofingStage;
    merged.proofingRounds = existing.proofingRounds;
    merged.proofingEnabled = existing.proofingEnabled;
    merged.proofingExpiresAt = existing.proofingExpiresAt;
    const stars = new Map((existing.photos || []).map(photo => [photo.id, photo.starred]));
    merged.photos = (merged.photos || []).map(photo => stars.has(photo.id) ? { ...photo, starred: stars.get(photo.id) } : photo);
  }
  return merged;
}

// Photo uploads are merged additively so concurrent camera/mobile uploads are
// not lost. Deletions therefore need explicit tombstones; otherwise a stale
// full-album save can merge the removed photos straight back into the album.
function applyAlbumPhotoRemovals(album, removedPhotoIds) {
  const removed = new Set((removedPhotoIds || []).map(String).filter(Boolean));
  if (!removed.size) return album;

  const photos = (album.photos || []).filter(photo => !removed.has(String(photo.id)));
  const photoSources = new Set(photos.map(photo => photo.src).filter(Boolean));
  const coverImage = album.coverImage && photoSources.has(album.coverImage)
    ? album.coverImage
    : (photos[0]?.src || "");
  const proofingRounds = Array.isArray(album.proofingRounds)
    ? album.proofingRounds.map(round => ({
        ...round,
        selectedPhotoIds: Array.isArray(round.selectedPhotoIds)
          ? round.selectedPhotoIds.filter(id => !removed.has(String(id)))
          : round.selectedPhotoIds,
      }))
    : album.proofingRounds;

  return { ...album, photos, photoCount: photos.length, coverImage, proofingRounds };
}

function proofingSubmission(album, { selectedPhotoIds, clientNote, submissionId, roundNumber, roundSentAt }, now = new Date().toISOString()) {
  const ids = [...new Set(selectedPhotoIds.map(String).filter(Boolean))];
  const note = typeof clientNote === "string" ? clientNote.trim().slice(0, 5000) : "";
  const rounds = album.proofingRounds || [];
  const latest = rounds.at(-1);
  const receiptId = /^[a-zA-Z0-9_-]{16,100}$/.test(String(submissionId || "")) ? submissionId : crypto.randomUUID();
  if (latest?.submittedAt && latest.submissionId === receiptId) {
    if (JSON.stringify([...latest.selectedPhotoIds].sort()) !== JSON.stringify([...ids].sort()) || (latest.clientNote || "") !== note) {
      return { error: "This submission reference was already used for different selections", status: 409 };
    }
    return { album, receipt: latest, replayed: true };
  }
  if (!album.proofingEnabled || album.proofingStage !== "proofing") return { error: "This gallery is no longer accepting selections. Reload to see the latest status.", status: 409 };
  if ((roundNumber != null && Number(roundNumber) !== Number(latest?.roundNumber || 1)) ||
      (roundSentAt != null && String(roundSentAt) !== String(latest?.sentAt || ""))) {
    return { error: "A new proofing round has started. Reload the gallery before submitting.", status: 409 };
  }
  if (!ids.length) return { error: "Select at least one photo", status: 400 };
  const selectable = new Set((album.photos || []).filter(photo => !photo.hidden && (album.showCullRejectsToClient || photo.cull?.status !== "reject")).map(photo => String(photo.id)));
  if (ids.some(id => !selectable.has(id))) return { error: "One or more selected photos are unavailable", status: 400 };
  const receipt = { ...(latest || { roundNumber: 1, sentAt: now }), selectedPhotoIds: ids, clientNote: note || undefined, submittedAt: now, submissionId: receiptId };
  const selected = new Set(ids);
  return { album: { ...album, proofingRevision: receiptId, proofingStage: "selections-submitted", proofingRounds: [...rounds.slice(0, -1), receipt],
    photos: (album.photos || []).map(photo => ({ ...photo, starred: selected.has(String(photo.id)) })) }, receipt, replayed: false };
}

module.exports = { applyAlbumPhotoRemovals, dedupeAlbumPhotos, markAlbumDelivered, mergeAlbumPhotos, normalizeEmail, recoverablePurchase, preserveGalleryServerState, proofingSubmission, repairDeliveredAlbumWorkflows, stripePurchaseIdentity, updateManualAlbumStatus };
