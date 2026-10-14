// The note repeater's graph. The builder arrives as an ARGUMENT, so this file imports nothing at
// runtime — a song folder has no node_modules and should never need one (the `import type` is
// erased; see dspRunner.mjs).
//
// This is @studio/dsp's `noteRepeatGraph()`, written out here: a module is a FOLDER you can copy,
// so it carries its own source rather than pointing at a shared library.
// packages/dsp/src/noteRepeat.test.ts holds the shared copy to its shape.
//
// `hold` before `strike` is the circuit; the four nodes between them say which strikes play and how
// loud (engine/k7-runtime/docs/midiGraph.md). After the strike they would apply a block late.

import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  // In BEATS, not an index into a table: the panel's dropdown writes the value it labels — "1/8" is 0.5.
  const count = g.param("Count", { min: 1, max: 8, default: 1 });
  const division = g.param("Division", { min: 0.125, max: 4, default: 0.5 });
  const gate = g.param("Gate", { min: 0.05, max: 1, default: 0.5 });
  // The share of velocity each repeat loses, and the chance a step plays at all.
  const decay = g.param("Decay", { min: 0, max: 1, default: 0 });
  const chance = g.param("Chance", { min: 0, max: 1, default: 1 });
  // The rhythm: 0 every step, 1 a burst, 2 Euclid — over `Length` steps, `Density` of them playing.
  const pattern = g.param("Pattern", { min: 0, max: 2, default: 0 });
  const length = g.param("Length", { min: 1, max: 32, default: 16 });
  const density = g.param("Density", { min: 0, max: 1, default: 0.5 });
  const rotate = g.param("Rotate", { min: 0, max: 1, default: 0 });
  // Accents: the share of hits played as played, the level of the others, and two switches.
  const accents = g.param("Accents", { min: 0, max: 1, default: 1 });
  const low = g.param("Low", { min: 0, max: 1, default: 0.5 });
  const opposite = g.param("Opposite", { min: 0, max: 1, default: 0 });
  const keep = g.param("Keep", { min: 0, max: 1, default: 0 });

  const m = g.hold(g.midi());
  g.pattern(m, pattern, length, density, rotate);
  g.accent(m, accents, low, opposite, keep);
  g.chance(m, chance);
  g.decay(m, decay);
  g.strike(m, g.mul(count, division), gate);
};
