// Every reference graph here is also written out in a k7-core module's jsdsp.ts, since a module is a
// folder you can copy and carries its own source. This holds each pair to the same emitted graph.
// The auto-wah is not in the table: k7-core's adds an `Output` make-up stage the engine's fallback lacks.

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { chorus } from "./chorus";
import { crossfade } from "./crossfade";
import { echo } from "./echo";
import { fade } from "./fade";
import { flanger } from "./flanger";
import { type GraphJson, graph } from "./index";
import { noteRepeat } from "./noteRepeat";
import { phaser } from "./phaser";
import { sweepFilter } from "./sweep";
import { tremolo } from "./tremolo";

const MODULES = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "k7-core",
  "modules",
);

const PAIRS: [string, () => GraphJson][] = [
  ["audio/chorus/engines/classic", chorus],
  ["audio/phaser/engines/classic", phaser],
  ["audio/tremolo/engines/classic", tremolo],
  ["transformers/note-repeat", noteRepeat],
  ["audio/filter/engines/sweep", sweepFilter],
  ["audio/flanger", flanger],
  ["audio/delay/engines/echo", echo],
  ["audio/zz_utility/fade", fade],
  ["audio/zz_utility/crossfade", crossfade],
];

describe("the k7-core copies of the reference graphs", () => {
  it.each(PAIRS)("%s emits the same graph", async (dir, reference) => {
    const file = join(MODULES, dir, "jsdsp.ts");
    const m = await import(pathToFileURL(file).href);
    expect(graph(m.default)).toEqual(reference());
  });
});
