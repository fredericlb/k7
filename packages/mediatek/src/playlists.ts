// playlists.ts — the set lists this volume holds: `playlists/<name>.yaml`, a root zone beside
// the families. Listing them, naming one, creating one. The FORMAT is not ours — it is
// @studio/song-schema/mediaYaml, the YAML front end of k7's playlist rules — and neither is
// resolving a line, which needs the songs listing (playlistItems.ts). See docs/playlists.md.

import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
  MEDIA_PLAYLIST_EXT,
  mediaPlaylistStub,
  parseMediaPlaylist,
} from "@studio/song-schema/mediaYaml";
import { plainSegments } from "@studio/web-protocol/paths";
import { playlistsDir, safePath } from "./layout.ts";
import { mapLimit } from "./pool.ts";
import { PLAYLISTS_DIR } from "./types.ts";
import { putFile } from "./write.ts";

/** Thrown by `createPlaylist` for a name already taken — a create that handed one back would open the wrong set list. */
export class PlaylistExistsError extends Error {}

/** One line of the listing. `ok: false` is a file on disk that does not parse — it is listed all the same. */
export interface PlaylistSummary {
  /** What names it, `playlists/`-relative and without the extension: `ete-2026`, `live/repet`. */
  name: string;
  /** Mediatek-relative POSIX path — what `GET /file` and `PUT /file` take. */
  path: string;
  /** `title:` when the file carries one; a surface falls back to the name. */
  title?: string;
  /** How many lines it holds, 0 for a file that does not parse. */
  count: number;
  /** Did it parse? A file that did not is to be repaired, an empty `items:` to be filled. */
  ok: boolean;
  mtime: number;
}

/** A playlist NAME as its mediatek-relative path, or null for one that would leave the zone. */
export function playlistPath(name: string): string | null {
  const clean = name.trim().replace(/^\/+|\/+$/g, "");
  if (!clean) return null;
  // `.` and `..` are refused per SEGMENT, since `resolve` would otherwise walk out of the volume.
  const segs = plainSegments(clean);
  if (!segs) return null;
  const rel = segs.join("/");
  return `${PLAYLISTS_DIR}/${/\.ya?ml$/i.test(rel) ? rel : `${rel}${MEDIA_PLAYLIST_EXT}`}`;
}

/** …and back: a path under the zone as the name that addresses it, or null for one outside. */
export function playlistName(path: string): string | null {
  const posix = path.split(sep).join("/");
  if (!posix.startsWith(`${PLAYLISTS_DIR}/`)) return null;
  const rest = posix.slice(PLAYLISTS_DIR.length + 1);
  if (!/\.ya?ml$/i.test(rest)) return null;
  return rest.replace(/\.ya?ml$/i, "");
}

/** Every `.yaml` under the zone, at whatever depth — the zone nests, so `live/repet` is one. */
async function walk(dir: string, into: string[]): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return; // No zone yet on an old volume: an absent folder is an empty list, not a failure.
  }
  const below: string[] = [];
  await mapLimit(entries, async (name) => {
    if (name.startsWith(".")) return;
    const abs = join(dir, name);
    try {
      const st = await stat(abs);
      if (st.isDirectory()) below.push(abs);
      else if (/\.ya?ml$/i.test(name)) into.push(abs);
    } catch {
      /* vanished between the readdir and the stat — it is not in the listing either way */
    }
  });
  for (const d of below) await walk(d, into);
}

/** The zone's whole listing, newest first — the order a surface wants without sorting again. */
export async function listPlaylists(): Promise<PlaylistSummary[]> {
  const root = playlistsDir();
  const files: string[] = [];
  await walk(root, files);
  const read = await mapLimit(files, async (abs) => {
    try {
      const [text, st] = await Promise.all([readFile(abs, "utf8"), stat(abs)]);
      return { abs, text, mtime: st.mtimeMs };
    } catch {
      return null;
    }
  });
  const out: PlaylistSummary[] = [];
  for (const r of read) {
    if (!r) continue;
    const rel = relative(root, r.abs).split(sep).join("/");
    const doc = parseMediaPlaylist(r.text);
    out.push({
      name: rel.replace(/\.ya?ml$/i, ""),
      path: `${PLAYLISTS_DIR}/${rel}`,
      ...(doc?.title ? { title: doc.title } : {}),
      count: doc?.items.length ?? 0,
      ok: doc !== null,
      mtime: r.mtime,
    });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/** Write the STUB for a new playlist, refusing a name already taken — see docs/playlists.md. */
export function createPlaylist(name: string): PlaylistSummary {
  const path = playlistPath(name);
  if (!path) throw new RangeError(`not a playlist name: ${name}`);
  if (existsSync(safePath(path)))
    throw new PlaylistExistsError(`${name} already exists`);
  const label = playlistName(path) ?? name;
  putFile(path, mediaPlaylistStub(label));
  return {
    name: label,
    path,
    title: label,
    count: 0,
    ok: true,
    mtime: Date.now(),
  };
}
