// useOpenSong.ts — the song the address names, and its source: a song here, or on the phone one of the server's
// alone, read through the forward. Opening a server song there the first time also copies it down, in the
// background, as a download-manager job. See ../docs/songSource.md.

import type { MediatekEntry } from "@studio/mediatek/types";
import { useEffect, useMemo, useRef } from "react";
import { type LibraryClient, library, serverLibrary } from "./api";
import { serverBase } from "./config";
import { useLabels } from "./host";
import { entryAt, isSong, relative } from "./libraryTree";
import { folderOf } from "./routes";
import type { useServerCopy } from "./ServerCopy";
import { type SongSource, songSide } from "./songSource";

/** The opened song, null when the address names none; `source` null when it cannot be opened now. */
export function useOpenSong(
  file: string | null,
  entries: MediatekEntry[] | null,
  remote: MediatekEntry[],
  serverCopy: ReturnType<typeof useServerCopy>,
): { entry: MediatekEntry | null; source: SongSource | null } {
  const readOnly = useLabels().song.readOnly;
  const { onDemand, reachable, placeOf, refreshCopy, download } = serverCopy;
  // DERIVED from the route rather than held beside it, so a deep link needs no replay — see ../docs/routing.md.
  const found = useMemo(() => {
    const dir = folderOf(file);
    if (!dir) return null;
    const here = entryAt(entries, dir);
    if (here && isSong(here)) return here;
    // On demand, a song only the server holds opens too.
    const there = onDemand ? entryAt(remote, dir) : null;
    return there && isSong(there) ? there : null;
  }, [entries, remote, file, onDemand]);
  // A copy that just landed is no longer the server's alone, and not yet in the local listing: the song stays open meanwhile.
  const last = useRef<MediatekEntry | null>(null);
  const dir = folderOf(file);
  if (found) last.current = found;
  else if (
    !last.current ||
    relative(last.current.path) !== dir ||
    placeOf(last.current.path) !== "synced"
  )
    last.current = null;
  const entry = found ?? last.current;

  const path = entry?.path ?? null;
  const place = path ? placeOf(path) : null;
  const side = songSide({ place, onDemand, reachable });

  const source = useMemo((): SongSource | null => {
    const server = serverLibrary();
    const at = (s: "local" | "server" | null): LibraryClient | null =>
      s === "server" ? server : s === "local" ? library : null;
    const read = at(side.read);
    if (!read || !path) return null;
    const write = at(side.write);
    return {
      read,
      write,
      readOnly: write ? null : readOnly,
      // Not here yet: its audio streams from the server.
      streamBase: place === "server" ? (serverBase() ?? undefined) : undefined,
      afterWrite:
        side.write === "server" ? () => refreshCopy(path) : () => undefined,
    };
  }, [side.read, side.write, path, place, readOnly, refreshCopy]);

  // The first look at a server song copies it down; the manager's key makes a second look, or the button, the same job.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the song and its place are the trigger; `download` is re-made with every placement.
  useEffect(() => {
    if (onDemand && path && place === "server" && reachable !== false)
      void download([path]);
  }, [onDemand, path, place, reachable]);

  return { entry, source };
}
