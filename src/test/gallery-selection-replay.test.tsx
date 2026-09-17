import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Album } from "@/lib/types";
import { selectionStorageKey, useGallerySelection } from "@/hooks/use-gallery-selection";

const captured = vi.hoisted(() => ({ updates: [] as Array<(state: unknown) => unknown> }));
vi.mock("react", async importOriginal => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useState: (initial: unknown) => {
    const [state, setState] = react.useState(initial);
    return [state, (update: unknown) => {
      if (typeof update === "function") captured.updates.push(update as (state: unknown) => unknown);
      setState(update);
    }];
  } };
});
afterEach(() => { cleanup(); localStorage.clear(); captured.updates.length = 0; });

it("keeps hydration deterministic when React replays it after a click was persisted", () => {
  const album = { id: "replay", photos: [{ id: "one" }] } as Album;
  renderHook(() => useGallerySelection(album, "session", true));
  const restore = captured.updates[0];
  const initial = { key: null, ids: new Set<string>() };
  const first = restore(initial);
  localStorage.setItem(selectionStorageKey(album.id, "session"), JSON.stringify({ savedAt: Date.now(), photoIds: ["one"] }));
  expect(restore(initial)).toEqual(first);
});
