// playlistItems.ts — a playlist's lines against the songs this library actually holds: which
// morceau each one names, which of its versions, and why a line cannot play. Pure, so the
// resolution is testable without a screen.
//
// HERE and not in either surface, because there are two now and they must agree: l8's playlist
// screen draws the lines to edit them, and the DJ desk draws the same lines to load one onto a
// deck (`@studio/ui-turntables/docs/songBrowser.md`). Two copies of "path first, then name"
// would disagree the first time one learned a case. The direction of the import is the reason
// it landed on this side: the listing, the entry and `takesOf` are all this package's, and only
// the `PlaylistItem` type comes the other way — from a file in @studio/song that opens nothing.
// See @studio/song/docs/playlists.md.

import type { PlaylistItem } from "@studio/song/playlist";
import { type Take, takesOf } from "./takes.ts";
import type { MediatekEntry } from "./types.ts";

/**
 * The song a line names, among the songs family.
 *
 * By PATH first, then by name — `findChain` in SongVariants.tsx resolves a chain ref exactly
 * this way, and a playlist ref is the same kind of string. A line may say
 * `AC-DC/Back in Black/Hells Bells` (unambiguous, and what the tree hands you) or just
 * `Hells Bells` (what anyone types). Matching the path first means a title that collides with
 * another's tail still resolves to the one asked for.
 */
export function findSong(
  ref: string,
  entries: MediatekEntry[],
): MediatekEntry | undefined {
  const want = ref.replace(/^\/+|\/+$/g, "");
  return (
    entries.find((e) => e.path === want || e.path === `songs/${want}`) ??
    entries.find((e) => e.name === want)
  );
}

/**
 * How a line should NAME a song the search just found — its path under `songs/`.
 *
 * The unambiguous form, not the bare title, because this one is written by a machine: a person
 * typing `Lithium` is choosing brevity and accepting the ambiguity, whereas a click on one row
 * of a list means THAT morceau and nothing that happens to share its name. `findSong` reads
 * both, so the file stays hand-editable either way.
 */
export function songRef(entry: MediatekEntry): string {
  return entry.path.replace(/^songs\//, "");
}

/**
 * Does this song match what was typed? Case-insensitive, over the three things a person would
 * search by — the title, the artist, and the path, which is where the album lives.
 *
 * Every word has to hit SOMETHING, though not the same thing: "nirvana lithium" finds a
 * morceau whose artist is one and whose title is the other, which a single-substring match
 * over the whole query never would.
 */
export function songMatches(entry: MediatekEntry, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay =
    `${entry.name} ${entry.path} ${entry.meta?.artist ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** One line, as far as the two listings can take it. */
export interface ResolvedItem {
  item: PlaylistItem;
  /** The morceau, or null when the library holds none by that path or name. */
  song: MediatekEntry | null;
  /**
   * The version asked for — the master when the line names no variant — or null when the song
   * has none by that name. Null with a song present is a DIFFERENT fact from a missing song,
   * and the row says which.
   */
  take: Take | null;
}

/**
 * Every line resolved, in the playlist's own order and keeping the ones that resolve to
 * nothing.
 *
 * Dropping them would be the wrong kindness: the file is edited by hand, right there on the
 * left of this screen, and a line that silently disappears from the right-hand pane is a typo
 * you cannot see. A row that says "introuvable" is one you can fix.
 *
 * `songs` being null means the listing has not arrived; every line then reads as unresolved,
 * which is what it looks like, and one poll later they resolve themselves.
 */
export function resolveItems(
  items: PlaylistItem[],
  songs: MediatekEntry[] | null,
): ResolvedItem[] {
  return items.map((item) => {
    const song = songs ? (findSong(item.song, songs) ?? null) : null;
    if (!song) return { item, song: null, take: null };
    const takes = takesOf(song);
    // No variant named is the master, which `takesOf` always puts first — including for a song
    // whose folder holds no audio at all, whose take therefore carries a null file.
    const take = item.variant
      ? (takes.find((t) => t.name === item.variant) ?? null)
      : (takes[0] ?? null);
    return { item, song, take };
  });
}

/**
 * Why a line cannot play, or "" when nothing here says it cannot.
 *
 * "As far as this can tell" is the whole contract: a CHAIN variant is audio only once it has
 * been rendered beside the master, and whether that render is on disk is a question for the
 * library rather than for these two lists. So this returns "" for one, and the pane probes.
 */
export function itemProblem(r: ResolvedItem, songsLoaded: boolean): string {
  if (!r.song)
    return songsLoaded ? "morceau introuvable" : "morceaux pas encore chargés";
  if (!r.take) return `variante « ${r.item.variant} » introuvable`;
  // A folder carrying a sidecar and no audio — the scan allows it, so a playlist can name it.
  if (r.take.kind === "master" && !r.take.file)
    return "ce morceau n'a pas de master";
  return "";
}

/** What the row shows as its title: the morceau, and the version when it is not the master. */
export function itemLabel(r: ResolvedItem): string {
  const name = r.song?.name ?? r.item.song;
  return r.item.variant ? `${name} · ${r.item.variant}` : name;
}
