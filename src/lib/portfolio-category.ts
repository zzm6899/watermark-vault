const categoryAliases: Record<string, string> = {
  "brand and business": "brand and corporate",
  "brand business": "brand and corporate",
  "brand corporate": "brand and corporate",
  "brand activation": "brand and corporate",
  "brand activations": "brand and corporate",
  "business event": "brand and corporate",
  "business events": "brand and corporate",
  commercial: "brand and corporate",
  corporate: "brand and corporate",
  "corporate and events": "brand and corporate",
  "corporate event": "brand and corporate",
  "corporate events": "brand and corporate",
  "event photography": "events",
  "brand event": "brand and corporate",
  "brand events": "brand and corporate",
  music: "live music",
  live: "live music",
  "live performance": "live music",
  concert: "live music",
  concerts: "live music",
  cosplay: "cosplay and conventions",
  convention: "cosplay and conventions",
  conventions: "cosplay and conventions",
  sport: "sports",
  "race coverage": "sports",
  food: "food and hospitality",
  hospitality: "food and hospitality",
  venue: "venues and details",
  venues: "venues and details",
  details: "venues and details",
  portrait: "portraits",
};

const canonicalLabels: Record<string, string> = {
  weddings: "Weddings",
  "live music": "Live Music",
  "cosplay and conventions": "Cosplay & Conventions",
  sports: "Sports",
  events: "Events",
  "brand and corporate": "Brand & Corporate",
  "food and hospitality": "Food & Hospitality",
  "venues and details": "Venues & Details",
  portraits: "Portraits",
};

export function normalizePortfolioCategory(value: string | null | undefined): string {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  return categoryAliases[normalized] || normalized;
}

export function portfolioCategoryLabel(value: string | null | undefined): string {
  const normalized = normalizePortfolioCategory(value);
  return canonicalLabels[normalized] || String(value || "").trim();
}

export function resolvePortfolioCategory(
  value: string | null | undefined,
  available: readonly string[],
): string | undefined {
  const normalized = normalizePortfolioCategory(value);
  if (!normalized) return undefined;
  return available.find(category => normalizePortfolioCategory(category) === normalized)
    ? portfolioCategoryLabel(available.find(category => normalizePortfolioCategory(category) === normalized))
    : undefined;
}

export function portfolioCategoryMatches(value: string | null | undefined, selected: string | null | undefined): boolean {
  const selectedCategory = normalizePortfolioCategory(selected);
  return !!selectedCategory && normalizePortfolioCategory(value) === selectedCategory;
}
