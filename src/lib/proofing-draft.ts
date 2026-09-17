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
    const addonSelections: Record<string, string[]> = {};
    for (const requirement of album.proofingAddonRequirements || []) {
      const picks = draft.addonSelections?.[requirement.id];
      if (Array.isArray(picks)) addonSelections[requirement.id] = [...new Set(picks.filter((id: unknown): id is string => typeof id === "string" && available.has(id) && (draft.photographerChooses === true || draft.photoIds.includes(id))))].slice(0, requirement.quantity) as string[];
    }
    return { photographerChooses: draft.photographerChooses === true, addonPhotographerChoices: (album.proofingAddonRequirements || []).filter(rule => Array.isArray(draft.addonPhotographerChoices) && draft.addonPhotographerChoices.includes(rule.id)).map(rule => rule.id), addonSelections, photoIds: draft.photoIds.filter((id: unknown): id is string => typeof id === "string" && available.has(id)), note: draft.note.slice(0, 5000), submissionId: draft.submissionId };
  } catch { return null; }
}
