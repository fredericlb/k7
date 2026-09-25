// syncTarget.ts — where a machine can COPY a set list to: a name and a `file://` URI — a stick, a
// folder, a share the OS already mounts. The vocabulary only — parsing a URI, laying a track out as
// `[artist]/[album]/[title]`, writing an m3u. No `node:`, so the machine that copies and the screen
// that offers the button read the same rules. See docs/syncTarget.md.

/** One destination a machine knows about, as `preferences.yaml` declares it. */
export interface SyncTarget {
  /** What the dropdown shows. Free text: it names a place a person recognises, not a path. */
  name: string;
  /** `file:///media/usb/MUSIC`. */
  uri: string;
}

/** A target's URI, taken apart. Null for a URI this cannot copy to — the caller says so by name. */
export interface ParsedTarget {
  /** The folder the tree starts in, as an absolute path. */
  root: string;
}

/** The folder a target must already HAVE for an m3u to be written — never created, see docs/syncTarget.md. */
export const TARGET_PLAYLISTS_DIR = "playlists";

/** Read a target URI, or null when it is not one this can copy to. */
export function parseSyncTarget(uri: string): ParsedTarget | null {
  let url: URL;
  try {
    url = new URL(uri.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "file:") return null;
  // A file URI's host must be empty or `localhost`, and it carries no credentials.
  if (url.hostname && url.hostname !== "localhost") return null;
  if (url.username || url.password) return null;
  // A file URI's path is percent-encoded.
  const path = decodeURIComponent(url.pathname);
  if (!path || path === "/") return null;
  // Windows spells `file:///C:/x` — the leading slash is the URI's, not the path's.
  const root = /^\/[a-zA-Z]:/.test(path) ? path.slice(1) : path;
  return { root };
}

/** Characters no FAT/exFAT volume accepts, which is what a stick handed to a player is formatted as. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the control range is exactly what FAT refuses
const UNSAFE = /[<>:"/\\|?*\u0000-\u001f]/g;

/** One path segment as a target can hold it: trimmed, unsafe characters dropped, never empty. */
export function targetSegment(raw: string, fallback = "Unknown"): string {
  const clean = raw
    .replace(UNSAFE, " ")
    .replace(/\s+/g, " ")
    .trim()
    // A trailing dot or space is legal to write and unopenable afterwards on Windows.
    .replace(/[. ]+$/, "");
  return clean || fallback;
}

/** One track on the target: `[artist]/[album]/[title].<ext>` — the layout, and nothing else decides it. */
export function targetTrackPath(t: {
  artist: string;
  album: string;
  title: string;
  /** The master's extension, dot included (`.mp3`) — the bytes are copied as they are. */
  ext: string;
}): string {
  const seg = [
    targetSegment(t.artist, "Unknown Artist"),
    targetSegment(t.album, "Unknown Album"),
    targetSegment(t.title, "Untitled"),
  ];
  return `${seg.join("/")}${t.ext}`;
}

/** An m3u naming the tracks, RELATIVE to the folder the file itself sits in — see docs/syncTarget.md. */
export function m3uText(name: string, trackPaths: string[]): string {
  // `#EXTM3U` and nothing more: an `#EXTINF` needs a duration, and a wrong one is worse than none.
  const lines = ["#EXTM3U", `# ${name}`];
  // The m3u lives one level down, so every track is reached by climbing out of that folder first.
  for (const p of trackPaths) lines.push(`../${p}`);
  return `${lines.join("\r\n")}\r\n`;
}

/** The m3u's own name on the target, under `playlists/`. */
export function m3uName(playlist: string): string {
  // A playlist may be filed under a folder (`live/repet`); the m3u is flat, so the name is the leaf.
  const leaf = playlist.split("/").pop() ?? playlist;
  return `${targetSegment(leaf, "playlist")}.m3u`;
}
