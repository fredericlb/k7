// playlist.ts — what a playlist file says: an ordered list of songs the library already holds,
// each optionally naming one of that song's variants. Parsing and nothing else, and no
// `node:fs`, so the scan and the browser read a playlist by exactly the same rules.
// See docs/playlists.md.

import { parse as parseYaml } from "yaml";

/**
 * What a playlist file is called at its end.
 *
 * A playlist IS its file — unlike a song, a chain or a module, which are folders around one —
 * so there is no `playlist.yaml` marker to look for and the extension is the whole rule. See
 * docs/playlists.md for why that asymmetry is deliberate rather than an oversight.
 */
export const PLAYLIST_EXT = ".yaml";

/**
 * One line of a playlist.
 *
 * `song` is kept VERBATIM, the way `SongVariant.ref` is: resolving it means holding the songs
 * listing, and this file deliberately holds nothing. See `docs/playlists.md`, "the refs are not
 * checked here".
 */
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

/**
 * Read a playlist, or `null` when the text is not one.
 *
 * Null and not an empty playlist, because the two are different facts and a surface says so
 * differently: a file that does not parse is one to go and fix, an empty `items:` is one to go
 * and fill. The same distinction `readSong` declines to make — a song is still a song with an
 * unreadable sidecar, because the AUDIO is the song — and a playlist has nothing but its text.
 *
 * An item may be a bare string, which is what anyone actually types for the common case, or a
 * mapping when it has to name a variant too. Anything else in the list is DROPPED rather than
 * coerced: `- [x]` is a malformed line, and inventing "[object Object]" as a ref would put a row
 * on screen that points at nothing anybody can go and look at.
 */
export function parsePlaylist(text: string): Playlist | null {
  let doc: unknown;
  try {
    doc = parseYaml(text, { version: "1.2" });
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const raw = (doc as Record<string, unknown>).items;
  const items: PlaylistItem[] = [];
  if (Array.isArray(raw))
    for (const line of raw) {
      const short = str(line);
      if (short) {
        items.push({ song: short });
        continue;
      }
      if (!line || typeof line !== "object" || Array.isArray(line)) continue;
      const row = line as Record<string, unknown>;
      const song = str(row.song);
      if (!song) continue;
      const variant = str(row.variant);
      items.push({ song, ...(variant ? { variant } : {}) });
    }
  const title = str((doc as Record<string, unknown>).title);
  return { ...(title ? { title } : {}), items };
}

/**
 * What a playlist file that does not exist yet says.
 *
 * A stub that PARSES, the way a module's jsdsp stub compiles: the first thing this screen does
 * with the text is draw the right-hand pane from it, and an empty file would open on a parse
 * failure for a playlist nobody has had a chance to get wrong yet.
 */
export function playlistStub(name: string): string {
  return `# ${name}\ntitle: ${name}\nitems: []\n`;
}
