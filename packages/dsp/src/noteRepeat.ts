// Note repeat — the keys you hold, re-struck on the song's grid until you let go. A MIDI GRAPH,
// not a compiled plugin: `hold` takes the keys, `strike` plays them on a clock, and the rate is
// ordinary control arithmetic over two parameters. See ../docs/builder.md on the MIDI nodes.

import { type GraphJson, graph } from "./index";

/** The reference note repeater. The step is `Count × Division` BEATS, so it follows the tempo. */
export function noteRepeat(): GraphJson {
  return graph((g) => {
    // Both in BEATS rather than as an index into a table: the graph has no array to index, and a
    // panel's dropdown writes the value it labels — 1/8 is 0.5, and that IS the number.
    const count = g.param("Count", { min: 1, max: 8, default: 1 });
    const division = g.param("Division", { min: 0.125, max: 4, default: 0.5 });
    const gate = g.param("Gate", { min: 0.05, max: 1, default: 0.5 });

    const m = g.hold(g.midi());
    g.strike(m, g.mul(count, division), gate);
  });
}
