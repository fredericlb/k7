// videoOutputs.ts — the picture's two built-in outputs, and the one thing the audio pair has no
// equivalent of: a project that declares a viewport and has no `RENDER: [ VIDEO_OUT ]` run gets
// one WRITTEN, rather than warned about — and, once, the mix wired into `RENDER#audio`, the sound
// its export leaves with. An edit by key path, so a hand-commented graph.k7x survives it.
// What a reader gets wrong: the sound is wired ONCE, at level 5, so unwiring it later sticks.
// Full rationale: docs/videoOutputs.md.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { K7Document, type K7Scope } from "@studio/k7x/document";
import { stringify } from "@studio/k7x/print";
import {
  formatLevelOfText,
  RENDER_AUDIO_LEVEL,
} from "@studio/song-schema/formatLevel";
import {
  MIX_NODE,
  RENDER_AUDIO_IN,
  RENDER_NODE,
  VIDEO_OUT_NODE,
} from "@studio/song-schema/moduleTypes";
import { CHAINS_DIR } from "@studio/song-schema/yaml/chainSchema";
import { connectNodes } from "@studio/song-schema/yaml/graphFile";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { chainTaken } from "./chainCreate";
import { editChainGraph } from "./chainGraphEdit";
import { isChainProject, readChainProject } from "./chainProject";
import { stampFormatLevel } from "./formatStamp";
import { entityFileFor } from "./yaml/moduleIO";
import { wsData, wsEdit, wsText, wsWriteText } from "./yaml/workspaceDoc";

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

/** Wire the mix into RENDER's sound input unless something already is; false when `modules` is not a map. */
export function addRenderSound(doc: K7Scope): boolean {
  const modules = doc.getNode(["modules"]);
  if (modules && modules.kind !== "map") return false;
  try {
    connectNodes(doc, MIX_NODE, RENDER_AUDIO_IN);
  } catch (e) {
    // Wired already, by hand or by a `runs` line: the arrow the file holds stays as it is.
    if (!/already feeds/.test((e as Error).message)) throw e;
  }
  return true;
}

/** Wire the mix into RENDER#audio ONCE, the first time a build of level 5 opens it, then stamp it; docs/videoOutputs.md. */
export function ensureRenderSound(dir: string): boolean {
  const root = entityFileFor(dir, "", "project");
  if (!root) return false;
  try {
    if ((formatLevelOfText(wsText(root.path)) ?? 1) >= RENDER_AUDIO_LEVEL)
      return false;
    const edit = (g: K7Scope) => void addRenderSound(g);
    if (isChainProject(dir)) editChainGraph(resolve(dir), edit);
    else {
      const file = join(resolve(dir), GRAPH_FILE);
      if (!existsSync(file)) return false;
      wsEdit(file, (doc) => edit(doc.at([])), { raw: true });
    }
    return stampFormatLevel(dir, RENDER_AUDIO_LEVEL);
  } catch {
    return false; // best-effort, like the run: the next open tries again
  }
}

/** Give `dir`'s graph the run if it has none, and its sound once — the CALLER decides there is a viewport, docs/videoOutputs.md. */
export function ensureVideoRun(dir: string): boolean {
  const wrote = ensureRun(dir);
  // After the run, so a project gaining both gets its sound wired into the RENDER just written.
  ensureRenderSound(dir);
  return wrote;
}

function ensureRun(dir: string): boolean {
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
