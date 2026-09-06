import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  fireEvent.click(screen.getByRole("button", { name: "Select Photo 2" }));
  fireEvent.click(screen.getByRole("button", { name: "Pay $20.00" }));
  expect(await screen.findByText("$20.00", { selector: "span" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Choose Payment Method" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^Close$/ }));
  fireEvent.click(screen.getByRole("button", { name: "$100.00 Album" }));
  expect(await screen.findByText(/Full album · 2 photos/)).toBeInTheDocument();
  expect(screen.getByText("$100.00", { selector: "span" })).toBeInTheDocument();
});
