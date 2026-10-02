import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it("requests a bounded indexed page with filters, stable offset, and a revision", async () => {
  const page = { photos: [{ id: "p1", src: "/uploads/p1.jpg", title: "Portrait", source: "Album" }], total: 121, offset: 60, limit: 60, revision: 9, hasMore: true };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input) === "/api/health" ? { ok: true } : page), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  const { fetchAdminPhotoPage } = await import("@/lib/api");
  const result = await fetchAdminPhotoPage({ source: "album", albumId: "album/1", q: "portrait", dateFrom: "2026-01-01", size: "medium", sort: "name-asc", offset: 60, limit: 60, revision: 9 });
  expect(result).toMatchObject({ total: 121, offset: 60, limit: 60, revision: 9, hasMore: true });
  const request = String(fetchMock.mock.calls.at(-1)?.[0]);
  expect(request).toContain("/api/admin/photos?");
  expect(request).toContain("albumId=album%2F1");
  expect(request).toContain("offset=60");
  expect(request).toContain("limit=60");
  expect(request).toContain("revision=9");
  expect(request).toContain("sort=name-asc");
});

it("returns null instead of treating a stale page response as an empty library", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input) === "/api/health" ? { ok: true } : { error: "stale", stale: true }), { status: String(input) === "/api/health" ? 200 : 409, headers: { "content-type": "application/json" } })));
  const { fetchAdminPhotoPage } = await import("@/lib/api");
  expect(await fetchAdminPhotoPage({ offset: 60, limit: 60, revision: 8 })).toBeNull();
});

it("loads selected records by scoped IDs and posts bounded targeted mutations", async () => {
  const seenRequests: Array<[string, RequestInit | undefined]> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seenRequests.push([url, init]);
    const body = url === "/api/health" ? { ok: true }
      : url === "/api/admin/photos/records" ? { photos: [{ id: "p1", src: "/uploads/p1.jpg", title: "Portrait" }], requested: 1, missing: 0 }
        : { ok: true, changed: 1, deletedFileCandidates: [] };
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  const { fetchAdminPhotoRecords, mutateAdminPhotos } = await import("@/lib/api");
  const records = await fetchAdminPhotoRecords([{ id: "p1", sourceAlbumId: "album-a" }]);
  expect(records).toEqual([{ id: "p1", src: "/uploads/p1.jpg", title: "Portrait" }]);
  const recordsRequest = seenRequests.find(([url]) => url === "/api/admin/photos/records");
  expect(JSON.parse(String(recordsRequest?.[1]?.body))).toEqual({ items: [{ id: "p1", sourceAlbumId: "album-a" }] });

  const mutation = await mutateAdminPhotos([{ type: "star", photoId: "p1", sourceType: "album", albumId: "album-a", starred: true }]);
  expect(mutation).toMatchObject({ ok: true, changed: 1 });
  const mutationRequest = seenRequests.find(([url]) => url === "/api/admin/photos/mutations");
  expect(JSON.parse(String(mutationRequest?.[1]?.body))).toEqual({
    operations: [{ type: "star", photoId: "p1", sourceType: "album", albumId: "album-a", starred: true }],
  });
});

it("does not load album or photo arrays in the ordinary startup store sync", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => new Response(
    JSON.stringify(String(input) === "/api/health" ? { ok: true } : {}),
    { headers: { "content-type": "application/json" } },
  ));
  vi.stubGlobal("fetch", fetchMock);
  const { syncFromServer } = await import("@/lib/api");
  await expect(syncFromServer({ awaitLazy: true })).resolves.toBe(true);
  const storeQueries = fetchMock.mock.calls.map(([input]) => String(input)).filter(url => url.startsWith("/api/store?keys="));
  expect(storeQueries).toHaveLength(2);
  expect(storeQueries.every(url => !url.includes("wv_photo_library") && !url.includes("wv_albums"))).toBe(true);
});
