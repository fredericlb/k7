// chainCreate.ts — creating nodes and lanes in a chain project. A new node is one item in a chain of
// its own with no start and no ports: hidden until it is placed on the graph or wired. A new lane is
// its `tracks/` file plus a `start: true` chain holding it. Nothing here wires anything, but an
// input put in a lane's chain ahead of the lane, which IS its wiring.
// What would be got wrong: the name a caller asked for names the CHAIN; the node is its fresh id.
// See docs/chainFiles.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseChain } from "@studio/song-schema/yaml/chainFile";
import { CHAINS_DIR, TRACKS_DIR } from "@studio/song-schema/yaml/chainSchema";
import {
  Document,
  isMap,
  isSeq,
  parseDocument,
  type YAMLMap,
  YAMLSeq,
} from "yaml";
import { newNodeId, readChainProject } from "./chainProject";

const OPTS = { version: "1.2" as const, strict: false };

/** Whether `chains/<name>` is taken — a chain file of that name, either extension. */
export const chainTaken = (dir: string, name: string): boolean =>
  existsSync(join(dir, CHAINS_DIR, `${name}.yaml`)) ||
  existsSync(join(dir, CHAINS_DIR, `${name}.yml`));

/** Write a node, given as a node file's text, as the one item of a new loose chain `chain`; its id and file. */
export function createChainNode(
  dir: string,
  chain: string,
  body: string,
): { id: string; rel: string } {
  if (chainTaken(dir, chain))
    throw new Error(
      `${CHAINS_DIR}/${chain}.yaml already exists — refusing to overwrite`,
    );
  const src = parseDocument(body, OPTS);
  const id = newNodeId();
  const doc = new Document({ steps: [] }, OPTS);
  const item = doc.createNode({ id }) as YAMLMap<unknown, unknown>;
  // The body's fields after the id, each pair moved whole so its comments come along.
  if (isMap(src.contents))
    for (const p of src.contents.items) item.items.push(p);
  const steps = new YAMLSeq();
  steps.items.push(item);
  doc.set("steps", steps);
  doc.commentBefore = src.commentBefore ?? src.contents?.commentBefore ?? null;
  mkdirSync(join(dir, CHAINS_DIR), { recursive: true });
  const rel = `${CHAINS_DIR}/${chain}.yaml`;
  writeFileSync(join(dir, rel), doc.toString({ lineWidth: 0 }), "utf8");
  return { id, rel };
}

/** A new lane: `tracks/<lane>.yaml` holding `body`, and the `start: true` chain that plays it. */
export function createChainLane(
  dir: string,
  lane: string,
  body: string,
): string[] {
  const track = `${TRACKS_DIR}/${lane}.yaml`;
  if (existsSync(join(dir, track)))
    throw new Error(`track '${lane}' already exists (${track})`);
  if (chainTaken(dir, lane))
    throw new Error(
      `${CHAINS_DIR}/${lane}.yaml already exists — a lane's chain is named after it`,
    );
  mkdirSync(join(dir, TRACKS_DIR), { recursive: true });
  mkdirSync(join(dir, CHAINS_DIR), { recursive: true });
  writeFileSync(join(dir, track), body, "utf8");
  const chain = `${CHAINS_DIR}/${lane}.yaml`;
  writeFileSync(
    join(dir, chain),
    `start: true\nsteps:\n  - { id: ${newNodeId()}, track: ${JSON.stringify(lane)} }\n`,
    "utf8",
  );
  return [track, chain];
}

/** Put an input, given as a node file's text, in the lane's chain just ahead of the lane — docs/chainFiles.md. */
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
  const yml = join(dir, CHAINS_DIR, `${at.chain}.yaml`);
  const path = existsSync(yml) ? yml : join(dir, CHAINS_DIR, `${at.chain}.yml`);
  const doc = parseDocument(readFileSync(path, "utf8"), OPTS);
  const steps = doc.get("steps");
  if (!isSeq(steps)) throw new Error(`${at.chain} has no steps`);
  const src = parseDocument(body, OPTS);
  const id = newNodeId();
  const item = doc.createNode({ id }) as YAMLMap<unknown, unknown>;
  if (isMap(src.contents))
    for (const p of src.contents.items) item.items.push(p);
  item.commentBefore = src.commentBefore ?? src.contents?.commentBefore;
  steps.items.splice(at.step, 0, item);
  const out = doc.toString({ lineWidth: 0 });
  const parsed = parseChain(out);
  if (!parsed.value)
    throw new Error(
      `the input would make ${at.chain} unreadable — ${parsed.issues[0]?.message ?? ""}`.trim(),
    );
  writeFileSync(path, out, "utf8");
  return { id, rel: `${CHAINS_DIR}/${at.chain}.yaml` };
}
