import { describe, expect, it } from "vitest";
import { buildAlbumPhotoSaveMarkers } from "@/lib/album-photo-save";

describe("album photo save markers", () => {
  it("records a photo removed from the editor's original snapshot", () => {
    expect(buildAlbumPhotoSaveMarkers(
      ["photo-1", "photo-2"],
      [{ id: "photo-2" }],
    )).toEqual({
      _replacePhotos: true,
      _basePhotoIds: ["photo-1", "photo-2"],
      _removedPhotoIds: ["photo-1"],
    });
  });

  it("keeps explicit deletions for photos added during the editing session", () => {
    expect(buildAlbumPhotoSaveMarkers(
      ["photo-1"],
      [{ id: "photo-1" }],
      ["new-photo"],
    )._removedPhotoIds).toEqual(["new-photo"]);
  });
});
