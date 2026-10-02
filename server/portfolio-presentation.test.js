const { test } = require("node:test");
const assert = require("node:assert/strict");
const { upgradePortfolioPresentation } = require("./portfolio-presentation.mjs");

test("presentation migration upgrades seed copy, preserves originals and is idempotent", () => {
  const galleryImages = [{ id: "mine", image: "/portfolio-media/mine.jpg" }];
  const original = { portfolioTitle: "Stories that still feel alive.", introTitle: "A custom introduction", projects: [{ id: "corporate", title: "My commercial work", image: "/portfolio-media/my-original.jpg" }], galleryImages };
  const migrated = upgradePortfolioPresentation(original);
  assert.equal(migrated.portfolioTitle, "Selected photographs");
  assert.equal(migrated.presentationVersion, 5);
  assert.equal(migrated.introTitle, original.introTitle);
  assert.deepEqual(migrated.projects, original.projects);
  assert.strictEqual(migrated.galleryImages.at(-1), galleryImages[0]);
  assert.equal(galleryImages.length, 1);
  assert.equal(original.portfolioTitle, "Stories that still feel alive.");
  assert.equal(original.presentationVersion, undefined);
  assert.deepEqual(upgradePortfolioPresentation(migrated), migrated);
});

test("v1 seed presentation refreshes known copy and preserves custom content", () => {
  const galleryImages = [{ id: "custom-photo", image: "/portfolio-media/custom.jpg", category: "Brand & Corporate" }];
  const customProject = { id: "private-project", title: "Client's own title", image: "/portfolio-media/client.jpg", category: "Events" };
  const legacy = {
    presentationVersion: 1,
    focusVersion: 1,
    portfolioTitle: "Selected work",
    portfolioBody: "Client's custom description.",
    portfolioCtaEyebrow: "Your story, photographed honestly",
    storyTitle: "Every room has its own rhythm.",
    introTitle: "Client's introduction.",
    heroImages: ["/portfolio/curated/cosplay-animaga-editorial.jpg", "/portfolio/curated/music-teddyloid-smash-crowd.webp", "/portfolio/imported/lemontage6-2-2025roomshotsnestle42of71.jpg"],
    heroCaptions: [
      { id: "cosplay", title: "Cosplay & character", description: "The craft. The character. A world of your own.", category: "Cosplay & Conventions" },
      { id: "music", title: "Live performance", description: "The energy of the room, held in a photograph.", category: "Live Music" },
      { id: "brands", title: "Brands & hospitality", description: "An eye for the details that make you different.", category: "Brand & Corporate" },
    ],
    projects: [
      { id: "corporate", title: "Brands & events", image: "/portfolio/imported/lemontage6-2-2025roomshotsnestle42of71.jpg", description: "Client's custom project copy.", category: "Brand & Corporate" },
      customProject,
    ],
    galleryImages,
  };
  const migrated = upgradePortfolioPresentation(legacy);

  assert.equal(migrated.portfolioTitle, "Selected photographs");
  assert.equal(migrated.portfolioBody, "Client's custom description.");
  assert.equal(migrated.portfolioCtaEyebrow, "Have an event coming up?");
  assert.equal(migrated.storyTitle, "A clear brief.\nA considered eye.");
  assert.equal(migrated.introTitle, "Client's introduction.");
  assert.deepEqual(migrated.heroImages, ["/portfolio/selected/navarra-gala-dining-room.webp", "/portfolio/selected/navarra-cbhs-live-cooking.webp", "/portfolio/curated/music-teddyloid-smash-crowd.webp"]);
  assert.deepEqual(migrated.heroCaptions.map(({ title, category }) => [title, category]), [
    ["Gala dinner", "Venues & Details"],
    ["Event catering", "Food & Hospitality"],
    ["TeddyLoid at SMASH!", "Live Music"],
  ]);
  assert.equal(migrated.projects[0].title, "Corporate events");
  assert.equal(migrated.projects[0].image, "/portfolio/selected/navarra-gala-dining-room.webp");
  assert.equal(migrated.projects[0].description, "Client's custom project copy.");
  assert.strictEqual(migrated.projects[1], customProject);
  assert.strictEqual(migrated.galleryImages.at(-1), galleryImages[0]);
  assert.equal(galleryImages.length, 1);
  assert.equal(legacy.presentationVersion, 1);
  assert.equal(legacy.portfolioTitle, "Selected work");
  assert.deepEqual(upgradePortfolioPresentation(migrated), migrated);
});
