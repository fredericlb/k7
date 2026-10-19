// videoOutputs.ts — the picture's two built-in outputs, and the one thing the audio pair has no
// equivalent of: a project that declares a viewport and has no `RENDER: [ VIDEO_OUT ]` run gets
// one WRITTEN, rather than warned about. An edit by key path, so a hand-commented graph.k7x survives it.
// Full rationale: docs/videoOutputs.md.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { K7Document, type K7Scope } from "@studio/k7x/document";
import { stringify } from "@studio/k7x/print";
import { RENDER_NODE, VIDEO_OUT_NODE } from "@studio/song-schema/moduleTypes";
import { CHAINS_DIR } from "@studio/song-schema/yaml/chainSchema";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { chainTaken } from "./chainCreate";
import { isChainProject, readChainProject } from "./chainProject";
import { wsData, wsText, wsWriteText } from "./yaml/workspaceDoc";

/** Does this graph's expanded data declare the run — a `RENDER` KEY, not merely a destination naming it? */
export const hasVideoRun = (graph: Record<string, unknown>): boolean => {
  const modules = graph.modules;
  return !!modules && typeof modules === "object" && RENDER_NODE in modules;
};

/** Append the run to the END of the `modules` map, made when the file has none; false when `modules` is not a map. */
export function addVideoRun(doc: K7Scope): boolean {
  const modules = doc.getNode(["modules"]);
  if (modules && modules.kind !== "map") return false;
  doc.setIn(["modules", RENDER_NODE], [VIDEO_OUT_NODE]);
  return true;
}

/** Give `dir`'s graph the run if it has none — the CALLER decides there is a viewport, docs/videoOutputs.md. */
export function ensureVideoRun(dir: string): boolean {
  if (isChainProject(dir)) return ensureChainVideoRun(resolve(dir));
  const file = join(resolve(dir), GRAPH_FILE);
  if (!existsSync(file)) return false;
  try {
    if (hasVideoRun(wsData(file))) return false;
    // The file as written, not its expansion: a `runs` short form stays, since the run joins `modules` beside it.
    const doc = new K7Document(wsText(file));
    if (!addVideoRun(doc.at([]))) return false;
    wsWriteText(file, doc.toString());
    return true;
  } catch {
    return false;
  }
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
    wsWriteText(
      join(dir, CHAINS_DIR, `${name}.k7x`),
      stringify({
        start: RENDER_NODE,
        steps: [{ to: [{ chain: VIDEO_OUT_NODE }] }],
      }),
    );
  } catch {
    return false;
  }
  return true;
}
