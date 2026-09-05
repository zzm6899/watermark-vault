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

// Public-only curation: keep the complete archive and booking history in the studio.
export function publicPortfolioFocus(value) {
  if (value.focusVersion === 1) return value;
  const next = { ...value, focusVersion: 1 };
  const wedding = text => /wedding|engagement|newlywed|bridal/i.test(text || "");
  const hidden = (value.galleryImages || []).filter(image => wedding(image.category));
  const hiddenPaths = new Set(hidden.map(image => image.image));
  const isWeddingImage = image => hiddenPaths.has(image) || /\/wedding[^/]*\./i.test(image || "") || image === "/portfolio/imported/alexrosanna-010.jpg";
  const lead = "/portfolio/curated/cosplay-animaga-editorial.jpg";
  const portrait = "/portfolio/curated/cosplay-pax-portrait.jpg";
  const priority = ["cosplay-animaga-editorial", "cosplay-pax-portrait", "cosplay-animaga-steps", "cosplay-animaga-sunlight", "cosplay-pax-duo", "cosplay-pax-spiderman", "cosplay-pax-valkyries", "cosplay-animaga-harbour", "cosplay-animaga-armour"];
  const gallery = (value.galleryImages || []).filter(image => !wedding(image.category));
  const cosplay = gallery.filter(image => image.category === "Cosplay & Conventions").sort((a, b) => {
    const rank = id => priority.includes(id) ? priority.indexOf(id) : priority.length;
    return rank(a.id) - rank(b.id);
  }).map(image => image.id === "cosplay-animaga-editorial" ? { ...image, alt: "Pink-haired cosplayer seated on architectural steps beneath colourful lights" } : image);
  next.galleryImages = [...cosplay, ...gallery.filter(image => image.category !== "Cosplay & Conventions")];
  const ids = new Set(hidden.map(image => image.id));
  next.featuredGalleryIds = (value.featuredGalleryIds || []).map(id => ids.has(id) ? "cosplay-animaga-editorial" : id === "archive-portrait-red-dress" ? "cosplay-pax-portrait" : id);
  next.heroImages = (value.heroImages || []).map(image => isWeddingImage(image) ? lead : image);
  next.heroCaptions = (value.heroCaptions || []).map(caption => wedding(`${caption.title} ${caption.category}`) ? { id: "cosplay", title: "Cosplay & character", description: "The craft. The character. A world of your own.", category: "Cosplay & Conventions" } : caption);
  for (const key of ["heroImage", "portrait", "enquiryImage", "philosophyImage", "testimonialsImage", "aboutSupportingImage"]) {
    if (isWeddingImage(next[key])) next[key] = key === "enquiryImage" ? portrait : lead;
  }
  for (const key of ["homeRibbonImages", "aboutRibbonImages", "testimonialsRibbonImages"]) {
    next[key] = (value[key] || []).map(image => isWeddingImage(image) ? lead : image);
  }
  next.projects = (value.projects || []).filter(project => !wedding(`${project.category} ${project.title}`)).map(project => project.category === "Cosplay & Conventions" ? { ...project, image: project.image === "/portfolio/curated/cosplay-smash-confetti.jpg" ? portrait : project.image, title: "Cosplay & character", description: "Character-led portraits, expressive poses and the details that make every costume your own." } : project);
  next.projects = [...next.projects.filter(project => project.category === "Cosplay & Conventions"), ...next.projects.filter(project => project.category !== "Cosplay & Conventions")];
  const copy = {
    introEyebrow: "Behind the camera",
    heroLabel: "Cosplay, live music and events",
    heroServicesLabel: "Cosplay · Live music · Events · Sport · Brands",
    introBody: "I'm Zac, a Sydney photographer drawn to character, atmosphere and the moments that make an event feel alive. From expressive cosplay portraits to live performances and brand events, I create photographs with energy and attention to detail.",
    aboutSecondaryBody: "I offer clear direction when it helps and leave space for natural expression. Every gallery is built around the people, details and atmosphere that make the experience yours.",
    portfolioBody: "Character, colour and the energy of being there. Cosplay, live music, sport and commercial photography.",
    testimonialsIntro: "Kind words from portrait sessions, celebrations and business events across Sydney.",
    aboutSupportingCaption: "Working across Sydney conventions, events, venues and live productions.",
  };
  for (const [key, replacement] of Object.entries(copy)) if (wedding(next[key])) next[key] = replacement;
  next.testimonials = (value.testimonials || []).filter(review => !wedding(`${review.context} ${review.quote}`));
  if (wedding(next.testimonial) && next.testimonials.length) {
    next.testimonial = next.testimonials[0].quote;
    next.testimonialAuthor = next.testimonials[0].author;
  }
  next.enquiryEventTypes = (value.enquiryEventTypes || []).filter(type => !wedding(type));
  return next;
}
