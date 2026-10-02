export const presentationDefaults = {
  presentationVersion: 2,
  featuredGalleryIds: ["brand-networking", "navarra-ballroom", "music-teddyloid-smash-stage"],
  heroCaptions: [
    { id: "corporate", title: "Corporate events", description: "Brand events and company gatherings, photographed with people and atmosphere in focus.", category: "Brand & Corporate" },
    { id: "venues", title: "Venues & hospitality", description: "Food, service and setting photographed with attention to detail.", category: "Food & Hospitality" },
    { id: "music", title: "Live performance", description: "The energy of the room, held in a photograph.", category: "Live Music" },
  ],
};

// Upgrade only known seed strings from the original and v1 presentation. Custom copy survives.
const copyUpdates = {
  heroLabel: [["Live in action", "Corporate & event photography"], ["Cosplay, live music and events", "Corporate & event photography"]],
  heroImage: [["/portfolio/live-action.jpg", "/portfolio/gallery/brand-event.jpg"], ["/portfolio/imported/alexrosanna-010.jpg", "/portfolio/gallery/brand-event.jpg"], ["/portfolio/curated/cosplay-animaga-editorial.jpg", "/portfolio/gallery/brand-event.jpg"]],
  heroServicesLabel: [["Weddings · Events · Live music · Sport · Brands", "Corporate events · Venues · Hospitality · Live music"], ["Cosplay · live music · Events · Sport · Brands", "Corporate events · Venues · Hospitality · Live music"]],
  introEyebrow: [["Hey, I'm Zac, an event / wedding photographer", "Sydney corporate & event photographer"], ["Behind the camera", "Sydney corporate & event photographer"]],
  introTitle: [["Let's get to know each other", "Events, seen from the inside."], ["Hi, I'm Zac.", "Events, seen from the inside."]],
  introBody: [["What started as a hobby quickly became a passion for capturing the moments people want to remember. I photograph weddings, live music, parties and corporate events across Sydney.", "I photograph corporate events, brand gatherings, venue experiences and live performances across Sydney. The images keep the people, place and pace of the day in view."], ["I'm Zac, a Sydney photographer drawn to character, atmosphere and the moments that make an event feel alive. From expressive cosplay portraits to live performances and brand events, I create photographs with energy and attention to detail.", "I photograph corporate events, brand gatherings, venue experiences and live performances across Sydney. The images keep the people, place and pace of the day in view."]],
  portfolioTitle: [["Stories that still feel alive.", "Corporate, event and live photography."], ["Selected work", "Corporate, event and live photography."]],
  portfolioBody: [["Weddings, performances, conventions, sport and brands photographed with energy and intent.", "A considered record of the people, atmosphere and details behind brand events, venues, hospitality and live productions."], ["A quiet glance. A room full of energy. The details that bring a story to life.", "A considered record of the people, atmosphere and details behind brand events, venues, hospitality and live productions."], ["Character, colour and the energy of being there. Cosplay, live music, sport and commercial photography.", "A considered record of the people, atmosphere and details behind brand events, venues, hospitality and live productions."]],
  portfolioCtaTitle: [["Planning something?", "Tell me what you need the images to do."], ["Your story, thoughtfully captured.", "Tell me what you need the images to do."]],
  portfolioCtaEyebrow: [["Your story, photographed honestly", "Have an event coming up?"]],
  portfolioCtaLabel: [["Check availability", "Plan event coverage"]],
  storyEyebrow: [["Ways of seeing", "Event coverage"]],
  storyTitle: [["Every room has its own rhythm.", "Every room moves differently."]],
  testimonialsTitle: [["The experience matters too.", "What clients say"], ["Kind words", "What clients say"]],
  testimonialsIntro: [["Feedback from weddings, celebrations, portrait sessions and business events across Sydney.", "Feedback from the events and portrait sessions shown here."], ["Kind words from portrait sessions, celebrations and business events across Sydney.", "Feedback from the events and portrait sessions shown here."]],
  bookingTitle: [["Tell me what you're planning", "Let's talk about your event."]],
  bookingBody: [["Share the date, location and feeling you want captured. I'll reply with availability and the right coverage option.", "Tell me the date, venue and what you'd like to capture. I'll reply with availability and a clear next step."]],
  bookingButtonLabel: [["Start an enquiry", "Discuss your event"], ["Enquire", "Discuss your event"]],
  footerTitle: [["Let's make it memorable.", "Event photographs with people at the centre."], ["People. Places. Moments that matter.", "Event photographs with people at the centre."]],
  aboutSupportingCaption: [["Working across Sydney weddings, events, venues and live productions.", "Working across Sydney corporate events, venues and live productions."], ["Working across Sydney conventions, events, venues and live productions.", "Working across Sydney corporate events, venues and live productions."]],
  enquiryImage: [["/portfolio/gallery/concert-crowd.jpg", "/portfolio/gallery/brand-event.jpg"], ["/portfolio/curated/wedding-kj-harbour.jpg", "/portfolio/gallery/brand-event.jpg"], ["/portfolio/curated/cosplay-pax-portrait.jpg", "/portfolio/gallery/brand-event.jpg"]],
};

const legacyHeroImages = [
  ["/portfolio/live-action.jpg", "/portfolio/gallery/concert-performer.jpg", "/portfolio/gallery/brand-event.jpg"],
  ["/portfolio/imported/alexrosanna-010.jpg", "/portfolio/curated/music-teddyloid-smash-crowd.webp", "/portfolio/imported/lemontage6-2-2025roomshotsnestle42of71.jpg"],
  ["/portfolio/curated/cosplay-animaga-editorial.jpg", "/portfolio/curated/music-teddyloid-smash-crowd.webp", "/portfolio/imported/lemontage6-2-2025roomshotsnestle42of71.jpg"],
];
const refreshedHeroImages = ["/portfolio/gallery/brand-event.jpg", "/portfolio/curated/navarra-ballroom.jpg", "/portfolio/curated/music-teddyloid-smash-crowd.webp"];

function upgradeSeedCopy(value) {
  const next = { ...value };
  for (const [key, alternatives] of Object.entries(copyUpdates)) {
    const match = alternatives.find(([previous]) => next[key] === previous);
    if (match) next[key] = match[1];
  }
  return next;
}

function sameArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function upgradePortfolioPresentation(value) {
  const next = { ...presentationDefaults, ...value };
  if ((Number(value.presentationVersion) || 0) >= 2) return next;
  Object.assign(next, upgradeSeedCopy(next));
  if (legacyHeroImages.some(images => sameArray(next.heroImages, images))) next.heroImages = refreshedHeroImages;
  const legacyFeatured = [
    ["archive-wedding-waterfront", "archive-portrait-red-dress", "archive-stage-performer"],
    ["cosplay-animaga-editorial", "cosplay-pax-portrait", "archive-stage-performer"],
  ];
  if (legacyFeatured.some(ids => sameArray(next.featuredGalleryIds, ids))) next.featuredGalleryIds = [...presentationDefaults.featuredGalleryIds];
  const legacyCaptions = [
    [
      { id: "weddings", title: "Weddings & couples", description: "The big feelings. The little moments. All yours.", category: "Weddings" },
      { id: "music", title: "Live performance", description: "The energy of the room, held in a photograph.", category: "Live Music" },
      { id: "brands", title: "Brands & hospitality", description: "An eye for the details that make you different.", category: "Brand & Corporate" },
    ],
    [
      { id: "cosplay", title: "Cosplay & character", description: "The craft. The character. A world of your own.", category: "Cosplay & Conventions" },
      { id: "music", title: "Live performance", description: "The energy of the room, held in a photograph.", category: "Live Music" },
      { id: "brands", title: "Brands & hospitality", description: "An eye for the details that make you different.", category: "Brand & Corporate" },
    ],
  ];
  const refreshedCaptions = [
    { id: "corporate", title: "Corporate events", description: "Brand events and company gatherings, photographed with people and atmosphere in focus.", category: "Brand & Corporate" },
    { id: "venues", title: "Venues & hospitality", description: "Food, service and setting photographed with attention to detail.", category: "Food & Hospitality" },
    { id: "music", title: "Live performance", description: "The energy of the room, held in a photograph.", category: "Live Music" },
  ];
  if (legacyCaptions.some(captions => sameArray(next.heroCaptions, captions))) next.heroCaptions = refreshedCaptions;
  const projectUpdates = {
    bands: { image: [["/portfolio/bands.jpg", "/portfolio/curated/music-teddyloid-smash-portrait.webp"], "/portfolio/curated/music-teddyloid-smash-stage.webp"], title: [["Band Photos"], "Live performance"] },
    corporate: {
      image: [["/portfolio/corporate.jpg", "/portfolio/imported/lemontage6-2-2025roomshotsnestle42of71.jpg"], "/portfolio/gallery/brand-event.jpg"],
      title: [["Corporate Events", "Brands & events"], "Corporate events"],
      description: [["Polished event coverage for teams, brands and venues."], "Brand events and company gatherings, photographed with people and atmosphere in focus."],
    },
    parties: {
      image: [["/portfolio/parties.jpg"], "/portfolio/imported/oatlandsestatesmallbusinessevent30-10-24137.jpg"],
      title: [["Parties"], "Events and celebrations"],
      description: [["Candid celebration photography with people at the centre."], "Event coverage shaped around the room, the people and the moments that matter."],
    },
    food: {
      image: [["/portfolio/curated/food-mcdonalds-live-cooking.jpg"], "/portfolio/curated/food-lexus-live-service.jpg"],
      title: [["Food & Hospitality"], "Venues and hospitality"],
      description: [["Food, chefs and service photographed with colour, texture and a sense of occasion."], "Food, service and setting photographed with attention to detail."],
    },
  };
  next.projects = (next.projects || []).map(project => {
    const update = projectUpdates[project.id];
    if (!update) return project;
    const migrated = { ...project };
    for (const field of ["image", "title", "description"]) {
      const migration = update[field];
      if (migration && migration[0].includes(project[field])) migrated[field] = migration[1];
    }
    return migrated;
  });
  next.presentationVersion = 2;
  return next;
}

// Public-only curation: keep the complete archive and booking history in the studio.
export function publicPortfolioFocus(value) {
  if ((Number(value.focusVersion) || 0) >= 2) return value;
  const next = upgradeSeedCopy({ ...value, focusVersion: 2 });
  const wedding = text => /wedding|engagement|newlywed|bridal/i.test(text || "");
  const hidden = (value.galleryImages || []).filter(image => wedding(image.category));
  const hiddenPaths = new Set(hidden.map(image => image.image));
  const isWeddingImage = image => hiddenPaths.has(image) || /\/wedding[^/]*\./i.test(image || "") || image === "/portfolio/imported/alexrosanna-010.jpg";
  const lead = "/portfolio/curated/cosplay-animaga-editorial.jpg";
  const portrait = "/portfolio/curated/cosplay-pax-portrait.jpg";
  const cosplayPriority = ["cosplay-animaga-editorial", "cosplay-pax-portrait", "cosplay-animaga-steps", "cosplay-animaga-sunlight", "cosplay-pax-duo", "cosplay-pax-spiderman", "cosplay-pax-valkyries", "cosplay-animaga-harbour", "cosplay-animaga-armour"];
  const publicCategoryOrder = ["Brand & Corporate", "Events", "Venues & Details", "Food & Hospitality", "Live Music", "Sports", "Cosplay & Conventions", "Portraits"];
  const categoryRank = new Map(publicCategoryOrder.map((category, index) => [category, index]));
  const gallery = (value.galleryImages || []).filter(image => !wedding(image.category));
  const rankCosplay = id => cosplayPriority.includes(id) ? cosplayPriority.indexOf(id) : cosplayPriority.length;
  next.galleryImages = [...gallery].sort((left, right) => {
    const difference = (categoryRank.get(left.category) ?? publicCategoryOrder.length) - (categoryRank.get(right.category) ?? publicCategoryOrder.length);
    if (difference) return difference;
    return left.category === "Cosplay & Conventions" ? rankCosplay(left.id) - rankCosplay(right.id) : 0;
  }).map(image => image.id === "cosplay-animaga-editorial" ? { ...image, alt: "Pink-haired cosplayer seated on architectural steps beneath colourful lights" } : image);
  const ids = new Set(hidden.map(image => image.id));
  next.featuredGalleryIds = (value.featuredGalleryIds || []).map(id => ids.has(id) ? "cosplay-animaga-editorial" : id === "archive-portrait-red-dress" ? "cosplay-pax-portrait" : id);

  next.heroImages = legacyHeroImages.some(images => sameArray(value.heroImages, images))
    ? refreshedHeroImages
    : (value.heroImages || []).map(image => isWeddingImage(image) ? lead : image);
  next.heroCaptions = (value.heroCaptions || []).map(caption => wedding(`${caption.title} ${caption.category}`) ? { id: "cosplay", title: "Cosplay & character", description: "The craft. The character. A world of your own.", category: "Cosplay & Conventions" } : caption);
  for (const key of ["heroImage", "portrait", "enquiryImage", "philosophyImage", "testimonialsImage", "aboutSupportingImage"]) {
    if (isWeddingImage(next[key])) next[key] = key === "enquiryImage" ? portrait : lead;
  }
  if (next.enquiryImage === "/portfolio/gallery/concert-crowd.jpg") next.enquiryImage = "/portfolio/gallery/brand-event.jpg";
  for (const key of ["homeRibbonImages", "aboutRibbonImages", "testimonialsRibbonImages"]) {
    next[key] = (value[key] || []).map(image => isWeddingImage(image) ? lead : image);
  }
  next.projects = (value.projects || []).filter(project => !wedding(`${project.category} ${project.title}`)).map(project => {
    if (project.category !== "Cosplay & Conventions") return project;
    return {
      ...project,
      image: project.image === "/portfolio/curated/cosplay-smash-confetti.jpg" ? portrait : project.image,
      title: project.title === "Cosplay & Conventions" ? "Cosplay & character" : project.title,
      description: project.description === "Character portraits, stages and convention crowds photographed with colour and energy."
        ? "Character-led portraits, expressive poses and the details that make every costume your own."
        : project.description,
    };
  }).sort((left, right) => (categoryRank.get(left.category) ?? publicCategoryOrder.length) - (categoryRank.get(right.category) ?? publicCategoryOrder.length));

  const seedCopyUpdates = {
    heroLabel: ["Live in action", "Corporate & event photography"],
    heroServicesLabel: ["Weddings · Events · Live music · Sport · Brands", "Corporate events · Venues · Hospitality · Live music"],
    introEyebrow: ["Hey, I'm Zac, an event / wedding photographer", "Sydney corporate & event photographer"],
    introTitle: ["Let's get to know each other", "Events, seen from the inside."],
    introBody: ["What started as a hobby quickly became a passion for capturing the moments people want to remember. I photograph weddings, live music, parties and corporate events across Sydney.", "I photograph corporate events, brand gatherings, venue experiences and live performances across Sydney. The images keep the people, place and pace of the day in view."],
    portfolioTitle: ["Stories that still feel alive.", "Corporate, event and live photography."],
    portfolioBody: ["Weddings, performances, conventions, sport and brands photographed with energy and intent.", "A considered record of the people, atmosphere and details behind brand events, venues, hospitality and live productions."],
    portfolioCtaTitle: ["Planning something?", "Tell me what you need the images to do."],
    portfolioCtaLabel: ["Check availability", "Plan event coverage"],
    testimonialsTitle: ["The experience matters too.", "What clients say"],
    testimonialsIntro: ["Feedback from weddings, celebrations, portrait sessions and business events across Sydney.", "Feedback from the events and portrait sessions shown here."],
    bookingTitle: ["Tell me what you're planning", "Let's talk about your event."],
    bookingBody: ["Share the date, location and feeling you want captured. I'll reply with availability and the right coverage option.", "Tell me the date, venue and what you'd like to capture. I'll reply with availability and a clear next step."],
    bookingButtonLabel: ["Start an enquiry", "Discuss your event"],
    footerTitle: ["Let's make it memorable.", "Event photographs with people at the centre."],
    aboutSupportingCaption: ["Working across Sydney weddings, events, venues and live productions.", "Working across Sydney corporate events, venues and live productions."],
  };
  for (const [key, [previous, replacement]] of Object.entries(seedCopyUpdates)) {
    if (next[key] === previous) next[key] = replacement;
  }
  next.testimonials = (value.testimonials || []).filter(review => !wedding(`${review.context} ${review.quote}`));
  if (wedding(next.testimonial) && next.testimonials.length) {
    next.testimonial = next.testimonials[0].quote;
    next.testimonialAuthor = next.testimonials[0].author;
  }
  next.enquiryEventTypes = (value.enquiryEventTypes || []).filter(type => !wedding(type));
  return next;
}
