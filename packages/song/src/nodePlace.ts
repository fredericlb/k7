// nodePlace.ts — where a chain project's unnamed node SITS, as a person reads it: `chain · step n`.
// A node's name is its uuid, which is what every command and the wire carry; this is only what is
// SHOWN beside it, on a card, a tooltip, a completion. Re-exported by graph.ts. docs/chainFiles.md.

import {
  type ChainNode,
  isChainProject,
  readChainProject,
} from "./chainProject";

/** What an unnamed node is shown as: where it sits, and the module it extends when it extends one. */
export interface NodePlace {
  place: string;
  uses?: string;
}

/** `chain · step n`, steps counted from 1, and `n.k` for the k-th node of a side-by-side step. */
export const placeOf = (
  n: Pick<ChainNode, "chain" | "step" | "item">,
): string =>
  `${n.chain} · step ${n.step + 1}${n.item === null ? "" : `.${n.item + 1}`}`;

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
