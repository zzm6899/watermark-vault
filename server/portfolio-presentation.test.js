const { test } = require("node:test");
const assert = require("node:assert/strict");
const { upgradePortfolioPresentation } = require("./portfolio-presentation.mjs");

test("presentation migration upgrades seed copy, preserves originals and is idempotent", () => {
  const original = { portfolioTitle: "Stories that still feel alive.", introTitle: "A custom introduction", projects: [{ id: "corporate", title: "My commercial work", image: "/portfolio-media/my-original.jpg" }], galleryImages: [{ id: "mine", image: "/portfolio-media/mine.jpg" }] };
  const migrated = upgradePortfolioPresentation(original);
  assert.equal(migrated.portfolioTitle, "Selected work");
  assert.equal(migrated.introTitle, original.introTitle);
  assert.deepEqual(migrated.projects, original.projects);
  assert.strictEqual(migrated.galleryImages, original.galleryImages);
  assert.deepEqual(upgradePortfolioPresentation(migrated), migrated);
  assert.equal(original.presentationVersion, undefined);
});
