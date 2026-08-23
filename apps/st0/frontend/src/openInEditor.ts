// Which file `ui file` was asking for — the resolution behind App's openInEditor, on its own so a
// test holds the RULE rather than a copy of it. What it decides is one path out of what the tree
// holds; opening it, and revealing the pane, are the shell's.

import { materialRefOf } from "@studio/song-schema/placementId";
import { fuzzyScore } from "./fuzzy";

/** The file `arg` names, or null: an exact path, then the best fuzzy match, then the MATERIAL behind a placement — and null rather than `arg`. */
export function resolveEditorFile(arg: string, files: string[]): string | null {
  if (!arg) return null;
  const best = (q: string): string | null =>
    files
      .map((p) => ({ p, score: fuzzyScore(q, p) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score || a.p.localeCompare(b.p))[0]?.p ??
    null;
  const material = materialRefOf(arg);
  return (
    (files.includes(arg) ? arg : null) ??
    best(arg) ??
    (material === arg ? null : best(material))
  );
}
