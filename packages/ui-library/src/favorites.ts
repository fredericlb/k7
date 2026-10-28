// favorites.ts — the songs and albums on this account's lists — its favorites, its practice list —
// which order the songs' table. An item is a library path (`songs/Artist/Album[/Title]`), kept by the account's server, every device alike.
// The one thing a reader would get wrong: a song shows when IT or ANY folder above it is starred (../docs/library.md).

import { fetchWithin, readJson } from "@studio/http-client/call";
import type { MediatekEntry } from "@studio/mediatek/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiBase, libraryConfig } from "./config";
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

/** What a list call may take: on a paired machine it waits on the server. */
const FAVORITES_MS = 15_000;

/** An account's lists of songs and albums: the stars, and what it is practising. */
export type PathList = "favorites" | "practice";

/** `/api/favorites` or `/api/practice` on the host's backend, which asks the account's server when it is paired (../docs/library.md). */
async function listCall(
  kind: PathList,
  body?: {
    paths: string[];
    favorite: boolean;
  },
): Promise<string[]> {
  const res = await fetchWithin(
    `${apiBase()}/api/${kind}`,
    body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
    FAVORITES_MS,
    (s) => new Error(libraryConfig().noAnswer(s)),
  );
  return (await readJson<Record<PathList, string[]>>(res, kind))[kind] ?? [];
}

/** The account's favorites, `ready` once read — a star offered before that would not reflect the list. */
export const useFavorites = (onError: (message: string) => void) =>
  usePathList("favorites", onError);

/** …and its practice list, the same kind of list (../docs/library.md). */
export const usePractice = (onError: (message: string) => void) =>
  usePathList("practice", onError);

/** One of the account's lists, `ready` once read, toggled one path at a time in click order. */
function usePathList(kind: PathList, onError: (message: string) => void) {
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(new Set());
  const [ready, setReady] = useState(false);
  const current = useRef<ReadonlySet<string>>(favorites);
  // One write at a time, so the server sees the clicks in the order they were made.
  const writing = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const adopt = useCallback((list: string[]) => {
    current.current = new Set(list);
    setFavorites(current.current);
    setReady(true);
  }, []);
  // Read again whenever the tab comes back, so a star made on another device shows; never over a write in flight.
  const reload = useCallback(() => {
    if (pending.current) return;
    listCall(kind)
      .then((list) => {
        if (!pending.current) adopt(list);
      })
      .catch(() => {});
  }, [adopt, kind]);
  useEffect(() => {
    reload();
    const onShow = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [reload]);
  const toggle = useCallback(
    (path: string) => {
      const next = new Set(current.current);
      const favorite = !next.delete(path);
      if (favorite) next.add(path);
      current.current = next;
      setFavorites(next);
      pending.current++;
      writing.current = writing.current
        .then(() => listCall(kind, { paths: [path], favorite }))
        .then(
          (list) => {
            if (--pending.current === 0) adopt(list);
          },
          (e: Error) => {
            onError(e.message);
            // The screen showed a change that did not land: take the stored list back.
            if (--pending.current === 0) reload();
          },
        );
    },
    [onError, adopt, reload, kind],
  );
  return { favorites, ready, toggle };
}

/** Both lists, which order the songs' table and which its rows' menus toggle. */
export function useSongLists(onError: (message: string) => void) {
  return { fav: useFavorites(onError), practice: usePractice(onError) };
}
