export type PortfolioProject = {
  id: string;
  title: string;
  image: string;
  description: string;
};

export type PortfolioGalleryImage = {
  id: string;
  image: string;
  alt: string;
  category: string;
};

export type PortfolioTestimonial = {
  quote: string;
  author: string;
  context: string;
};

export type PortfolioSite = {
  brandName: string;
  logo: string;
  heroImage: string;
  heroLabel: string;
  introEyebrow: string;
  introTitle: string;
  introBody: string;
  aboutSecondaryBody: string;
  portfolioTitle: string;
  portfolioBody: string;
  testimonialsTitle: string;
  portrait: string;
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
  heroLabel: "Live in action",
  introEyebrow: "Hey, I'm Zac, an event / wedding photographer",
  introTitle: "Let's get to know each other",
  introBody: "What started as a hobby quickly became a passion for capturing the moments people want to remember. I photograph weddings, live music, parties and corporate events across Sydney.",
  aboutSecondaryBody: "I work quietly when the moment calls for it and step in with direction when it helps. The goal is a polished gallery that keeps the people, movement and atmosphere that made the day yours.",
  portfolioTitle: "Stories that still feel alive.",
  portfolioBody: "Weddings, performances, parties, people and brands photographed with energy and intent.",
  testimonialsTitle: "The experience matters too.",
  portrait: "/portfolio/portrait.jpg",
  testimonial: "Zac is an extremely talented photographer. His photos captured the energy of the night perfectly and were delivered quickly.",
  testimonialAuthor: "Henry M",
  projects: [
    { id: "weddings", title: "Engagements / Weddings", image: "/portfolio/weddings.jpg", description: "Relaxed, honest coverage from the quiet moments to the dance floor." },
    { id: "bands", title: "Band Photos", image: "/portfolio/bands.jpg", description: "Live performance and artist imagery that keeps the atmosphere intact." },
    { id: "corporate", title: "Corporate Events", image: "/portfolio/corporate.jpg", description: "Polished event coverage for teams, brands and venues." },
    { id: "parties", title: "Parties", image: "/portfolio/parties.jpg", description: "Candid celebration photography with people at the centre." },
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
    { quote: "Zac's photos for our wedding were amazing. He was professional, genuine and made sure the day was captured beautifully, from our families to the candid moments.", author: "Alexander", context: "Wedding" },
    { quote: "The photos were stunning, the session was fun and relaxed, and the turnaround time was incredibly fast.", author: "Jorden", context: "Portrait session" },
    { quote: "Thanks so much Zac for your amazing work at our wedding. I am loving all the photos that captured the best day of my life.", author: "Luisa Munoz", context: "Wedding" },
    { quote: "Zac was the ultimate professional, capturing only the best photos for my son's 21st and creating a lifetime of memories.", author: "Henry Makhouf", context: "21st birthday" },
    { quote: "The photos were outstanding and the turnaround time was very speedy. Highly recommend.", author: "Keith", context: "Family celebration" },
    { quote: "Professional, punctual and a great communicator. He handled the brief with professionalism and flair.", author: "Lorenzo", context: "Corporate event" },
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
