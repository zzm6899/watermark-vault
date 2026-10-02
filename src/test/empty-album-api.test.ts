import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("empty album API", () => {
  it("sends the exact photo snapshot and revision before changing an album", async () => {
    const album = { id: "album-1", slug: "client", photos: [], photoCount: 0 };
    const fetchMock = vi.fn(async (url: string, _request?: RequestInit) => new Response(JSON.stringify(
      url === "/api/health"
        ? { ok: true }
        : { ok: true, album, removedPhotoCount: 2, cleanup: { deleted: 2, alreadyMissing: 0, shared: 0, unsafe: 0, failed: 0 }, cleanupIncomplete: false },
    ), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { emptyAlbumPhotosOnServer } = await import("@/lib/api");
    const photos = [{ id: "one", src: "/uploads/one.jpg" }, { id: "two", src: "/uploads/two.jpg" }] as import("@/lib/types").Photo[];

    const result = await emptyAlbumPhotosOnServer("album-1", photos, "revision-1", "studio-a");

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, request] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/albums/album-1/empty?tenant=studio-a");
    expect(request).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(request?.body))).toEqual({
      expectedPhotoCount: 2,
      expectedPhotos: photos.map(({ id, src }) => ({ id, src })),
      photoRevision: "revision-1",
    });
  });

  it("returns stale-target conflicts without treating them as success", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
      url === "/api/health" ? { ok: true } : { error: "Album photos changed" },
    ), { status: url === "/api/health" ? 200 : 409, headers: { "content-type": "application/json" } })));
    const { emptyAlbumPhotosOnServer } = await import("@/lib/api");
    const result = await emptyAlbumPhotosOnServer("album-1", [{ id: "one", src: "/uploads/one.jpg" } as import("@/lib/types").Photo]);
    expect(result).toMatchObject({ ok: false, error: "Album photos changed", stale: true });
  });
});
