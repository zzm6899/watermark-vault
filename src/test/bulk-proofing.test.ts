import { beforeEach, expect, it, vi } from "vitest";
import type { Album } from "@/lib/types";
import { proofingInviteAction, sendAlbumProofingInvite } from "@/lib/bulk-proofing";
import { fetchAlbumPhotos, saveAlbumToServer, ensurePublicAlbumAvailable, sendEmail } from "@/lib/api";

vi.mock("@/lib/api", () => ({ fetchAlbumPhotos: vi.fn(), saveAlbumToServer: vi.fn(), ensurePublicAlbumAvailable: vi.fn(), publicGalleryUrl: () => "https://example.com/gallery#token=private", sendEmail: vi.fn() }));
vi.mock("@/lib/storage", () => ({ cacheAlbumLocally: vi.fn() }));
const album = { id: "one", title: "Portraits", slug: "portraits", clientEmail: "client@example.com", _photosStripped: true, photoCount: 2, photos: [] } as unknown as Album;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchAlbumPhotos).mockResolvedValue([{ id: "photo", src: "/photo.jpg" }] as Album["photos"]);
  vi.mocked(saveAlbumToServer).mockResolvedValue({ ok: true });
  vi.mocked(ensurePublicAlbumAvailable).mockResolvedValue({ ok: true });
  vi.mocked(sendEmail).mockResolvedValue({ ok: true });
});
it("hydrates and saves a new round before sending a private link", async () => {
  const result = await sendAlbumProofingInvite(album, 48, "", 20);
  expect(result.photos).toHaveLength(1);
  expect(result.proofingRounds).toHaveLength(1);
  expect(result.purchasingDisabled).toBe(true);
  expect(saveAlbumToServer).toHaveBeenCalledWith("one", result);
  expect(sendEmail).toHaveBeenCalledWith("client@example.com", expect.any(String), expect.stringContaining("#token=private"));
  expect(sendEmail).toHaveBeenCalledWith("client@example.com", expect.any(String), expect.stringContaining("pick 5–8 photos"));
});
it("resends active rounds without resetting selections or expiry", async () => {
  const active = { ...album, proofingEnabled: true, proofingStage: "proofing", clientToken: "private", proofingRounds: [{ roundNumber: 1, sentAt: "2026-01-01", selectedPhotoIds: ["photo"] }] } as Album;
  expect(await sendAlbumProofingInvite(active, 48, "Different note", 40)).toBe(active);
  expect(saveAlbumToServer).not.toHaveBeenCalled();
  expect(fetchAlbumPhotos).not.toHaveBeenCalled();
  expect(sendEmail).toHaveBeenCalledOnce();
  expect(sendEmail).toHaveBeenCalledWith("client@example.com", expect.any(String), expect.stringContaining("pick 10–15 photos"));
});
it("does not send when saving or publication fails", async () => {
  vi.mocked(saveAlbumToServer).mockResolvedValue({ ok: false, error: "Save failed" });
  await expect(sendAlbumProofingInvite(album, 48, "")).rejects.toThrow("Save failed");
  expect(sendEmail).not.toHaveBeenCalled();
  vi.mocked(saveAlbumToServer).mockResolvedValue({ ok: true });
  vi.mocked(ensurePublicAlbumAvailable).mockResolvedValue({ ok: false, error: "Not published" });
  await expect(sendAlbumProofingInvite(album, 48, "")).rejects.toThrow("Not published");
  expect(sendEmail).not.toHaveBeenCalled();
});
it("skips missing emails, expired windows and submitted selections", () => {
  expect(proofingInviteAction({ ...album, clientEmail: "" })).toBe("Missing client email");
  expect(proofingInviteAction({ ...album, proofingStage: "selections-submitted" })).toContain("individually");
  expect(proofingInviteAction({ ...album, proofingEnabled: true, proofingStage: "proofing", proofingExpiresAt: "2000-01-01" })).toBe("Proofing window expired");
});
