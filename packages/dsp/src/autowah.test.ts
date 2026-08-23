// The auto-wah exists twice: written in JS here, and hand-written as a fallback string in the engine
// (GraphDspPlugin::defaultGraphJson). Two copies of one thing is a drift waiting to happen — the kind where the
// engine's fallback quietly stops matching what the library emits and nobody notices until a module without a
// `dsp:` sounds different from one with it. So the test reads the C++ SOURCE and compares.
//
// It is a plain deep-equal because the C++ copy IS the emitted file, pasted. A first cut hand-wrote the C++
// version with readable wire names (env, floorDb, travel) and reused one register across three nodes; the test
// then needed a normalisation step to call the two equal, which is a sign the comparison had started
// accommodating a divergence rather than preventing one. Pasting the generated text removes the divergence.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { autoWah } from "./autowah";
import type { GraphJson } from "./index";

const here = dirname(fileURLToPath(import.meta.url));

/** The raw string literal the engine falls back to, lifted out of the C++. */
function engineDefaultGraph(): GraphJson {
  const cpp = readFileSync(
    join(
      here,
      "..",
      "..",
      "..",
      "engine",
      "moteur",
      "engine",
      "GraphDspPlugin.cpp",
    ),
    "utf8",
  );
  const m = /R"\(([\s\S]*?)\)"/.exec(cpp);
  if (!m) throw new Error("no raw string literal in GraphDspPlugin.cpp");
  return JSON.parse(m[1]) as GraphJson;
}

describe("the auto-wah graph", () => {
  it("declares the parameters the module shows", () => {
    const g = autoWah();
    expect(g.params.map((p) => p.name)).toEqual([
      "Low",
      "High",
      "Sensitivity",
      "Resonance",
      "Attack",
      "Release",
      "Mix",
      "Direction",
    ]);
    // Direction is the only one with settings, which is what makes it a dropdown rather than a knob.
    expect(g.params.find((p) => p.name === "Direction")?.labels).toEqual([
      "up",
      "down",
    ]);
    expect(g.params.filter((p) => p.labels).length).toBe(1);
  });

  it("matches the fallback graph compiled into the engine", () => {
    expect(autoWah()).toEqual(engineDefaultGraph());
  });

  it("is what graphs/autowah.json holds — the file a module's `dsp:` points at", () => {
    // The committed artifact is what runs, so this catches a library change nobody re-emitted.
    const committed = JSON.parse(
      readFileSync(join(here, "..", "graphs", "autowah.json"), "utf8"),
    ) as GraphJson;
    expect(autoWah()).toEqual(committed);
  });

  it("reads the sample rate rather than hard-coding a ceiling", () => {
    // A Nyquist clamp is the one thing a literal cannot express, and getting it wrong is a NaN downstream.
    const g = autoWah();
    expect(JSON.stringify(g.nodes)).toContain('"sr"');
  });
});
