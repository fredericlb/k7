// playlistItems.ts — a playlist's lines against the songs the library actually holds: which
// morceau each one names, which of its versions, and why a line cannot play. Pure, so the
// resolution is testable without a screen. See ../docs/playlists.md.

import type { PlaylistItem } from "@studio/mediatek/playlist";
import type { MediatekEntry } from "@studio/mediatek/types";
import { type Take, takesOf } from "./songTakes";

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
