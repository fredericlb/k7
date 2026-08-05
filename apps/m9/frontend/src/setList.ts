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
      return {
        ref,
        id,
        name: entry?.name || (id.split("/").pop() ?? id),
        entry,
      };
    }),
  };
}
