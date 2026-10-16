// setList.ts — the PLAYLIST the surface names, resolved against the cache on the chosen
// machine. Two failures are kept apart on purpose: a set list that will not parse, and a song
// this machine has not got yet. See ../../docs/setList.md.

import {
  findSong,
  type ResolvedItem,
  resolveItems,
} from "@studio/mediatek/playlistItems";
import type { MediatekEntry } from "@studio/mediatek/types";
import { parsePlaylist } from "@studio/song-schema/playlist";

/** One line of the set list: what the playlist named, and what this machine can play of it. */
export interface SetEntry {
  /** As written in the playlist — its path under `songs/`, or the bare name somebody typed. */
  ref: string;
  /** The médiathèque id — the resolved entry's, else `songs/<ref>`, which is what the sync would fetch. */
  id: string;
  /** What to show — the catalogue's title when the cache holds it, else the ref's last segment. */
  name: string;
  /** Who it is by, when the tags said. Null rather than "" so a label can leave the line out. */
  artist: string | null;
  /** The version the line asked for — shown beside the title, since playing the master would be a lie. */
  variant?: string;
  /** The audio INSIDE the song's folder, master or variant — its own field, so a caller cannot play the master. */
  file: string | null;
  /** The catalogued entry, or null when this machine's cache has not got it YET. */
  entry: MediatekEntry | null;
}

export interface SetList {
  entries: SetEntry[];
  /** What the playlist said that could not be read, one line per problem. Empty when it read. */
  issues: string[];
  /** The surface names NO playlist — distinct from an empty one and from a missing one (docs/setList.md). */
  absent: boolean;
}

/** A string as the browser SEARCHES it: lower case, accents folded — a DJ types `alizee`. */
export function fold(s: string): string {
  // The combining-marks block as escapes: the literal characters are invisible in an editor.
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** The set's songs as the browser shows them: every term anywhere, sorted by ARTIST — docs/songBrowser.md. */
export function browseSongs(entries: SetEntry[], query: string): SetEntry[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  const hit = (s: SetEntry) => {
    const hay = fold(`${s.artist ?? ""} ${s.name}`);
    return terms.every((t) => hay.includes(t));
  };
  const cmp = (a: string, b: string) =>
    a.localeCompare(b, "fr", { sensitivity: "base", numeric: true });
  return entries
    .filter(hit)
    .sort((a, b) => cmp(a.artist ?? "", b.artist ?? "") || cmp(a.name, b.name));
}

/** The set list of a desk whose surface names no playlist — shared, so three call sites cannot drift. */
export const NO_PLAYLIST: SetList = { entries: [], issues: [], absent: true };

/** One resolved line as the desk's row. Split out so the map below reads as one thing. */
function entryOf(r: ResolvedItem, entries: MediatekEntry[]): SetEntry {
  const ref = r.item.song.replace(/^\/+|\/+$/g, "");
  // The id the cache would file it under: the resolved entry's, else the ref read as one.
  const id = r.song?.id ?? (ref.startsWith("songs/") ? ref : `songs/${ref}`);
  const artist = r.song?.meta?.artist;
  return {
    ref,
    id,
    name: r.song?.name || (ref.split("/").pop() ?? ref),
    // The id's SECOND segment is the artist FOLDER — not a guess, and all there is without tags.
    artist: (typeof artist === "string" && artist) || id.split("/")[1] || null,
    ...(r.item.variant ? { variant: r.item.variant } : {}),
    file: r.take?.file ?? null,
    entry: r.song ?? findSong(ref, entries) ?? null,
  };
}

/** What NAMES a row: the VARIANT is part of it, since a master and its instrumental are two records. */
export const entryKey = (ref: string, variant?: string): string =>
  `${ref.replace(/^\/+|\/+$/g, "")}\u0000${variant ?? ""}`;

/** The row a dragged playlist line means, or undefined when this set list does not carry it. */
export function entryForDrag(
  entries: readonly SetEntry[],
  drag: { song: string; variant?: string },
): SetEntry | undefined {
  const want = entryKey(drag.song, drag.variant);
  return entries.find((e) => entryKey(e.ref, e.variant) === want);
}

/** Resolve a playlist against a catalogue listing — every ref kept, duplicates dropped. See docs/setList.md. */
export function resolveSet(
  text: string | null,
  entries: MediatekEntry[],
): SetList {
  if (text === null)
    return {
      entries: [],
      absent: false,
      issues: ["the playlist this surface names cannot be found"],
    };

  const parsed = parsePlaylist(text);
  if (parsed === null)
    return {
      entries: [],
      absent: false,
      issues: ["this file does not read as a playlist"],
    };

  const seen = new Set<string>();
  const out: SetEntry[] = [];
  for (const r of resolveItems(parsed.items, entries)) {
    const row = entryOf(r, entries);
    const key = entryKey(row.ref, row.variant);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return { entries: out, absent: false, issues: [] };
}
