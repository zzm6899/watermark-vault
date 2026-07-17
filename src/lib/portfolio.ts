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

export const defaultPortfolioSite: PortfolioSite = {
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
    { id: "bands", title: "Band Photos", image: "/portfolio/bands.jpg", description: "Live performance and artist imagery that keeps the atmosphere intact.", category: "Live music" },
    { id: "corporate", title: "Corporate Events", image: "/portfolio/corporate.jpg", description: "Polished event coverage for teams, brands and venues.", category: "Brand and business" },
    { id: "parties", title: "Parties", image: "/portfolio/parties.jpg", description: "Candid celebration photography with people at the centre.", category: "Events" },
  ],
  galleryImages: [
    { id: "wedding-aisle", image: "/portfolio/gallery/wedding-garden.jpg", alt: "Newlyweds walking down the church aisle", category: "Weddings" },
    { id: "wedding-flowers", image: "/portfolio/gallery/wedding-celebration.jpg", alt: "Wedding floral details", category: "Weddings" },
    { id: "wedding-harbour", image: "/portfolio/gallery/wedding-candid.jpg", alt: "Wedding couple at Sydney Harbour", category: "Weddings" },
    { id: "dj", image: "/portfolio/gallery/concert-performer.jpg", alt: "DJ performing at a live event", category: "Live music" },
    { id: "performer", image: "/portfolio/gallery/food-detail.jpg", alt: "Singer performing under stage lights", category: "Live music" },
    { id: "nightlife-sign", image: "/portfolio/gallery/concert-crowd.jpg", alt: "Neon venue signage at a nightlife event", category: "Events" },
    { id: "cocktail", image: "/portfolio/gallery/event-energy.jpg", alt: "Cocktail service at an event", category: "Events" },
    { id: "brand-networking", image: "/portfolio/gallery/brand-event.jpg", alt: "Guests networking at a business event", category: "Brand and business" },
    { id: "event-production", image: "/portfolio/gallery/portrait-editorial.jpg", alt: "Event production team at work", category: "Brand and business" },
    { id: "chef", image: "/portfolio/gallery/corporate-networking.jpg", alt: "Chef serving guests at a catered event", category: "Brand and business" },
    { id: "wine-detail", image: "/portfolio/gallery/formal-room.jpg", alt: "Wine and glassware at a formal event", category: "Details" },
    { id: "balter", image: "/portfolio/gallery/nightlife.jpg", alt: "Balter brand activation", category: "Brand and business" },
  ],
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
  linkedinUrl: "https://www.linkedin.com/in/zac-morgan-photography/",
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
