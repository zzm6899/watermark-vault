import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Admin from "@/pages/Admin";
import type { Album, Photo } from "@/lib/types";
import * as api from "@/lib/api";

const photo = (id: string, title = id): Photo => ({
  id,
  src: `data:image/gif;base64,${id}`,
  thumbnail: `data:image/gif;base64,${id}`,
  title,
  width: 1,
  height: 1,
});

const album = (id: string, title: string, photos: Photo[]): Album => ({
  id,
  slug: id,
  title,
  description: "",
  coverImage: "",
  date: "2026-01-01",
  photoCount: photos.length,
  freeDownloads: 0,
  pricePerPhoto: 0,
  priceFullAlbum: 0,
  isPublic: false,
  photos,
});

function renderPhotoLibrary() {
  return render(
    <MemoryRouter initialEntries={["/admin/photos"]}>
      <Routes>
        <Route path="/admin/:tab" element={<Admin />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("wv_setup_complete", "true");
  localStorage.setItem("wv_session", "true");
  localStorage.setItem("wv_albums", "[]");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, isSuperAdmin: false }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })));
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
  await api.recheckServer();
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function activateIndexedServer(
  rows: Array<Photo & { source: string; sourceAlbumId?: string }>,
  stubs: Album[],
) {
  const albumStubRequest = vi.spyOn(api, "fetchAlbumStubs").mockResolvedValue(stubs);
  const summaryRequest = vi.spyOn(api, "fetchAdminPhotoSummary").mockResolvedValue({
    all: rows.length,
    library: rows.filter(row => !row.sourceAlbumId).length,
    unassigned: rows.filter(row => !row.sourceAlbumId).length,
    starred: 0,
    albumMemberships: rows.filter(row => row.sourceAlbumId).length,
    revision: 1,
  });
  const pageRequest = vi.spyOn(api, "fetchAdminPhotoPage").mockImplementation(async (query = {}) => {
    let filtered = rows;
    if (query.source === "album") filtered = filtered.filter(row => row.sourceAlbumId === query.albumId);
    if (query.source === "library") filtered = filtered.filter(row => !row.sourceAlbumId);
    if (query.filterAlbumId) filtered = filtered.filter(row => row.sourceAlbumId === query.filterAlbumId);
    if (query.q) {
      const needle = query.q.toLowerCase();
      filtered = filtered.filter(row => `${row.title} ${row.src} ${row.source}`.toLowerCase().includes(needle));
    }
    if (query.starred) filtered = filtered.filter(row => row.starred);
    if (query.size) {
      filtered = filtered.filter(row => {
        const size = row.fileSize;
        if (size == null) return true;
        if (query.size === "small") return size < 5 * 1024 * 1024;
        if (query.size === "medium") return size >= 5 * 1024 * 1024 && size <= 15 * 1024 * 1024;
        return size > 15 * 1024 * 1024;
      });
    }
    if (query.dateFrom) filtered = filtered.filter(row => !row.takenAt && !row.uploadedAt || String(row.takenAt || row.uploadedAt).slice(0, 10) >= query.dateFrom!);
    if (query.dateTo) filtered = filtered.filter(row => !row.takenAt && !row.uploadedAt || String(row.takenAt || row.uploadedAt).slice(0, 10) <= query.dateTo!);
    const offset = query.offset || 0;
    const limit = query.limit || 60;
    return {
      photos: filtered.slice(offset, offset + limit),
      total: filtered.length,
      offset,
      limit,
      revision: 1,
      hasMore: offset + limit < filtered.length,
    };
  });
  await api.recheckServer();
  return { albumStubRequest, summaryRequest, pageRequest };
}

describe("admin photo library workflow", () => {
  it("renders photos in bounded batches and exposes a direct load-more action", async () => {
    const manyPhotos = Array.from({ length: 65 }, (_, index) => photo(`photo-${index}`, `Photo ${index}`));
    localStorage.setItem("wv_albums", JSON.stringify([album("session", "Session", manyPhotos)]));
    renderPhotoLibrary();

    await screen.findByText("Showing 60 of 65 photos");
    expect(screen.getAllByRole("button", { name: /^Select Photo/ })).toHaveLength(60);
    fireEvent.click(screen.getByRole("button", { name: "Load 5 more photos" }));
    await waitFor(() => expect(screen.getByText("Showing 65 of 65 photos")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: /^Select Photo/ })).toHaveLength(65);
    expect(screen.queryByRole("button", { name: /Load .* more photos/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Select Photo 0" }));
    const search = screen.getByPlaceholderText(/Search by filename/);
    fireEvent.change(search, { target: { value: "Photo 64" } });
    await waitFor(() => expect(screen.getByText("Showing 1 of 1 photos")).toBeInTheDocument());
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "" } });
    await waitFor(() => expect(screen.getByText("Showing 60 of 65 photos")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Deselect Photo 0" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Load 5 more photos" })).toBeInTheDocument();
  }, 15000);

  it("keeps grid rendering bounded and in source order for a thousand-photo fixture", async () => {
    const thousandPhotos = Array.from({ length: 1000 }, (_, index) => photo(`photo-${String(index).padStart(4, "0")}`, `Photo ${String(index).padStart(4, "0")}`));
    localStorage.setItem("wv_albums", JSON.stringify([album("large-session", "Large Session", thousandPhotos)]));
    renderPhotoLibrary();

    await screen.findByText("Showing 60 of 1000 photos");
    expect(screen.getAllByRole("button", { name: /^Select Photo/ })).toHaveLength(60);
    expect(screen.getByRole("button", { name: "Select Photo 0000" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Photo 0059" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select Photo 0060" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Load 60 more photos" }));
    await waitFor(() => expect(screen.getByText("Showing 120 of 1000 photos")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: /^Select Photo/ })).toHaveLength(120);
    expect(screen.getByRole("button", { name: "Select Photo 0119" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select Photo 0120" })).not.toBeInTheDocument();
  }, 20000);

  it("shows only the photos belonging to the chosen album chip", async () => {
    localStorage.setItem("wv_albums", JSON.stringify([
      album("alpha", "Alpha", [photo("alpha-photo", "Alpha portrait")]),
      album("beta", "Beta", [photo("beta-photo", "Beta portrait")]),
    ]));
    renderPhotoLibrary();
    await screen.findByRole("button", { name: "Select Alpha portrait" });
    fireEvent.click(screen.getByRole("button", { name: "Beta (1)" }));

    expect(screen.getByRole("button", { name: "Select Beta portrait" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select Alpha portrait" })).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 1 photos")).toBeInTheDocument();
  });

  it("uses indexed pages on server startup without hydrating albums or fetching a full library snapshot", async () => {
    const rows = Array.from({ length: 1000 }, (_, index) => ({
      ...photo(`server-${String(index).padStart(4, "0")}`, `Server Photo ${String(index).padStart(4, "0")}`),
      source: "Session",
      sourceAlbumId: "session",
    }));
    const stubs = [{ ...album("session", "Session", []), photoCount: rows.length, _photosStripped: true }];
    const fetchPhotos = vi.spyOn(api, "fetchAlbumPhotos").mockResolvedValue(null);
    const fullSnapshots = vi.spyOn(api, "fetchAdminPhotoSnapshots").mockResolvedValue(null);
    const { albumStubRequest, summaryRequest, pageRequest } = await activateIndexedServer(rows, stubs);
    renderPhotoLibrary();

    await screen.findByText("Showing 60 of 1000 photos");
    expect(screen.getAllByRole("button", { name: /^Select Server Photo/ })).toHaveLength(60);
    expect(screen.getByRole("button", { name: "Select Server Photo 0000" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select Server Photo 0060" })).not.toBeInTheDocument();
    expect(albumStubRequest).toHaveBeenCalledTimes(1);
    expect(summaryRequest).toHaveBeenCalledTimes(1);
    expect(pageRequest).toHaveBeenCalledTimes(1);
    expect(fetchPhotos).not.toHaveBeenCalled();
    expect(fullSnapshots).not.toHaveBeenCalled();
  });

  it("ignores an older server page after a newer search filter finishes", async () => {
    const rows = [
      { ...photo("alpha-photo", "Alpha portrait"), source: "Alpha", sourceAlbumId: "alpha" },
      { ...photo("beta-photo", "Beta portrait"), source: "Beta", sourceAlbumId: "beta" },
    ];
    const pending: Array<(page: Awaited<ReturnType<typeof api.fetchAdminPhotoPage>>) => void> = [];
    vi.spyOn(api, "fetchAlbumStubs").mockResolvedValue([
      { ...album("alpha", "Alpha", []), photoCount: 1, _photosStripped: true },
      { ...album("beta", "Beta", []), photoCount: 1, _photosStripped: true },
    ]);
    vi.spyOn(api, "fetchAdminPhotoSummary").mockResolvedValue({ all: 2, library: 0, unassigned: 0, starred: 0, albumMemberships: 2, revision: 1 });
    const pageRequest = vi.spyOn(api, "fetchAdminPhotoPage").mockImplementation((query = {}) => {
      if (!query.q) return new Promise(resolve => pending.push(resolve));
      return Promise.resolve({ photos: [rows[1]], total: 1, offset: 0, limit: 60, revision: 1, hasMore: false });
    });
    await api.recheckServer();
    renderPhotoLibrary();

    await waitFor(() => expect(pageRequest).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByPlaceholderText(/Search by filename/), { target: { value: "Beta" } });
    expect(await screen.findByRole("button", { name: "Select Beta portrait" })).toBeInTheDocument();
    pending[0]({ photos: [rows[0]], total: 2, offset: 0, limit: 60, revision: 1, hasMore: false });

    await waitFor(() => expect(pageRequest).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Showing 1 of 1 photos")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select Alpha portrait" })).not.toBeInTheDocument();
  });

  it("selects only loaded matches and preserves their contexts across pages and filters", async () => {
    const rows = Array.from({ length: 62 }, (_, index) => ({
      ...photo(`server-${String(index).padStart(4, "0")}`, `Session Photo ${String(index).padStart(4, "0")}`),
      source: "Session",
      sourceAlbumId: "session",
    }));
    const mutateRequest = vi.spyOn(api, "mutateAdminPhotos").mockResolvedValue({ ok: true, changed: 61, deletedFileCandidates: [] });
    await activateIndexedServer(rows, [{ ...album("session", "Session", []), photoCount: rows.length, _photosStripped: true }]);
    vi.stubGlobal("confirm", vi.fn(() => true));
    renderPhotoLibrary();

    await screen.findByText("Showing 60 of 62 photos");
    fireEvent.click(screen.getByRole("button", { name: "Select all 60 loaded photos" }));
    expect(screen.getByText("60 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load 2 more photos" }));
    await waitFor(() => expect(screen.getByText("Showing 62 of 62 photos")).toBeInTheDocument());
    expect(screen.getByText("60 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Session Photo 0060" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.change(screen.getByPlaceholderText(/Search by filename/), { target: { value: "Session Photo 0061" } });
    await screen.findByRole("button", { name: "Select Session Photo 0061" });
    fireEvent.click(screen.getByRole("button", { name: "Select all 1 loaded photos" }));
    expect(screen.getByText("61 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete (61)" }));

    await waitFor(() => expect(mutateRequest).toHaveBeenCalledTimes(1));
    const operations = mutateRequest.mock.calls[0][0];
    expect(operations).toHaveLength(61);
    expect(operations.every(operation => operation.type === "remove" && operation.sourceType === "album" && operation.albumId === "session")).toBe(true);
    const ids = new Set(operations.map(operation => operation.type === "remove" ? operation.photoId : ""));
    expect(ids.has("server-0000")).toBe(true);
    expect(ids.has("server-0059")).toBe(true);
    expect(ids.has("server-0061")).toBe(true);
    expect(ids.has("server-0060")).toBe(false);
    expect(ids.has("server-0119")).toBe(false);
  }, 15000);
});
