// shownName.ts — what a person reads for a chain node: `<module> · <chain> · step n` when it is
// unnamed, its own name otherwise. The name itself (a uuid in a chain project) stays what commands,
// the wire and the files carry; this is only ever SHOWN. packages/song/docs/chainFiles.md.

import {
  splitPort,
  type WebChain,
  type WebChainStep,
} from "@studio/graph-model";
import { moduleDisplayName } from "./geometry";

/** One step's shown name: its module and place when the graph gave it a place, else its own name. */
export function stepShownName(
  s: Pick<WebChainStep, "module" | "uses" | "place">,
): string {
  if (!s.place) return s.module;
  return s.uses ? `${moduleDisplayName(s.uses)} · ${s.place}` : s.place;
}

/** A lookup from any node name (a `#port` kept as written) to what is shown for it; a name no step places is its own. */
export function shownNamesOf(
  steps: Iterable<Partial<Pick<WebChainStep, "module" | "uses" | "place">>>,
): (name: string) => string {
  const by = new Map<string, string>();
  for (const s of steps)
    if (s.module && s.place)
      by.set(s.module, stepShownName({ ...s, module: s.module }));
  return (name) => {
    const { node, port } = splitPort(name);
    const shown = by.get(node);
    if (!shown) return name;
    return port ? `${shown} #${port}` : shown;
  };
}

/** …over a graph's chains, which also names a chain HEADED by an unnamed node, keyed by that node's name. */
export const shownNames = (
  chains: Record<string, Pick<WebChain, "use">> | undefined,
): ((name: string) => string) =>
  shownNamesOf(Object.values(chains ?? {}).flatMap((c) => c.use));
