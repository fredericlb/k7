// linkLevels.ts — a chain project's link `level`s laid onto the derived chains' `out[].gain`, the
// field the compile turns into a send's level and the graph view tags. Segments carry no gain, so
// every out derives at 1; this is the one place a written level reaches it. docs/chainFiles.md.
// What would be got wrong: only a link to a BUS can be played at a level; the rest are named, not dropped.

import { splitPort } from "@studio/song-schema/moduleTypes";
import type { Chain } from "./graph";

/** The node a chain's outs leave from: its last step, else its source — the `<from>` of a level key. */
const lastNodeOf = (c: Chain): string | undefined =>
  c.use.length ? c.use[c.use.length - 1].module : c.from;

/** Each out's gain from `levels` (keyed `<from>><to>` as toSegments spells it), in place. */
export function applyLinkLevels(
  chains: Record<string, Chain>,
  levels: Record<string, number>,
): void {
  if (!Object.keys(levels).length) return;
  for (const c of Object.values(chains)) {
    const from = lastNodeOf(c);
    if (!from) continue;
    for (const o of c.out) {
      const lv = levels[`${from}>${o.to}`];
      if (lv !== undefined) o.gain = lv;
    }
  }
}

/** Is `to` a bus the compile sends to — a chain of its own, entered by its main input, fed by no lane. */
const isBusTarget = (
  chains: Record<string, Chain>,
  to: string,
  isSink: (to: string) => boolean,
  isLane: (n: string) => boolean,
): boolean => {
  if (splitPort(to).port || isSink(to)) return false;
  const c = chains[to];
  return !!c && !(c.from && isLane(c.from));
};

/** A level other than unity on a link the engine document has no gain for — said, since it is not played. */
export function unplayedLevels(
  chains: Record<string, Chain>,
  isSink: (to: string) => boolean,
  isLane: (n: string) => boolean,
): string[] {
  const w: string[] = [];
  for (const [name, c] of Object.entries(chains))
    for (const o of c.out)
      if (o.gain !== 1 && !isBusTarget(chains, o.to, isSink, isLane))
        w.push(
          `chain '${name}': the level ${o.gain} on its link to '${o.to}' is not played — only a link to a bus carries one`,
        );
  return w;
}
