import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("portfolio technical SEO", () => {
  it("ships complete canonical, social and structured metadata in the static shell", () => {
    const html = read("index.html");
    const document = new DOMParser().parseFromString(html, "text/html");
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const jsonLd = document.querySelector<HTMLScriptElement>('script[type="application/ld+json"]');

    expect(document.title).toContain("Zac Morgan Photography");
    expect(canonical?.href).toBe("https://zacmorganphotography.com/");
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toContain("Sydney event photographer");
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute("content")).toBe(canonical?.href);
    expect(document.querySelector('meta[property="og:image"]')?.getAttribute("content")).toMatch(/^https:\/\/zacmorganphotography\.com\/.+\.jpg$/);
    expect(document.querySelector('meta[name="twitter:card"]')?.getAttribute("content")).toBe("summary_large_image");
    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toContain("max-image-preview:large");
    expect(html.match(/<!-- SEO:START -->/g)).toHaveLength(1);
    expect(html.match(/<!-- SEO:END -->/g)).toHaveLength(1);

    const schema = JSON.parse(jsonLd?.textContent || "{}");
    expect(schema["@context"]).toBe("https://schema.org");
    expect(schema["@graph"].some((node: { "@type": string | string[] }) => node["@type"] === "WebSite")).toBe(true);
    const business = schema["@graph"].find((node: { "@id": string }) => node["@id"] === "https://zacmorganphotography.com/#business");
    const person = schema["@graph"].find((node: { "@type": string }) => node["@type"] === "Person");
    expect(business["@type"]).toEqual(["LocalBusiness", "ProfessionalService"]);
    expect(business.founder["@id"]).toBe("https://zacmorganphotography.com/#zac-morgan");
    expect(person).toMatchObject({ name: "Zac Morgan", jobTitle: "Photographer" });
    expect(person.worksFor["@id"]).toBe(business["@id"]);
  });

  it("publishes a crawl policy and sitemap for every public portfolio route", () => {
    const robots = read("public/robots.txt");
    const sitemap = read("public/sitemap.xml");
    const routes = ["/", "/portfolio", "/concerts", "/about", "/testimonials", "/enquire"];

    expect(robots).toContain("Disallow: /admin");
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain("Sitemap: https://zacmorganphotography.com/sitemap.xml");
    for (const route of routes) {
      expect(sitemap).toContain(`<loc>https://zacmorganphotography.com${route}</loc>`);
    }
    expect(sitemap).not.toContain("/portfolio-preview");
  });

  it("configures route metadata, canonical redirects and Cloudflare edge caching at the origin", () => {
    const server = read("server/index.js");
    const compose = read("docker-compose.yml");

    for (const route of ["/portfolio", "/concerts", "/about", "/testimonials", "/enquire"]) {
      expect(server).toContain(`\"${route}\": {`);
    }
    expect(server).toContain('["/concert", "/concerts"]');
    expect(server).toContain('["/contact", "/enquire"]');
    expect(server).toContain("requiresCanonicalHost");
    expect(server).toContain('res.redirect(308,');
    expect(server).toContain('if (requestPath === "/api" || requestPath.startsWith("/api/")) return next()');
    expect(server).toContain('res.setHeader("Cloudflare-CDN-Cache-Control"');
    expect(server).toContain('res.setHeader("Content-Security-Policy"');
    expect(server).toContain('res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive")');
    expect(server).toContain('if (!isPortfolioSiteHost(req.hostname)) return next()');
    expect(server).toContain("index: false");
    expect(server).toContain("platformSeoBlock()");
    expect(compose).toContain("CANONICAL_PORTFOLIO_HOST=${CANONICAL_PORTFOLIO_HOST:-zacmorganphotography.com}");
  });
});
