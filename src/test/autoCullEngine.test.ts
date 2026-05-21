import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  autoCullGroup,
  bestShotScore,
  rankBestShots,
  scoreReview,
} = require("../../server/auto-cull-engine.js");

describe("AutoPhotoImporter-style culling engine", () => {
  it("scores photos safely when face and person metadata is absent", () => {
    const review = scoreReview({
      sharpnessScore: 140,
      subjectSharpnessScore: 140,
      exposureValue: 0.4,
    });

    const score = bestShotScore({
      path: "photo-1",
      name: "photo-1.jpg",
      type: "photo",
      sharpnessScore: 140,
      subjectSharpnessScore: 140,
      reviewScore: review.score,
      blurRisk: review.blurRisk,
      exposureValue: 0.4,
    });

    expect(review.blurRisk).toBe("low");
    expect(review.score).toBeGreaterThan(0);
    expect(score).toBeGreaterThan(0);
  });

  it("keeps the best-ranked frame and rejects weaker similar frames", () => {
    const files = [
      {
        path: "best",
        name: "best.jpg",
        type: "photo",
        sharpnessScore: 210,
        subjectSharpnessScore: 210,
        reviewScore: 90,
        blurRisk: "low",
        visualGroupSize: 3,
      },
      {
        path: "soft",
        name: "soft.jpg",
        type: "photo",
        sharpnessScore: 18,
        subjectSharpnessScore: 18,
        reviewScore: 12,
        blurRisk: "high",
        visualGroupSize: 3,
      },
      {
        path: "middle",
        name: "middle.jpg",
        type: "photo",
        sharpnessScore: 75,
        subjectSharpnessScore: 75,
        reviewScore: 45,
        blurRisk: "low",
        visualGroupSize: 3,
      },
    ];

    const ranked = rankBestShots(files);
    const decision = autoCullGroup(files, { confidence: "balanced", keeperQuota: "best-1" });

    expect(ranked[0].path).toBe("best");
    expect(decision.best?.path).toBe("best");
    expect(decision.keep).toContain("best");
    expect(decision.reject).toContain("soft");
  });
});
