const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { upgradePortfolioSales, selectedPortfolioPhotos } = require("./portfolio-sales.mjs");
const { publicPortfolioFocus } = require("./portfolio-presentation.mjs");

test("sales refresh preserves custom fields, photos, captions, client facts and reviews", () => {
  const customPhoto = { id: selectedPortfolioPhotos[0].id, image: "/portfolio-media/custom.jpg", alt: "Custom alt", category: "Custom category" };
  const caption = { id: "mine", title: "Custom title", description: "Custom copy", category: "Events" };
  const value = { presentationVersion: 2, heroImages: ["/portfolio/gallery/brand-event.jpg"], heroCaptions: [caption], portfolioTitle: "My title", galleryImages: [customPhoto], projects: [{ id: "corporate", title: "My services", image: "/custom.jpg", description: "My description" }], portfolioClients: ["Existing client"], testimonials: [{ quote: "Existing review", author: "Existing author" }] };
  const snapshot = JSON.stringify(value);
  const refreshed = upgradePortfolioSales(value);
  assert.equal(refreshed.portfolioTitle, "My title");
  assert.strictEqual(refreshed.heroCaptions[0], caption);
  assert.strictEqual(refreshed.galleryImages.find(photo => photo.id === customPhoto.id), customPhoto);
  assert.equal(refreshed.galleryImages.filter(photo => photo.id === customPhoto.id).length, 1);
  assert.deepEqual(refreshed.projects, value.projects);
  assert.strictEqual(refreshed.portfolioClients, value.portfolioClients);
  assert.strictEqual(refreshed.testimonials, value.testimonials);
  assert.equal(JSON.stringify(value), snapshot);
});
test("saved v5 removals and edits are not repopulated", () => {
  const saved = { ...upgradePortfolioSales({ presentationVersion: 2 }), heroImages: ["/my-hero.jpg"], galleryImages: [], projects: [], heroCaptions: [], portfolioTitle: "My edited headline" };
  assert.strictEqual(upgradePortfolioSales(saved), saved);
  assert.deepEqual(saved.galleryImages, []);
});
test("editorial refresh changes only untouched v3 copy and keeps custom selections and removals", () => {
  const saved = { presentationVersion: 3, introTitle: "My introduction", introBody: "My own words", portfolioTitle: "The work speaks.", featuredGalleryIds: ["my-photo"], galleryImages: [], projects: [], heroImages: ["/custom.jpg"], heroCaptions: [{ id: "custom", title: "Custom caption", description: "My description", category: "Portraits" }] };
  const refreshed = upgradePortfolioSales(saved);
  assert.equal(refreshed.presentationVersion, 5);
  assert.equal(refreshed.portfolioTitle, "Selected photographs");
  assert.equal(refreshed.introTitle, saved.introTitle);
  assert.equal(refreshed.introBody, saved.introBody);
  assert.strictEqual(refreshed.galleryImages, saved.galleryImages);
  assert.strictEqual(refreshed.featuredGalleryIds, saved.featuredGalleryIds);
  assert.deepEqual(refreshed.heroCaptions, saved.heroCaptions);
  assert.strictEqual(upgradePortfolioSales(refreshed), refreshed);
  assert.equal(saved.presentationVersion, 3);
});
test("public curation does not reapply legacy copy replacements to the current presentation", () => {
  const focused = publicPortfolioFocus({ presentationVersion: 4, introTitle: "Hi, I'm Zac.", bookingButtonLabel: "Enquire", galleryImages: [], projects: [] });
  assert.equal(focused.introTitle, "Hi, I'm Zac.");
  assert.equal(focused.bookingButtonLabel, "Enquire");
});

test("v4 default hero changes to the brighter gala photograph with matching captions and no duplicate frames", () => {
  const value = {
    presentationVersion: 4,
    heroImages: ["/portfolio/selected/navarra-cbhs-awards-reception.webp", "/portfolio/selected/navarra-gala-dining-room.webp", "/portfolio/curated/music-teddyloid-smash-crowd.webp"],
    heroCaptions: [
      { id: "corporate", title: "CBHS Care Awards", description: "Parramatta Town Hall, August 2026", category: "Events" },
      { id: "venues", title: "Gala dinner", description: "September 2026", category: "Venues & Details" },
      { id: "music", title: "TeddyLoid at SMASH!", description: "Live music", category: "Live Music" },
    ],
    galleryImages: selectedPortfolioPhotos,
    portfolioClients: ["Saved client"], testimonials: [{ quote: "Saved review", author: "Saved author" }],
    projects: [{ id: "corporate", image: "/portfolio/selected/navarra-cbhs-awards-reception.webp", description: "Custom service description" }],
  };
  const before = JSON.stringify(value);
  const result = upgradePortfolioSales(value);
  assert.equal(result.heroImages[0], "/portfolio/selected/navarra-gala-dining-room.webp");
  assert.equal(result.heroCaptions[0].title, "Gala dinner");
  assert.equal(result.heroCaptions[1].title, "Event catering");
  assert.equal(new Set(result.heroImages).size, 3);
  assert.equal(result.projects[0].image, result.heroImages[0]);
  assert.equal(result.projects[0].description, "Custom service description");
  assert.strictEqual(result.galleryImages, value.galleryImages);
  assert.strictEqual(result.portfolioClients, value.portfolioClients);
  assert.strictEqual(result.testimonials, value.testimonials);
  assert.equal(JSON.stringify(value), before);
  const edited = { ...value, heroCaptions: value.heroCaptions.map((caption, index) => index ? caption : { ...caption, title: "My saved caption" }), concertTitle: "Custom show", aboutApproachBody: "Custom approach", enquiryImage: "/my-photo.jpg" };
  const preserved = upgradePortfolioSales(edited);
  assert.strictEqual(preserved.heroImages, edited.heroImages);
  assert.strictEqual(preserved.heroCaptions, edited.heroCaptions);
  assert.equal(preserved.concertTitle, edited.concertTitle);
  assert.equal(preserved.aboutApproachBody, edited.aboutApproachBody);
  assert.equal(preserved.enquiryImage, edited.enquiryImage);
});
test("selected images, responsive sources and deliberately cropped heroes are present", () => {
  assert.equal(selectedPortfolioPhotos.length, 16);
  for (const photo of selectedPortfolioPhotos) {
    const images = [photo.image, photo.image.replace(/\.webp$/, "-960.webp")];
    if (photo.hero) images.push(photo.image.replace(/\.webp$/, "-hero-desktop.webp"), photo.image.replace(/\.webp$/, "-hero-mobile.webp"));
    for (const image of images) assert.ok(fs.existsSync(path.join(__dirname, "../public", image)), image);
    assert.ok(photo.alt && photo.category && photo.width && photo.height && photo.smallWidth);
  }
});
