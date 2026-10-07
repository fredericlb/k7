// nodePlace.ts — where a chain project's unnamed node SITS, as a person reads it: `chain · step n`.
// A node's name is its uuid, which is what every command and the wire carry; this is only what is
// SHOWN beside it, on a card, a tooltip, a completion. Re-exported by graph.ts. docs/chainFiles.md.

import { calledSubchains, itemsOf } from "@studio/song-schema/yaml/chainSchema";
import {
  type ChainNode,
  isChainProject,
  nameOfItem,
  readChainProject,
} from "./chainProject";

/** What an unnamed node is shown as: where it sits, and the module it extends when it extends one. */
export interface NodePlace {
  place: string;
  uses?: string;
}

/** `chain · step n` (`chain › sub` inside a subchain), steps from 1, and `n.k` for the k-th of a side-by-side step. */
export const placeOf = (
  n: Pick<ChainNode, "chain" | "sub" | "step" | "item">,
): string =>
  `${n.sub ? `${n.chain} › ${n.sub}` : n.chain} · step ${n.step + 1}${n.item === null ? "" : `.${n.item + 1}`}`;

/** Every unnamed node by its name (its id) — a lane has a name of its own, and none here. */
export function nodePlaces(dir: string): Record<string, NodePlace> {
  if (!isChainProject(dir)) return {};
  const out: Record<string, NodePlace> = {};
  for (const n of Object.values(readChainProject(dir).nodes)) {
    if (n.track) continue;
    const ext = (n.value as { extends?: unknown }).extends;
    out[n.name] = {
      place: placeOf(n),
      ...(typeof ext === "string" ? { uses: ext } : {}),
    };
  }
  return out;
}

/** The line a list shows for an unnamed node: its module, then its place. */
export const nodeCaption = (p: NodePlace): string =>
  p.uses ? `${p.uses} · ${p.place}` : p.place;

/** Each subchain RUN in place, its nodes in order — what a row stacks into one column; undefined outside a chain project. */
export function nodeStacks(dir: string): string[][] | undefined {
  if (!isChainProject(dir)) return undefined;
  const out: string[][] = [];
  for (const c of Object.values(readChainProject(dir).chains)) {
    const called = calledSubchains(c);
    for (const sc of c.subchains ?? [])
      if (called.has(sc.id))
        out.push(sc.steps.flatMap(itemsOf).map(nameOfItem));
  }
  return out;
}
