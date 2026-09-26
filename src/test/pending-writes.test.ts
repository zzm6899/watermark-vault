import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readPendingWrites } from "@/lib/pending-writes";

beforeEach(() => { localStorage.clear(); vi.resetModules(); vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("restores store and per-album writes after reload and removes only acknowledged work", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new Error("offline")); vi.stubGlobal("fetch", fetchMock);
  let api = await import("@/lib/api");
  api.persistToServer("wv_profile", { name: "Offline studio" });
  api.persistAlbumToServer("album-one", { id: "album-one", title: "Offline gallery", photos: [] } as never);
  await api.retryPendingWrites();
  expect(readPendingWrites()).toHaveLength(2);
  vi.clearAllTimers(); vi.resetModules();
  api = await import("@/lib/api");
  fetchMock.mockImplementation(async (url: string) => ({ ok: !url.includes("album-one"), status: url.includes("album-one") ? 403 : 200 }));
  await api.retryPendingWrites();
  expect(readPendingWrites().map(row => row.key)).toEqual(["album:album-one"]);
  expect(readPendingWrites()[0].error).toMatch(/Sign in/);
  expect(fetchMock).toHaveBeenCalledWith("/api/store/wv_profile", expect.objectContaining({ body: JSON.stringify({ value: { name: "Offline studio" } }) }));
  fetchMock.mockResolvedValue({ ok: true });
  await api.retryPendingWrites();
  expect(readPendingWrites()).toEqual([]);
});

it("retains newer edits while an older save is in flight and keeps credentials out of durable drafts", async () => {
  let release!: (value: { ok: boolean }) => void;
  const fetchMock = vi.fn().mockImplementation(async (url: string) => url === "/api/health" ? { ok: true } : new Promise(resolve => { release = resolve; }));
  vi.stubGlobal("fetch", fetchMock);
  const api = await import("@/lib/api");
  api.persistToServer("wv_settings", { label: "old", smtpPassword: "PRIVATE_PASSWORD" });
  expect(localStorage.getItem("wv_pending_writes_v1")).not.toContain("PRIVATE_PASSWORD");
  expect(readPendingWrites()[0].requiresCredentials).toBe(true);
  const flushing = api.retryPendingWrites();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  api.persistToServer("wv_settings", { label: "new" });
  fetchMock.mockResolvedValue({ ok: false, status: 503 });
  release({ ok: true }); await flushing;
  expect(readPendingWrites()[0].value).toEqual({ label: "new" });
  expect(readPendingWrites()[0].error).toMatch(/503/);
});
