// mixFile.ts — read `mix.yaml`, the desk's cue sheet: parse, validate, and hand back where this
// set drops the needle. Browser-safe (no fs), because the app that DRAWS a desk is the one that
// needs it. Full rationale: docs/mixFile.md.

import { isMap, isSeq, LineCounter, parseDocument } from "yaml";
import { songIdOf } from "../songRef";
import { MARKER_SLOTS, type MixFile, MixFileSchema } from "./mixSchema";
import type { ModuleIssue } from "./moduleFile";

/** The cue sheet's filename, at the root of the project — named once, see docs/deskFiles.md. */
export const MIX_BASE = "mix";

// YAML 1.2 for the reason every other file here pins it: a scalar shaped like `5:1:1` stays a string.
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
  // A bare sequence at the root is named precisely, being the first thing anyone writes (docs/deskFiles.md).
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

/** Every song the sheet names, deduplicated and SORTED — its line order means nothing (docs/deskFiles.md). */
export function cueRefs(file: MixFile | null | undefined): string[] {
  const refs = (file?.cues ?? []).map((s) =>
    typeof s === "string" ? s : s.ref,
  );
  return [...new Set(refs)].sort();
}

/** Every song's cue points by ref, positional — index 0 is button 1 (docs/deskFiles.md). */
export function cueMarkers(
  file: MixFile | null | undefined,
): Record<string, (number | null)[]> {
  const out: Record<string, (number | null)[]> = {};
  for (const s of file?.cues ?? [])
    if (typeof s !== "string" && s.markers) out[s.ref] = s.markers;
  return out;
}

/** One song's line, as a plain object — whatever the file said, in whichever of the two shapes. */
interface Entry {
  ref: string;
  markers?: (number | null)[];
}

/** Read one entry back out of the document, so a writer can change ONE field and keep the rest.
 *
 * `withMarkers` replaces the whole node, so anything else on the line would go with it. One writer
 * needs this today; it is kept because the next field added here would otherwise silently eat the
 * cues, which is exactly what happened when a grid correction briefly lived on this line. */
function entryAt(cues: unknown, at: number, ref: string): Entry {
  const item = (cues as { items: unknown[] }).items[at];
  if (at < 0 || !isMap(item)) return { ref };
  const markers = item.get("markers", true);
  return {
    ref,
    ...(isSeq(markers)
      ? {
          markers: markers.items.map((m) => {
            const v = (m as { value?: unknown })?.value ?? m;
            return typeof v === "number" ? v : null;
          }),
        }
      : {}),
  };
}

/** Find this ref's line, change it, and write it back — a bare ref again when nothing is left. */
function editEntry(
  text: string,
  ref: string,
  change: (e: Entry) => Entry,
): string {
  const doc = parseDocument(text, OPTS);
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

  const next = change(entryAt(cues, at, ref));
  // Nothing but the ref: back to a bare string, so a cleared song leaves no empty map behind.
  const bare = !next.markers?.length;
  const node = bare ? doc.createNode(ref) : doc.createNode({ ...next });
  // Cues on one line: eight numbers down the page would bury the ref they belong to.
  if (!bare && isMap(node)) {
    const m = node.get("markers", true);
    if (isSeq(m)) m.flow = true;
  }
  if (at >= 0) cues.items[at] = node;
  else cues.add(node);
  return String(doc);
}

/** Set one song's cue points IN the text, appending a ref the file does not name — docs/deskFiles.md. */
export function withMarkers(
  text: string,
  ref: string,
  markers: readonly (number | null)[],
): string {
  const kept = [...markers].slice(0, MARKER_SLOTS);
  while (kept.length && kept[kept.length - 1] == null) kept.pop();
  return editEntry(text, ref, (e) => ({
    ...e,
    ...(kept.length ? { markers: kept } : { markers: undefined }),
  }));
}

/** The médiathèque ids the sheet names — the refs with their `@k7-core/` taken off. */
export function cueIds(file: MixFile | null | undefined): string[] {
  return cueRefs(file)
    .map(songIdOf)
    .filter((id): id is string => !!id);
}
