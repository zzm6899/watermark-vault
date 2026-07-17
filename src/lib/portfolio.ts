export type PortfolioProject = {
  id: string;
  title: string;
  image: string;
  description: string;
  category: string;
};

export type PortfolioGalleryImage = {
  id: string;
  image: string;
  alt: string;
  category: string;
};

export type PortfolioTestimonial = {
  id: string;
  quote: string;
  author: string;
  context: string;
};

export type PortfolioValue = {
  id: string;
  title: string;
  body: string;
};

export type PortfolioStep = {
  id: string;
  title: string;
  body: string;
};

export type PortfolioSite = {
  gallerySeedVersion: number;
  brandName: string;
  logo: string;
  heroImage: string;
  heroImages: string[];
  heroLabel: string;
  heroServicesLabel: string;
  introEyebrow: string;
  introTitle: string;
  introBody: string;
  aboutSecondaryBody: string;
  portfolioTitle: string;
  portfolioBody: string;
  testimonialsTitle: string;
  testimonialsIntro: string;
  portrait: string;
  homeRibbonImages: string[];
  storyEyebrow: string;
  storyTitle: string;
  philosophyEyebrow: string;
  philosophyTitle: string;
  philosophyBody: string;
  philosophyImage: string;
  portfolioClientsLabel: string;
  portfolioClients: string[];
  portfolioCtaEyebrow: string;
  portfolioCtaTitle: string;
  portfolioCtaLabel: string;
  concertEyebrow: string;
  concertTitle: string;
  concertBody: string;
  concertHeroImage: string;
  concertHighlights: string[];
  aboutApproachEyebrow: string;
  aboutApproachTitle: string;
  aboutApproachBody: string;
  aboutSupportingImage: string;
  aboutSupportingCaption: string;
  aboutValues: PortfolioValue[];
  aboutRibbonImages: string[];
  testimonialsFeatureEyebrow: string;
  testimonialsFeatureTitle: string;
  testimonialsFeaturePoints: string[];
  testimonialsImage: string;
  testimonialsRibbonImages: string[];
  enquiryImage: string;
  enquirySteps: PortfolioStep[];
  testimonial: string;
  testimonialAuthor: string;
  projects: PortfolioProject[];
  galleryImages: PortfolioGalleryImage[];
  testimonials: PortfolioTestimonial[];
  instagramUrl: string;
  instagramHandle: string;
  linkedinUrl: string;
  contactEmail: string;
  locationLabel: string;
  bookingTitle: string;
  bookingBody: string;
  bookingButtonLabel: string;
  footerTitle: string;
  enquiryEventTypes: string[];
  webhookUrl?: string;
  updatedAt?: string;
};

export const importedPortfolioGalleryImages: PortfolioGalleryImage[] = [
  { id: "archive-wedding-waterfront", image: "/portfolio/imported/alexrosanna-010.jpg", alt: "Couple embracing beside the waterfront", category: "Weddings" },
  { id: "archive-portrait-red-dress", image: "/portfolio/imported/aurie-175.jpg", alt: "Editorial portrait in a red dress", category: "Portraits" },
  { id: "archive-wedding-garden", image: "/portfolio/imported/jjswedding-138.jpg", alt: "Wedding couple sharing a quiet garden moment", category: "Weddings" },
  { id: "archive-wedding-blossoms", image: "/portfolio/imported/melanienicholaswedding0152.jpg", alt: "Newlyweds kissing beneath flowering trees", category: "Weddings" },
  { id: "archive-live-band", image: "/portfolio/imported/coogebay-thevanns-22-09-240103.jpg", alt: "Live band performing on an outdoor stage", category: "Live Music" },
  { id: "archive-dj-duo", image: "/portfolio/imported/cosmosmidnight-fullres-018.jpg", alt: "DJ duo performing under coloured lights", category: "Live Music" },
  { id: "archive-stage-performer", image: "/portfolio/imported/zm-382.jpg", alt: "Performer on stage beneath blue lighting", category: "Live Music" },
  { id: "archive-concert-crowd", image: "/portfolio/imported/zm-day2-120.jpg", alt: "Concert crowd holding illuminated light sticks", category: "Live Music" },
  { id: "archive-party-crowd", image: "/portfolio/imported/greenwoodhotel-cruiser-31-10-240046.jpg", alt: "Crowd celebrating at a live party", category: "Events" },
  { id: "archive-party-djs", image: "/portfolio/imported/greenwoodhotel-cruiser-31-10-240095.jpg", alt: "DJs performing at an outdoor party", category: "Events" },
  { id: "archive-formal-audience", image: "/portfolio/imported/thewarwick-nrl-115.jpg", alt: "Audience watching a formal presentation", category: "Events" },
  { id: "archive-gaming-event", image: "/portfolio/imported/thewarwick-nrl-46.jpg", alt: "Guests gathered around a gaming activation", category: "Events" },
  { id: "archive-balter-bar", image: "/portfolio/imported/coogebay-thevanns-22-09-240010.jpg", alt: "Balter beverage display at a branded event", category: "Brand & Corporate" },
  { id: "archive-balter-can", image: "/portfolio/imported/greenwoodhotel-cruiser-31-10-240113.jpg", alt: "Balter Easy Hazy can at an event", category: "Brand & Corporate" },
  { id: "archive-restaurant-team", image: "/portfolio/imported/cloudec-050.jpg", alt: "Restaurant team portrait", category: "Brand & Corporate" },
  { id: "archive-brand-gardening", image: "/portfolio/imported/cloudec-264.jpg", alt: "Team member working in a garden", category: "Brand & Corporate" },
  { id: "archive-event-drinks", image: "/portfolio/imported/curzonhallschneidercorporate26-10-24-150.jpg", alt: "Guests enjoying drinks at a corporate event", category: "Brand & Corporate" },
  { id: "archive-corporate-networking", image: "/portfolio/imported/oatlandsestatesmallbusinessevent30-10-24137.jpg", alt: "Professionals networking at an evening reception", category: "Brand & Corporate" },
  { id: "archive-event-selfie", image: "/portfolio/imported/oatlandsestatesmallbusinessevent30-10-24109.jpg", alt: "Guests taking a selfie at a formal event", category: "Events" },
  { id: "archive-outdoor-service", image: "/portfolio/imported/oatlandsestategraduationsetup13-11-240053.jpg", alt: "Outdoor beverage service at an event", category: "Events" },
  { id: "archive-corporate-conversation", image: "/portfolio/imported/stryd-140.jpg", alt: "Business guests in conversation", category: "Brand & Corporate" },
  { id: "archive-catered-prosciutto", image: "/portfolio/imported/aawedding-190.jpg", alt: "Catered prosciutto finished with herbs", category: "Food & Hospitality" },
  { id: "archive-chef-service", image: "/portfolio/imported/curzonhallschneidercorporate26-10-24-123.jpg", alt: "Chef serving guests at an outdoor station", category: "Food & Hospitality" },
  { id: "archive-catering-spread", image: "/portfolio/imported/lemontage6-2-2025roomshotsnestle25of71.jpg", alt: "Catered sandwich and appetizer spread", category: "Food & Hospitality" },
  { id: "archive-plated-service", image: "/portfolio/imported/lemontage6-2-2025roomshotsnestle28of71.jpg", alt: "Chef plating dishes during service", category: "Food & Hospitality" },
  { id: "archive-gnocchi", image: "/portfolio/imported/oatlandsestategraduationsetup13-11-240101.jpg", alt: "Gnocchi finished with parmesan and herbs", category: "Food & Hospitality" },
  { id: "archive-plated-entree", image: "/portfolio/imported/lemontagegraduationsetup15-11-240083.jpg", alt: "Plated entree prepared for a formal dinner", category: "Food & Hospitality" },
  { id: "archive-formal-room-blue", image: "/portfolio/imported/lemontagegraduationsetup15-11-240014.jpg", alt: "Ballroom prepared with blue architectural lighting", category: "Venues & Details" },
  { id: "archive-formal-table-blue", image: "/portfolio/imported/lemontagegraduationsetup15-11-240008-enhanced-nr.jpg", alt: "Formal table setting with blue linens", category: "Venues & Details" },
  { id: "archive-corporate-room", image: "/portfolio/imported/lemontage6-2-2025roomshotsnestle42of71.jpg", alt: "Corporate dining room during an event", category: "Venues & Details" },
  { id: "archive-gift-table", image: "/portfolio/imported/oatlandsestate1-2-25elizabethroom41of66.jpg", alt: "Formal table setting with wrapped gifts", category: "Venues & Details" },
  { id: "archive-editorial-writing", image: "/portfolio/imported/cloudec-037.jpg", alt: "Hands writing in strong afternoon light", category: "Venues & Details" },
  { id: "archive-cocktails", image: "/portfolio/imported/thewarwick-nrl-2-copy.jpg", alt: "Two pink cocktails at an evening event", category: "Venues & Details" },
  { id: "archive-cosplay", image: "/portfolio/imported/zm-182.jpg", alt: "Cosplay guests arriving at a convention", category: "Events" },
];

const corePortfolioGalleryImages: PortfolioGalleryImage[] = [
  { id: "wedding-aisle", image: "/portfolio/gallery/wedding-garden.jpg", alt: "Newlyweds walking down the church aisle", category: "Weddings" },
  { id: "wedding-flowers", image: "/portfolio/gallery/wedding-celebration.jpg", alt: "Wedding floral details", category: "Weddings" },
  { id: "wedding-harbour", image: "/portfolio/gallery/wedding-candid.jpg", alt: "Wedding couple at Sydney Harbour", category: "Weddings" },
  { id: "dj", image: "/portfolio/gallery/concert-performer.jpg", alt: "DJ performing at a live event", category: "Live Music" },
  { id: "performer", image: "/portfolio/gallery/food-detail.jpg", alt: "Singer performing under stage lights", category: "Live Music" },
  { id: "nightlife-sign", image: "/portfolio/gallery/concert-crowd.jpg", alt: "Neon venue signage at a nightlife event", category: "Events" },
  { id: "cocktail", image: "/portfolio/gallery/event-energy.jpg", alt: "Cocktail service at an event", category: "Events" },
  { id: "brand-networking", image: "/portfolio/gallery/brand-event.jpg", alt: "Guests networking at a business event", category: "Brand & Corporate" },
  { id: "event-production", image: "/portfolio/gallery/portrait-editorial.jpg", alt: "Event production team at work", category: "Brand & Corporate" },
  { id: "chef", image: "/portfolio/gallery/corporate-networking.jpg", alt: "Chef serving guests at a catered event", category: "Food & Hospitality" },
  { id: "wine-detail", image: "/portfolio/gallery/formal-room.jpg", alt: "Wine and glassware at a formal event", category: "Venues & Details" },
  { id: "balter", image: "/portfolio/gallery/nightlife.jpg", alt: "Balter brand activation", category: "Brand & Corporate" },
];

export const portfolioCategoryOrder = ["Weddings", "Live Music", "Events", "Brand & Corporate", "Food & Hospitality", "Venues & Details", "Portraits"];
export const curatedPortfolioGalleryImages = [...corePortfolioGalleryImages, ...importedPortfolioGalleryImages]
  .sort((left, right) => portfolioCategoryOrder.indexOf(left.category) - portfolioCategoryOrder.indexOf(right.category));

export const defaultPortfolioSite: PortfolioSite = {
  gallerySeedVersion: 2,
  brandName: "Zac Morgan Photography",
  logo: "/portfolio/logo.png",
  heroImage: "/portfolio/live-action.jpg",
  heroImages: ["/portfolio/live-action.jpg", "/portfolio/gallery/concert-performer.jpg", "/portfolio/gallery/brand-event.jpg"],
  heroLabel: "Live in action",
  heroServicesLabel: "Weddings · Events · Live music · Brands",
  introEyebrow: "Hey, I'm Zac, an event / wedding photographer",
  introTitle: "Let's get to know each other",
  introBody: "What started as a hobby quickly became a passion for capturing the moments people want to remember. I photograph weddings, live music, parties and corporate events across Sydney.",
  aboutSecondaryBody: "I work quietly when the moment calls for it and step in with direction when it helps. The goal is a polished gallery that keeps the people, movement and atmosphere that made the day yours.",
  portfolioTitle: "Stories that still feel alive.",
  portfolioBody: "Weddings, performances, parties, people and brands photographed with energy and intent.",
  testimonialsTitle: "The experience matters too.",
  testimonialsIntro: "Feedback from weddings, celebrations, portrait sessions and business events across Sydney.",
  portrait: "/portfolio/portrait.jpg",
  homeRibbonImages: ["/portfolio/gallery/wedding-garden.jpg", "/portfolio/gallery/wedding-celebration.jpg", "/portfolio/gallery/wedding-candid.jpg"],
  storyEyebrow: "Ways of seeing",
  storyTitle: "Every room has its own rhythm.",
  philosophyEyebrow: "The work",
  philosophyTitle: "Photographs should feel like the night did.",
  philosophyBody: "Not over-directed. Not flattened into a trend. Just the people, atmosphere and small details that made the moment yours.",
  philosophyImage: "/portfolio/gallery/food-detail.jpg",
  portfolioClientsLabel: "Selected clients and venues",
  portfolioClients: ["Asahi Breweries", "Navarra Venues", "SMASH!"],
  portfolioCtaEyebrow: "Your story, photographed honestly",
  portfolioCtaTitle: "Planning something?",
  portfolioCtaLabel: "Check availability",
  concertEyebrow: "Live music photography",
  concertTitle: "The room, at full volume.",
  concertBody: "Touring artists, festivals, venues and late-night sets photographed from inside the energy. Fast, atmospheric coverage built for press, social and the archive.",
  concertHeroImage: "/portfolio/imported/zm-day2-120.jpg",
  concertHighlights: ["Live sets", "Artist portraits", "Crowd and atmosphere", "Fast selects"],
  aboutApproachEyebrow: "The approach",
  aboutApproachTitle: "Present enough to guide. Quiet enough to notice.",
  aboutApproachBody: "I look for the interactions happening between the scheduled moments: the reaction across the room, the energy building before a performance, and the details your team spent months getting right.",
  aboutSupportingImage: "/portfolio/gallery/concert-performer.jpg",
  aboutSupportingCaption: "Working across Sydney weddings, events, venues and live productions.",
  aboutValues: [
    { id: "natural", title: "Natural over staged", body: "Real expressions and useful direction, without turning your event into a production." },
    { id: "dependable", title: "Fast and dependable", body: "Clear communication, careful backups and delivery that respects your timeline." },
    { id: "people", title: "Built around people", body: "Coverage adapts to your guests, venue, schedule and what matters most to you." },
  ],
  aboutRibbonImages: ["/portfolio/gallery/concert-crowd.jpg", "/portfolio/gallery/event-energy.jpg", "/portfolio/gallery/brand-event.jpg"],
  testimonialsFeatureEyebrow: "From first message to final gallery",
  testimonialsFeatureTitle: "Clear, calm and ready for the moment.",
  testimonialsFeaturePoints: ["Straightforward planning", "Natural, true-to-life coverage", "Careful backup and timely delivery"],
  testimonialsImage: "/portfolio/gallery/portrait-editorial.jpg",
  testimonialsRibbonImages: ["/portfolio/gallery/wedding-celebration.jpg", "/portfolio/gallery/wedding-candid.jpg", "/portfolio/gallery/concert-performer.jpg"],
  enquiryImage: "/portfolio/gallery/concert-crowd.jpg",
  enquirySteps: [
    { id: "details", title: "Send the details", body: "Share the date, venue and kind of coverage you have in mind." },
    { id: "fit", title: "Confirm the fit", body: "You'll receive availability, options and a clear recommendation." },
    { id: "book", title: "Lock it in", body: "Approve the booking, sign online and your date is secured." },
  ],
  testimonial: "Zac is an extremely talented photographer. His photos captured the energy of the night perfectly and were delivered quickly.",
  testimonialAuthor: "Henry M",
  projects: [
    { id: "weddings", title: "Engagements / Weddings", image: "/portfolio/weddings.jpg", description: "Relaxed, honest coverage from the quiet moments to the dance floor.", category: "Weddings" },
    { id: "bands", title: "Band Photos", image: "/portfolio/bands.jpg", description: "Live performance and artist imagery that keeps the atmosphere intact.", category: "Live Music" },
    { id: "corporate", title: "Corporate Events", image: "/portfolio/corporate.jpg", description: "Polished event coverage for teams, brands and venues.", category: "Brand & Corporate" },
    { id: "parties", title: "Parties", image: "/portfolio/parties.jpg", description: "Candid celebration photography with people at the centre.", category: "Events" },
  ],
  galleryImages: curatedPortfolioGalleryImages,
  testimonials: [
    { id: "alexander", quote: "Zac's photos for our wedding were amazing. He was professional, genuine and made sure the day was captured beautifully, from our families to the candid moments.", author: "Alexander", context: "Wedding" },
    { id: "jorden", quote: "The photos were stunning, the session was fun and relaxed, and the turnaround time was incredibly fast.", author: "Jorden", context: "Portrait session" },
    { id: "luisa", quote: "Thanks so much Zac for your amazing work at our wedding. I am loving all the photos that captured the best day of my life.", author: "Luisa Munoz", context: "Wedding" },
    { id: "henry", quote: "Zac was the ultimate professional, capturing only the best photos for my son's 21st and creating a lifetime of memories.", author: "Henry Makhouf", context: "21st birthday" },
    { id: "keith", quote: "The photos were outstanding and the turnaround time was very speedy. Highly recommend.", author: "Keith", context: "Family celebration" },
    { id: "lorenzo", quote: "Professional, punctual and a great communicator. He handled the brief with professionalism and flair.", author: "Lorenzo", context: "Corporate event" },
  ],
  instagramUrl: "https://www.instagram.com/zacmphotos/",
  instagramHandle: "@zacmphotos",
  linkedinUrl: "https://www.linkedin.com/in/zacmorgan1/",
  contactEmail: "zacmorganphotography@gmail.com",
  locationLabel: "Sydney, Australia",
  bookingTitle: "Tell me what you're planning",
  bookingBody: "Share the date, location and feeling you want captured. I'll reply with availability and the right coverage option.",
  bookingButtonLabel: "Start an enquiry",
  footerTitle: "Let's make it memorable.",
  enquiryEventTypes: ["Wedding / engagement", "Corporate event", "Party", "Live music", "Brand / business shoot", "Other"],
};

function adminHeaders(): Record<string, string> {
  try {
    const creds = JSON.parse(localStorage.getItem("wv_admin") || "null") as { username?: string; passwordHash?: string } | null;
    const hash = localStorage.getItem("wv_admin_session_hash") || (creds?.passwordHash?.startsWith("$2") ? "" : creds?.passwordHash);
    return creds?.username && hash ? { Authorization: `Basic ${btoa(`${creds.username}:${hash}`)}` } : {};
  } catch {
    return {};
  }
}

export async function fetchPublishedPortfolio(): Promise<PortfolioSite> {
  try {
    const response = await fetch("/api/portfolio", { cache: "no-store" });
    if (response.ok) return { ...defaultPortfolioSite, ...(await response.json()) };
  } catch { /* fallback keeps the public site available */ }
  return defaultPortfolioSite;
}

export async function fetchPortfolioDraft(): Promise<{ draft: PortfolioSite; publishedAt?: string }> {
  const response = await fetch("/api/admin/portfolio", { headers: adminHeaders(), cache: "no-store" });
  if (!response.ok) throw new Error("Could not load website settings");
  const data = await response.json();
  return { draft: { ...defaultPortfolioSite, ...(data.draft || {}) }, publishedAt: data.publishedAt };
}

export async function uploadPortfolioImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("image", file);
  const response = await fetch("/api/admin/portfolio/media", { method: "POST", headers: adminHeaders(), body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.url) throw new Error(data.error || "Image upload failed");
  return data.url;
}

export async function testPortfolioWebhook(webhookUrl: string): Promise<void> {
  const response = await fetch("/api/admin/portfolio/webhook/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders() },
    body: JSON.stringify({ webhookUrl }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Webhook test failed");
}

export type PortfolioEnquiry = {
  name: string; email: string; phone?: string; eventTypeTitle: string;
  preferredDate?: string; venue?: string; referralSource?: string; message: string; website?: string;
};

export async function submitPortfolioEnquiry(enquiry: PortfolioEnquiry): Promise<void> {
  const response = await fetch("/api/portfolio/enquiry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(enquiry),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok !== true) throw new Error(data.error || "Could not send enquiry");
}

export async function savePortfolioDraft(draft: PortfolioSite): Promise<void> {
  const response = await fetch("/api/admin/portfolio/draft", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...adminHeaders() },
    body: JSON.stringify({ draft }),
  });
  if (!response.ok) throw new Error("Could not save website draft");
}

export async function publishPortfolio(): Promise<{ publishedAt: string }> {
  const response = await fetch("/api/admin/portfolio/publish", { method: "POST", headers: adminHeaders() });
  if (!response.ok) throw new Error("Could not publish website");
  return response.json();
}
