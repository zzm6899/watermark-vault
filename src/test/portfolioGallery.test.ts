import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultPortfolioSite, importedPortfolioGalleryImages } from "@/lib/portfolio";

describe("portfolio archive import", () => {
  it("ships every unique image imported from the legacy portfolio pages", () => {
    expect(importedPortfolioGalleryImages).toHaveLength(34);
    expect(new Set(importedPortfolioGalleryImages.map(item => item.id)).size).toBe(34);
    expect(new Set(importedPortfolioGalleryImages.map(item => item.image)).size).toBe(34);

    for (const item of importedPortfolioGalleryImages) {
      expect(item.image).toMatch(/^\/portfolio\/imported\/.+\.jpg$/);
      expect(existsSync(path.join(process.cwd(), "public", item.image.slice(1)))).toBe(true);
    }

    expect(defaultPortfolioSite.galleryImages).toHaveLength(46);
    expect(defaultPortfolioSite.gallerySeedVersion).toBe(1);
    expect(defaultPortfolioSite.galleryImages.filter(item => item.category === "Live music")).toHaveLength(6);
    expect(defaultPortfolioSite.concertHeroImage).toContain("/portfolio/");
    expect(defaultPortfolioSite.concertHighlights.length).toBeGreaterThanOrEqual(3);
  });
});
