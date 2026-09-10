import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { albumIdFromPhotoSourceKey, albumPhotoSourceKey } from "@/lib/album-photo-source";

describe("album photo source identity", () => {
  it("round-trips album IDs independently of duplicate display titles", () => {
    expect(albumIdFromPhotoSourceKey(albumPhotoSourceKey("album-2"))).toBe("album-2");
    expect(albumIdFromPhotoSourceKey("Library")).toBeUndefined();
  });

  it("targets photo actions by album ID in both admin views", () => {
    for (const file of ["src/pages/Admin.tsx", "src/pages/TenantAdmin.tsx"]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).toContain("sourceAlbumId");
      expect(source).not.toContain("albums.find(a => a.title === photo.source)");
      expect(source).not.toContain("setViewSource(a.title)");
    }
  });

  it("waits for storage saves and marks broken photo references as removals", () => {
    const admin = readFileSync(join(process.cwd(), "src/pages/Admin.tsx"), "utf8");
    const tenant = readFileSync(join(process.cwd(), "src/pages/TenantAdmin.tsx"), "utf8");
    expect(admin).toContain('await saveStoreKeyToServer("wv_photo_library", updated)');
    expect(admin).toContain('_removedPhotoIds: brokenPhotos.map(photo => photo.id)');
    expect(admin).toContain('_removedPhotoIds: [...missingSet].map(photo => photo.id)');
    expect(tenant).toContain('const saved = await saveTenantAlbum(slug, updatedAlb)');
    expect(tenant).toContain('_removedPhotoIds: brokenPhotos.map(photo => photo.id)');
  });
});
