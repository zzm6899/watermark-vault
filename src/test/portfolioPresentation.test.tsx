import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PortfolioSite from "@/pages/PortfolioSite";
import { defaultPortfolioSite, fetchPublishedPortfolio, submitPortfolioEnquiry } from "@/lib/portfolio";
import { upgradePortfolioPresentation, publicPortfolioFocus } from "../../server/portfolio-presentation.mjs";
import { existsSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/portfolio", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/portfolio")>(),
  fetchPublishedPortfolio: vi.fn(),
  submitPortfolioEnquiry: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(fetchPublishedPortfolio).mockResolvedValue(defaultPortfolioSite);
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const open = (path: string) => render(<MemoryRouter initialEntries={[`/portfolio-preview${path}`]}><PortfolioSite /></MemoryRouter>);

describe("public portfolio presentation", () => {
  it("ships every default gallery, slide and collection photograph", () => {
    const images = [...defaultPortfolioSite.galleryImages.map(image => image.image), ...defaultPortfolioSite.projects.map(project => project.image), ...defaultPortfolioSite.heroImages];
    expect(images.filter(image => !existsSync(join(process.cwd(), "public", image)))).toEqual([]);
  });
  it("upgrades untouched copy without replacing custom content or gallery originals", () => {
    const galleryImages = [{ id: "custom", image: "/portfolio-media/original.jpg" }];
    const result = upgradePortfolioPresentation({ portfolioTitle: "Stories that still feel alive.", introTitle: "My own introduction", galleryImages, heroImages: ["/portfolio-media/custom.jpg"] });
    expect(result.portfolioTitle).toBe("Selected work");
    expect(result.introTitle).toBe("My own introduction");
    expect(result.galleryImages).toBe(galleryImages);
    expect(result.heroImages).toEqual(["/portfolio-media/custom.jpg"]);
    expect(upgradePortfolioPresentation(result)).toEqual(result);
  });

  it("uses one hero with working slide controls", async () => {
    const { container } = open("/");
    expect(container.querySelectorAll(".portfolio-hero")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Show slide 2" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Live performance");
    expect(container.querySelectorAll(".portfolio-hero-media img.active")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Play slideshow" })).toBeInTheDocument();
  });

  it("retains the full archive and restores focus after lightbox navigation", async () => {
    const { container } = open("/portfolio");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Selected work");
    expect(container.querySelectorAll(".portfolio-cover figure")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "All work" }));
    expect(container.querySelectorAll(".portfolio-gallery-item")).toHaveLength(publicPortfolioFocus(defaultPortfolioSite).galleryImages.length);
    const photo = container.querySelector<HTMLButtonElement>(".portfolio-gallery-item")!;
    photo.focus(); fireEvent.click(photo);
    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(photo);
  });

  it("opens the Commercial page from navigation", async () => {
    open("/portfolio");
    fireEvent.click(screen.getByRole("link", { name: "Commercial" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Brands & events");
    expect(screen.getByRole("link", { name: "Discuss your brief" })).toHaveAttribute("href", "/portfolio-preview/enquire");
  });

  it("keeps enquiry submission connected and reports success", async () => {
    vi.mocked(submitPortfolioEnquiry).mockResolvedValue(undefined);
    open("/enquire");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Preview Test" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "preview@example.com" } });
    fireEvent.change(screen.getByLabelText("What are you planning?"), { target: { value: "Convention / cosplay" } });
    fireEvent.change(screen.getByLabelText("Tell me about it"), { target: { value: "Test only, not sent to a real server." } });
    fireEvent.submit(screen.getByRole("button", { name: "Send enquiry" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Enquiry received"));
    expect(submitPortfolioEnquiry).toHaveBeenCalledWith(expect.objectContaining({ email: "preview@example.com", eventTypeTitle: "Convention / cosplay" }));
  });
  it("removes weddings from the public presentation without deleting the archive", () => {
    const focused = publicPortfolioFocus(defaultPortfolioSite);
    expect(focused.galleryImages.some(image => image.category === "Weddings")).toBe(false);
    expect(defaultPortfolioSite.galleryImages.some(image => image.category === "Weddings")).toBe(true);
    expect(focused.heroCaptions[0].title).toBe("Cosplay & character");
    expect(focused.featuredGalleryIds[0]).toBe("cosplay-animaga-editorial");
    expect(focused.enquiryEventTypes.join(" ")).not.toMatch(/wedding/i);
    expect(focused.testimonials.some(review => /wedding/i.test(review.quote))).toBe(false);
    expect(publicPortfolioFocus(focused)).toEqual(focused);
  });
  it("shows character portraits first on the dedicated cosplay page", () => {
    const { container } = open("/cosplay");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Cosplay & character");
    expect(container.querySelectorAll(".portfolio-gallery-item")).toHaveLength(13);
    expect(container.querySelector(".portfolio-gallery-item img")).toHaveAttribute("src", "/portfolio/curated/cosplay-animaga-editorial.jpg");
    expect(container.textContent).not.toMatch(/wedding/i);
  });
});
