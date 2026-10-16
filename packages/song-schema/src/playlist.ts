// playlist.ts — where a workspace keeps its playlists, and what one says: an ordered list of
// songs the médiathèque holds, each optionally naming one of that song's variants. Reading one,
// and adding, dropping or reordering a line AS TEXT. No `node:fs`, so the file service and the
// browser go by exactly the same rules. See docs/playlists.md.

import { parse as parseYaml } from "yaml";

/** The folder a workspace keeps its playlists in, beside `_modules` — see docs/playlistFile.md. */
export const PLAYLISTS_DIR = "_playlists";

/** What a playlist file is called at its end — a playlist IS its file, so the extension is the whole rule. */
export const PLAYLIST_EXT = ".yaml";

/** A playlist NAME as the workspace path holding it, null for one that would leave the folder (docs/playlistFile.md). */
export function playlistPathOf(name: string): string | null {
  const clean = name.trim().replace(/^\/+|\/+$/g, "");
  if (!clean) return null;
  const segs = clean.split("/");
  if (segs.some((s) => !s || s === "." || s === "..")) return null;
  const rel = segs.join("/");
  return `${PLAYLISTS_DIR}/${/\.(ya?ml|k7x)$/i.test(rel) ? rel : `${rel}${PLAYLIST_EXT}`}`;
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

/** Read a playlist, or `null` when the text is not one — an unreadable file is not an empty one (docs/playlistFile.md). */
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

/** What a playlist file that does not exist yet says — a stub that PARSES, see docs/playlistFile.md. */
export function playlistStub(name: string): string {
  return `# ${name}\ntitle: ${name}\nitems: []\n`;
}

/** Where a top-level `items:` is, and what (if anything) sits on the same line after it. */
const ITEMS_LINE = /^items:[ \t]*(.*)$/;

/** Characters that make a plain scalar mean something else at the START of one. */
const INDICATORS = "-?:,[]{}#&*!|>'\"%@`";

/** The words YAML would read as something other than a string — a morceau called "No" is a title, not `false`. */
const RESERVED = /^(true|false|null|yes|no|on|off|~)$/i;

/** A string as a YAML scalar, plain when it can be — NOT always quoted, see docs/playlistFile.md. */
export function yamlScalar(value: string): string {
  const safe =
    value !== "" &&
    value === value.trim() &&
    !INDICATORS.includes(value[0] as string) &&
    !value.includes(": ") &&
    !value.endsWith(":") &&
    !value.includes(" #") &&
    !/[\n\r]/.test(value) &&
    !RESERVED.test(value) &&
    !(value !== "" && Number.isFinite(Number(value)));
  return safe ? value : `'${value.replace(/'/g, "''")}'`;
}

/** One more line on the end of a playlist's `items:` as TEXT, or null when the shape cannot take one (docs/playlistFile.md). */
export function appendPlaylistItem(
  text: string,
  item: PlaylistItem,
): string | null {
  const song = yamlScalar(item.song);
  const lines = text.split("\n");
  const key = lines.findIndex((l) => ITEMS_LINE.test(l));

  /** The line(s) for the item at a given indent; a variant's second key aligns past the `- `. */
  const entry = (indent: string): string[] =>
    item.variant
      ? [
          `${indent}- song: ${song}`,
          `${indent}  variant: ${yamlScalar(item.variant)}`,
        ]
      : [`${indent}- ${song}`];

  // No `items:` at all: the key goes on the END, where it cannot land inside another block by accident.
  if (key < 0) {
    const body = text.endsWith("\n") || text === "" ? text : `${text}\n`;
    return `${body}items:\n${entry("  ").join("\n")}\n`;
  }

  const after = (ITEMS_LINE.exec(lines[key] as string)?.[1] ?? "").trim();

  // `items: []` — what the stub writes; the empty flow becomes a block, the shape every line after it is in.
  if (after === "[]") {
    lines.splice(key, 1, "items:", ...entry("  "));
    return lines.join("\n");
  }

  // A one-line flow sequence: extended in its own notation rather than converted (docs/playlistFile.md).
  if (after.startsWith("[")) {
    if (!after.endsWith("]")) return null; // spread over lines — not ours to reflow
    if (item.variant) return null; // a mapping inside a flow list is a shape too far
    const inner = after.slice(1, -1).trim();
    lines[key] = `items: [${inner ? `${inner}, ` : ""}${song}]`;
    return lines.join("\n");
  }

  // Anything else on that line is not a sequence we can extend — `items: some-scalar`.
  if (after !== "") return null;

  // The block below the key: the last non-blank line is what the new entry follows (docs/playlistFile.md).
  let last = key;
  let indent = "  ";
  let seen = false;
  for (let i = key + 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.trim() === "") continue; // may be inside the block, may be after it — read on
    if (!/^[ \t]/.test(line)) break; // a top-level key: the sequence ended above
    last = i;
    if (!seen) {
      // The file's own indentation, taken from its first entry rather than imposed.
      indent = (/^[ \t]*/.exec(line)?.[0] ?? "  ") as string;
      seen = true;
    }
  }
  lines.splice(last + 1, 0, ...entry(indent));
  return lines.join("\n");
}

/** The line span of every entry of a BLOCK `items:`, or null when the file is not in that shape (docs/playlistFile.md). */
function playlistItemLines(
  text: string,
): { start: number; end: number }[] | null {
  const lines = text.split("\n");
  const key = lines.findIndex((l) => ITEMS_LINE.test(l));
  if (key < 0) return null;
  // A flow list or a scalar on the key's own line: appending knows those shapes, reordering does not.
  if ((ITEMS_LINE.exec(lines[key] as string)?.[1] ?? "").trim() !== "")
    return null;
  const spans: { start: number; end: number }[] = [];
  for (let i = key + 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.trim() === "") continue;
    if (!/^[ \t]/.test(line)) break; // a top-level key: the sequence ended above
    if (/^[ \t]*-\s/.test(line)) spans.push({ start: i, end: i });
    // A continuation — `variant:`, or a comment somebody wrote under the line it is about.
    else if (spans.length) (spans[spans.length - 1] as { end: number }).end = i;
  }
  return spans;
}

/** Drop one line of a playlist by its 0-based position, as TEXT. Null when the shape or the index is not one this can take. */
export function removePlaylistItem(text: string, index: number): string | null {
  const spans = playlistItemLines(text);
  if (!spans || index < 0 || index >= spans.length) return null;
  const lines = text.split("\n");
  const span = spans[index] as { start: number; end: number };
  lines.splice(span.start, span.end - span.start + 1);
  // The last one out leaves a bare `items:`, which reads as null rather than as the empty list it is.
  if (spans.length === 1) {
    const key = lines.findIndex((l) => ITEMS_LINE.test(l));
    if (key >= 0) lines[key] = "items: []";
  }
  return lines.join("\n");
}

/** Move one line to another 0-based position, as TEXT. Blank lines BETWEEN entries do not survive the reorder. */
export function movePlaylistItem(
  text: string,
  from: number,
  to: number,
): string | null {
  const spans = playlistItemLines(text);
  if (!spans || spans.length < 2) return null;
  if (from < 0 || from >= spans.length || to < 0 || to >= spans.length)
    return null;
  if (from === to) return text;
  const lines = text.split("\n");
  const blocks = spans.map((s) => lines.slice(s.start, s.end + 1));
  const [moved] = blocks.splice(from, 1);
  blocks.splice(to, 0, moved as string[]);
  const first = (spans[0] as { start: number }).start;
  const last = (spans[spans.length - 1] as { end: number }).end;
  lines.splice(first, last - first + 1, ...blocks.flat());
  return lines.join("\n");
}
