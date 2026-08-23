// videoOutputs.ts — the picture's two built-in outputs, and the one thing the audio pair has no
// equivalent of: a project that declares a viewport and has no `RENDER: [ VIDEO_OUT ]` run gets
// one WRITTEN, rather than warned about. Textual, so a hand-commented graph.yaml survives it.
// Full rationale: docs/videoOutputs.md.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { RENDER_NODE, VIDEO_OUT_NODE } from "./moduleTypes";
import { GRAPH_FILE } from "./yaml/graphSchema";

/** The line itself, indented for a block mapping — one spelling, shared by the scaffold. */
export const VIDEO_RUN_LINE = `  ${RENDER_NODE}: [ ${VIDEO_OUT_NODE} ]`;

/**
 * Does this graph declare the run — a `RENDER:` KEY, not merely a destination naming it?
 *
 * The key is what makes it a run; a lane wired `main: [ RENDER ]` names the sum without saying
 * where the sum goes, and that project still needs the line. Exactly the test `migrateMixOut.ts`
 * makes for `MIX:`, and for the same reason.
 */
export const hasVideoRun = (text: string): boolean =>
  new RegExp(`^\\s*${RENDER_NODE}\\s*:`, "m").test(text);

/**
 * Append the run to the `modules:` map, after its last entry — or null when there is no map.
 *
 * Textual rather than parse-and-dump, which is the rule every writer of a graph.yaml here
 * follows: the file is commented and hand-edited, and re-emitting it would reformat the whole
 * thing to add one line. Placed at the END because that is where the signal arrives — a reader
 * following the arrows down the file reaches the sums last, and the picture's after the sound's.
 *
 * A block mapping's extent is "the indented lines under the key", so a comment indented with the
 * map belongs to it and is stepped over; only the next unindented line ends it.
 *
 * Null for a graph with no `modules:` at all. Inventing the map to hold one line would be writing
 * a file the project never had — the same refusal `migrateMixOut.ts` makes.
 */
export function addVideoRun(text: string): string | null {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^modules\s*:/.test(l));
  if (start === -1) return null;
  let end = start;
  for (let i = start + 1; i < lines.length; i++) {
    // A blank line inside the block is not the end of it — only the next unindented line is.
    if (lines[i].trim() === "") continue;
    if (!/^\s/.test(lines[i])) break;
    end = i;
  }
  lines.splice(end + 1, 0, VIDEO_RUN_LINE);
  return lines.join("\n");
}

/**
 * Give `dir`'s graph the picture's run if it has none. True when the file was rewritten.
 *
 * **Does not ask whether the project HAS a viewport** — the caller has already decided that, and
 * the two callers know it differently: `createSurfaceFile` is the one writing the surface, and the
 * file service is opening a project whose surfaces it has just read. Asking again here would mean
 * importing `surfaces.ts`, which imports this, and the cycle would be to re-answer a settled
 * question.
 *
 * Best-effort by design. A graph.yaml that is not there, is not readable, or holds no `modules:`
 * map leaves the project alone and returns false: this runs on the OPEN path, and a project that
 * fails to gain a convenience must still open.
 */
export function ensureVideoRun(dir: string): boolean {
  const file = join(resolve(dir), GRAPH_FILE);
  if (!existsSync(file)) return false;
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return false;
  }
  if (hasVideoRun(text)) return false;
  const next = addVideoRun(text);
  if (next === null) return false;
  try {
    writeFileSync(file, next, "utf8");
  } catch {
    return false;
  }
  return true;
}
