import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultPortfolioSite, importedPortfolioGalleryImages, portfolioCategoryOrder } from "@/lib/portfolio";

describe("portfolio archive import", () => {
  it("ships every unique image imported from the legacy portfolio pages", () => {
    expect(importedPortfolioGalleryImages).toHaveLength(81);
    expect(new Set(importedPortfolioGalleryImages.map(item => item.id)).size).toBe(81);
    expect(new Set(importedPortfolioGalleryImages.map(item => item.image)).size).toBe(81);

    for (const item of importedPortfolioGalleryImages) {
      expect(item.image).toMatch(/^\/portfolio\/(imported|curated)\/.+\.jpg$/);
      expect(existsSync(path.join(process.cwd(), "public", item.image.slice(1)))).toBe(true);
    }

    expect(defaultPortfolioSite.galleryImages).toHaveLength(92);
    expect(defaultPortfolioSite.gallerySeedVersion).toBe(6);
    expect(defaultPortfolioSite.galleryImages.filter(item => item.category === "Cosplay & Conventions")).toHaveLength(13);
    expect(defaultPortfolioSite.galleryImages.filter(item => item.category === "Sports")).toHaveLength(15);
    expect(defaultPortfolioSite.galleryImages.filter(item => item.category === "Live Music")).toHaveLength(8);
    expect(defaultPortfolioSite.galleryImages.filter(item => item.category === "Food & Hospitality")).toHaveLength(18);
    expect(defaultPortfolioSite.galleryImages.some(item => item.alt.toLowerCase().includes("kissing"))).toBe(false);
    const originalResolutionImages = [
      ...importedPortfolioGalleryImages.map(item => item.image),
      "/portfolio/gallery/concert-crowd.jpg",
      "/portfolio/gallery/concert-performer.jpg",
      "/portfolio/gallery/formal-room.jpg",
    ];
    expect(new Set(originalResolutionImages).size).toBe(84);
    expect(defaultPortfolioSite.galleryImages.filter(item => originalResolutionImages.includes(item.image))).toHaveLength(84);
    expect(defaultPortfolioSite.galleryImages.map(item => portfolioCategoryOrder.indexOf(item.category))).toEqual(
      [...defaultPortfolioSite.galleryImages].map(item => portfolioCategoryOrder.indexOf(item.category)).sort((left, right) => left - right),
    );
    expect(defaultPortfolioSite.concertHeroImage).toContain("/portfolio/");
    expect(defaultPortfolioSite.concertHighlights.length).toBeGreaterThanOrEqual(3);
  });
});
