// chainCreate.ts — creating nodes and lanes in a chain project. A new node is one item in a chain of
// its own with no start and no ports: hidden until it is placed on the graph or wired. A new lane is
// its `tracks/` file plus a `start: true` chain holding it. Nothing here wires anything, but an
// input put in a lane's chain ahead of the lane, which IS its wiring.
// What would be got wrong: the name a caller asked for names the CHAIN; the node is its fresh id.
// See docs/chainFiles.md.

import { existsSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { K7Document } from "@studio/k7x/document";
import { lineCol } from "@studio/k7x/parse";
import { stringify } from "@studio/k7x/print";
import { parseChain } from "@studio/song-schema/yaml/chainFile";
import { CHAINS_DIR, TRACKS_DIR } from "@studio/song-schema/yaml/chainSchema";
import { chainFilePath, newNodeId, readChainProject } from "./chainProject";
import { wsText, wsWriteText } from "./yaml/workspaceDoc";

/** Whether `chains/<name>` is taken by a chain file. */
export const chainTaken = (dir: string, name: string): boolean =>
  existsSync(chainFilePath(dir, name));

/** A node file's k7x text as an item's data after a fresh id, and the `//` lines it opens with. */
function itemOf(body: string): {
  id: string;
  item: Record<string, unknown>;
  header: string[];
} {
  const src = new K7Document(body);
  const id = newNodeId();
  return { id, item: { id, ...src.toJS() }, header: src.header };
}

/** Write a node, given as a node file's k7x text, as the one item of a new loose chain `chain`; its id and file. */
export function createChainNode(
  dir: string,
  chain: string,
  body: string,
): { id: string; rel: string } {
  const rel = `${CHAINS_DIR}/${chain}.k7x`;
  if (chainTaken(dir, chain))
    throw new Error(`${rel} already exists — refusing to overwrite`);
  const { id, item, header } = itemOf(body);
  mkdirSync(join(dir, CHAINS_DIR), { recursive: true });
  wsWriteText(join(dir, rel), stringify({ steps: [item] }, { header }));
  return { id, rel };
}

/** A new lane: `tracks/<lane>.k7x` holding `body` (k7x text), and the `start: true` chain that plays it. */
export function createChainLane(
  dir: string,
  lane: string,
  body: string,
): string[] {
  const track = `${TRACKS_DIR}/${lane}.k7x`;
  if (existsSync(join(dir, track)))
    throw new Error(`track '${lane}' already exists (${track})`);
  const chain = `${CHAINS_DIR}/${lane}.k7x`;
  if (chainTaken(dir, lane))
    throw new Error(
      `${chain} already exists — a lane's chain is named after it`,
    );
  mkdirSync(join(dir, TRACKS_DIR), { recursive: true });
  mkdirSync(join(dir, CHAINS_DIR), { recursive: true });
  wsWriteText(join(dir, track), body);
  wsWriteText(
    join(dir, chain),
    stringify({ start: true, steps: [{ id: newNodeId(), track: lane }] }),
  );
  return [track, chain];
}

/** Put an input, given as a node file's k7x text, in the lane's chain just ahead of the lane — docs/chainFiles.md. */
export function insertChainInput(
  dir: string,
  lane: string,
  body: string,
): { id: string; rel: string } {
  const at = readChainProject(dir).nodes[lane];
  if (!at?.track) throw new Error(`no lane '${lane}' in a chain`);
  if (at.sub || at.item !== null)
    throw new Error(
      `'${lane}' sits inside a subchain or a parallel step — wire its input by hand`,
    );
  const path = chainFilePath(dir, at.chain);
  const doc = new K7Document(wsText(path));
  const steps = doc.getNode(["steps"]);
  if (steps?.kind !== "list") throw new Error(`${at.chain} has no steps`);
  const { id, item, header } = itemOf(body);
  doc.insertIn(["steps"], at.step, item);
  const added = doc.getNode(["steps", at.step]);
  // The body's own description goes above the item, when the item has a line of its own to sit under it.
  const own = added && doc.text.lastIndexOf("\n", added.start) > steps.start;
  if (header.length && added && own) {
    const pad = " ".repeat(lineCol(doc.text, added.start).col - 1);
    const lead = header.map((l) => `// ${l}`.trimEnd()).join(`\n${pad}`);
    const src = doc.getSource(["steps", at.step]) ?? "";
    doc.replaceSource(["steps", at.step], `${lead}\n${pad}${src}`);
  }
  const out = doc.toString();
  const parsed = parseChain(out);
  if (!parsed.value)
    throw new Error(
      `the input would make ${at.chain} unreadable — ${parsed.issues[0]?.message ?? ""}`.trim(),
    );
  wsWriteText(path, out);
  return { id, rel: relative(dir, path) };
}
