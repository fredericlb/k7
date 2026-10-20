// favorites.ts — the songs and albums this account starred, and the filter that shows only them.
// A favorite is a library path (`songs/Artist/Album[/Title]`), kept in the account's preferences.
// The one thing a reader would get wrong: a song shows when IT or ANY folder above it is starred (../docs/library.md).

import type { MediatekEntry } from "@studio/mediatek/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { engines } from "./api";
import { isSong, relative } from "./libraryTree";

/** Is this path starred, itself or through a folder above it? */
export function isFavorite(
  favorites: ReadonlySet<string>,
  path: string,
): boolean {
  for (let p = path; p; p = p.slice(0, Math.max(0, p.lastIndexOf("/"))))
    if (favorites.has(p)) return true;
  return false;
}

/** Only the entries a favorite covers. */
export function favoriteEntries(
  entries: MediatekEntry[] | null,
  favorites: ReadonlySet<string>,
): MediatekEntry[] {
  return (entries ?? []).filter((e) => isFavorite(favorites, e.path));
}

/** An ALBUM row: a folder that directly holds a song, `rel` being family-relative. */
export function isAlbumFolder(
  entries: MediatekEntry[] | null,
  rel: string,
): boolean {
  if (!rel) return false;
  return (entries ?? []).some((e) => {
    if (!isSong(e)) return false;
    const r = relative(e.path);
    return r.startsWith(`${rel}/`) && !r.slice(rel.length + 1).includes("/");
  });
}

/** The account's favorites, `ready` once read — a toggle before that would write over the stored list. */
export function useFavorites(onError: (message: string) => void) {
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(new Set());
  const [ready, setReady] = useState(false);
  const current = useRef<ReadonlySet<string>>(favorites);
  // One write at a time, each with its own snapshot, so the last click is the one stored.
  const writing = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    let live = true;
    engines()
      .prefs()
      .then((p) => {
        if (!live) return;
        current.current = new Set(p?.favorites ?? []);
        setFavorites(current.current);
        setReady(true);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const toggle = useCallback(
    (path: string) => {
      const next = new Set(current.current);
      if (!next.delete(path)) next.add(path);
      current.current = next;
      setFavorites(next);
      // Read-merge-write on the server's copy, never a cached one, so another field set elsewhere survives.
      writing.current = writing.current
        .then(() => engines().patchPrefs({ favorites: [...next].sort() }))
        .catch((e: Error) => onError(e.message));
    },
    [onError],
  );
  return { favorites, ready, toggle };
}

const ONLY_KEY = "k7.library.favoritesOnly";

/** Whether the tree shows only favorites — this browser's choice, remembered where it can be. */
export function useFavoritesOnly(): [boolean, (on: boolean) => void] {
  const [only, setOnly] = useState(() => {
    try {
      return localStorage.getItem(ONLY_KEY) === "1";
    } catch {
      return false;
    }
  });
  const set = useCallback((on: boolean) => {
    setOnly(on);
    try {
      localStorage.setItem(ONLY_KEY, on ? "1" : "0");
    } catch {}
  }, []);
  return [only, set];
}
