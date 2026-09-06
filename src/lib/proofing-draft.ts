import type { Album } from "./types";

export function proofingDraftKey(album: Album, sessionKey: string) {
  const round = album.proofingRounds?.at(-1);
  return `wv_proofing_draft:${album.id}:${sessionKey}:${round?.roundNumber || 1}:${round?.sentAt || "initial"}`;
}

export function readProofingDraft(album: Album, sessionKey: string) {
  if (!album.proofingEnabled || album.proofingStage !== "proofing") return null;
  try {
    const draft = JSON.parse(localStorage.getItem(proofingDraftKey(album, sessionKey)) || "null");
    if (!draft || !Array.isArray(draft.photoIds) || typeof draft.note !== "string" || typeof draft.submissionId !== "string") return null;
    const available = new Set(album.photos.map(photo => photo.id));
    return { photoIds: draft.photoIds.filter((id: unknown): id is string => typeof id === "string" && available.has(id)), note: draft.note.slice(0, 5000), submissionId: draft.submissionId };
  } catch { return null; }
}
