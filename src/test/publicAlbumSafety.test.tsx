import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { cleanAdminThumbnailUrl } from "@/hooks/use-backfill-thumbnails";
import AlbumDetail, { getOrCreateViewerSessionKey, isServerHostedPhotoSrc } from "@/pages/AlbumDetail";
import type { Album } from "@/lib/types";

describe("public album safety", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("uses a stable opaque identity that is isolated per album", () => {
    const first = getOrCreateViewerSessionKey("album-a");
    const repeat = getOrCreateViewerSessionKey("album-a");
    const otherAlbum = getOrCreateViewerSessionKey("album-b");

    expect(first).toBe(repeat);
    expect(first).toMatch(/^viewer-[a-f\d-]{16,}$/i);
    expect(otherAlbum).not.toBe(first);
    expect(first).not.toContain("album-a");
  });

  it("replaces a legacy predictable gallery session", () => {
    localStorage.setItem("wv_gallery_viewer_album-a", "session-album-a");
    expect(getOrCreateViewerSessionKey("album-a")).toMatch(/^viewer-/);
  });

  it("recognizes server photos even when tenant parameters are present", () => {
    expect(isServerHostedPhotoSrc("/uploads/photo.jpg?tenant=studio")).toBe(true);
    expect(isServerHostedPhotoSrc("https://example.test/uploads/photo.jpg?tenant=studio")).toBe(true);
    expect(isServerHostedPhotoSrc("data:image/jpeg;base64,abc")).toBe(false);
  });

  it("adds thumbnail parameters without corrupting an existing tenant query", () => {
    const result = cleanAdminThumbnailUrl("/uploads/photo.jpg?tenant=studio");
    expect(result).toBe("/uploads/photo.jpg?tenant=studio&size=thumb&wm=0");
    expect(result).not.toContain("??");
  });

  it("contains no public whole-album or generic store mutation path", () => {
    const sourcePath = join(process.cwd(), "src/pages/AlbumDetail.tsx");
    const source = readFileSync(sourcePath, "utf8");

    expect(source).not.toMatch(/\b(?:updateAlbum|saveTenantAlbum|persistCurrentAlbum)\s*\(/);
    expect(source).not.toContain("/api/store/");
    expect(source).not.toContain("session-${album.id}");
    expect(source).not.toContain("token-${token}");
    expect(source).toContain('method: "POST"');
    expect(source).toContain("/access");
    expect(source).toContain('url.searchParams.delete("token")');
    expect(source).toContain('/api/album/download-complete');
    expect(source).toContain('/api/album/download-request');
    expect(source).toContain('/api/album/free-unlock');
    expect(source).toContain('/original/access');
    expect(source).not.toContain('original?sessionKey=');
    expect(source).not.toContain('url.searchParams.set("sessionKey"');
    expect(source).not.toContain("getTenantSettings(");
    expect(source).not.toContain("getAlbumBySlug(");
    expect(source).toContain("useState<Album | undefined>(undefined)");
    expect(source).toContain("tenantSlug ? (tenantBankTransfer ?? DISABLED_BANK_TRANSFER)");
    expect(source).toContain("publicInfo?.bankTransfer");
    expect(source).toContain("const billableSelected = unpaidSelected.slice");
    expect(source).not.toContain("photoIds: isFullAlbumPurchase ? [] : unpaidSelected.map");
    expect(source).toContain('response.status === 428 && result.code === "DOWNLOAD_EMAIL_REQUIRED"');
    expect(source).toContain('localStorage.removeItem(`wv_download_capture_${albumId}`)');
    expect(source).toContain("setPendingDownloadIntent(intent)");
  });

  it("never downloads a non-clean server photo directly from uploads", () => {
    const source = readFileSync(join(process.cwd(), "src/pages/AlbumDetail.tsx"), "utf8");
    const resolverStart = source.indexOf("const resolveDownloadSource = async");
    const resolverEnd = source.indexOf("const downloadPhoto = async", resolverStart);
    const resolver = source.slice(resolverStart, resolverEnd);

    expect(resolverStart).toBeGreaterThan(-1);
    expect(resolverEnd).toBeGreaterThan(resolverStart);
    expect(resolver).toContain("if (!isServerHostedPhotoSrc(photo.src))");
    expect(resolver).not.toContain("!isCleanDownload(photo.id)");
    expect(resolver).toContain("/original/access");
    expect(resolver).toContain("downloadEmailCaptureId: captureId || undefined");
  });

  it("does not claim Stripe success when entitlement polling times out", () => {
    const source = readFileSync(join(process.cwd(), "src/pages/AlbumDetail.tsx"), "utf8");

    expect(source).not.toContain("Payment received —");
    expect(source).toContain("Payment is still processing and has not yet been confirmed.");
    expect(source).toContain("setStripeConfirmationDelayed(true)");
    expect(source).toContain('url.searchParams.delete("success")');
    expect(source).toContain("Check again");
  });

  it("isolates route state and uses only sanitized config on public entry", () => {
    const appSource = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    expect(appSource).toContain('fetch("/api/public/config"');
    expect(appSource).toContain('<AlbumDetail key={albumId || "missing-album"} />');
    expect(appSource).toContain("const tasks: Promise<unknown>[] = [syncPublicConfig()]");
    expect(appSource).toContain("if (!isPublicRoute() && isLoggedIn()) tasks.push(syncFromServer())");
    expect(appSource).toContain("verifyAdminSession()");
    expect(appSource).toContain('localStorage.getItem("wv_tenant_api_token")');
  });

  it("renders an expired gallery response instead of a network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 410,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ error: "This gallery has expired" }),
    }) as Response));

    render(
      <MemoryRouter initialEntries={["/gallery/expired-album"]}>
        <Routes>
          <Route path="/gallery/:albumId" element={<AlbumDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Gallery Expired" })).toBeInTheDocument();
    expect(screen.queryByText(/check your connection/i)).not.toBeInTheDocument();
  });

  it("shows a private-link error without a PIN form for token-only galleries", async () => {
    const redactedAlbum: Album = {
      id: "token-only-album",
      slug: "token-only-album",
      title: "Token-only Gallery",
      description: "",
      coverImage: "",
      date: "2026-08-08",
      photoCount: 0,
      freeDownloads: 0,
      pricePerPhoto: 0,
      priceFullAlbum: 0,
      watermarkDisabled: false,
      isPublic: true,
      enabled: true,
      photos: [],
    };
    const response = (body: unknown, status: number) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => body,
    }) as Response;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/public-album/token-only-album")) {
        return response({ protected: true, pinRequired: false, tokenRequired: true }, 401);
      }
      if (url.endsWith("/api/public-album/token-only-album/access")) {
        return response({
          album: redactedAlbum,
          tenantSlug: null,
          protected: true,
          pinRequired: false,
          tokenRequired: true,
        }, 401);
      }
      return response({}, 503);
    }));

    render(
      <MemoryRouter initialEntries={["/gallery/token-only-album"]}>
        <Routes>
          <Route path="/gallery/:albumId" element={<AlbumDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Private Link Required" })).toBeInTheDocument();
    expect(screen.getByText(/missing, invalid, or no longer active/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Gallery PIN")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unlock Gallery" })).not.toBeInTheDocument();
  });

  it("unlocks a zero-price full album before offering an all-photo download", async () => {
    const album: Album = {
      id: "free-album",
      slug: "free-album",
      title: "Free Client Gallery",
      description: "",
      coverImage: "",
      date: "2026-08-08",
      photoCount: 2,
      freeDownloads: 0,
      pricePerPhoto: 10,
      priceFullAlbum: 0,
      isPublic: true,
      enabled: true,
      photos: [
        { id: "photo-1", src: "/uploads/photo-1.jpg", title: "Photo 1", width: 1200, height: 800 },
        { id: "photo-2", src: "/uploads/photo-2.jpg", title: "Photo 2", width: 1200, height: 800 },
      ],
    };
    const response = (body: unknown, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => body,
    }) as Response;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/public-album/free-album/purchase")) return response({});
      if (url.endsWith("/api/public-album/free-album")) {
        return response({ album, tenantSlug: null, protected: false, sessionKey: "gallery-free-session-123456789" });
      }
      if (url.endsWith("/api/album/free-unlock")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({ albumId: "free-album" });
        return response({ ok: true, fullAlbum: true });
      }
      if (url.endsWith("/api/stripe/status")) return response({ configured: false });
      return response({}, 503);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter initialEntries={["/gallery/free-album"]}>
        <Routes>
          <Route path="/gallery/:albumId" element={<AlbumDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Free Client Gallery" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download Free" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/album/free-unlock",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByRole("heading", { name: "Download Options" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download ZIP (2)" })).toBeInTheDocument();
    expect(screen.getByText("Unlocked")).toBeInTheDocument();
  });

  it("loads a protected album and unlocks it without changing hook order", async () => {
    const album: Album = {
      id: "private-album",
      slug: "private-album",
      title: "Private Client Gallery",
      description: "",
      coverImage: "",
      date: "2026-08-07",
      photoCount: 1,
      freeDownloads: 1,
      pricePerPhoto: 10,
      priceFullAlbum: 20,
      watermarkDisabled: true,
      isPublic: true,
      enabled: true,
      accessCode: "__server_protected__",
      photos: [{ id: "photo-1", src: "/uploads/photo-1.jpg", title: "Photo 1", width: 1200, height: 800 }],
    };
    const response = (body: unknown, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => body,
    }) as Response;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/public-album/private-album")) {
        return response({ protected: true, requiresSession: true }, 401);
      }
      if (url.endsWith("/api/public-album/private-album/access")) {
        const request = JSON.parse(String(init?.body || "{}")) as { pin?: string };
        return request.pin === "2468"
          ? response({ album, tenantSlug: null, protected: true, sessionKey: "gallery-secure-session-123456789" })
          : response({ album: { ...album, photos: [] }, tenantSlug: null, protected: true }, 401);
      }
      return response({}, 503);
    }));

    render(
      <MemoryRouter initialEntries={["/gallery/private-album"]}>
        <Routes>
          <Route path="/gallery/:albumId" element={<AlbumDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Private Gallery" })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Enter PIN"), { target: { value: "2468" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock Gallery" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Private Client Gallery" })).toBeInTheDocument());
    const photo = screen.getByAltText("Photo 1");
    expect(photo).toBeInTheDocument();
    const previewUrl = new URL(photo.getAttribute("src") || "", "https://example.test");
    expect(previewUrl.searchParams.get("paid")).toBe("1");
    expect(previewUrl.searchParams.get("albumId")).toBe("private-album");
    expect(previewUrl.searchParams.has("sessionKey")).toBe(false);
  });
});
