// chainProject.ts — a project kept as `chains/*.yaml`, read into and written back from the SEGMENT
// graph everything downstream already reads. A node's in-memory name is its lane name or its id.
// The two directions (chainSegments.ts) must round-trip: a graph edit is a transform over segments.
// What would be got wrong: a chain without a start that nothing links is hidden, unless it is PLACED.
// See docs/chainFiles.md.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { stripDocExt } from "@studio/song-schema/docExt";
import { formatChain, parseChain } from "@studio/song-schema/yaml/chainFile";
import {
  CHAINS_DIR,
  type ChainFile,
  type Item,
  isVideoTrackItem,
  itemsOf,
  LAYOUT_FILE,
  laneOfItem,
  stepLists,
} from "@studio/song-schema/yaml/chainSchema";
import type { GraphFile } from "@studio/song-schema/yaml/graphSchema";
import { parse, stringify } from "yaml";
import { toSegments } from "./chainSegments";
import {
  isDocName,
  realPath,
  wsExists,
  wsIssues,
  wsRead,
  wsRemove,
  wsWrite,
} from "./yaml/workspaceFile";

export {
  type FromSegmentsOptions,
  fromSegments,
  pictureLaneOf,
  toSegments,
} from "./chainSegments";

/** One node as the loader sees it: where it sits, and what it says. */
export interface ChainNode {
  name: string;
  id: string;
  chain: string;
  /** The subchain of `chain` it sits in, absent for the chain's own steps. */
  sub?: string;
  step: number;
  /** Its index in a parallel step; null for a step holding one item. */
  item: number | null;
  /** The lane it IS, of either kind — an audio lane's file is in `tracks/`, a picture lane's in `video_tracks/`. */
  track?: string;
  /** Set on a PICTURE lane: it holds no module, and its placements are not in `tracks/`. */
  picture?: true;
  /** The item as written — module fields plus `id`, `bypass`, `vstpreset`, `mapping`. */
  value: Item;
}

export interface ChainProject {
  chains: Record<string, ChainFile>;
  /** The chains marked `hidden`, set aside whole: no node of theirs is in `nodes`, and no writer rewrites them. */
  hidden?: Record<string, ChainFile>;
  /** Each chain file's text as read, so a rewrite keeps its comments (formatChain). */
  texts: Record<string, string>;
  nodes: Record<string, ChainNode>;
  issues: string[];
}

export type Positions = NonNullable<GraphFile["positions"]>;

/** Its presence IS the format: a project with `chains/` is read from it, and never from graph.yaml. */
export function isChainProject(dir: string): boolean {
  const d = join(dir, CHAINS_DIR);
  return wsExists(d) && statSync(d).isDirectory();
}

/** The name a node is known by in memory, in commands and on the wire: its lane, else its id. */
export const nameOfItem = (i: Item): string => laneOfItem(i) ?? i.id;

/** The file chain `chain` is read from and written to: `.k7x`, else `.yaml`, else `.yml`; `.yaml` for a new one. */
export function chainFilePath(dir: string, chain: string): string {
  const base = join(dir, CHAINS_DIR, chain);
  const yaml = realPath(`${base}.yaml`);
  const yml = realPath(`${base}.yml`);
  return existsSync(yaml) || !existsSync(yml) ? yaml : yml;
}

/** Every chain file, parsed; a file that fails is reported and left out rather than half-read. */
export function readChainProject(dir: string): ChainProject {
  const out: ChainProject = { chains: {}, texts: {}, nodes: {}, issues: [] };
  const folder = join(dir, CHAINS_DIR);
  if (!wsExists(folder)) return out;
  // By chain NAME, each read once from chainFilePath, since `x.k7x` and `x.yaml` are one chain.
  const names = new Set<string>();
  for (const f of readdirSync(folder)) {
    const name = stripDocExt(f);
    if (name && isDocName(f)) names.add(name);
  }
  // `polysynth-copy` sorts before `polysynth` by file name but not by chain name, and lanes follow this order.
  for (const name of [...names].sort((p, q) => (p < q ? -1 : p > q ? 1 : 0))) {
    const file = chainFilePath(dir, name);
    const f = basename(file);
    const text = wsRead(file);
    const { value, issues } = parseChain(text);
    for (const i of wsIssues(file, issues))
      out.issues.push(
        `${CHAINS_DIR}/${f}${i.line ? `:${i.line}:${i.col}` : ""}: ${i.path ? `${i.path}: ` : ""}${i.message}`,
      );
    if (!value) continue;
    // A hidden chain is not part of the project as compiled: its lane, its nodes and its links are all left out.
    if (value.hidden) {
      out.hidden = { ...out.hidden, [name]: value };
      continue;
    }
    out.chains[name] = value;
    out.texts[name] = text;
    for (const { sub, steps } of stepLists(value))
      steps.forEach((step, s) => {
        const items = itemsOf(step);
        items.forEach((it, k) => {
          const n = nameOfItem(it);
          if (out.nodes[n])
            out.issues.push(
              `${CHAINS_DIR}/${f}: "${n}" is already a node of chain "${out.nodes[n].chain}"`,
            );
          out.nodes[n] = {
            name: n,
            id: it.id,
            chain: name,
            ...(sub ? { sub } : {}),
            step: s,
            item: Array.isArray(step) ? k : null,
            ...(laneOfItem(it) ? { track: laneOfItem(it) } : {}),
            ...(isVideoTrackItem(it) ? { picture: true as const } : {}),
            value: it,
          };
        });
      });
  }
  return out;
}

export function readLayout(dir: string): Positions {
  const f = join(dir, LAYOUT_FILE);
  if (!wsExists(f)) return {};
  const raw = parse(wsRead(f))?.positions;
  return raw && typeof raw === "object" ? (raw as Positions) : {};
}

export function writeLayout(dir: string, positions: Positions): void {
  const f = join(dir, LAYOUT_FILE);
  if (!Object.keys(positions).length) {
    if (wsExists(f)) wsRemove(f);
    return;
  }
  const flow = Object.fromEntries(Object.entries(positions));
  const text = stringify(
    { positions: flow },
    { lineWidth: 0, flowCollectionPadding: true },
  )
    // One card per line: a move is a one-line diff.
    .replace(
      /^ {2}(\S.*):\n {4}x: (.+)\n {4}y: (.+)$/gm,
      "  $1: { x: $2, y: $3 }",
    );
  wsWrite(f, text);
}

/** Write every chain that changed and remove the files of chains that are gone. */
export function writeChainProject(
  dir: string,
  chains: Record<string, ChainFile>,
  prevTexts: Record<string, string> = {},
): void {
  const folder = join(dir, CHAINS_DIR);
  mkdirSync(folder, { recursive: true });
  for (const [name, c] of Object.entries(chains)) {
    const text = formatChain(c, prevTexts[name] ?? "");
    if (text !== prevTexts[name]) wsWrite(chainFilePath(dir, name), text);
  }
  for (const name of Object.keys(prevTexts))
    if (!chains[name]) {
      for (const ext of [".yaml", ".yml"]) {
        const f = join(folder, `${name}${ext}`);
        if (wsExists(f)) wsRemove(f);
      }
    }
}

/** A fresh node id — every node written gets one, and a copy gets a new one (docs/chainFiles.md). */
export const newNodeId = (): string => randomUUID();

/** Each link's level keyed `<from>><to>` as `toSegments` spells it — empty for a project of segments. */
export function loadLinkLevels(dir: string): Record<string, number> {
  if (!isChainProject(dir)) return {};
  return toSegments(readChainProject(dir), readLayout(dir)).levels;
}
