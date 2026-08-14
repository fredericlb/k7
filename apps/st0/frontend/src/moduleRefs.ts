// moduleRefs.ts — how a médiathèque module is NAMED by a file that points at it. The
// catalogue speaks in paths (`modules/audio/utility/mixer`); `extends:` and a chain step
// speak in refs (`@st0/audio/utility/mixer`). See ../docs/completion.md.

import type { MediatekEntry } from "@studio/mediatek/types";

/**
 * The level the médiathèque's modules are named under.
 *
 * Spelt out rather than imported: the canonical `MEDIATEK_REF` lives in
 * `@studio/song/mediatekRoot`, which reaches for `node:os` to find the folder — a browser
 * cannot pull that in to learn one word. `ChainEditor` states `chains.yaml` for the same
 * reason. The vocabulary is the contract; the path resolver is not.
 */
export const MEDIATEK_REF = "@st0";

/**
 * A modules listing as the refs another file may name it by, sorted.
 *
 * The family segment is dropped because the namespace replaces it: the folder
 * `modules/audio/utility/mixer` is the module `@st0/audio/utility/mixer`, which is what
 * `mediatekPathPrefix` maps back the other way.
 */
export function mediatekModuleRefs(entries: MediatekEntry[]): string[] {
  const refs = new Set<string>();
  for (const e of entries) {
    // A folder with no module.yaml is drawn in the tree but is not a module — offering it
    // would complete to a ref that resolves to nothing.
    if (e.meta?.catalogued === false) continue;
    const sub = e.path.replace(/^modules\//, "");
    if (sub && sub !== e.path) refs.add(`${MEDIATEK_REF}/${sub}`);
  }
  return [...refs].sort();
}
