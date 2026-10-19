// mixFile.ts — read `mix.k7x`, the desk's cue sheet: parse, validate, and hand back where this
// set drops the needle. Browser-safe (no fs), because the app that DRAWS a desk is the one that
// needs it. Full rationale: docs/mixFile.md.

import type { K7Scope } from "@studio/k7x/document";
import { songIdOf } from "../songRef";
import { parseK7xWith } from "./k7xIssues";
import { MARKER_SLOTS, type MixFile, MixFileSchema } from "./mixSchema";
import type { ModuleIssue } from "./moduleFile";

/** The cue sheet's filename, at the root of the project — named once, see docs/deskFiles.md. */
export const MIX_BASE = "mix";

export interface ParsedMix {
  value: MixFile | null;
  issues: ModuleIssue[];
}

/** Parse the cue sheet's k7x text; an empty file is a sheet with nothing cued. */
export function parseMix(text: string): ParsedMix {
  return parseK7xWith(MixFileSchema, text);
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

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Set one song's cue points in the sheet, appending a ref it does not name; a song left with none goes back to a bare ref. */
export function withMarkers(
  doc: K7Scope,
  ref: string,
  markers: readonly (number | null)[],
): void {
  const kept = [...markers].slice(0, MARKER_SLOTS);
  while (kept.length && kept[kept.length - 1] == null) kept.pop();
  const cues = doc.getIn(["cues"]);
  const list = Array.isArray(cues) ? cues : [];
  if (!Array.isArray(cues)) doc.setIn(["cues"], []);
  const at = list.findIndex((item) =>
    isRecord(item) ? item.ref === ref : item === ref,
  );
  const entry = at >= 0 ? list[at] : undefined;
  // Cues on one line: eight numbers down the page would bury the ref they belong to.
  const inline = { inline: true };
  if (isRecord(entry)) {
    const others = Object.keys(entry).filter(
      (k) => k !== "ref" && k !== "markers",
    );
    if (kept.length) doc.setIn(["cues", at, "markers"], kept, inline);
    else if (others.length) doc.deleteIn(["cues", at, "markers"]);
    else doc.setIn(["cues", at], ref);
    return;
  }
  if (!kept.length) {
    if (at < 0) doc.addIn(["cues"], ref);
    return;
  }
  const cued = { ref, markers: kept };
  if (at >= 0) doc.setIn(["cues", at], cued, inline);
  else doc.addIn(["cues"], cued, inline);
}

/** The médiathèque ids the sheet names — the refs with their `@k7-core/` taken off. */
export function cueIds(file: MixFile | null | undefined): string[] {
  return cueRefs(file)
    .map(songIdOf)
    .filter((id): id is string => !!id);
}
