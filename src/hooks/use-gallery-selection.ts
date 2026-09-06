import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Album } from "@/lib/types";

export const selectionStorageKey = (albumId: string, sessionKey: string) => `wv_gallery_selection:v1:${encodeURIComponent(albumId)}:${encodeURIComponent(sessionKey)}`;
const MAX_AGE = 30 * 86400000;

export function readGallerySelection(key: string, allowed: Set<string>): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    if (!value || !Number.isFinite(value.savedAt) || Date.now() - value.savedAt > MAX_AGE || !Array.isArray(value.photoIds)) return new Set();
    return new Set(value.photoIds.filter((id: unknown): id is string => typeof id === "string" && allowed.has(id)));
  } catch { return new Set(); }
}

/** Stores choices only. Access and purchase rights always come from the server. */
export function useGallerySelection(album: Album | undefined, sessionKey: string, enabled: boolean) {
  const key = enabled && album && sessionKey ? selectionStorageKey(album.id, sessionKey) : null;
  const allowed = useMemo(() => new Set((album?.photos || []).filter(photo => !photo.hidden && (album?.showCullRejectsToClient || photo.cull?.status !== "reject")).map(photo => photo.id)), [album?.photos, album?.showCullRejectsToClient]);
  const [selection, setSelection] = useState<{ key: string | null; ids: Set<string> }>({ key: null, ids: new Set() });
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    if (!key) return;
    setSelection(previous => previous.key === key ? previous : { key, ids: readGallerySelection(key, allowed) });
  }, [key, allowed]);
  useEffect(() => {
    if (!key || selection.key !== key) return;
    const ids = [...selection.ids].filter(id => allowed.has(id));
    if (ids.length !== selection.ids.size) {
      setSelection({ key, ids: new Set(ids) });
      return;
    }
    try {
      if (ids.length) localStorage.setItem(key, JSON.stringify({ photoIds: ids, savedAt: Date.now() }));
      else localStorage.removeItem(key);
      setSaved(true);
    } catch { setSaved(false); }
  }, [selection, key, allowed]);
  const setSelectedIds: Dispatch<SetStateAction<Set<string>>> = useCallback(update => {
    setSelection(previous => {
      const ids = previous.key === key ? previous.ids : new Set<string>();
      return { key, ids: typeof update === "function" ? update(ids) : update };
    });
  }, [key]);
  return { selectedIds: selection.key === key ? selection.ids : new Set<string>(), setSelectedIds, selectionSaved: saved };
}
