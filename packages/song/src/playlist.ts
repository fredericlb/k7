// playlist.ts — where a workspace keeps its playlists, and what one says: an ordered list of
// songs the médiathèque holds, each optionally naming one of that song's variants. Reading one,
// and adding a line to one AS TEXT. No `node:fs`, so the file service and the browser go by
// exactly the same rules. See docs/playlists.md.

import { parse as parseYaml } from "yaml";

/**
 * The folder a workspace keeps its playlists in, at its root.
 *
 * Beside `_modules` and `_libraries` and named like them, because it is the same KIND of thing:
 * something every project in the workspace draws on, found by where it sits rather than by a
 * line declaring it. A playlist is not a project and does not belong inside one — you build a
 * set list once and open it against whichever project you happen to be working in.
 *
 * That is also why it is not in the médiathèque any more. A playlist is the one family there
 * whose content was pure REFERENCE: it holds no bytes, only names of things filed elsewhere, so
 * hosting it bought nothing and cost the account a document it could not version with its work.
 * `_playlists` is in the repository, so a set list is committed, branched and cloned with the
 * songs it was built for. See docs/playlists.md.
 */
export const PLAYLISTS_DIR = "_playlists";

/**
 * What a playlist file is called at its end.
 *
 * A playlist IS its file — unlike a song, a chain or a module, which are folders around one —
 * so there is no `playlist.yaml` marker to look for and the extension is the whole rule. See
 * docs/playlists.md for why that asymmetry is deliberate rather than an oversight.
 */
export const PLAYLIST_EXT = ".yaml";

/**
 * A playlist NAME as the workspace path holding it — `ete-2026` → `_playlists/ete-2026.yaml`.
 *
 * The name is what a surface writes (`surfaces/desk.yaml`'s `playlist:`), and it is a name
 * rather than a path for the reason a module ref is: the folder is fixed, so spelling it into
 * every declaration would let a file be wrong about a location nothing can choose. Subfolders
 * are kept — `live/repet` is a playlist filed under `live/` — because `_playlists/` nests.
 *
 * The extension is added when it is missing and kept when it is there: it is what makes the
 * file a playlist, and somebody who writes it out has not made a mistake.
 *
 * Null for a name that would leave the folder. Not a throw: this runs on a value out of a YAML
 * file somebody typed, and the surface that asked reports it beside the control it breaks —
 * which is a screen you can read, unlike a project that refuses to open.
 */
export function playlistPathOf(name: string): string | null {
  const clean = name.trim().replace(/^\/+|\/+$/g, "");
  if (!clean) return null;
  const segs = clean.split("/");
  if (segs.some((s) => !s || s === "." || s === "..")) return null;
  const rel = segs.join("/");
  return `${PLAYLISTS_DIR}/${/\.ya?ml$/i.test(rel) ? rel : `${rel}${PLAYLIST_EXT}`}`;
}

/**
 * One line of a playlist.
 *
 * `song` is kept VERBATIM: resolving it means holding the médiathèque listing, and this file
 * deliberately holds nothing. See `docs/playlists.md`, "the refs are not checked here".
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

/** Where a top-level `items:` is, and what (if anything) sits on the same line after it. */
const ITEMS_LINE = /^items:[ \t]*(.*)$/;

/** Characters that make a plain scalar mean something else at the START of one. */
const INDICATORS = "-?:,[]{}#&*!|>'\"%@`";

/** The words YAML would read as something other than a string. Quoted so a morceau called
 *  "No" stays a title rather than becoming `false` under a 1.1 reader. */
const RESERVED = /^(true|false|null|yes|no|on|off|~)$/i;

/**
 * A string as a YAML scalar — plain when it can be, single-quoted when it cannot.
 *
 * Not always quoted, deliberately. This file is written by hand as much as by this function,
 * the doc page shows bare paths, and `- 'AC-DC/Back in Black/Hells Bells'` beside a line
 * somebody typed without quotes reads as two different conventions in one file.
 *
 * Song folders are `segment()`ed from tags, so they legitimately carry spaces, `&` and
 * parentheses — all fine unquoted in the middle of a plain scalar, none fine at the start.
 */
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

/**
 * One more line on the end of a playlist's `items:`, or null when the file's shape cannot
 * take one.
 *
 * TEXT, never a re-serialisation. `yaml/edit.ts` takes the same care over a project's files and
 * for the same reason: these files carry comments and an order somebody chose, and parsing to an
 * object and dumping it back would quietly throw both away. Round-tripping a set list through a
 * serialiser is exactly the change nobody would notice until their notes were gone.
 *
 * Null rather than a guess when `items:` is a flow sequence spread over several lines, or is
 * missing its key in a file that does not parse at all. The surface disables the button and
 * says why; inventing a second `items:` key lower down would produce a file whose two halves
 * disagree, which is worse than being told to type the line yourself.
 */
export function appendPlaylistItem(
  text: string,
  item: PlaylistItem,
): string | null {
  const song = yamlScalar(item.song);
  const lines = text.split("\n");
  const key = lines.findIndex((l) => ITEMS_LINE.test(l));

  /** The line(s) for the item, at a given indent. A variant needs a mapping, whose second key
   *  aligns under the first — past the `- `, which is why it is two more spaces and not the
   *  same indent. */
  const entry = (indent: string): string[] =>
    item.variant
      ? [
          `${indent}- song: ${song}`,
          `${indent}  variant: ${yamlScalar(item.variant)}`,
        ]
      : [`${indent}- ${song}`];

  // No `items:` at all — a file with only a title, or one somebody started. The key goes on
  // the end, which is where a reader looks for it and where it cannot land inside another
  // block by accident.
  if (key < 0) {
    const body = text.endsWith("\n") || text === "" ? text : `${text}\n`;
    return `${body}items:\n${entry("  ").join("\n")}\n`;
  }

  const after = (ITEMS_LINE.exec(lines[key] as string)?.[1] ?? "").trim();

  // `items: []` — what the stub writes. The empty flow becomes a block, since that is the
  // shape every line after it will be in.
  if (after === "[]") {
    lines.splice(key, 1, "items:", ...entry("  "));
    return lines.join("\n");
  }

  // A flow sequence with something in it, all on one line: extend it in its own notation
  // rather than converting, which would rewrite a line nobody asked us to touch.
  if (after.startsWith("[")) {
    if (!after.endsWith("]")) return null; // spread over lines — not ours to reflow
    if (item.variant) return null; // a mapping inside a flow list is a shape too far
    const inner = after.slice(1, -1).trim();
    lines[key] = `items: [${inner ? `${inner}, ` : ""}${song}]`;
    return lines.join("\n");
  }

  // Anything else on that line is not a sequence we can extend — `items: some-scalar`.
  if (after !== "") return null;

  // The block below the key: every line indented past it, blanks included. The last one that
  // is not blank is what the new entry follows, so a trailing blank line stays trailing.
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
