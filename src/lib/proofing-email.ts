import { buildClientEmail, emailParagraphs, escapeEmailHtml } from "./client-email";

interface ProofingEmailOptions {
  albumTitle: string;
  clientName?: string;
  galleryUrl: string;
  expiryDate?: string;
  note?: string;
  durationMinutes?: number;
  selectionGuidance?: string;
}

export function proofingSelectionGuidance(durationMinutes?: number, defaults?: Record<string, string>, overrides?: Record<string, string>) {
  const key = String(durationMinutes);
  const custom = overrides?.[key]?.trim() || overrides?.default?.trim() || defaults?.[key]?.trim() || defaults?.default?.trim();
  if (custom) return custom;
  if (durationMinutes === 20) return "For your 20-minute session, please pick 5–8 photos to be edited.";
  if (durationMinutes === 40) return "For your 40-minute session, please pick 10–15 photos to be edited.";
  return "Please pick the photos you’d like edited.";
}

export function buildProofingEmail({ albumTitle, clientName, galleryUrl, expiryDate, note, durationMinutes, selectionGuidance }: ProofingEmailOptions) {
  const greeting = clientName?.trim() ? `Hi ${clientName.trim()},` : "Hi,";
  return buildClientEmail({
    title: albumTitle,
    label: "Photo selections",
    bodyHtml: emailParagraphs(`${greeting}\n\nYour photos are ready to look through. ${selectionGuidance || proofingSelectionGuidance(durationMinutes)}\n\nOpen the gallery, star your favourites, then choose Submit Picks when you’re done.\n\nThese are previews. Your finished edits will follow after you’ve made your selections.`)
      + (note?.trim() ? `<div style="margin:0 0 24px;padding-left:16px;border-left:2px solid #c4b59a;font-size:15px;line-height:1.7;">${escapeEmailHtml(note.trim()).replace(/\r?\n/g, "<br>")}</div>` : ""),
    action: { label: "Choose your photos", url: galleryUrl },
    footer: expiryDate ? `Please submit your selections by ${expiryDate}.` : "",
  });
}

export const proofingEmailSubject = (albumTitle: string) => `Choose your photos: ${albumTitle}`;
