// playlistItems.ts — a playlist's lines against the songs this library holds: which morceau each
// names, which version, and why a line cannot play. Pure, so it is testable without a screen.
//
// HERE because TWO surfaces must agree — k7's playlist screen edits the lines, the DJ desk
// loads one onto a deck — and two copies of "path first, then name" would diverge the first time
// one learned a case. The import direction settled the side: everything but the `PlaylistItem`
// type is already this package's.
//
// See @studio/song/docs/playlists.md and packages/k7-plugins/docs/turntables/songBrowser.md.

import type { PlaylistItem } from "@studio/song-schema/playlist";
import { type Take, takesOf } from "./takes.ts";
import type { MediatekEntry } from "./types.ts";

/** The song a line names, by PATH first then by name, so a colliding title still resolves to the one asked for. */
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

/** How a line should NAME a song a search found — the unambiguous path, since a machine writes it. */
export function songRef(entry: MediatekEntry): string {
  return entry.path.replace(/^songs\//, "");
}

/** Does this song match what was typed? Every word must hit title, artist or path, but not the same one. */
export function songMatches(entry: MediatekEntry, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay =
    `${entry.name} ${entry.path} ${entry.meta?.artist ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

// --- dragging a line onto a deck: the vocabulary BOTH listings speak (packages/k7-plugins/docs/turntables/setList.md) ---

/** Our own MIME, so a deck accepts a playlist row and refuses every other thing a browser can drop. */
export const SONG_DRAG_TYPE = "application/x-studio-song";

/** What travels is the LINE, not the resolved song: the deck resolves it exactly as its own set list did. */
export interface SongDrag {
  song: string;
  variant?: string;
}

export const packSongDrag = (d: SongDrag): string => JSON.stringify(d);

/** …and back, refusing anything that is not one — a drop carries whatever the page it came from wrote. */
export function parseSongDrag(text: string): SongDrag | null {
  try {
    const v = JSON.parse(text) as Partial<SongDrag>;
    if (typeof v?.song !== "string" || !v.song) return null;
    return typeof v.variant === "string" && v.variant
      ? { song: v.song, variant: v.variant }
      : { song: v.song };
  } catch {
    return null;
  }
}

/** One line, as far as the two listings can take it. */
export interface ResolvedItem {
  item: PlaylistItem;
  /** The morceau, or null when the library holds none by that path or name. */
  song: MediatekEntry | null;
  /** The version asked for, the master by default, or null — which is not the same fact as a missing song. */
  take: Take | null;
}

/** Every line resolved in the playlist's own order, KEEPING the ones that resolve to nothing — a dropped row is an invisible typo. */
export function resolveItems(
  items: PlaylistItem[],
  songs: MediatekEntry[] | null,
): ResolvedItem[] {
  return items.map((item) => {
    const song = songs ? (findSong(item.song, songs) ?? null) : null;
    if (!song) return { item, song: null, take: null };
    const takes = takesOf(song);
    // No variant named is the master, which `takesOf` always puts first, file or no file.
    const take = item.variant
      ? (takes.find((t) => t.name === item.variant) ?? null)
      : (takes[0] ?? null);
    return { item, song, take };
  });
}

/** Why a line cannot play, or "" when nothing HERE says it cannot — the pane probes the disk itself. */
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
