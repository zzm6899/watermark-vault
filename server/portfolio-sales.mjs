export const selectedPortfolioPhotos = [
  {
    "id": "navarra-cbhs-awards-reception",
    "image": "/portfolio/selected/navarra-cbhs-awards-reception.webp",
    "alt": "Guests mingle beneath blue lighting during an awards reception at Parramatta Town Hall.",
    "category": "Events",
    "width": 2000,
    "height": 1333,
    "smallWidth": 960,
    "hero": true
  },
  {
    "id": "navarra-cbhs-awards-speaker",
    "image": "/portfolio/selected/navarra-cbhs-awards-speaker.webp",
    "alt": "A smiling speaker addresses guests beneath the CBHS Care Awards screen.",
    "category": "Brand & Corporate",
    "width": 2000,
    "height": 1333,
    "smallWidth": 960,
    "hero": false
  },
  {
    "id": "navarra-cbhs-canape-service",
    "image": "/portfolio/selected/navarra-cbhs-canape-service.webp",
    "alt": "A Navarra server offers canapes to guests at an evening reception.",
    "category": "Food & Hospitality",
    "width": 2000,
    "height": 1333,
    "smallWidth": 960,
    "hero": false
  },
  {
    "id": "navarra-cbhs-live-cooking",
    "image": "/portfolio/selected/navarra-cbhs-live-cooking.webp",
    "alt": "A Navarra chef scatters herbs over a large pan during live event service.",
    "category": "Food & Hospitality",
    "width": 2000,
    "height": 1333,
    "smallWidth": 960,
    "hero": false
  },
  {
    "id": "navarra-cbhs-canape-detail",
    "image": "/portfolio/selected/navarra-cbhs-canape-detail.webp",
    "alt": "Fruit-topped canapes with fresh herbs arranged on Navarra-branded paper.",
    "category": "Food & Hospitality",
    "width": 2000,
    "height": 1333,
    "smallWidth": 960,
    "hero": false
  },
  {
    "id": "navarra-cbhs-reception-glassware",
    "image": "/portfolio/selected/navarra-cbhs-reception-glassware.webp",
    "alt": "Crystal sparkling-wine glasses ready for guests arriving at a reception.",
    "category": "Venues & Details",
    "width": 2000,
    "height": 1333,
    "smallWidth": 960,
    "hero": false
  },
  {
    "id": "navarra-gala-dining-room",
    "image": "/portfolio/selected/navarra-gala-dining-room.webp",
    "alt": "A gala dining room set with round tables beneath chandeliers.",
    "category": "Venues & Details",
    "width": 2000,
    "height": 1333,
    "smallWidth": 960,
    "hero": false
  },
  {
    "id": "navarra-gala-evening-arrivals",
    "image": "/portfolio/selected/navarra-gala-evening-arrivals.webp",
    "alt": "Guests gather at an illuminated venue entrance as evening falls.",
    "category": "Events",
    "width": 2000,
    "height": 1333,
    "smallWidth": 960,
    "hero": false
  },
  {
    "id": "cosplay-sophy-glowing-book",
    "image": "/portfolio/selected/cosplay-sophy-glowing-book.webp",
    "alt": "A red-and-white costumed cosplayer holds a glowing book among trees and golden light effects.",
    "category": "Cosplay & Conventions",
    "width": 2000,
    "height": 1333,
    "smallWidth": 960,
    "hero": true
  },
  {
    "id": "cosplay-sophy-sunlit-lawn",
    "image": "/portfolio/selected/cosplay-sophy-sunlit-lawn.webp",
    "alt": "A cosplayer in a red-and-white costume sits on a sunlit lawn beside an orange prop.",
    "category": "Cosplay & Conventions",
    "width": 2000,
    "height": 1333,
    "smallWidth": 960,
    "hero": false
  },
  {
    "id": "cosplay-teal-green-duo",
    "image": "/portfolio/selected/cosplay-teal-green-duo.webp",
    "alt": "Two cosplayers in teal and green robes pose together beneath leafy branches.",
    "category": "Cosplay & Conventions",
    "width": 1333,
    "height": 2000,
    "smallWidth": 640,
    "hero": false
  },
  {
    "id": "cosplay-red-uniform-pose",
    "image": "/portfolio/selected/cosplay-red-uniform-pose.webp",
    "alt": "A silver-haired cosplayer in a red uniform and animal ears points across a sunlit woodland scene.",
    "category": "Cosplay & Conventions",
    "width": 2000,
    "height": 1333,
    "smallWidth": 960,
    "hero": false
  },
  {
    "id": "cosplay-blue-suit-portrait",
    "image": "/portfolio/selected/cosplay-blue-suit-portrait.webp",
    "alt": "A cosplayer in a blue Fantastic Four suit poses with folded arms beneath an outdoor structure.",
    "category": "Cosplay & Conventions",
    "width": 1333,
    "height": 2000,
    "smallWidth": 640,
    "hero": false
  },
  {
    "id": "cosplay-blue-suit-action",
    "image": "/portfolio/selected/cosplay-blue-suit-action.webp",
    "alt": "A blue-suited cosplayer reaches a gloved hand toward the camera in a dramatic wide-angle pose.",
    "category": "Cosplay & Conventions",
    "width": 2000,
    "height": 1333,
    "smallWidth": 960,
    "hero": false
  },
  {
    "id": "cosplay-red-jacket-portrait",
    "image": "/portfolio/selected/cosplay-red-jacket-portrait.webp",
    "alt": "A blond cosplayer in a red jacket holds a long prop weapon in warm backlight.",
    "category": "Cosplay & Conventions",
    "width": 1333,
    "height": 2000,
    "smallWidth": 640,
    "hero": false
  },
  {
    "id": "cosplay-kale-fire-edit",
    "image": "/portfolio/selected/cosplay-kale-fire-edit.webp",
    "alt": "A red-jacketed cosplayer holds a glowing prop weapon amid flame effects in an edited portrait.",
    "category": "Cosplay & Conventions",
    "width": 2000,
    "height": 1333,
    "smallWidth": 960,
    "hero": false
  }
];

const photo = id => `/portfolio/selected/${id}.webp`;
export const selectedPhotoSources = Object.fromEntries(selectedPortfolioPhotos.map(image => [image.image, image]));
const heroSeeds = {
  "/portfolio/gallery/brand-event.jpg": { image: photo("navarra-cbhs-awards-reception"), caption: { id: "corporate", title: "Your event.\nSeen at its best.", description: "Sydney photography for the people, atmosphere and details that make your event worth talking about.", category: "Events" } },
  "/portfolio/curated/navarra-ballroom.jpg": { image: photo("navarra-gala-dining-room"), caption: { id: "venues", title: "Spaces worth\nstepping into.", description: "Show the experience you create, from the first impression to the finishing touches.", category: "Venues & Details" } },
  "/portfolio/curated/music-teddyloid-smash-crowd.webp": { image: "/portfolio/curated/music-teddyloid-smash-crowd.webp", caption: { id: "music", title: "The room.\nAt full volume.", description: "Live music photography that brings the performance, the crowd and the feeling back into focus.", category: "Live Music" } },
};
const oldCaptions = [
  { id: "corporate", title: "Corporate events", description: "Brand events and company gatherings, photographed with people and atmosphere in focus.", category: "Brand & Corporate" },
  { id: "venues", title: "Venues & hospitality", description: "Food, service and setting photographed with attention to detail.", category: "Food & Hospitality" },
  { id: "music", title: "Live performance", description: "The energy of the room, held in a photograph.", category: "Live Music" },
];

// One-time, exact seed refresh. Custom copy, records, ordering and later deletions survive.
export function upgradePortfolioSales(value) {
  if ((Number(value.presentationVersion) || 0) >= 3) return upgradePortfolioEditorial(value);
  const next = { ...value, presentationVersion: 3 };
  const replacements = {
    heroServicesLabel: ["Corporate events · Venues · Hospitality · Live music", "Corporate events / Brands / Venues / Live music"],
    introTitle: ["Events, seen from the inside.", "Good photographs start with understanding the brief."],
    introBody: ["I photograph corporate events, brand gatherings, venue experiences and live performances across Sydney. The images keep the people, place and pace of the day in view.", "I'm Zac, a Sydney photographer covering corporate events, brand experiences, hospitality and live performances. Tell me what matters to your team, and I'll look for the people, details and moments that tell that story."],
    storyEyebrow: ["Event coverage", "Photography services"],
    storyTitle: ["Every room moves differently.", "A clear brief.\nA considered eye."],
    portfolioTitle: ["Corporate, event and live photography.", "The work speaks."],
    portfolioBody: ["A considered record of the people, atmosphere and details behind brand events, venues, hospitality and live productions.", "Corporate gatherings, brand experiences, hospitality and live moments. Explore the work by the kind of story you want to tell."],
    bookingTitle: ["Let's talk about your event.", "Let's make\nsomething worth keeping."],
    bookingBody: ["Tell me the date, venue and what you'd like to capture. I'll reply with availability and a clear next step.", "Share the date, location and what you need from the photographs. I'll come back with availability and coverage options for your brief."],
    bookingButtonLabel: ["Discuss your event", "Check availability"],
    footerTitle: ["Event photographs with people at the centre.", "Your next event deserves to be remembered."],
    enquiryImage: ["/portfolio/gallery/brand-event.jpg", photo("navarra-cbhs-awards-speaker")],
    aboutSupportingImage: ["/portfolio/gallery/concert-performer.jpg", photo("navarra-cbhs-canape-service")],
    testimonialsImage: ["/portfolio/gallery/portrait-editorial.jpg", photo("navarra-cbhs-live-cooking")],
  };
  for (const [key, [previous, replacement]] of Object.entries(replacements)) {
    if (next[key] === previous) next[key] = replacement;
  }
  const frames = value.heroImages || [];
  next.heroImages = frames.map(image => heroSeeds[image]?.image || image);
  next.heroImage = heroSeeds[value.heroImage]?.image || value.heroImage;
  next.heroCaptions = frames.map((image, index) => {
    const caption = value.heroCaptions?.[index];
    const known = !caption || oldCaptions.some(seed => ["id", "title", "description", "category"].every(key => caption[key] === seed[key]));
    return known && heroSeeds[image] ? { ...heroSeeds[image].caption } : caption || { id: `slide-${index}`, title: "", description: "", category: "" };
  });
  if (JSON.stringify(value.featuredGalleryIds) === JSON.stringify(["brand-networking", "navarra-ballroom", "music-teddyloid-smash-stage"])) {
    next.featuredGalleryIds = ["navarra-cbhs-awards-speaker", "navarra-gala-dining-room", "music-teddyloid-smash-stage"];
  }
  const existing = value.galleryImages || [];
  next.galleryImages = [...selectedPortfolioPhotos.filter(image => !existing.some(saved => saved.id === image.id || saved.image === image.image)).map(({ id, image, alt, category }) => ({ id, image, alt, category })), ...existing];
  const projectSeeds = {
    corporate: { image: ["/portfolio/gallery/brand-event.jpg", photo("navarra-cbhs-awards-reception")], description: ["Brand events and company gatherings, photographed with people and atmosphere in focus.", "Conferences, launches and company gatherings. Capture the speakers, connections and brand details that make your event yours."] },
    parties: { image: ["/portfolio/imported/oatlandsestatesmallbusinessevent30-10-24137.jpg", photo("navarra-gala-evening-arrivals")] },
    food: { image: ["/portfolio/curated/food-lexus-live-service.jpg", photo("navarra-cbhs-canape-service")], description: ["Food, service and setting photographed with attention to detail.", "Show people what it feels like to be there, with considered images of the food, the service and the space."] },
    cosplay: { image: [["/portfolio/curated/cosplay-smash-confetti.jpg", "/portfolio/curated/cosplay-pax-portrait.jpg", "/portfolio/curated/cosplay-animaga-editorial.jpg"], photo("cosplay-sophy-glowing-book")], description: [["Character portraits, stages and convention crowds photographed with colour and energy.", "Character-led portraits, expressive poses and the details that make every costume your own."], "You bring the character. I'll help bring it to life, with expressive portraits that give your costume, craft and personality room to shine."] },
  };
  next.projects = (value.projects || []).map(project => {
    const updates = projectSeeds[project.id];
    if (!updates) return project;
    const updated = { ...project };
    for (const [field, [previous, replacement]] of Object.entries(updates)) {
      if ([previous].flat().includes(project[field])) updated[field] = replacement;
    }
    return updated;
  });
  return upgradePortfolioEditorial(next);
}

// Refresh the unpublished sales-template defaults without overwriting saved edits.
function upgradePortfolioEditorial(value) {
  if ((Number(value.presentationVersion) || 0) >= 4) return upgradePortfolioCollections(value);
  const next = { ...value, presentationVersion: 4 };
  const replacements = {
    introTitle: ["Good photographs start with understanding the brief.", "Hi, I'm Zac."],
    introBody: ["I'm Zac, a Sydney photographer covering corporate events, brand experiences, hospitality and live performances. Tell me what matters to your team, and I'll look for the people, details and moments that tell that story.", "I'm based in Sydney and photograph corporate events, live music and cosplay. I also work with venues and hospitality teams. If you have a date or a brief in mind, get in touch."],
    portfolioTitle: ["The work speaks.", "Selected photographs"],
    portfolioBody: ["Corporate gatherings, brand experiences, hospitality and live moments. Explore the work by the kind of story you want to tell.", "Events, live music, cosplay and hospitality. Choose a collection to see more."],
    bookingTitle: ["Let's make\nsomething worth keeping.", "Tell me about your shoot."],
    bookingBody: ["Share the date, location and what you need from the photographs. I'll come back with availability and coverage options for your brief.", "Let me know the date, location and what you need photographed. I'll reply with availability and coverage options."],
    bookingButtonLabel: ["Check availability", "Enquire"],
    footerTitle: ["Your next event deserves to be remembered.", "Enquiries"],
  };
  for (const [key, [previous, replacement]] of Object.entries(replacements)) {
    if (next[key] === previous) next[key] = replacement;
  }
  next.heroCaptions = (value.heroCaptions || []).map((caption, index) => {
    const source = Object.values(heroSeeds).find(seed => seed.image === value.heroImages?.[index]);
    if (!source || !["id", "title", "description", "category"].every(key => caption[key] === source.caption[key])) return caption;
    const labels = {
      corporate: { title: "CBHS Care Awards", description: "Parramatta Town Hall, August 2026" },
      venues: { title: "Gala dinner", description: "September 2026" },
      music: { title: "TeddyLoid at SMASH!", description: "Live music" },
    };
    return { ...caption, ...labels[caption.id] };
  });
  if (JSON.stringify(value.featuredGalleryIds) === JSON.stringify(["navarra-cbhs-awards-speaker", "navarra-gala-dining-room", "music-teddyloid-smash-stage"])) {
    next.featuredGalleryIds = ["navarra-gala-dining-room", "cosplay-sophy-glowing-book", "music-teddyloid-smash-stage"];
  }
  return upgradePortfolioCollections(next);
}

function upgradePortfolioCollections(value) {
  if ((Number(value.presentationVersion) || 0) >= 5) return value;
  const next = { ...value, presentationVersion: 5 };
  const replacements = {
    heroImage: [photo("navarra-cbhs-awards-reception"), photo("navarra-gala-dining-room")],
    enquiryImage: [photo("navarra-cbhs-awards-speaker"), photo("navarra-cbhs-live-cooking")],
    concertTitle: ["The room, at full volume.", "Live music"],
    concertBody: ["Touring artists, festivals, venues and late-night sets photographed from inside the energy. Fast, atmospheric coverage built for press, social and the archive.", "Live sets, artist portraits and the audience. A selection of photographs from performances and festivals."],
    aboutApproachTitle: ["Present enough to guide. Quiet enough to notice.", "How I work"],
    aboutApproachBody: ["I look for the interactions happening between the scheduled moments: the reaction across the room, the energy building before a performance, and the details your team spent months getting right.", "I'll ask about the run sheet, people and photographs that matter to you. During the shoot, I work with the pace of the event and offer direction when it's useful."],
  };
  for (const [key, [previous, replacement]] of Object.entries(replacements)) {
    if (next[key] === previous) next[key] = replacement;
  }
  const previousFrames = [photo("navarra-cbhs-awards-reception"), photo("navarra-gala-dining-room"), "/portfolio/curated/music-teddyloid-smash-crowd.webp"];
  const previousCaptions = [
    { id: "corporate", title: "CBHS Care Awards", description: "Parramatta Town Hall, August 2026", category: "Events" },
    { id: "venues", title: "Gala dinner", description: "September 2026", category: "Venues & Details" },
    { id: "music", title: "TeddyLoid at SMASH!", description: "Live music", category: "Live Music" },
  ];
  // Move images and captions together only when the entire saved selection is untouched.
  if (JSON.stringify(value.heroImages) === JSON.stringify(previousFrames)
    && value.heroCaptions?.length === previousCaptions.length
    && previousCaptions.every((caption, index) => Object.keys(caption).every(key => value.heroCaptions[index][key] === caption[key]))) {
    next.heroImages = [photo("navarra-gala-dining-room"), photo("navarra-cbhs-live-cooking"), previousFrames[2]];
    next.heroCaptions = [previousCaptions[1], { id: "hospitality", title: "Event catering", description: "Parramatta Town Hall, August 2026", category: "Food & Hospitality" }, previousCaptions[2]];
  }
  if (JSON.stringify(value.featuredGalleryIds) === JSON.stringify(["navarra-gala-dining-room", "cosplay-sophy-glowing-book", "music-teddyloid-smash-stage"])) {
    next.featuredGalleryIds = ["navarra-cbhs-live-cooking", "cosplay-sophy-glowing-book", "music-teddyloid-smash-stage"];
  }
  next.projects = (value.projects || []).map(project => {
    if (project.id === "corporate" && project.image === photo("navarra-cbhs-awards-reception")) return { ...project, image: photo("navarra-gala-dining-room") };
    if (project.id === "cosplay" && project.description === "You bring the character. I'll help bring it to life, with expressive portraits that give your costume, craft and personality room to shine.") return { ...project, description: "Cosplay portraits, from individual characters to pairs and groups. Let me know what you're making and where you'd like to shoot." };
    return project;
  });
  return next;
}
