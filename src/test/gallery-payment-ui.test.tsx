import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AlbumDetail from "@/pages/AlbumDetail";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear(); });

it("keeps all-photo selections at the cheaper individual price and displays explicit album pricing", async () => {
  const album = { id: "pricing", slug: "pricing", title: "Pricing Gallery", description: "", coverImage: "", date: "2026-09-06",
    photoCount: 2, freeDownloads: 0, pricePerPhoto: 10, priceFullAlbum: 100, isPublic: true, enabled: true,
    photos: [{ id: "one", title: "Photo 1", src: "/uploads/one.jpg" }, { id: "two", title: "Photo 2", src: "/uploads/two.jpg" }] };
  localStorage.setItem("wv_email_pricing", "buyer@example.test");
  vi.stubGlobal("fetch", vi.fn(async (input) => {
    const url = String(input);
    const body = url.endsWith("/api/public-album/pricing") ? { album, tenantSlug: null, sessionKey: "viewer-secure-test-session-123" } : {};
    return { ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as Response;
  }));
  render(<MemoryRouter initialEntries={["/gallery/pricing"]}><Routes><Route path="/gallery/:albumId" element={<AlbumDetail />} /></Routes></MemoryRouter>);
  await screen.findByRole("heading", { name: "Pricing Gallery" });
  fireEvent.click(screen.getByRole("button", { name: "Select Photo 1" }));
  await screen.findByRole("button", { name: "Deselect Photo 1" });
  fireEvent.click(screen.getByRole("button", { name: "Select Photo 2" }));
  fireEvent.click(await screen.findByRole("button", { name: "Review selection · $20.00" }));
  expect(await screen.findByRole("heading", { name: "Review your photographs" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Continue to payment · $20.00" }));
  expect(await screen.findByText("$20.00", { selector: "span" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Choose Payment Method" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^Close$/ }));
  fireEvent.click(screen.getByRole("button", { name: "Download & pricing" }));
  fireEvent.click(screen.getByRole("button", { name: "Get full gallery · $100.00" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue to payment · $100.00" }));
  expect(await screen.findByText(/Full album · 2 photos/)).toBeInTheDocument();
  expect(screen.getByText("$100.00", { selector: "span" })).toBeInTheDocument();
});

async function renderGallery(overrides: Record<string, unknown> = {}) {
  const album = { id: "simple", slug: "simple", title: "Client Gallery", description: "", coverImage: "", date: "2026-09-06",
    photoCount: 40, freeDownloads: 0, pricePerPhoto: 10, priceFullAlbum: 100, isPublic: true, enabled: true,
    photos: Array.from({ length: 40 }, (_, index) => ({ id: `photo-${index}`, title: `Photo ${index + 1}`, src: `/uploads/${index}.jpg` })), ...overrides };
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async (input) => {
    const body = String(input).endsWith("/api/public-album/simple") ? { album, tenantSlug: null, sessionKey: "gallery-secure-session-123456" } : {};
    return { ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as Response;
  }));
  render(<MemoryRouter initialEntries={["/gallery/simple"]}><Routes><Route path="/gallery/:albumId" element={<AlbumDetail />} /></Routes></MemoryRouter>);
  await screen.findByRole("heading", { name: "Client Gallery" });
}

it("opens photos independently of selection and selects only the rendered batch", async () => {
  await renderGallery();
  fireEvent.click(screen.getByRole("button", { name: "Open Photo 1 in lightbox" }));
  expect(screen.getByRole("dialog", { name: "Photo viewer: Photo 1" })).toBeInTheDocument();
  expect(screen.queryByText("1 photo selected")).not.toBeInTheDocument();
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Select visible" }));
  expect(screen.getByText("36 photos selected")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Deselect Photo 37" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(screen.getByRole("button", { name: "Select Photo 1" })).toHaveAttribute("aria-pressed", "false");
});

it("does not stack a delayed email dialog over payment choices", async () => {
  await renderGallery();
  fireEvent.click(screen.getByRole("button", { name: "Select Photo 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Review selection · $10.00" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue to payment · $10.00" }));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)); });
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "Choose Payment Method" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Your checkout email" })).not.toBeInTheDocument();
});

it("keeps expired downloads viewable without offering checkout or selection", async () => {
  await renderGallery({ downloadExpiresAt: "2020-01-01", allUnlocked: true });
  expect(screen.getByText("Download access has expired")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Select Photo 1" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Download & pricing" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open Photo 1 in lightbox" })).toBeInTheDocument();
});

it("downloads the full gallery even when an earlier selection is active", async () => {
  await renderGallery({ allUnlocked: true });
  fireEvent.click(screen.getByRole("button", { name: "Select Photo 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Download all photos" }));
  expect(await screen.findByRole("button", { name: "Download ZIP (40)" })).toBeInTheDocument();
});

it("resets the purchased-only filter along with other gallery filters", async () => {
  await renderGallery({ paidPhotoIds: ["photo-0"] });
  fireEvent.click(screen.getByRole("button", { name: "Purchased photos (1)" }));
  expect(screen.queryByRole("button", { name: "Open Photo 2 in lightbox" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show gallery filters" }));
  fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
  expect(screen.getByRole("button", { name: "Open Photo 2 in lightbox" })).toBeInTheDocument();
});

it("preserves the reviewed price when the complimentary allowance changes during email capture", async () => {
  const sessionKey = "gallery-reviewed-session-123456";
  let registered = false;
  let submitted: Record<string, unknown> | undefined;
  const album = { id: "reviewed", slug: "reviewed", title: "Reviewed Gallery", photos: [{ id: "one", title: "Photo 1", src: "/uploads/one.jpg" }, { id: "two", title: "Photo 2", src: "/uploads/two.jpg" }], enabled: true, freeDownloads: 1, pricePerPhoto: 10, priceFullAlbum: 100 };
  localStorage.setItem("wv_settings", JSON.stringify({ bankTransfer: { enabled: true } }));
  vi.stubGlobal("fetch", vi.fn(async (input, options) => {
    const url = String(input);
    let body: unknown = {};
    if (url.endsWith("/api/public-album/reviewed")) body = { album: { ...album, usedFreeDownloads: { [sessionKey]: registered ? 1 : 0 } }, sessionKey };
    if (url.endsWith("/api/album/register-purchaser")) { registered = true; body = { email: "buyer@example.test" }; }
    if (url.endsWith("/api/album/download-request")) { submitted = JSON.parse(options.body); body = { error: "Gallery allowance changed; review again." }; }
    return { ok: !url.endsWith("/download-request"), status: url.endsWith("/download-request") ? 409 : 200, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as Response;
  }));
  render(<MemoryRouter initialEntries={["/gallery/reviewed"]}><Routes><Route path="/gallery/:albumId" element={<AlbumDetail />} /></Routes></MemoryRouter>);
  await screen.findByRole("heading", { name: "Reviewed Gallery" });
  fireEvent.click(screen.getByRole("button", { name: "Select Photo 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Select Photo 2" }));
  fireEvent.click(screen.getByRole("button", { name: "Review selection · $10.00" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue to payment · $10.00" }));
  fireEvent.click(screen.getByRole("button", { name: "Bank Transfer / PayID" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Checkout email" }), { target: { value: "buyer@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Save & continue" }));
  fireEvent.click(await screen.findByRole("button", { name: "Submit Request & View Bank Details" }));
  await waitFor(() => expect(submitted).toMatchObject({ expectedAmount: 10, amount: 20, fullAlbum: false }));
  expect(screen.getByRole("heading", { name: "Request Photos via Bank Transfer" })).toBeInTheDocument();
});
