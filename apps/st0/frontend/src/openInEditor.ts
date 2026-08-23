// Which file `ui file` was asking for — the resolution behind App's openInEditor, on its own so a
// test holds the RULE rather than a copy of it. What it decides is one path out of what the tree
// holds; opening it, and revealing the pane, are the shell's.

import { materialRefOf } from "@studio/song-schema/placementId";
import { fuzzyScore } from "./fuzzy";

/**
 * The file `arg` names, or null when the project holds none.
 *
 * Three passes, in this order, and the order is the whole design:
 *
 * 1. **An exact path** stands as it is — a completion handed one back, and there is nothing to guess.
 * 2. **The best fuzzy match**, which is what lets `ui file <track>` be typed with a bare id.
 * 3. **The MATERIAL behind it**, because half the callers name a PLACEMENT. The right-click on an
 *    event offers `ui file` with a clip's id — `audio_14_0@98.5`, see `@studio/song/placementId` —
 *    and the file it wants is `clips/audio_14_0.yaml`. That `@98.5` is a subsequence of no path, so
 *    pass 2 scored −1 on every file and the editor opened on nothing at all.
 *
 * Third and not first: `materialRefOf` returns a material name unchanged, and an entity may
 * legitimately carry an `@`, so what was written gets the first say and this answers only when
 * nothing did.
 *
 * **Null rather than `arg`** when all three miss. Falling back to the text typed meant opening a
 * path nobody named, which reported an "open error" about a file that was never asked for — and by
 * then the pane had already been popped open on nothing.
 */
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
