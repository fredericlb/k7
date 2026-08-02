// A flanger — the effect that needed BOTH of the last two additions: a delay whose output feeds back into its
// own input, and something to sweep its time per sample. Neither existed two steps ago.
//
// The delay is short (a few ms) and swept, so the comb notches it creates slide up and down the spectrum. That
// sliding IS the effect; a fixed short delay is just a slightly hollow tone.

import { type GraphJson, graph } from "./index";

export function flanger(): GraphJson {
  return graph((g) => {
    const rate = g.param("Rate", { min: 0.05, max: 10, default: 0.4 });
    const depth = g.param("Depth", { min: 0, max: 8, default: 3 });
    const centre = g.param("Centre", { min: 0.5, max: 12, default: 5 });
    const feedback = g.param("Feedback", { min: 0, max: 0.9, default: 0.5 });
    const mix = g.param("Mix", { min: 0, max: 1, default: 0.5 });

    const dry = g.input();
    // centre + depth·sin(2π·rate·t), in milliseconds, evaluated every sample.
    const timeMs = g.aadd(g.amul(g.lfo("sine", rate), depth), centre);

    const fb = g.wire("fb");
    const into = g.aadd(dry, g.amul(fb, feedback));
    g.delay(into, timeMs, 20, fb); // 20 ms ceiling: allocated once, so it bounds Centre + Depth
    g.output(g.aadd(dry, fb));
    g.mix(mix);
  });
}
