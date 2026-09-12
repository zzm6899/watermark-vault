import { buildClientEmail, emailParagraphs, escapeEmailHtml } from "./client-email";

interface ProofingEmailOptions {
  albumTitle: string;
  clientName?: string;
  galleryUrl: string;
  expiryDate?: string;
  note?: string;
}

export function buildProofingEmail({ albumTitle, clientName, galleryUrl, expiryDate, note }: ProofingEmailOptions) {
  const greeting = clientName?.trim() ? `Hi ${clientName.trim()},` : "Hi,";
  return buildClientEmail({
    title: albumTitle,
    label: "Photo selections",
    bodyHtml: emailParagraphs(`${greeting}\n\nYour photos are ready to look through. Open the gallery, star the photos you’d like edited, then choose Submit Picks when you’re done.\n\nThese are previews. Your finished edits will follow after you’ve made your selections.`)
      + (note?.trim() ? `<div style="margin:0 0 24px;padding-left:16px;border-left:2px solid #c4b59a;font-size:15px;line-height:1.7;">${escapeEmailHtml(note.trim()).replace(/\r?\n/g, "<br>")}</div>` : ""),
    action: { label: "Choose your photos", url: galleryUrl },
    footer: expiryDate ? `Please submit your selections by ${expiryDate}.` : "",
  });
}

export const proofingEmailSubject = (albumTitle: string) => `Choose your photos: ${albumTitle}`;
