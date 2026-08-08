// songsFile.ts — read songs.yaml: parse, validate, and hand back the set's refs deduplicated
// and sorted. Browser-safe (no fs), because the app that DRAWS a set list is the one that
// needs it. Full rationale: docs/songsFile.md.

import { isMap, isSeq, LineCounter, parseDocument } from "yaml";
import { songIdOf } from "../songRef";
import type { ModuleIssue } from "./moduleFile";
import {
  MARKER_SLOTS,
  type SongsFile,
  SongsFileSchema,
} from "./songsSchema";

// YAML 1.2 for the reason every other file here pins it (moduleFile.ts): a scalar shaped like
// `5:1:1` stays a string. A ref carries no colon today, and the day one does it must not
// silently become a number.
const OPTS = { version: "1.2" as const };

export interface ParsedSongs {
  value: SongsFile | null;
  issues: ModuleIssue[];
}

export function parseSongs(text: string): ParsedSongs {
  const lines = new LineCounter();
  const doc = parseDocument(text, { ...OPTS, lineCounter: lines });
  const issues: ModuleIssue[] = [];
  for (const e of doc.errors) {
    const pos = lines.linePos(e.pos[0]);
    issues.push({ path: "", message: e.message, line: pos.line, col: pos.col });
  }
  if (issues.length) return { value: null, issues };

  const raw = doc.toJS() ?? {};
  // A bare sequence at the root — `- "@mediatek/songs/…"` with no `songs:` key. Named
  // precisely rather than reported as "expected object": it is the first thing anyone writes,
  // and the fix is one line.
  if (Array.isArray(raw))
    return {
      value: null,
      issues: [
        {
          path: "",
          message:
            "songs.yaml is a mapping with a `songs:` key, not a bare list — indent the " +
            "entries under `songs:`.",
        },
      ],
    };

  const result = SongsFileSchema.safeParse(raw);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const keys = (issue as { keys?: string[] }).keys;
      const path = [...issue.path, ...(keys?.length ? [keys[0]] : [])];
      issues.push({ path: path.map(String).join("."), message: issue.message });
    }
    return { value: null, issues };
  }
  return { value: result.data, issues: [] };
}

/**
 * The set's songs: every ref it names, deduplicated and SORTED.
 *
 * Sorted because the list is unordered and something has to decide what a surface draws
 * first; doing it here rather than in each surface is what stops two screens showing the
 * same set in two orders. The file's own line order is therefore not meaningful, which is
 * the point — a set list's running order is decided at the desk, not in git.
 */
export function songRefs(file: SongsFile | null | undefined): string[] {
  const refs = (file?.songs ?? []).map((s) => (typeof s === "string" ? s : s.ref));
  return [...new Set(refs)].sort();
}

/**
 * Every song's cue points, by ref — the slot list exactly as the file wrote it.
 *
 * Positional: index 0 is button 1, and a `null` is an empty slot. Trailing empties are absent
 * rather than null, so a caller reads a missing index as an empty button too.
 */
export function songMarkers(
  file: SongsFile | null | undefined,
): Record<string, (number | null)[]> {
  const out: Record<string, (number | null)[]> = {};
  for (const s of file?.songs ?? [])
    if (typeof s !== "string" && s.markers) out[s.ref] = s.markers;
  return out;
}

/**
 * Set one song's cue points, IN the text — comments, order and every other entry untouched.
 *
 * A round trip through `toJS()` and a dump would rewrite the file: the scaffold's comments are
 * the one worked example a reader of an m9 set gets, and a desk that ate them the first time
 * somebody dropped a cue would be a desk nobody forgives. So this edits the parsed document
 * and re-prints it, which is what the `yaml` package's Document exists for.
 *
 * A ref the file does not name is APPENDED. That is not a courtesy: a deck can be playing a
 * song somebody removed from the list a moment ago, and refusing the cue would lose a gesture
 * the DJ has already made.
 *
 * Trailing empties are trimmed, and a song whose last cue is cleared goes back to a bare ref —
 * so a set list nobody has cued reads exactly as it did before any of this existed.
 */
export function withMarkers(
  text: string,
  ref: string,
  markers: readonly (number | null)[],
): string {
  const doc = parseDocument(text, OPTS);
  const kept = [...markers].slice(0, MARKER_SLOTS);
  while (kept.length && kept[kept.length - 1] == null) kept.pop();

  let songs = doc.get("songs", true);
  if (!isSeq(songs)) {
    doc.set("songs", doc.createNode([]));
    songs = doc.get("songs", true);
  }
  if (!isSeq(songs)) return text; // unreachable; the set above just made one

  const at = songs.items.findIndex((item) => {
    if (isMap(item)) return item.get("ref") === ref;
    // A scalar node, or the plain string a permissive parse may have left.
    const v = (item as { value?: unknown })?.value ?? item;
    return v === ref;
  });

  const node = kept.length
    ? doc.createNode({ ref, markers: kept })
    : doc.createNode(ref);
  // Cues on one line: eight numbers down the page would bury the ref they belong to.
  if (kept.length && isMap(node)) {
    const m = node.get("markers", true);
    if (isSeq(m)) m.flow = true;
  }
  if (at >= 0) songs.items[at] = node;
  else songs.add(node);
  return String(doc);
}

/** The médiathèque ids a set names — the refs with their `@mediatek/` taken off. */
export function songIds(file: SongsFile | null | undefined): string[] {
  return songRefs(file)
    .map(songIdOf)
    .filter((id): id is string => !!id);
}
