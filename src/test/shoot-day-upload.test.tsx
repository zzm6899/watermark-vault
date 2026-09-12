import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import ShootDayUploadButton from "@/components/ShootDayUploadButton";
import { fetchAlbumPhotos, saveAlbumToServer, uploadPhotosToServer } from "@/lib/api";
import type { Album } from "@/lib/types";

vi.mock("@/lib/api", () => ({ fetchAlbumPhotos: vi.fn(), saveAlbumToServer: vi.fn(), uploadPhotosToServer: vi.fn(), isServerMode: () => true, isSupportedUploadFile: () => true, isSupportedPhotoSource: () => true }));
vi.mock("@/lib/storage", () => ({ cacheAlbumLocally: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
const album = { id: "session-album", title: "Session", photos: [], _photosStripped: true, _replacePhotos: true } as unknown as Album;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchAlbumPhotos).mockResolvedValue([{ id: "old", src: "/old.jpg" }] as Album["photos"]);
  vi.mocked(saveAlbumToServer).mockResolvedValue({ ok: true });
  vi.mocked(uploadPhotosToServer).mockResolvedValue([{ id: "new", url: "/new.jpg", originalName: "new.jpg", size: 10 }]);
});
it("uploads to the chosen session and appends without deleting existing photos", async () => {
  const completed = vi.fn();
  render(<ShootDayUploadButton clientName="Alex" resolveAlbum={() => album} onComplete={completed} />);
  fireEvent.change(screen.getByLabelText("Upload photos for Alex"), { target: { files: [new File(["photo"], "new.jpg", { type: "image/jpeg" })] } });
  await waitFor(() => expect(completed).toHaveBeenCalledOnce());
  expect(uploadPhotosToServer).toHaveBeenCalledWith(expect.any(Array), expect.any(Function), undefined, 3, "Session", "session-album");
  expect(saveAlbumToServer).toHaveBeenLastCalledWith("session-album", expect.objectContaining({ photos: [expect.objectContaining({ id: "old" }), expect.objectContaining({ id: "new" })], _replacePhotos: undefined }));
});
it("does not upload when the existing album cannot be loaded", async () => {
  vi.mocked(fetchAlbumPhotos).mockResolvedValue(null);
  render(<ShootDayUploadButton clientName="Sam" resolveAlbum={() => album} onComplete={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Upload photos for Sam"), { target: { files: [new File(["photo"], "new.jpg")] } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Upload Photos" })).toBeEnabled());
  expect(uploadPhotosToServer).not.toHaveBeenCalled();
});
