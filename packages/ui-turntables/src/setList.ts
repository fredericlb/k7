// setList.ts — the open project's songs.yaml, resolved against the cache on the chosen
// machine. Two failures are kept apart on purpose: a set list that will not parse, and a song
// this machine has not got yet. See ../../docs/setList.md.

import type { MediatekEntry } from "@studio/mediatek/types";
import { songIdOf } from "@studio/song/songRef";
import { parseSongs, songRefs } from "@studio/song/yaml/songsFile";

/** One line of the set list: what the project named, and what this machine can play of it. */
export interface SetEntry {
  /** As written in songs.yaml. */
  ref: string;
  /** The médiathèque id — the ref with its `@mediatek/` taken off. */
  id: string;
  /** What to show. The catalogue's title when the cache holds it, else the id's last segment,
   *  which is the folder the médiathèque filed it under and the best name available. */
  name: string;
  /** Who it is by, when the sidecar's tags said. Null rather than "" so a surface can leave
   *  the line out entirely instead of drawing an empty one — a vinyl label has no room to
   *  spend on nothing. */
  artist: string | null;
  /** The catalogued entry, or null when this machine's cache has not got it YET. */
  entry: MediatekEntry | null;
}

export interface SetList {
  entries: SetEntry[];
  /** What the file said that could not be read, one line per problem. Empty when it read. */
  issues: string[];
  /** True when the project has no songs.yaml at all — a set nobody has filled in, or an l8
   *  song opened here. Distinct from an EMPTY list, which someone wrote on purpose. */
  absent: boolean;
}

export const EMPTY_SET: SetList = { entries: [], issues: [], absent: true };

/**
 * A string as the browser SEARCHES it: lower case, accents folded.
 *
 * The médiathèque is full of them — `Alizée`, `Rosé`, `& Feduk` — and a DJ typing at a desk
 * types `alizee`. Matching the raw string would make half the library unfindable by anyone
 * who does not stop to compose an é. NFD splits a letter from its accent and the range strip
 * drops the accent, which is the whole trick.
 */
export function fold(s: string): string {
  // The combining-marks block, spelled as escapes: the literal characters are invisible in
  // an editor, and a regex nobody can see the contents of is one nobody can review.
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * The set's songs as the browser shows them: filtered by `query`, then sorted by ARTIST and
 * title.
 *
 * Every term has to appear somewhere in "artist title", in any ORDER — so `bashung nuit`
 * finds *La nuit je mens* without knowing which field holds which word. A single substring
 * over the joined string would fail that, and searching one field at a time would fail it
 * twice.
 *
 * Sorted with `localeCompare` in French rather than by code point: `É` sorts after `E` and
 * before `F` where a raw comparison files every accented artist after `Z`. `numeric` so
 * `Track 2` precedes `Track 10`.
 */
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

/**
 * Resolve a set list against a catalogue listing.
 *
 * The ref is kept whatever happens. A song the cache has not got is a REAL and ordinary state
 * — the sync fetches what the open project names, so a set edited a minute ago is briefly
 * ahead of the disk — and it must draw as a song that is coming, not vanish from the list.
 * Dropping it would make a set list that is missing three songs indistinguishable from one
 * that never had them.
 */
export function resolveSet(text: string, entries: MediatekEntry[]): SetList {
  const { value, issues } = parseSongs(text);
  if (issues.length)
    return {
      entries: [],
      absent: false,
      issues: issues.map((i) =>
        i.path ? `${i.path}: ${i.message}` : i.message,
      ),
    };

  const byId = new Map(entries.map((e) => [e.id, e]));
  return {
    absent: false,
    issues: [],
    entries: songRefs(value).map((ref) => {
      const id = songIdOf(ref) ?? ref;
      const entry = byId.get(id) ?? null;
      const artist = entry?.meta?.artist;
      return {
        ref,
        id,
        name: entry?.name || (id.split("/").pop() ?? id),
        // The id's SECOND segment is the artist folder (`songs/<artiste>/<album>/<titre>`),
        // which is what to show while the cache has not got the entry and there are no tags
        // to read — the médiathèque filed it under that name, so it is not a guess.
        artist:
          (typeof artist === "string" && artist) || id.split("/")[1] || null,
        entry,
      };
    }),
  };
}
