import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import PortfolioSite from "@/pages/PortfolioSite";
import { defaultPortfolioSite, fetchPublishedPortfolio, submitPortfolioEnquiry } from "@/lib/portfolio";
import { publicPortfolioFocus } from "../../server/portfolio-presentation.mjs";

vi.mock("@/lib/portfolio", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/portfolio")>(),
  fetchPublishedPortfolio: vi.fn(), submitPortfolioEnquiry: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchPublishedPortfolio).mockResolvedValue(defaultPortfolioSite);
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function HistoryHarness() {
  const navigate = useNavigate(); const location = useLocation();
  return <><button onClick={() => navigate(-1)}>History back</button><button onClick={() => navigate(1)}>History forward</button><output data-testid="location">{location.pathname}{location.search}</output><PortfolioSite /></>;
}
const open = (path: string) => render(<MemoryRouter initialEntries={[path]}><HistoryHarness /></MemoryRouter>);
const selectedPaths = (container: HTMLElement) => Array.from(container.querySelectorAll(".portfolio-gallery-item img")).map(image => image.getAttribute("src"));

describe("photography sales journeys", () => {
  it.each([
    ["/events", "Corporate events"], ["/cosplay", "Cosplay & character"],
    ["/portfolio", "Selected photographs"], ["/about", "Hi, I'm Zac."],
    ["/testimonials", "What clients say"], ["/enquire", "Tell me about your shoot."],
    ["/contact/", "Tell me about your shoot."], ["/concerts", "Live music"], ["/concert/", "Live music"],
  ])("renders the collection or enquiry content at %s", (path, title) => {
    const { container } = open(path);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(title);
    if (path === "/events") expect(container.querySelector(".portfolio-collection-photo img")).toHaveAttribute("src", "/portfolio/selected/navarra-gala-dining-room.webp");
    if (path === "/contact/" || path === "/enquire") {
      expect(screen.getByRole("button", { name: "Send enquiry" })).toBeInTheDocument();
      expect(container.querySelector(".portfolio-footer-contact")).not.toBeInTheDocument();
      expect(within(screen.getByRole("navigation", { name: "Main navigation" })).getByRole("link", { name: "Enquire" })).toHaveAttribute("aria-current", "page");
    }
    if (path.startsWith("/concert")) expect(selectedPaths(container)).toEqual(publicPortfolioFocus(defaultPortfolioSite).galleryImages.filter(image => image.category === "Live Music").map(image => image.image));
  });
  it("keeps saved reviews verbatim with their authors and context", () => {
    const { container } = open("/testimonials");
    const reviews = publicPortfolioFocus(defaultPortfolioSite).testimonials;
    expect(container.querySelectorAll(".portfolio-review-list figure")).toHaveLength(reviews.length);
    reviews.forEach((review, index) => {
      const row = container.querySelectorAll(".portfolio-review-list figure")[index];
      expect(row.querySelector("blockquote")?.textContent).toBe(review.quote);
      expect(row.querySelector("strong")?.textContent).toBe(review.author);
      expect(row.querySelector("figcaption span")?.textContent).toBe(review.context);
    });
  });
  it.each(["/about", "/concerts", "/events", "/cosplay", "/testimonials"])("preserves custom CMS copy and photographs at %s", async path => {
    vi.mocked(fetchPublishedPortfolio).mockResolvedValue({ ...defaultPortfolioSite,
      introTitle: "Custom introduction", introBody: "Custom biography", portrait: "/my-portrait.jpg", aboutApproachTitle: "My approach", aboutApproachBody: "My working method",
      concertTitle: "Custom live collection", concertBody: "My live music copy", concertHeroImage: "/my-live-photo.jpg",
      testimonialsTitle: "Client feedback", testimonials: [{ id: "custom-review", quote: "Original client words", author: "Original author", context: "Original context" }],
      projects: defaultPortfolioSite.projects.map(project => ["corporate", "cosplay"].includes(project.id) ? { ...project, title: `My ${project.id} work`, description: "My service description", image: `/my-${project.id}.jpg` } : project),
    });
    const { container } = open(path);
    const titles: Record<string, string> = { "/about": "Custom introduction", "/concerts": "Custom live collection", "/events": "My corporate work", "/cosplay": "My cosplay work", "/testimonials": "Client feedback" };
    await screen.findByRole("heading", { level: 1, name: titles[path] });
    if (path === "/about") {
      expect(container.querySelector(".portfolio-about img")).toHaveAttribute("src", "/my-portrait.jpg");
      expect(screen.getByText("My working method")).toBeInTheDocument();
    } else if (path === "/testimonials") {
      expect(container.querySelector("blockquote")?.textContent).toBe("Original client words");
      expect(screen.getByText("Original author")).toBeInTheDocument();
    } else {
      const images: Record<string, string> = { "/concerts": "/my-live-photo.jpg", "/events": "/my-corporate.jpg", "/cosplay": "/my-cosplay.jpg" };
      expect(container.querySelector(".portfolio-collection-photo img")).toHaveAttribute("src", images[path]);
    }
  });
  it("connects footer destinations to the matching public pages", async () => {
    open("/");
    const footer = () => within(screen.getByRole("navigation", { name: "Footer navigation" }));
    fireEvent.click(footer().getByRole("link", { name: "Kind words" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(defaultPortfolioSite.testimonialsTitle);
    fireEvent.click(footer().getByRole("link", { name: "Live music" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Live music");
    fireEvent.click(footer().getByRole("link", { name: "All work" }));
    expect(screen.getByRole("group", { name: "Filter portfolio" })).toBeInTheDocument();
  });
  it.each(["/events", "/portfolio"])("filters real visible photos and restores %s collections through Back/Forward", async path => {
    const { container } = open(path);
    const initial = selectedPaths(container);
    fireEvent.click(screen.getByRole("button", { name: "Events" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Events" })).toHaveAttribute("aria-pressed", "true"));
    const eventImages = selectedPaths(container);
    expect(eventImages).not.toEqual(initial);
    expect(eventImages.length).toBe(publicPortfolioFocus(defaultPortfolioSite).galleryImages.filter(image => image.category === "Events").length);
    expect(container.querySelector(".portfolio-gallery-toolbar>p")).toHaveTextContent(`${eventImages.length} photographs`);
    expect(screen.getByTestId("location")).toHaveTextContent(`${path}?category=Events`);
    fireEvent.click(screen.getByRole("button", { name: "Food & Hospitality" }));
    const foodImages = selectedPaths(container);
    expect(foodImages).not.toEqual(eventImages);
    expect(Array.from(container.querySelectorAll(".portfolio-gallery-item")).every(label => label.getAttribute("data-category") === "Food & Hospitality")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "History back" }));
    await waitFor(() => expect(selectedPaths(container)).toEqual(eventImages));
    expect(screen.getByRole("button", { name: "Events" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "History back" }));
    await waitFor(() => expect(selectedPaths(container)).toEqual(initial));
    expect(screen.getByRole("button", { name: "Selected" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "History forward" }));
    await waitFor(() => expect(selectedPaths(container)).toEqual(eventImages));
  });
  it("checks every commercial category and All work without resetting to Selected", async () => {
    const { container } = open("/events");
    const gallery = publicPortfolioFocus(defaultPortfolioSite).galleryImages.filter(image => ["Events", "Brand & Corporate", "Food & Hospitality", "Venues & Details"].includes(image.category));
    for (const category of ["Events", "Brand & Corporate", "Food & Hospitality", "Venues & Details"]) {
      fireEvent.click(screen.getByRole("button", { name: category }));
      await waitFor(() => expect(selectedPaths(container)).toEqual(gallery.filter(image => image.category === category).map(image => image.image)));
      expect(screen.getByRole("button", { name: category })).toHaveAttribute("aria-pressed", "true");
    }
    fireEvent.click(screen.getByRole("button", { name: "All work" }));
    expect(selectedPaths(container)).toEqual(gallery.map(image => image.image));
  });
  it("pairs the first usable CMS hero photograph with its saved caption", async () => {
    vi.mocked(fetchPublishedPortfolio).mockResolvedValue({ ...defaultPortfolioSite, heroImages: ["", "/custom-a.jpg", "/custom-b.jpg"], heroCaptions: [
      { id: "empty", title: "Empty frame", description: "Skip", category: "Events" },
      { id: "a", title: "Custom first photograph", description: "Custom caption", category: "Events" },
      { id: "b", title: "Second photograph", description: "Saved for later", category: "Live Music" },
    ] });
    const { container } = open("/");
    await screen.findByText("Custom first photograph");
    expect(container.querySelector(".portfolio-editorial-lead img")).toHaveAttribute("src", "/custom-a.jpg");
    expect(container.querySelector(".portfolio-editorial-lead figcaption")).toHaveTextContent("Custom caption");
    expect(screen.queryByText("Empty frame")).not.toBeInTheDocument();
  });
  it("keeps custom featured selection, ordering and edited captions on the landing page", async () => {
    const image = defaultPortfolioSite.galleryImages.find(photo => photo.id === "navarra-gala-dining-room")!;
    vi.mocked(fetchPublishedPortfolio).mockResolvedValue({ ...defaultPortfolioSite, featuredGalleryIds: [image.id], galleryImages: defaultPortfolioSite.galleryImages.map(photo => photo.id === image.id ? { ...photo, alt: "My edited assignment caption" } : photo) });
    const { container } = open("/");
    await screen.findByRole("heading", { name: "My edited assignment caption" });
    expect(container.querySelectorAll(".portfolio-assignment")).toHaveLength(1);
    expect(container.querySelector(".portfolio-assignment img")).toHaveAttribute("src", image.image);
  });
  it("supports the mobile menu, Escape and route selection", async () => {
    open("/");
    const toggle = screen.getByRole("button", { name: "Open navigation" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Mobile navigation" })).getByRole("link", { name: "Cosplay" }));
    await screen.findByRole("heading", { name: "Cosplay & character" });
    expect(screen.queryByRole("navigation", { name: "Mobile navigation" })).not.toBeInTheDocument();
    const navigation = screen.getByRole("navigation", { name: "Main navigation" });
    expect(within(navigation).getByRole("link", { name: "Cosplay" })).toHaveAttribute("aria-current", "page");
    expect(within(navigation).getByRole("link", { name: "Events" })).not.toHaveAttribute("aria-current");
  });
  it("keeps lightbox keyboard navigation and focus within the dialog", async () => {
    const { container } = open("/portfolio");
    const photo = container.querySelector<HTMLButtonElement>(".portfolio-gallery-item")!;
    photo.focus(); fireEvent.click(photo);
    const close = screen.getByRole("button", { name: "Close photo" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next photo" }));
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    const first = screen.getByRole("dialog").getAttribute("aria-label");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("dialog").getAttribute("aria-label")).not.toBe(first);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", first);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(photo);
    expect(document.body.style.overflow).not.toBe("hidden");
  });
  it("does not submit missing, malformed or whitespace-only required enquiry fields", () => {
    open("/enquire");
    const form = screen.getByRole("button", { name: "Send enquiry" }).closest("form")!;
    fireEvent.submit(form);
    expect(submitPortfolioEnquiry).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Preview Test" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "invalid" } });
    fireEvent.change(screen.getByLabelText("What are you planning?"), { target: { value: "Corporate event" } });
    fireEvent.change(screen.getByLabelText("Tell me about it"), { target: { value: "Local mock." } });
    fireEvent.submit(form);
    expect(submitPortfolioEnquiry).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "preview@example.com" } });
    fireEvent.change(screen.getByLabelText("Tell me about it"), { target: { value: "   " } });
    fireEvent.submit(form);
    expect(screen.getByRole("alert")).toHaveTextContent("short brief");
    expect(submitPortfolioEnquiry).not.toHaveBeenCalled();
  });
  it("preserves editable draft copy and photographs in the admin preview", () => {
    const { container } = open("/portfolio-preview?editor=1");
    fireEvent(window, new MessageEvent("message", { origin: window.location.origin, source: window.parent, data: { type: "wv:portfolio-preview", site: { ...defaultPortfolioSite, heroImages: ["/portfolio-media/edited.jpg"], heroCaptions: [{ id: "custom", title: "An editor's headline", description: "Their own sales copy", category: "Events" }] } } }));
    expect(container.querySelector(".portfolio-editorial-lead figcaption")).toHaveTextContent("An editor's headline");
    expect(container.querySelector(".portfolio-editorial-lead img")).toHaveAttribute("src", "/portfolio-media/edited.jpg");
    expect(fetchPublishedPortfolio).not.toHaveBeenCalled();
  });
});
