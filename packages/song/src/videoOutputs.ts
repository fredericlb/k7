// videoOutputs.ts — the picture's two built-in outputs, and the one thing the audio pair has no
// equivalent of: a project that declares a viewport and has no `RENDER: [ VIDEO_OUT ]` run gets
// one WRITTEN, rather than warned about. Textual, so a hand-commented graph.yaml survives it.
// Full rationale: docs/videoOutputs.md.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { RENDER_NODE, VIDEO_OUT_NODE } from "@studio/song-schema/moduleTypes";
import { CHAINS_DIR } from "@studio/song-schema/yaml/chainSchema";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { chainTaken } from "./chainCreate";
import { isChainProject, readChainProject } from "./chainProject";

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
  if (isChainProject(dir)) return ensureChainVideoRun(resolve(dir));
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

/** The same in a chain project: a chain starting at RENDER, written when none does. */
function ensureChainVideoRun(dir: string): boolean {
  const cp = readChainProject(dir);
  if (Object.values(cp.chains).some((c) => c.start === RENDER_NODE))
    return false;
  // A chain file that would not read may be the one that starts there: guessing would write a second.
  if (cp.issues.length) return false;
  let name = "picture";
  for (let i = 2; chainTaken(dir, name); i++) name = `picture-${i}`;
  try {
    writeFileSync(
      join(dir, CHAINS_DIR, `${name}.yaml`),
      `start: ${RENDER_NODE}\nsteps:\n  - to:\n      - { chain: ${VIDEO_OUT_NODE} }\n`,
      "utf8",
    );
  } catch {
    return false;
  }
  return true;
}
