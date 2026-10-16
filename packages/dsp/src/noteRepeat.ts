// Note repeat — the keys you hold, re-struck on the song's grid until you let go. A MIDI GRAPH,
// not a compiled plugin: `hold` takes the keys, `strike` plays them on a clock, and between the two
// four nodes say which strikes play and how loud. See ../docs/builder.md on the MIDI nodes.

import { type GraphBuilder, type GraphJson, graph } from "./index";

/** The note repeater's graph; k7-core's note-repeat jsdsp.ts is a copy, held to it by k7core.test.ts. */
function noteRepeatGraph(g: GraphBuilder): void {
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
}

/** The reference note repeater. The step is `Count × Division` BEATS, so it follows the tempo. */
export function noteRepeat(): GraphJson {
  return graph(noteRepeatGraph);
}
