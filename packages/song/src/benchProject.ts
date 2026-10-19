// benchProject.ts — a synthetic project of N lanes, written to a temp folder, for the benches.
// Not a demo fixture: those hold ONE lane, and the numbers quoted (`graphDoc` at ~278 ms) are for some seventy nodes.
// Parameterised because what a bench shows is the CURVE: a cost that quadruples when the song doubles is the finding.

import { mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "@studio/k7x/print";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { writeProjectFiles } from "./scaffold";

/** How big a synthetic song is: lanes, and notes on each. */
export interface BenchSize {
  lanes: number;
  notesPerLane: number;
}

/** The two shapes the benches run, named so a result reads without a legend. */
export const BENCH_SIZES: Record<string, BenchSize> = {
  small: { lanes: 8, notesPerLane: 32 },
  large: { lanes: 64, notesPerLane: 32 },
};

/** `lanes` sequence lanes, each its own NODE of the shared synth so the module map grows too. */
export function benchProjectFiles(size: BenchSize): Record<string, string> {
  const files: Record<string, string> = {
    "project.k7x": stringify({
      project: {
        name: "bench",
        tempo: 120,
        sampleRate: 48000,
        timeSignature: "4/4",
      },
    }),
    "settings.k7x": stringify({ metronome: false, count_in: 0 }),
  };

  const notes = Array.from({ length: size.notesPerLane }, (_, n) => ({
    t: n * 0.5,
    d: 0.25,
    k: 36 + (n % 24),
  }));

  // Its own isolated `mkdtemp`, with no workspace beside it: each synth is inline, not a shared module.
  const modules: Record<string, string[]> = {};
  for (let i = 0; i < size.lanes; i++) {
    files[`nodes/lane${i}.k7x`] = stringify({
      extends: "@meta/track",
      events: [{ ref: `seq${i}`, start: "1:1:1" }],
    });
    files[`nodes/synth${i}.k7x`] = stringify({
      plugin: { type: "internal", name: "4osc" },
    });
    files[`sequences/seq${i}.k7x`] = stringify({ notes });
    modules[`lane${i}`] = [`synth${i}`];
    modules[`synth${i}`] = ["OUT"];
  }
  files[GRAPH_FILE] = stringify({ modules });
  return files;
}

/** …to its OWN `mkdtemp` and nothing outside it, with every mtime aged (docs/benchSettle.md). */
export function writeBenchProject(size: BenchSize): string {
  // The `.k7` suffix is load-bearing: without it the folder is invisible to `Workspace`.
  const dir = join(mkdtempSync(join(tmpdir(), "studio-bench-")), "bench.k7");
  const files = benchProjectFiles(size);
  writeProjectFiles(dir, files);
  // An hour back, or the fixture sits inside `yamlCache`'s 2 s SETTLE_MS and cannot be cached.
  const when = new Date(Date.now() - 3_600_000);
  for (const rel of Object.keys(files)) utimesSync(join(dir, rel), when, when);
  return dir;
}
