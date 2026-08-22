// mixFile.ts — read `mix.yaml`, the desk's cue sheet: parse, validate, and hand back where this
// set drops the needle. Browser-safe (no fs), because the app that DRAWS a desk is the one that
// needs it. Full rationale: docs/mixFile.md.

import { isMap, isSeq, LineCounter, parseDocument } from "yaml";
import { songIdOf } from "../songRef";
import { MARKER_SLOTS, type MixFile, MixFileSchema } from "./mixSchema";
import type { ModuleIssue } from "./moduleFile";

/** The cue sheet's filename, at the root of the project. Named once — every reader takes it
 *  from here rather than spelling it, which is what `views/mix.yaml` is NOT (see mixViewFile). */
export const MIX_BASE = "mix";

// YAML 1.2 for the reason every other file here pins it (moduleFile.ts): a scalar shaped like
// `5:1:1` stays a string. A ref carries no colon today, and the day one does it must not
// silently become a number.
const OPTS = { version: "1.2" as const };

export interface ParsedMix {
  value: MixFile | null;
  issues: ModuleIssue[];
}

export function parseMix(text: string): ParsedMix {
  const lines = new LineCounter();
  const doc = parseDocument(text, { ...OPTS, lineCounter: lines });
  const issues: ModuleIssue[] = [];
  for (const e of doc.errors) {
    const pos = lines.linePos(e.pos[0]);
    issues.push({ path: "", message: e.message, line: pos.line, col: pos.col });
  }
  if (issues.length) return { value: null, issues };

  const raw = doc.toJS() ?? {};
  // A bare sequence at the root — `- "@st0/songs/…"` with no `cues:` key. Named precisely
  // rather than reported as "expected object": it is the first thing anyone writes, and the
  // fix is one line.
  if (Array.isArray(raw))
    return {
      value: null,
      issues: [
        {
          path: "",
          message:
            "mix.yaml is a mapping with a `cues:` key, not a bare list — indent the " +
            "entries under `cues:`.",
        },
      ],
    };

  const result = MixFileSchema.safeParse(raw);
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
 * Every song the sheet names, deduplicated and SORTED.
 *
 * Sorted because the list is unordered and something has to decide what a reader sees first.
 * The file's own line order is therefore not meaningful, which is the point — a set's running
 * order is decided at the desk, not in git.
 */
export function cueRefs(file: MixFile | null | undefined): string[] {
  const refs = (file?.cues ?? []).map((s) =>
    typeof s === "string" ? s : s.ref,
  );
  return [...new Set(refs)].sort();
}

/**
 * Every song's cue points, by ref — the slot list exactly as the file wrote it.
 *
 * Positional: index 0 is button 1, and a `null` is an empty slot. Trailing empties are absent
 * rather than null, so a caller reads a missing index as an empty button too.
 */
export function cueMarkers(
  file: MixFile | null | undefined,
): Record<string, (number | null)[]> {
  const out: Record<string, (number | null)[]> = {};
  for (const s of file?.cues ?? [])
    if (typeof s !== "string" && s.markers) out[s.ref] = s.markers;
  return out;
}

/**
 * Set one song's cue points, IN the text — comments, order and every other entry untouched.
 *
 * A round trip through `toJS()` and a dump would rewrite the file: the scaffold's comments are
 * the one worked example a reader of a set gets, and a desk that ate them the first time
 * somebody dropped a cue would be a desk nobody forgives. So this edits the parsed document
 * and re-prints it, which is what the `yaml` package's Document exists for.
 *
 * A ref the file does not name is APPENDED. That is not a courtesy: a deck can be playing a
 * song somebody removed from the playlist a moment ago, and refusing the cue would lose a
 * gesture the DJ has already made.
 *
 * Trailing empties are trimmed, and a song whose last cue is cleared goes back to a bare ref —
 * so a sheet nobody has cued reads exactly as it did before any of this existed.
 */
export function withMarkers(
  text: string,
  ref: string,
  markers: readonly (number | null)[],
): string {
  const doc = parseDocument(text, OPTS);
  const kept = [...markers].slice(0, MARKER_SLOTS);
  while (kept.length && kept[kept.length - 1] == null) kept.pop();

  let cues = doc.get("cues", true);
  if (!isSeq(cues)) {
    doc.set("cues", doc.createNode([]));
    cues = doc.get("cues", true);
  }
  if (!isSeq(cues)) return text; // unreachable; the set above just made one

  const at = cues.items.findIndex((item) => {
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
  if (at >= 0) cues.items[at] = node;
  else cues.add(node);
  return String(doc);
}

/** The médiathèque ids the sheet names — the refs with their `@st0/` taken off. */
export function cueIds(file: MixFile | null | undefined): string[] {
  return cueRefs(file)
    .map(songIdOf)
    .filter((id): id is string => !!id);
}
