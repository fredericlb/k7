// mediatek.ts — the catalogue behind a `song:` address. A `.z0` stores only the médiathèque
// id, so the artist, the title and the playable file all come from here: one listing, fetched
// once and indexed, which is both what makes the song list readable and what the preview plays.
// See apps/z0/docs/editing.md.

import { SERVICE_PATHS } from "@studio/web-protocol/services";

const PL8 = SERVICE_PATHS.pl8;

/** One variant declared in a song's sidecar — `kind: "missing"` when the file is not there. */
interface Variant {
  name: string;
  ref: string;
  kind: "file" | "missing";
}

interface SongEntry {
  id: string;
  name: string;
  variants?: Variant[];
  meta?: {
    master?: string;
    artist?: string;
    catalogued?: boolean;
  };
}

export interface SongInfo {
  id: string;
  title: string;
  artist?: string;
  /** The master's file name inside the folder; absent when the folder carries no audio yet. */
  master?: string;
  variants: Variant[];
}

export type Catalogue = Map<string, SongInfo>;

/**
 * Every song the médiathèque holds, by id.
 *
 * One request for the whole family rather than one per song: a category is fifteen songs and a
 * session is fifteen categories, so per-song lookups would be a few hundred round trips to
 * draw one list. The listing is metadata only — no audio moves here.
 */
export async function loadCatalogue(): Promise<Catalogue> {
  const res = await fetch(`${PL8}/api/mediatek/list?family=songs`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`médiathèque ${res.status}`);
  const body = (await res.json()) as { entries?: SongEntry[] } | SongEntry[];
  const entries = Array.isArray(body) ? body : (body.entries ?? []);
  const map: Catalogue = new Map();
  for (const e of entries) {
    map.set(e.id, {
      id: e.id,
      title: e.name,
      artist: e.meta?.artist,
      master: e.meta?.master,
      variants: e.variants ?? [],
    });
  }
  return map;
}

/**
 * What to show for a track whose address the catalogue knows — "Artist — Title".
 *
 * Falls back to the last segment of the id, which is the title the folder is named for: a song
 * present in the session but not in this médiathèque still reads as itself rather than as a
 * blank row. That case is real — a `.z0` travels in a git repository and the machine that opens
 * it may hold a different library.
 */
export function label(id: string | undefined, cat: Catalogue): string {
  if (!id) return "";
  const info = cat.get(id);
  if (!info) return id.split("/").pop() ?? id;
  return info.artist ? `${info.artist} — ${info.title}` : info.title;
}

/**
 * The file a category actually PLAYS for one song, as a médiathèque-relative path.
 *
 * `variant` is the category's — `stems`, `8bit`, `deformees`. The rule is the loader's, written
 * down in apps/z0/docs/projects.md: the requested version if it exists, otherwise the master.
 * Null when the song has no audio at all, which the caller shows rather than plays.
 */
export function audioPath(
  id: string | undefined,
  variant: string | undefined,
  cat: Catalogue,
): string | null {
  if (!id) return null;
  const info = cat.get(id);
  if (!info) return null;
  if (variant) {
    const v = info.variants.find((x) => x.name === variant);
    if (v && v.kind === "file") return `${id}/${v.ref}`;
  }
  return info.master ? `${id}/${info.master}` : null;
}

/** Where those bytes are served. Range-capable, so the preview can seek without pulling it all. */
export function audioUrl(path: string): string {
  return `${PL8}/api/mediatek/file?path=${encodeURIComponent(path)}`;
}

/** Lowercase AND strip accents, so a typed "edith" finds "Édith Piaf". */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * The songs matching a typed query, artist and title alike, capped.
 *
 * Over the listing already in memory rather than pl8's `/search`: the catalogue is loaded for
 * the labels anyway, so a picker that re-asked the network per keystroke would be slower and
 * would stop working the moment the médiathèque did.
 */
export function search(q: string, cat: Catalogue, limit = 40): SongInfo[] {
  const needle = fold(q.trim());
  if (!needle) return [];
  const out: SongInfo[] = [];
  for (const info of cat.values()) {
    const hay = fold(`${info.artist ?? ""} ${info.title} ${info.id}`);
    if (hay.includes(needle)) out.push(info);
    if (out.length >= limit) break;
  }
  return out;
}
