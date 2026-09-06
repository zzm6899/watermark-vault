import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import GalleryRecovery from "@/components/GalleryRecovery";
import AlbumDetail from "@/pages/AlbumDetail";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear(); });
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, headers: new Headers({ "content-type": "application/json" }), json: async () => body }) as Response;

it("requests a verified purchase recovery link without claiming to unlock by email alone", async () => {
  const fetcher = vi.fn(async () => response({ ok: true }, 202));
  vi.stubGlobal("fetch", fetcher);
  render(<GalleryRecovery albumId="album-id" />);
  fireEvent.click(screen.getByRole("button", { name: "Find my purchases" }));
  fireEvent.change(screen.getByLabelText("Email used at checkout"), { target: { value: "Buyer@Example.com" } });
  fireEvent.submit(screen.getByRole("button", { name: "Email secure link" }).closest("form")!);
  await screen.findByText("Check your inbox");
  expect(fetcher).toHaveBeenCalledWith("/api/client-portal/request", expect.objectContaining({ body: JSON.stringify({ email: "buyer@example.com", albumId: "album-id" }) }));
  expect(screen.queryByText("Your purchases are restored")).not.toBeInTheDocument();
});

it("restores unsent proofing drafts after refresh and submits the canonical album ID with a receipt", async () => {
  let album = { id: "canonical-id", slug: "client-friendly-link", title: "Proofing Gallery", description: "", coverImage: "", date: "2026-09-06", photoCount: 2,
    freeDownloads: 0, pricePerPhoto: 10, priceFullAlbum: 100, enabled: true, isPublic: true, proofingEnabled: true, proofingStage: "proofing", lockDownloadsDuringProofing: true,
    proofingRounds: [{ roundNumber: 1, sentAt: "2026-09-06T00:00:00Z", selectedPhotoIds: [] as string[] }],
    photos: [{ id: "one", title: "Photo 1", src: "/uploads/one.jpg" }, { id: "two", title: "Photo 2", src: "/uploads/two.jpg" }] };
  const fetcher = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/proofing/submit")) {
      const body = JSON.parse(String(options?.body));
      album = { ...album, proofingStage: "selections-submitted", proofingRounds: [{ ...album.proofingRounds[0], ...body, submittedAt: "2026-09-06T01:00:00Z" }] };
      return response({ ok: true, album, receipt: { submissionId: body.submissionId, submittedAt: "2026-09-06T01:00:00Z", selectedCount: 1 } });
    }
    if (url.endsWith("/api/public-album/client-friendly-link")) return response({ album, tenantSlug: null, sessionKey: "gallery-secure-test-session-123" });
    return response({});
  });
  vi.stubGlobal("fetch", fetcher);
  const gallery = () => render(<MemoryRouter initialEntries={["/gallery/client-friendly-link"]}><Routes><Route path="/gallery/:albumId" element={<AlbumDetail />} /></Routes></MemoryRouter>);
  const first = gallery();
  await screen.findByRole("heading", { name: "Proofing Gallery" });
  fireEvent.click(screen.getByRole("button", { name: "Select Photo 1" }));
  fireEvent.change(screen.getByLabelText("Note for your photographer"), { target: { value: "Please keep the warm tones." } });
  await waitFor(() => expect(Object.keys(localStorage).some(key => key.startsWith("wv_proofing_draft:") && localStorage.getItem(key)?.includes("warm tones"))).toBe(true));
  first.unmount();
  gallery();
  await screen.findByRole("heading", { name: "Proofing Gallery" });
  expect(screen.getByRole("button", { name: "Deselect Photo 1" })).toBeInTheDocument();
  expect(screen.getByLabelText("Note for your photographer")).toHaveValue("Please keep the warm tones.");
  fireEvent.click(screen.getByRole("button", { name: "Submit selection" }));
  await screen.findByText("Your selections are safely submitted");
  const submission = fetcher.mock.calls.find(call => String(call[0]).endsWith("/api/proofing/submit"));
  expect(JSON.parse(String(submission?.[1]?.body))).toMatchObject({ albumId: "canonical-id", selectedPhotoIds: ["one"], clientNote: "Please keep the warm tones.", roundNumber: 1 });
  expect(Object.keys(localStorage).filter(key => key.startsWith("wv_proofing_draft:"))).toHaveLength(0);
});
