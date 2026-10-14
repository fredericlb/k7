// `sequence edit roll|tracker <sequence>` — reading the line, and turning the name in it into
// a file of this project. The two grids these open are the same ones the popin editor tabs
// mount (@studio/ui-editor/tracker/plugin); what is here is only which one, and on what.

import { fuzzyScore } from "./fuzzy";
import { isSeqFile } from "./projectPaths";

/** Which grid: the piano roll, or the tracker. */
export type SeqView = "roll" | "tracker";

const HEAD = /^sequence\s+edit\s+(roll|tracker)\b\s*(.*)$/i;

/** Read `sequence edit roll <name>`; null when the line is not one of the two, and the name may be empty while the bar is filling it. */
export function parseSeqEdit(
  line: string,
): { view: SeqView; name: string } | null {
  const m = HEAD.exec(line.trim());
  if (!m) return null;
  return { view: m[1].toLowerCase() as SeqView, name: m[2].trim() };
}

/** The sequence file a typed name means — SEQUENCES FIRST, then the whole project; null is reported rather than opening an empty grid. */
export function resolveSequence(arg: string, files: string[]): string | null {
  if (!arg) return null;
  if (files.includes(arg)) return arg;
  const best = (pool: string[]): string | null =>
    pool
      .map((p) => ({ p, score: fuzzyScore(arg, p) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score || a.p.localeCompare(b.p))[0]?.p ??
    null;
  return best(files.filter(isSeqFile)) ?? best(files);
}
