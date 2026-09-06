import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { readGallerySelection, selectionStorageKey, useGallerySelection } from "@/hooks/use-gallery-selection";
import type { Album } from "@/lib/types";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
const album = { id: "canonical", photos: [{ id: "one" }, { id: "hidden", hidden: true }, { id: "reject", cull: { status: "reject" } }] } as Album;
it("restores only authorised visible choices, persists changes and clears deliberately", async () => {
  const key = selectionStorageKey(album.id, "session-one");
  localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), photoIds: ["one", "hidden", "reject", "deleted"] }));
  const first = renderHook(() => useGallerySelection(album, "session-one", true));
  await waitFor(() => expect([...first.result.current.selectedIds]).toEqual(["one"]));
  expect(JSON.parse(localStorage.getItem(key)!).photoIds).toEqual(["one"]);
  first.unmount();
  const second = renderHook(() => useGallerySelection(album, "session-one", true));
  expect(second.result.current.selectedIds.has("one")).toBe(true);
  act(() => second.result.current.setSelectedIds(new Set()));
  await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
});
it("separates sessions and albums and never loads choices before gallery access", () => {
  localStorage.setItem(selectionStorageKey(album.id, "s1"), JSON.stringify({ savedAt: Date.now(), photoIds: ["one"] }));
  const hook = renderHook(({ session, enabled }) => useGallerySelection(album, session, enabled), { initialProps: { session: "s1", enabled: false } });
  expect(hook.result.current.selectedIds.size).toBe(0);
  hook.rerender({ session: "s2", enabled: true });
  expect(hook.result.current.selectedIds.size).toBe(0);
  hook.rerender({ session: "s1", enabled: true });
  expect(hook.result.current.selectedIds.has("one")).toBe(true);
  expect(selectionStorageKey("other", "s1")).not.toBe(selectionStorageKey(album.id, "s1"));
});
it("tolerates blocked storage and ignores expired or malformed drafts", () => {
  const key = selectionStorageKey(album.id, "s");
  localStorage.setItem(key, JSON.stringify({ savedAt: 1, photoIds: ["one"] }));
  expect(readGallerySelection(key, new Set(["one"])).size).toBe(0);
  localStorage.setItem(key, "broken");
  expect(readGallerySelection(key, new Set(["one"])).size).toBe(0);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disabled"); });
  const hook = renderHook(() => useGallerySelection(album, "s", true));
  act(() => hook.result.current.setSelectedIds(new Set(["one"])));
  expect(hook.result.current.selectionSaved).toBe(false);
  expect(hook.result.current.selectedIds.has("one")).toBe(true);
});
