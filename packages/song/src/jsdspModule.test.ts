// A module whose DSP is the `jsdsp.ts` beside it — `plugin: {type: jsdsp}`, the form an author
// writes and the médiathèque's own modules use.
//
// `enginePlugin` maps that type to the engine's built-in graph host, but the compiler's "is
// this a format the engine can load" gate ran FIRST and did not know the word, so every module
// in the new form was dropped from the compiled doc. Silently: a step whose module contributes
// no plugin is exactly how a bypass looks, so nothing warned and the modules simply were not
// there. These pin the gate.

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";

const here = dirname(fileURLToPath(import.meta.url));
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "engine",
  "capot",
  "songs",
  "synth-demo",
);

let dir: string;

/** Rewrite the fixture's instrument as a jsdsp module, source and compiled graph beside it. */
function asJsDsp(withGraph: boolean): void {
  const folder = join(dir, "modules", "instruments", "synth");
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

const plugins = () =>
  compileNodeProject(dir).tracks.flatMap((t) => t.plugins ?? []);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-jsdsp-"));
  cpSync(SONG, dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a jsdsp module", () => {
  it("reaches the engine at all", () => {
    // The regression in one assertion: it used to contribute nothing, like a missing module.
    asJsDsp(false);
    expect(plugins().some((p) => p.id.endsWith(":synth:lead"))).toBe(true);
  });

  it("arrives as the engine's graph host, not as the word the author wrote", () => {
    // The engine has no `jsdsp` plugin: it loads the built-in host and is handed the graph.
    asJsDsp(false);
    const p = plugins().find((x) => x.id.endsWith(":synth:lead"));
    expect(p?.type).toBe("DSP Graph");
    expect(p?.name).toBe("synth:lead"); // the module names it — a built-in has no scan entry
  });

  it("carries its compiled graph inline, since the engine parses no files", () => {
    asJsDsp(true);
    const p = plugins().find((x) => x.id.endsWith(":synth:lead"));
    expect(p?.dspGraph).toContain("Cutoff");
  });

  it("still compiles when the graph has not been built yet", () => {
    // Source but no compiled JSON beside it: the module is real, its parameters are simply not
    // known yet. That must cost the parameters, not the node — otherwise a module would come
    // and go from the song depending on whether its graph had been built.
    asJsDsp(false);
    const p = plugins().find((x) => x.id.endsWith(":synth:lead"));
    expect(p?.type).toBe("DSP Graph");
    expect(JSON.parse(p?.dspGraph ?? "null")).toEqual({}); // an empty graph, not a missing node
  });
});
