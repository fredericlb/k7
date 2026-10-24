// chainProject.ts — a project kept as `chains/*.k7x`, read into and written back from the SEGMENT
// graph everything downstream already reads. A node's in-memory name is its lane name or its id.
// The two directions (chainSegments.ts) must round-trip: a graph edit is a transform over segments.
// What would be got wrong: a chain without a start that nothing links is hidden, unless it is PLACED.
// See docs/chainFiles.md.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { printKey } from "@studio/k7x/print";
import { isDocFile, stripDocExt } from "@studio/song-schema/docExt";
import { PICTURE_TRACK_REF } from "@studio/song-schema/moduleTypes";
import { formatChain, parseChain } from "@studio/song-schema/yaml/chainFile";
import {
  CHAINS_DIR,
  type ChainFile,
  type Item,
  isTrackItem,
  isVideoTrackItem,
  itemsOf,
  LAYOUT_FILE,
  laneOfItem,
  stepLists,
  TRACKS_DIR,
} from "@studio/song-schema/yaml/chainSchema";
import type { GraphFile } from "@studio/song-schema/yaml/graphSchema";
import { toSegments } from "./chainSegments";
import { wsData, wsEdit, wsText, wsWriteText } from "./yaml/workspaceDoc";

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
  /** The lane it IS, of either kind — both a sound lane's file and a picture lane's are in `tracks/`. */
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

/** Its presence IS the format: a project with `chains/` is read from it, and never from graph.k7x. */
export function isChainProject(dir: string): boolean {
  const d = join(dir, CHAINS_DIR);
  return existsSync(d) && statSync(d).isDirectory();
}

/** Whether `tracks/<lane>.k7x` is a PICTURE lane: it extends `@meta/picture-track` (docs/chainFiles.md). */
function isPictureLaneFile(dir: string, lane: string): boolean {
  const file = join(dir, TRACKS_DIR, `${lane}.k7x`);
  try {
    return existsSync(file) && wsData(file).extends === PICTURE_TRACK_REF;
  } catch {
    return false; // a lane file that will not read is reported where it is loaded
  }
}

/** The name a node is known by in memory, in commands and on the wire: its lane, else its id. */
export const nameOfItem = (i: Item): string => laneOfItem(i) ?? i.id;

/** The file chain `chain` is read from and written to. */
export const chainFilePath = (dir: string, chain: string): string =>
  join(dir, CHAINS_DIR, `${chain}.k7x`);

/** Every chain file, parsed; a file that fails is reported and left out rather than half-read. */
export function readChainProject(dir: string): ChainProject {
  const out: ChainProject = { chains: {}, texts: {}, nodes: {}, issues: [] };
  const folder = join(dir, CHAINS_DIR);
  if (!existsSync(folder)) return out;
  const names = new Set<string>();
  for (const f of readdirSync(folder)) {
    const name = stripDocExt(f);
    if (name && isDocFile(f)) names.add(name);
  }
  // `polysynth-copy` sorts before `polysynth` by file name but not by chain name, and lanes follow this order.
  for (const name of [...names].sort((p, q) => (p < q ? -1 : p > q ? 1 : 0))) {
    const file = chainFilePath(dir, name);
    const f = basename(file);
    const text = wsText(file);
    const { value, issues } = parseChain(text);
    for (const i of issues)
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
            ...(isVideoTrackItem(it) ||
            (isTrackItem(it) && isPictureLaneFile(dir, it.track))
              ? { picture: true as const }
              : {}),
            value: it,
          };
        });
      });
  }
  return out;
}

export function readLayout(dir: string): Positions {
  const f = join(dir, LAYOUT_FILE);
  if (!existsSync(f)) return {};
  const raw = wsData(f).positions;
  return raw && typeof raw === "object" ? (raw as Positions) : {};
}

/** The pins, set by the fewest edits so a moved card is a one-value diff; no pin left removes the file. */
export function writeLayout(dir: string, positions: Positions): void {
  const f = join(dir, LAYOUT_FILE);
  if (!Object.keys(positions).length) {
    rmSync(f, { force: true });
    return;
  }
  if (existsSync(f)) {
    wsEdit(f, (doc) => doc.applyIn([], { positions }));
    return;
  }
  // A new file puts one card a line, so every later move is a one-line diff.
  const cards = Object.entries(positions).map(
    ([k, p]) => `  ${printKey(k)}: { x: ${p.x}, y: ${p.y} },\n`,
  );
  wsWriteText(f, `positions({\n${cards.join("")}})\n`);
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
    if (text !== prevTexts[name]) wsWriteText(chainFilePath(dir, name), text);
  }
  for (const name of Object.keys(prevTexts))
    if (!chains[name]) rmSync(chainFilePath(dir, name), { force: true });
}

/** A fresh node id — every node written gets one, and a copy gets a new one (docs/chainFiles.md). */
export const newNodeId = (): string => randomUUID();

/** Each link's level keyed `<from>><to>` as `toSegments` spells it — empty for a project of segments. */
export function loadLinkLevels(dir: string): Record<string, number> {
  if (!isChainProject(dir)) return {};
  return toSegments(readChainProject(dir), readLayout(dir)).levels;
}
