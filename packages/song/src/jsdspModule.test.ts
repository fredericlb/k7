// A module whose DSP is the `jsdsp.ts` beside it — `plugin: {type: jsdsp}`, the form an author
// writes and the médiathèque's own modules use.
//
// `enginePlugin` maps that type to the engine's built-in graph host, but the compiler's "is
// this a format the engine can load" gate runs FIRST and has to know the word, or the module is
// dropped from the compiled doc. Silently: a step whose module contributes no plugin is exactly
// how a bypass looks, so nothing warns and the module is simply not there. These pin the gate.

import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";

const here = dirname(fileURLToPath(import.meta.url));
const DEMOS = join(here, "..", "..", "..", "demos");
const SONG = join(DEMOS, "synth-demo.st0");

let ws: string;
let dir: string;

/** Rewrite the fixture's instrument as a jsdsp module, source and compiled graph beside it. */
function asJsDsp(withGraph: boolean): void {
  const folder = join(ws, "_modules", "instruments", "synth");
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "module.yaml"),
    "plugin:\n  type: jsdsp\n  name: Synth\n",
    "utf8",
  );
  writeFileSync(join(folder, "jsdsp.ts"), "// dsp\n", "utf8");
  if (withGraph)
    writeFileSync(
      join(folder, "jsdsp.json"),
      JSON.stringify({ params: [{ name: "Cutoff", min: 0, max: 1 }] }),
      "utf8",
    );
}

/** A `transformers/` module whose DSP is its own jsdsp.ts, wired BEFORE the melody's instrument.
 *  A jsdsp source needs its OWN folder (the file has one fixed name), so this lives at
 *  `@workspace`, referenced directly by ref since no node instantiates it. */
function midiGraphModule(): void {
  const folder = join(ws, "_modules", "transformers", "rpt");
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "module.yaml"),
    "plugin:\n  type: jsdsp\n  name: Note Repeat\n",
    "utf8",
  );
  writeFileSync(join(folder, "jsdsp.ts"), "// dsp\n", "utf8");
  writeFileSync(
    join(folder, "jsdsp.json"),
    JSON.stringify({ params: [], nodes: [{ type: "mhold" }] }),
    "utf8",
  );
  const graph = join(dir, "graph.yaml");
  writeFileSync(
    graph,
    readFileSync(graph, "utf8").replace(
      "melody: [ lead ]",
      'melody: [ "@workspace/transformers/rpt" ]\n  "@workspace/transformers/rpt": [ lead ]',
    ),
    "utf8",
  );
}

const plugins = () =>
  compileNodeProject(dir).tracks.flatMap((t) => t.plugins ?? []);

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "td-jsdsp-"));
  dir = join(ws, "synth-demo.st0");
  cpSync(SONG, dir, { recursive: true });
  // The Examples workspace's own shared library, beside every demo project.
  cpSync(join(DEMOS, "_modules"), join(ws, "_modules"), { recursive: true });
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

describe("a jsdsp module", () => {
  it("reaches the engine at all", () => {
    // The whole point in one assertion: contributing nothing would make it a missing module.
    asJsDsp(false);
    expect(plugins().some((p) => p.id.endsWith(":lead"))).toBe(true);
  });

  it("arrives as the MIDI graph host when its TYPE FOLDER says notes", () => {
    // One authored word, `jsdsp`, and two hosts: Tracktion routes an audio effect after the
    // instrument and a MIDI one before it, so a plugin cannot be both — packages/song/docs/enginePlugin.md.
    midiGraphModule();
    const p = plugins().find((x) => x.id.endsWith("transformers/rpt"));
    expect(p?.type).toBe("MIDI Graph");
    expect(p?.dspGraph).toContain("mhold");
    // …and the audio one is unchanged, from the same authored word.
    asJsDsp(false);
    expect(plugins().find((x) => x.id.endsWith(":lead"))?.type).toBe(
      "DSP Graph",
    );
  });

  it("arrives as the engine's graph host, not as the word the author wrote", () => {
    // The engine has no `jsdsp` plugin: it loads the built-in host and is handed the graph.
    asJsDsp(false);
    const p = plugins().find((x) => x.id.endsWith(":lead"));
    expect(p?.type).toBe("DSP Graph");
    expect(p?.name).toBe("lead"); // the module names it — a built-in has no scan entry
  });

  it("carries its compiled graph inline, since the engine parses no files", () => {
    asJsDsp(true);
    const p = plugins().find((x) => x.id.endsWith(":lead"));
    expect(p?.dspGraph).toContain("Cutoff");
  });

  it("still compiles when the graph has not been built yet", () => {
    // No compiled JSON costs the PARAMETERS, not the node, or the module comes and goes.
    asJsDsp(false);
    const p = plugins().find((x) => x.id.endsWith(":lead"));
    expect(p?.type).toBe("DSP Graph");
    expect(JSON.parse(p?.dspGraph ?? "null")).toEqual({}); // an empty graph, not a missing node
  });
});
