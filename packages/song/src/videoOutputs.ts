// videoOutputs.ts — the picture's two built-in outputs, and the one thing the audio pair has no
// equivalent of: a project that declares a viewport and has no `RENDER: [ VIDEO_OUT ]` run gets
// one WRITTEN, rather than warned about. Textual, so a hand-commented graph.yaml survives it.
// Full rationale: docs/videoOutputs.md.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { RENDER_NODE, VIDEO_OUT_NODE } from "@studio/song-schema/moduleTypes";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";

/** The line itself, indented for a block mapping — one spelling, shared by the scaffold. */
export const VIDEO_RUN_LINE = `  ${RENDER_NODE}: [ ${VIDEO_OUT_NODE} ]`;

/** Does this graph declare the run — a `RENDER:` KEY, not merely a destination naming it? */
export const hasVideoRun = (text: string): boolean =>
  new RegExp(`^\\s*${RENDER_NODE}\\s*:`, "m").test(text);

/** Append the run to the END of the `modules:` map, TEXTUALLY, or null when there is no map — docs/videoOutputs.md. */
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

/** Give `dir`'s graph the run if it has none — the CALLER decides there is a viewport, docs/videoOutputs.md. */
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
