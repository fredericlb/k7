// songSource.ts — where an opened song is read and where it is written. On the phone a song the server holds is
// edited THERE, through the forward, and read there while it answers; away, its local copy is read and nothing is
// written. Elsewhere every song is the pages' library's. The song page's parts read it from context. See ../docs/songSource.md.

import { createContext, useContext } from "react";
import { type LibraryClient, library } from "./api";

/** Where a song is, from this machine: on both, here alone, or on the server alone. */
export type SongPlace = "synced" | "local" | "server";

/** Which side a song's reads and writes go to; null is "nowhere": unopenable, or read-only. */
export interface SongSide {
  read: "local" | "server" | null;
  write: "local" | "server" | null;
}

/** The whole rule: on demand only, a server song is the server's while it answers and its local copy's when not. */
export function songSide(p: {
  place: SongPlace | null;
  onDemand: boolean;
  /** Null while the backend has not said yet. */
  reachable: boolean | null;
}): SongSide {
  if (!p.onDemand || p.place === null || p.place === "local")
    return { read: "local", write: "local" };
  if (p.place === "server")
    return p.reachable === false
      ? { read: null, write: null }
      : { read: "server", write: "server" };
  // On both: the local copy while the answer is unknown, so an offline start never waits on the server.
  if (p.reachable === true) return { read: "server", write: "server" };
  return { read: "local", write: p.reachable === null ? "server" : null };
}

export interface SongSource {
  read: LibraryClient;
  /** Null: the song is read-only here, and `readOnly` says why. */
  write: LibraryClient | null;
  readOnly: string | null;
  /** The base its audio streams from when it is not on this machine; unset when it is. */
  streamBase?: string;
  /** An edit landed on the server's version: the local copy is refreshed in the background. */
  afterWrite: () => void;
}

/** What a song page reads where no source was given: the pages' own library, read and written. */
const PAGES: SongSource = {
  read: library,
  write: library,
  readOnly: null,
  afterWrite: () => {},
};

const SongSourceContext = createContext<SongSource>(PAGES);

export const SongSourceProvider = SongSourceContext.Provider;

export const useSongSource = (): SongSource => useContext(SongSourceContext);
