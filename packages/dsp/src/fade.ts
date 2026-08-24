// A fade — one input, one gain, and a `Side` that says which way the gain runs. Two of them facing
// opposite ways ARE a crossfade, without the second port the crossfade needs: each deck keeps its own
// ordinary track and its own ordinary output, and the blend happens where they meet at the mixer.
//
// Why that matters rather than being a rewrite for its own sake: docs/catalogue.md.

import { type GraphJson, graph } from "./index";

export function fade(): GraphJson {
  return graph((g) => {
    // What the desk's one control drives, on BOTH sides at once — the opposition is `Side`, not the value.
    const mix = g.param("Mix", { min: 0, max: 1, default: 0 });
    // 0 fades OUT as Mix rises, 1 fades IN. A node's own setting, never a control's.
    const side = g.param("Side", { min: 0, max: 1, default: 0 });
    // (1−Side)·(1−Mix) + Side·Mix — no branch among the primitives, so the choice is arithmetic.
    const gain = g.add(g.mul(g.sub(1, side), g.sub(1, mix)), g.mul(side, mix));
    g.output(g.amul(g.input(0), gain));
  });
}
