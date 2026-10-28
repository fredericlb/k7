// songTable.ts — the songs family as the rows of the catalogue's table: the practice list first,
// then the favorites, then the rest, and an album of more than one song drawn as ONE row that
// unfolds into its songs. Pure, so the grouping is tested without a screen.
// The one thing a reader would get wrong: « Album inconnu » is where an untagged song is filed, not an album (../docs/library.md).

import { UNKNOWN_ALBUM } from "@studio/mediatek/song";
import type { MediatekEntry } from "@studio/mediatek/types";
import { isFavorite } from "./favorites";
import { relative } from "./libraryTree";

/** One song: `rel` is family-relative, the path the menus and the address go by. */
export interface SongRow {
  kind: "song";
  rel: string;
  entry: MediatekEntry;
  title: string;
  artist: string;
  album: string | null;
  /** Only on the paired server, not on this machine: drawn muted, with its download. */
  remote: boolean;
}

/** An album holding more than one song, `rel` being its folder. */
export interface AlbumRow {
  kind: "album";
  rel: string;
  title: string;
  artist: string;
  /** In the album's own order: the track number first, then by title. */
  songs: SongRow[];
  /** Every one of its songs is the server's alone. */
  remote: boolean;
}

export type TableRow = SongRow | AlbumRow;

export type GroupId = "practice" | "favorites" | "others";

export interface TableGroup {
  id: GroupId;
  rows: TableRow[];
}

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** The album folder a song sits in, or null when it has no real one — `Artist/Album`, family-relative. */
export function albumOf(rel: string): string | null {
  const parts = rel.split("/");
  if (parts.length !== 3 || parts[1] === UNKNOWN_ALBUM) return null;
  return `${parts[0]}/${parts[1]}`;
}

function songRow(e: MediatekEntry, remote: boolean): SongRow {
  const rel = relative(e.path);
  const parts = rel.split("/");
  const folder = albumOf(rel);
  return {
    kind: "song",
    rel,
    entry: e,
    title: e.name || (parts.at(-1) ?? rel),
    artist: text(e.meta?.artist) ?? parts[0] ?? "",
    album: folder ? (text(e.meta?.album) ?? parts[1] ?? null) : null,
    remote,
  };
}

const track = (r: SongRow): number => {
  const t = r.entry.meta?.track;
  return typeof t === "number" && t > 0 ? t : Number.POSITIVE_INFINITY;
};

const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

/** The table's three groups, empty ones left out; a song or an album sits in the first list that covers it. */
export function songTable(
  entries: MediatekEntry[] | null,
  remote: MediatekEntry[],
  practice: ReadonlySet<string>,
  favorites: ReadonlySet<string>,
): TableGroup[] {
  // Here first, then the server's: the same path is the same row, and the one here is the one that opens.
  const seen = new Set<string>();
  const songs: SongRow[] = [];
  for (const [list, isRemote] of [
    [entries ?? [], false],
    [remote, true],
  ] as const)
    for (const e of list) {
      if (e.family !== "songs" || seen.has(e.path)) continue;
      seen.add(e.path);
      songs.push(songRow(e, isRemote));
    }

  const albums = new Map<string, SongRow[]>();
  for (const s of songs) {
    const folder = albumOf(s.rel);
    if (folder) albums.set(folder, [...(albums.get(folder) ?? []), s]);
  }

  const rows: TableRow[] = [];
  for (const s of songs) {
    const folder = albumOf(s.rel);
    const mates = folder ? (albums.get(folder) ?? []) : [];
    if (mates.length < 2) {
      rows.push(s);
      continue;
    }
    // The album's row is made once, at its first song.
    if (mates[0] !== s || !folder) continue;
    rows.push({
      kind: "album",
      rel: folder,
      title: s.album ?? folder,
      artist: s.artist,
      songs: [...mates].sort(
        (a, b) => track(a) - track(b) || byName(a.title, b.title),
      ),
      remote: mates.every((m) => m.remote),
    });
  }

  // A song is covered by a list holding it or a folder above it; an album by any of its songs.
  const covered = (set: ReadonlySet<string>, r: TableRow) =>
    r.kind === "song"
      ? isFavorite(set, r.entry.path)
      : r.songs.some((s) => isFavorite(set, s.entry.path));
  const groupOf = (r: TableRow): GroupId =>
    covered(practice, r)
      ? "practice"
      : covered(favorites, r)
        ? "favorites"
        : "others";

  const order: GroupId[] = ["practice", "favorites", "others"];
  const groups = order.map((id) => ({ id, rows: [] as TableRow[] }));
  for (const r of rows) groups[order.indexOf(groupOf(r))]?.rows.push(r);
  for (const g of groups)
    g.rows.sort(
      (a, b) => byName(a.artist, b.artist) || byName(a.title, b.title),
    );
  return groups.filter((g) => g.rows.length > 0);
}
