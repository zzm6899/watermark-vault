import type { Album } from "./types";

type Submission = { albumId: string; selectedPhotoIds: string[]; clientNote: string; submissionId: string; roundNumber: number; roundSentAt?: string };
type SubmissionResult = { album: Album; receipt: { submissionId: string; submittedAt: string; selectedCount: number } };

async function timedJson(url: string, options?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return { ok: response.ok, body: await response.json() };
  }
  finally { clearTimeout(timer); }
}

/** A lost response is ambiguous: check the saved receipt before offering a retry. */
export async function submitProofing(submission: Submission, slug: string): Promise<SubmissionResult> {
  let failure = "We couldn’t confirm your submission. Your picks are kept on this device. Try submitting again.";
  try {
    const response = await timedJson("/api/proofing/submit", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(submission),
    });
    const body = response.body;
    if (response.ok && body.ok && body.receipt?.submissionId === submission.submissionId && body.album) return body;
    if (body.error) failure = body.error;
  } catch { /* Check whether the server committed before the connection failed. */ }
  try {
    const response = await timedJson(`/api/public-album/${encodeURIComponent(slug)}`);
    if (response.ok) {
      const { album } = response.body as { album: Album };
      const requestedIds = JSON.stringify([...new Set(submission.selectedPhotoIds)].sort());
      const round = album?.id === submission.albumId && album.proofingRounds?.find(item =>
        item.submissionId === submission.submissionId && item.submittedAt &&
        JSON.stringify([...new Set(item.selectedPhotoIds)].sort()) === requestedIds);
      if (round) return { album, receipt: { submissionId: submission.submissionId, submittedAt: round.submittedAt!, selectedCount: round.selectedPhotoIds.length } };
    }
  } catch { /* Keep the original message and stable submission ID for retry. */ }
  throw new Error(failure);
}
