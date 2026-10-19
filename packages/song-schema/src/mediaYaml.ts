// mediaYaml.ts — the media library's YAML: how its store's files are read, and its playlists edited AS TEXT.
// No workspace file is YAML; the médiathèque's volume (packages/mediatek) still is, so this is its front end only.
// Its playlists say what a workspace's do (playlist.ts): the data rules are shared, the text surgery is not.

import { parse as parseYaml } from "yaml";
import { type Playlist, type PlaylistItem, playlistFromData } from "./playlist";

/** How a media library file is parsed: YAML 1.2 forced, so `5:1:1` stays a string whatever the file declares. */
export const MEDIA_YAML_READ = { version: "1.2" } as const;

/** What a médiathèque playlist file is called at its end. */
export const MEDIA_PLAYLIST_EXT = ".yaml";

/** Read a médiathèque playlist's YAML text, or `null` when it is not one — an unreadable file is not an empty one. */
export function parseMediaPlaylist(text: string): Playlist | null {
  try {
    return playlistFromData(parseYaml(text, MEDIA_YAML_READ));
  } catch {
    return null;
  }
}

/** What a médiathèque playlist that does not exist yet says — a stub that PARSES. */
export function mediaPlaylistStub(name: string): string {
  return `# ${name}\ntitle: ${yamlScalar(name)}\nitems: []\n`;
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
export function appendMediaPlaylistItem(
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
export function removeMediaPlaylistItem(
  text: string,
  index: number,
): string | null {
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
export function moveMediaPlaylistItem(
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
