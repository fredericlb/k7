// scaffoldSetFixture.ts — the library a scaffolded set's tests resolve against, for the two test files on a set.
// Inline rather than copied: the EQ's real file extends `@engine/equaliser`, which needs a plugin scan a test has not got.

import { join } from "node:path";
import { writeDoc } from "./testSupport";

/** Every module a set NAMES, at the k7-core seed's paths; `[module, panel?]` per path. */
const MODULES: Record<
  string,
  [Record<string, unknown>, Record<string, unknown>?]
> = {
  "cold/tempo": [
    {
      cold: true,
      plugin: { type: "offline", name: "Tempo" },
      params: { "Source BPM": 0, "Target BPM": 0 },
    },
    // A panel only where a test reads one back: a widget's range is INHERITED, which a node cannot state.
    {
      cols: 2,
      rows: 2,
      widgets: {
        target: {
          type: "knob",
          col: 0,
          row: 0,
          rowSpan: 2,
          label: "BPM",
          bind: "Target BPM",
          min: 10,
          max: 300,
          step: 0.1,
        },
        source: {
          type: "meter",
          col: 1,
          row: 0,
          rowSpan: 2,
          label: "Source",
          bind: "Source BPM",
        },
      },
    },
  ],
  "audio/zz_utility/fade": [
    { plugin: { type: "jsdsp", name: "Fade" }, params: { Level: 1 } },
  ],
  // The filter and the EQ are modules with ENGINES; the desk names one of each (docs/engines.md).
  "audio/filter": [{ engine: "biquad-2" }],
  "audio/filter/engines/sweep": [
    { plugin: { type: "jsdsp", name: "Sweep Filter" }, params: { Sweep: 0 } },
  ],
  "audio/filter/engines/biquad-2": [
    { plugin: { type: "internal", name: "airwindows_biquad2" } },
  ],
  "audio/zz_utility/trim": [
    { plugin: { type: "jsdsp", name: "Trim" }, params: { Trim: 0 } },
  ],
  "audio/zz_utility/gain": [
    { plugin: { type: "jsdsp", name: "Gain" }, params: { Gain: 0 } },
  ],
  // The deck's echo is the delay's `echo` engine, a node naming it by `engine`.
  "audio/delay": [{ engine: "echo" }],
  "audio/delay/engines/echo": [{ plugin: { type: "jsdsp", name: "Echo" } }],
  // No platter here: it is k7's own `@meta/audio/turntable`, which every test resolves (docs/metaModules.md).
  "audio/eq": [{ engine: "parametric" }],
  "audio/eq/engines/parametric": [
    { plugin: { type: "jsdsp", name: "Parametric EQ" } },
  ],
  "audio/eq/engines/tracktion": [
    {
      plugin: { type: "internal", name: "Equaliser" },
      params: {
        "Low-shelf gain": 0,
        "Mid gain 1": 0,
        "High-shelf gain": 0,
        "Low-shelf freq": 200,
        "Mid freq 1": 1000,
        "High-shelf freq": 6000,
        "Mid gain 2": 0,
      },
    },
  ],
};

/** Write those modules under the library folder `lib` (what `librariesFixture` returns). */
export function writeSetLibrary(lib: string): void {
  for (const [at, [module, panel]] of Object.entries(MODULES)) {
    const to = join(lib, "modules", ...at.split("/"));
    writeDoc(join(to, "module.k7x"), module);
    if (panel) writeDoc(join(to, "ui.k7x"), panel);
  }
}
