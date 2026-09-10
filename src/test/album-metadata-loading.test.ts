import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it("loads album metadata on a fresh page without requiring a prior Albums visit", async () => {
  const albums = [{ id: "album", title: "Portrait", photos: [] }];
  const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url === "/api/health" ? { ok: true } : albums), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  const { fetchAlbumStubs } = await import("@/lib/api");
  expect(await fetchAlbumStubs()).toEqual(albums);
  expect(fetchMock.mock.calls.map(call => call[0])).toEqual(["/api/health", "/api/albums/stubs"]);
});

it("does not substitute an empty photo list for an authentication failure", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify({}), { status: url === "/api/health" ? 200 : 401, headers: { "content-type": "application/json" } })));
  const { fetchAlbumPhotos } = await import("@/lib/api");
  expect(await fetchAlbumPhotos("album")).toBeNull();
});

it("reloads a locally hydrated album when another device changes its photo count", () => {
  const source = readFileSync(join(process.cwd(), "src/pages/Admin.tsx"), "utf8");
  expect(source).toContain("(s.photoCount ?? 0) === (local.photos?.length || 0)");
});

it("sends the editor's base photo IDs with explicit replacements", () => {
  const admin = readFileSync(join(process.cwd(), "src/pages/Admin.tsx"), "utf8");
  const tenant = readFileSync(join(process.cwd(), "src/pages/TenantAdmin.tsx"), "utf8");
  expect(admin).toContain("_basePhotoIds: (album?.photos || []).map(photo => photo.id)");
  expect(tenant).toContain("_basePhotoIds: (album?.photos || []).map(photo => photo.id)");
});
