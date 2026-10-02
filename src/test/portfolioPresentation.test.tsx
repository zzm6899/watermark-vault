import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
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
  vi.clearAllMocks();
  vi.mocked(fetchPublishedPortfolio).mockResolvedValue(defaultPortfolioSite);
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const open = (path: string) => render(<MemoryRouter initialEntries={[`/portfolio-preview${path}`]}><PortfolioSite /></MemoryRouter>);
function PortfolioRouteControls() {
  const navigate = useNavigate();
  return <><button onClick={() => navigate("/portfolio-preview/portfolio?category=sports")}>Open sports filter</button><button onClick={() => navigate("/portfolio-preview/portfolio")}>Clear route filter</button><PortfolioSite /></>;
}

describe("public portfolio presentation", () => {
  it("ships every default gallery, slide and collection photograph", () => {
    const images = [...defaultPortfolioSite.galleryImages.map(image => image.image), ...defaultPortfolioSite.projects.map(project => project.image), ...defaultPortfolioSite.heroImages];
    expect(images.filter(image => !existsSync(join(process.cwd(), "public", image)))).toEqual([]);
  });
  it("upgrades untouched copy without replacing custom content or gallery originals", () => {
    const galleryImages = [{ id: "custom", image: "/portfolio-media/original.jpg" }];
    const result = upgradePortfolioPresentation({ portfolioTitle: "Stories that still feel alive.", introTitle: "My own introduction", galleryImages, heroImages: ["/portfolio-media/custom.jpg"] });
    expect(result.portfolioTitle).toBe("Corporate, event and live photography.");
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
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Corporate, event and live photography.");
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

  it("opens the corporate and events page from navigation", async () => {
    open("/portfolio");
    fireEvent.click(screen.getByRole("link", { name: "Corporate & events" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Corporate events");
    expect(screen.getByRole("link", { name: "Discuss event coverage" })).toHaveAttribute("href", "/portfolio-preview/enquire");
  });

  it("resolves category aliases to canonical gallery filters", async () => {
    const { container } = open("/portfolio?category=corporate");
    await waitFor(() => expect(screen.getByRole("button", { name: "Brand & Corporate" })).toHaveAttribute("aria-pressed", "true"));
    expect(container.querySelectorAll(".portfolio-gallery-item").length).toBeGreaterThan(0);
    expect(Array.from(container.querySelectorAll(".portfolio-gallery-item > span")).every(item => item.textContent === "Brand & Corporate")).toBe(true);
  });

  it("resets the gallery filter and lightbox selection when the route changes", async () => {
    render(<MemoryRouter initialEntries={["/portfolio-preview/portfolio?category=corporate"]}><PortfolioRouteControls /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("button", { name: "Brand & Corporate" })).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(screen.getByRole("button", { name: "Open Guests networking at a business event" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open sports filter" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Sports" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear route filter" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Selected" })).toHaveAttribute("aria-pressed", "true"));
  });

  it("keeps enquiry submission connected and reports success", async () => {
    vi.mocked(submitPortfolioEnquiry).mockResolvedValue({});
    open("/enquire");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Preview Test" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "preview@example.com" } });
    fireEvent.change(screen.getByLabelText("What are you planning?"), { target: { value: "Convention / cosplay" } });
    fireEvent.change(screen.getByLabelText("Tell me about it"), { target: { value: "Test only, not sent to a real server." } });
    fireEvent.submit(screen.getByRole("button", { name: "Send enquiry" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Enquiry received"));
    expect(submitPortfolioEnquiry).toHaveBeenCalledWith(expect.objectContaining({ email: "preview@example.com", eventTypeTitle: "Convention / cosplay" }));
  });

  it("shows a recoverable enquiry error and allows a mocked retry", async () => {
    vi.mocked(submitPortfolioEnquiry).mockRejectedValueOnce(new Error("Unable to send your enquiry. Try again."));
    vi.mocked(submitPortfolioEnquiry).mockResolvedValueOnce({});
    open("/enquire");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Preview Test" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "preview@example.com" } });
    fireEvent.change(screen.getByLabelText("What are you planning?"), { target: { value: "Corporate event" } });
    fireEvent.change(screen.getByLabelText("Tell me about it"), { target: { value: "Local mock only." } });
    const form = screen.getByRole("button", { name: "Send enquiry" }).closest("form")!;
    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to send your enquiry");
    expect(screen.getByRole("button", { name: "Send enquiry" })).toBeEnabled();
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Enquiry received"));
    expect(submitPortfolioEnquiry).toHaveBeenCalledTimes(2);
  });

  it("submits an enquiry only once while a mocked request is pending", async () => {
    let resolveRequest!: () => void;
    vi.mocked(submitPortfolioEnquiry).mockImplementationOnce(() => new Promise(resolve => { resolveRequest = () => resolve({ emailDelivered: true }); }));
    open("/enquire");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Preview Test" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "preview@example.com" } });
    fireEvent.change(screen.getByLabelText("What are you planning?"), { target: { value: "Corporate event" } });
    fireEvent.change(screen.getByLabelText("Tell me about it"), { target: { value: "Local mock only." } });
    const form = screen.getByRole("button", { name: "Send enquiry" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(submitPortfolioEnquiry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Sending your enquiry");
    resolveRequest();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Enquiry received"));
  });

  it("warns when the saved enquiry's studio email notification did not send", async () => {
    vi.mocked(submitPortfolioEnquiry).mockResolvedValueOnce({ emailDelivered: false });
    open("/enquire");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Preview Test" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "preview@example.com" } });
    fireEvent.change(screen.getByLabelText("What are you planning?"), { target: { value: "Corporate event" } });
    fireEvent.change(screen.getByLabelText("Tell me about it"), { target: { value: "Local mock only." } });
    fireEvent.submit(screen.getByRole("button", { name: "Send enquiry" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Your enquiry is saved");
    expect(screen.getByRole("link", { name: "Email Zac" })).toHaveAttribute("href", "mailto:zacmorganphotography@gmail.com");
  });
  it("removes weddings from the public presentation without deleting the archive", () => {
    const focused = publicPortfolioFocus(defaultPortfolioSite);
    expect(focused.galleryImages.some(image => image.category === "Weddings")).toBe(false);
    expect(defaultPortfolioSite.galleryImages.some(image => image.category === "Weddings")).toBe(true);
    expect(focused.heroCaptions[0].title).toBe("Corporate events");
    expect(focused.featuredGalleryIds[0]).toBe("brand-networking");
    expect(focused.enquiryEventTypes.join(" ")).not.toMatch(/wedding/i);
    expect(focused.testimonials.some(review => /wedding/i.test(review.quote))).toBe(false);
    expect(publicPortfolioFocus(focused)).toEqual(focused);
  });
  it("refreshes a prior public-focus version without mutating the saved archive", () => {
    const original = {
      focusVersion: 1,
      heroLabel: "Cosplay, live music and events",
      heroServicesLabel: "Cosplay · live music · Events · Sport · Brands",
      heroImages: ["/portfolio/curated/cosplay-animaga-editorial.jpg", "/portfolio/curated/music-teddyloid-smash-crowd.webp", "/portfolio/imported/lemontage6-2-2025roomshotsnestle42of71.jpg"],
      galleryImages: [
        { id: "brand", image: "/portfolio/gallery/brand-event.jpg", category: "Brand & Corporate" },
        { id: "wedding", image: "/portfolio/curated/wedding-aa-exit.jpg", category: "Weddings" },
      ],
      projects: [
        { id: "cosplay", title: "Cosplay & character", image: "/portfolio/curated/cosplay-smash-confetti.jpg", category: "Cosplay & Conventions" },
        { id: "corporate", title: "Corporate events", image: "/portfolio/gallery/brand-event.jpg", category: "Brand & Corporate" },
      ],
    };
    const refreshed = publicPortfolioFocus(original);
    expect(refreshed.focusVersion).toBe(2);
    expect(refreshed.heroLabel).toBe("Corporate & event photography");
    expect(refreshed.heroImages[0]).toBe("/portfolio/gallery/brand-event.jpg");
    expect(refreshed.projects[0].id).toBe("corporate");
    expect(refreshed.galleryImages.map(image => image.id)).toEqual(["brand"]);
    expect(original.focusVersion).toBe(1);
    expect(original.projects[0].id).toBe("cosplay");
    expect(original.galleryImages).toHaveLength(2);
  });
  it("shows character portraits first on the dedicated cosplay page", () => {
    const { container } = open("/cosplay");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Cosplay & character");
    expect(container.querySelectorAll(".portfolio-gallery-item")).toHaveLength(13);
    expect(container.querySelector(".portfolio-gallery-item img")).toHaveAttribute("src", "/portfolio/curated/cosplay-animaga-editorial.jpg");
    expect(container.textContent).not.toMatch(/wedding/i);
  });
});
