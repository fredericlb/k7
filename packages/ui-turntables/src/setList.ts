// setList.ts — the PLAYLIST the surface names, resolved against the cache on the chosen
// machine. Two failures are kept apart on purpose: a set list that will not parse, and a song
// this machine has not got yet. See ../../docs/setList.md.

import {
  findSong,
  type ResolvedItem,
  resolveItems,
} from "@studio/mediatek/playlistItems";
import type { MediatekEntry } from "@studio/mediatek/types";
import { parsePlaylist } from "@studio/song/playlist";

/** One line of the set list: what the playlist named, and what this machine can play of it. */
export interface SetEntry {
  /** As written in the playlist — its path under `songs/`, or the bare name somebody typed. */
  ref: string;
  /** The médiathèque id. The resolved entry's when there is one, else `songs/<ref>`, which is
   *  what the cache sync would fetch and therefore the right thing to key a cue by. */
  id: string;
  /** What to show. The catalogue's title when the cache holds it, else the ref's last segment,
   *  which is the folder the médiathèque filed it under and the best name available. */
  name: string;
  /** Who it is by, when the sidecar's tags said. Null rather than "" so a surface can leave
   *  the line out entirely instead of drawing an empty one — a vinyl label has no room to
   *  spend on nothing. */
  artist: string | null;
  /** The version the line asked for, when it named one. What the label shows beside the title
   *  — a set list saying `instrumental` and a deck playing the master would be a lie the desk
   *  tells in front of an audience. */
  variant?: string;
  /**
   * The audio INSIDE the song's folder — the master, or the variant's file when the line named
   * one. Null when there is nothing to play: the cache has not got the song yet, the folder is
   * catalogued and carries no audio, or the sidecar names a version whose file is absent.
   *
   * Its own field rather than something each caller derives from `entry.meta.master`, which is
   * what they all used to do: that spelling can only ever play a master, so a playlist naming
   * `instrumental` would silently put the original on the deck.
   */
  file: string | null;
  /** The catalogued entry, or null when this machine's cache has not got it YET. */
  entry: MediatekEntry | null;
}

export interface SetList {
  entries: SetEntry[];
  /** What the playlist said that could not be read, one line per problem. Empty when it read. */
  issues: string[];
  /**
   * The surface names NO playlist — `surfaces/<desk>.yaml` has no `playlist:` line.
   *
   * Distinct from an EMPTY playlist, which someone wrote on purpose, and from one that is
   * named and not on disk (an `issue`). Three states, three sentences: the fix is a different
   * one each time, and the browser is where you read it.
   */
  absent: boolean;
}

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
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
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
 *
 * SORTED, and therefore not in the playlist's own order — which is deliberate and unchanged
 * from when this read `songs.yaml`. This is a browser you FIND a record in, at a desk, mid-mix;
 * the running order of the evening is a live decision. A surface that wanted the written order
 * would want a different list, not this one sorted differently.
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

/** The set list of a desk whose surface names no playlist. Its own function because three
 *  call sites need the same shape and an inline literal would drift. */
export const NO_PLAYLIST: SetList = { entries: [], issues: [], absent: true };

/** One resolved line as the desk's row. Split out so the map below reads as one thing. */
function entryOf(r: ResolvedItem, entries: MediatekEntry[]): SetEntry {
  const ref = r.item.song.replace(/^\/+|\/+$/g, "");
  // The id the cache would file it under. From the resolved entry when there is one — a line
  // may name a song by its bare title, and then only the catalogue knows the path — else the
  // ref read as one, which is what the sync fetches and what a cue is keyed by.
  const id = r.song?.id ?? (ref.startsWith("songs/") ? ref : `songs/${ref}`);
  const artist = r.song?.meta?.artist;
  return {
    ref,
    id,
    name: r.song?.name || (ref.split("/").pop() ?? ref),
    // The id's SECOND segment is the artist folder (`songs/<artiste>/<album>/<titre>`),
    // which is what to show while the cache has not got the entry and there are no tags
    // to read — the médiathèque filed it under that name, so it is not a guess.
    artist: (typeof artist === "string" && artist) || id.split("/")[1] || null,
    ...(r.item.variant ? { variant: r.item.variant } : {}),
    file: r.take?.file ?? null,
    entry: r.song ?? findSong(ref, entries) ?? null,
  };
}

/**
 * Resolve a playlist against a catalogue listing.
 *
 * `text` is the playlist file; `null` says the surface named one and it could not be read,
 * which is an ISSUE and not an absence — the difference between "you have not chosen a set
 * list" and "the one you chose is not there" is the whole of what you need to know.
 *
 * The ref is kept whatever happens. A song the cache has not got is a REAL and ordinary state
 * — the sync fetches what the open project names, so a set edited a minute ago is briefly
 * ahead of the disk — and it must draw as a song that is coming, not vanish from the list.
 * Dropping it would make a set list that is missing three songs indistinguishable from one
 * that never had them.
 *
 * Deduplicated by ref, keeping the first. A playlist may legitimately name a song twice — st0's
 * screen draws both rows, because there it is a document you are editing — but this is a
 * BROWSER, where two identical rows are two chances to pick the same record and no way to tell
 * which you got. Same answer `songRefs` gave for `songs.yaml`, for a different reason.
 */
export function resolveSet(
  text: string | null,
  entries: MediatekEntry[],
): SetList {
  if (text === null)
    return {
      entries: [],
      absent: false,
      issues: ["la playlist nommée par cette surface est introuvable"],
    };

  const parsed = parsePlaylist(text);
  if (parsed === null)
    return {
      entries: [],
      absent: false,
      issues: ["ce fichier ne se lit pas comme une playlist"],
    };

  const seen = new Set<string>();
  const out: SetEntry[] = [];
  for (const r of resolveItems(parsed.items, entries)) {
    const row = entryOf(r, entries);
    // The VARIANT is part of the identity: a set list naming a song's master and its
    // instrumental names two different records, and folding them would drop one.
    const key = `${row.ref}\u0000${row.variant ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return { entries: out, absent: false, issues: [] };
}
