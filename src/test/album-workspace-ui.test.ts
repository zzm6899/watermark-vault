import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("album workspace UI contracts", () => {
  const adminSource = readFileSync(join(process.cwd(), "src/pages/Admin.tsx"), "utf8");
  const gallerySource = readFileSync(join(process.cwd(), "src/pages/AlbumDetail.tsx"), "utf8");
  const workspaceHeaderSource = readFileSync(join(process.cwd(), "src/pages/admin/AlbumWorkspaceHeader.tsx"), "utf8");
  const slotIntervalSource = readFileSync(join(process.cwd(), "src/pages/admin/SlotIntervalField.tsx"), "utf8");
  const albumCardSource = readFileSync(join(process.cwd(), "src/pages/admin/AlbumCardUI.tsx"), "utf8");
  const sectionHeadingSource = readFileSync(join(process.cwd(), "src/pages/admin/AlbumEditorSectionHeading.tsx"), "utf8");
  const slugFieldSource = readFileSync(join(process.cwd(), "src/pages/admin/AlbumSlugField.tsx"), "utf8");

  it("makes the common album actions and editor sections explicit", () => {
    expect(albumCardSource).toContain("Edit album");
    expect(albumCardSource).toContain("View gallery");
    expect(adminSource).toContain('id="album-editor-details"');
    expect(adminSource).toContain('id="album-editor-access"');
    expect(adminSource).toContain('id="album-editor-pricing"');
    expect(adminSource).toContain('id="album-editor-photos"');
    expect(workspaceHeaderSource).toContain("Save changes");
    expect(workspaceHeaderSource).toContain("Album workspace");
    expect(sectionHeadingSource).toContain("scroll-mt-40");
    expect(slugFieldSource).toContain("Already taken");
  });

  it("keeps gallery selection controls without the instructional step cards", () => {
    expect(gallerySource).not.toContain("Review total");
    expect(gallerySource).not.toContain("Free allowance and pricing update automatically");
    expect(gallerySource).toContain("Select visible");
    expect(gallerySource).toContain("Tap photos to select");
    expect(gallerySource).toContain("sticky top-20");
  });

  it("configures start-time increments independently from duration", () => {
    expect(slotIntervalSource).toContain("Start Times Every");
    expect(adminSource).toContain("slotIntervalMinutes");
    expect(slotIntervalSource).toContain("Controls available start choices independently of session length");
  });
});
