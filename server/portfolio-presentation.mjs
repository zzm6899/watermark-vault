export const presentationDefaults = {
  presentationVersion: 1,
  featuredGalleryIds: ["archive-wedding-waterfront", "archive-portrait-red-dress", "archive-stage-performer"],
  heroCaptions: [
    { id: "weddings", title: "Weddings & couples", description: "The big feelings. The little moments. All yours.", category: "Weddings" },
    { id: "music", title: "Live performance", description: "The energy of the room, held in a photograph.", category: "Live Music" },
    { id: "brands", title: "Brands & hospitality", description: "An eye for the details that make you different.", category: "Brand & Corporate" },
  ],
};

// Upgrade only untouched seed copy. Published edits and original gallery uploads survive.
const copyUpdates = {
  introEyebrow: ["Hey, I'm Zac, an event / wedding photographer", "Behind the camera"],
  introTitle: ["Let's get to know each other", "Hi, I'm Zac."],
  portfolioTitle: ["Stories that still feel alive.", "Selected work"],
  portfolioBody: ["Weddings, performances, conventions, sport and brands photographed with energy and intent.", "A quiet glance. A room full of energy. The details that bring a story to life."],
  portfolioCtaTitle: ["Planning something?", "Your story, thoughtfully captured."],
  testimonialsTitle: ["The experience matters too.", "Kind words"],
  bookingButtonLabel: ["Start an enquiry", "Enquire"],
  footerTitle: ["Let's make it memorable.", "People. Places. Moments that matter."],
  enquiryImage: ["/portfolio/gallery/concert-crowd.jpg", "/portfolio/curated/wedding-kj-harbour.jpg"],
};

export function upgradePortfolioPresentation(value) {
  const next = { ...presentationDefaults, ...value };
  if ((Number(value.presentationVersion) || 0) >= 1) return next;
  for (const [key, [previous, updated]] of Object.entries(copyUpdates)) {
    if (next[key] === previous) next[key] = updated;
  }
  const legacyHero = ["/portfolio/live-action.jpg", "/portfolio/gallery/concert-performer.jpg", "/portfolio/gallery/brand-event.jpg"];
  if (JSON.stringify(next.heroImages) === JSON.stringify(legacyHero)) {
    next.heroImages = ["/portfolio/imported/alexrosanna-010.jpg", "/portfolio/curated/music-teddyloid-smash-crowd.webp", "/portfolio/imported/lemontage6-2-2025roomshotsnestle42of71.jpg"];
  }
  const projectUpdates = {
    bands: { oldImage: "/portfolio/bands.jpg", image: "/portfolio/curated/music-teddyloid-smash-portrait.webp", oldTitle: "Band Photos", title: "Live performance" },
    corporate: { oldImage: "/portfolio/corporate.jpg", image: "/portfolio/imported/lemontage6-2-2025roomshotsnestle42of71.jpg", oldTitle: "Corporate Events", title: "Brands & events" },
    weddings: { oldTitle: "Engagements / Weddings", title: "Weddings & couples" },
  };
  next.projects = (next.projects || []).map(project => {
    const update = projectUpdates[project.id];
    if (!update) return project;
    return { ...project, ...(project.image === update.oldImage && update.image ? { image: update.image } : {}), ...(project.title === update.oldTitle ? { title: update.title } : {}) };
  });
  next.presentationVersion = 1;
  return next;
}
