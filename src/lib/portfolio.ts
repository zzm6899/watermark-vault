export type PortfolioProject = {
  id: string;
  title: string;
  image: string;
  description: string;
};

export type PortfolioSite = {
  brandName: string;
  logo: string;
  heroLabel: string;
  introEyebrow: string;
  introTitle: string;
  introBody: string;
  portrait: string;
  testimonial: string;
  testimonialAuthor: string;
  projects: PortfolioProject[];
  instagramUrl: string;
  instagramHandle: string;
  linkedinUrl: string;
  contactEmail: string;
  updatedAt?: string;
};

export const defaultPortfolioSite: PortfolioSite = {
  brandName: "Zac Morgan Photography",
  logo: "/portfolio/logo.png",
  heroLabel: "Live in action",
  introEyebrow: "Hey, I'm Zac, an event / wedding photographer",
  introTitle: "Let's get to know each other",
  introBody: "What started as a hobby quickly became a passion for capturing the moments people want to remember. I photograph weddings, live music, parties and corporate events across Sydney.",
  portrait: "/portfolio/portrait.jpg",
  testimonial: "Zac is an extremely talented photographer. His photos captured the energy of the night perfectly and were delivered quickly.",
  testimonialAuthor: "Henry M",
  projects: [
    { id: "weddings", title: "Engagements / Weddings", image: "/portfolio/weddings.jpg", description: "Relaxed, honest coverage from the quiet moments to the dance floor." },
    { id: "bands", title: "Band Photos", image: "/portfolio/bands.jpg", description: "Live performance and artist imagery that keeps the atmosphere intact." },
    { id: "corporate", title: "Corporate Events", image: "/portfolio/corporate.jpg", description: "Polished event coverage for teams, brands and venues." },
    { id: "parties", title: "Parties", image: "/portfolio/parties.jpg", description: "Candid celebration photography with people at the centre." },
  ],
  instagramUrl: "https://www.instagram.com/zacmphotos/",
  instagramHandle: "@zacmphotos",
  linkedinUrl: "https://www.linkedin.com/in/zac-morgan-photography/",
  contactEmail: "zacmorganphotography@gmail.com",
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
