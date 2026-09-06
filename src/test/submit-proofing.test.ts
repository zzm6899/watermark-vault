import { afterEach, expect, it, vi } from "vitest";
import { submitProofing } from "@/lib/submit-proofing";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const submission = { albumId: "album", selectedPhotoIds: ["one"], clientNote: "Keep warm tones", submissionId: "proof-stable-reference", roundNumber: 1 };
const response = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;

it("recovers a committed receipt when the submission response is lost", async () => {
  const album = { id: "album", proofingRounds: [{ submissionId: submission.submissionId, submittedAt: "2026-09-06", selectedPhotoIds: ["one"] }] };
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("Network interrupted")).mockResolvedValueOnce(response({ album }));
  vi.stubGlobal("fetch", fetcher);
  const result = await submitProofing(submission, "friendly slug");
  expect(result.receipt.submissionId).toBe(submission.submissionId);
  expect(fetcher.mock.calls[1][0]).toBe("/api/public-album/friendly%20slug");
  expect(fetcher.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(1);
});

it("never treats another client's receipt as confirmation of this submission", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ error: "A new round has started" }, false))
    .mockResolvedValueOnce(response({ album: { proofingRounds: [{ submissionId: "other", submittedAt: "2026-09-06", selectedPhotoIds: ["one"] }] } })));
  await expect(submitProofing(submission, "album")).rejects.toThrow("A new round has started");
});

it("keeps an unconfirmed network failure recoverable without silently resubmitting", async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError("offline")); vi.stubGlobal("fetch", fetcher);
  await expect(submitProofing(submission, "album")).rejects.toThrow("couldn’t confirm");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).submissionId).toBe(submission.submissionId);
});

it("does not confirm a reused reference for a different photo selection", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ error: "Reference already used" }, false))
    .mockResolvedValueOnce(response({ album: { id: "album", proofingRounds: [{ submissionId: submission.submissionId, submittedAt: "2026-09-06", selectedPhotoIds: ["two"] }] } })));
  await expect(submitProofing(submission, "album")).rejects.toThrow("Reference already used");
});

it("aborts a stalled request and checks for a saved receipt", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  })).mockResolvedValueOnce(response({ album: { id: "album", proofingRounds: [{ submissionId: submission.submissionId, submittedAt: "2026-09-06", selectedPhotoIds: ["one"] }] } }));
  vi.stubGlobal("fetch", fetcher);
  const pending = submitProofing(submission, "album");
  await vi.advanceTimersByTimeAsync(20000);
  expect((await pending).receipt.submissionId).toBe(submission.submissionId);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
