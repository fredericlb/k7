// playlist.ts — where a workspace keeps its playlists, and what one says: an ordered list of
// songs the médiathèque holds, each optionally naming one of that song's variants. Reading one
// from its data or its k7x text, and adding, dropping or reordering a line as a k7x edit. No
// `node:fs`, so the file service and the browser go by the same rules. See docs/playlists.md.
// The médiathèque's own store keeps its playlists in YAML: that front end is mediaYaml.ts.

import type { K7Scope } from "@studio/k7x/document";
import { parse } from "@studio/k7x/document";
import { stringify } from "@studio/k7x/print";
import { plainSegments } from "@studio/web-protocol/paths";
import { isDocFile } from "./docExt";

/** The folder a workspace keeps its playlists in, beside `_modules` — see docs/playlistFile.md. */
export const PLAYLISTS_DIR = "_playlists";

/** What a playlist file is called at its end — a playlist IS its file, so the extension is the whole rule. */
export const PLAYLIST_EXT = ".k7x";

/** A playlist NAME as the workspace path holding it, null for one that would leave the folder (docs/playlistFile.md). */
export function playlistPathOf(name: string): string | null {
  const clean = name.trim().replace(/^\/+|\/+$/g, "");
  if (!clean) return null;
  const segs = plainSegments(clean);
  if (!segs) return null;
  const rel = segs.join("/");
  return `${PLAYLISTS_DIR}/${isDocFile(rel) ? rel : `${rel}${PLAYLIST_EXT}`}`;
}

/** One line of a playlist; `song` is kept VERBATIM, since resolving it needs the médiathèque listing. */
export interface PlaylistItem {
  /** The song, as its path under `songs/` (`AC-DC/Back in Black/Hells Bells`) or just its name. */
  song: string;
  /** One of that song's variants, by the name its sidecar files it under. Absent means the master. */
  variant?: string;
}

/** A parsed playlist. `title` is what a listing shows; without one the file name stands in. */
export interface Playlist {
  title?: string;
  items: PlaylistItem[];
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** A playlist from data already read, whatever the file's format; null when the data is not a map. */
export function playlistFromData(doc: unknown): Playlist | null {
  if (!isRecord(doc)) return null;
  const items: PlaylistItem[] = [];
  if (Array.isArray(doc.items))
    for (const line of doc.items) {
      const short = str(line);
      if (short) {
        items.push({ song: short });
        continue;
      }
      if (!isRecord(line)) continue;
      const song = str(line.song);
      if (!song) continue;
      const variant = str(line.variant);
      items.push({ song, ...(variant ? { variant } : {}) });
    }
  const title = str(doc.title);
  return { ...(title ? { title } : {}), items };
}

/** Read a workspace playlist's k7x text, or `null` when it does not read — an unreadable file is not an empty one. */
export function parsePlaylist(text: string): Playlist | null {
  try {
    return playlistFromData(parse(text));
  } catch {
    return null;
  }
}

/** What a playlist file that does not exist yet says — a stub that PARSES, see docs/playlistFile.md. */
export function playlistStub(name: string): string {
  return stringify({ title: name, items: [] }, { header: [name] });
}

/** An item as it is written: the bare song when it names no variant, which is what anyone types. */
const itemValue = (item: PlaylistItem): unknown =>
  item.variant ? { song: item.song, variant: item.variant } : item.song;

/** One more line on the end of `items`, made when missing; false when `items` is something other than a list. */
export function appendPlaylistItem(doc: K7Scope, item: PlaylistItem): boolean {
  const items = doc.getIn(["items"]);
  if (items !== undefined && !Array.isArray(items)) return false;
  doc.addIn(["items"], itemValue(item));
  return true;
}

/** Drop one line by its 0-based position; false when `items` is no list or holds no such line. */
export function removePlaylistItem(doc: K7Scope, index: number): boolean {
  const items = doc.getIn(["items"]);
  if (!Array.isArray(items) || index < 0 || index >= items.length) return false;
  return doc.deleteIn(["items", index]);
}

/** Move one line to another 0-based position, its comments with it; false when either position is not a line. */
export function movePlaylistItem(
  doc: K7Scope,
  from: number,
  to: number,
): boolean {
  const items = doc.getIn(["items"]);
  if (!Array.isArray(items)) return false;
  const ok = (i: number) => Number.isInteger(i) && i >= 0 && i < items.length;
  if (!ok(from) || !ok(to)) return false;
  doc.moveIn(["items"], from, to);
  return true;
}
