// benchProject.ts — a synthetic project of N lanes, written to a temp folder, for the benches.
//
// Not a fixture committed under `demos/`: those hold ONE lane, and the numbers this
// repo quotes (`graphDoc` at ~278 ms) are for a song of some seventy nodes. A one-lane
// fixture would measure startup and nothing else. Parameterised because what a bench has to show
// here is the CURVE — a cost that doubles when the song doubles is fine, one that quadruples is
// the finding.

import { mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    "project.yaml":
      "project:\n  name: bench\n  tempo: 120\n  sampleRate: 48000\n" +
      '  timeSignature: "4/4"\n',
    "settings.yaml": "metronome: false\ncount_in: 0\n",
  };

  const notes = Array.from(
    { length: size.notesPerLane },
    (_, n) => `  - { t: ${n * 0.5}, d: 0.25, k: ${36 + (n % 24)} }`,
  ).join("\n");

  // Its own isolated `mkdtemp`, with no workspace beside it — so each synth is inline rather
  // than a shared module the bench would have nowhere to put.
  const segments: string[] = [];
  for (let i = 0; i < size.lanes; i++) {
    files[`nodes/lane${i}.yaml`] =
      `extends: "@studio/track"\nevents:\n  - { ref: seq${i}, start: "1:1:1" }\n`;
    files[`nodes/synth${i}.yaml`] = "plugin:\n  type: internal\n  name: 4osc\n";
    files[`sequences/seq${i}.yaml`] = `notes:\n${notes}\n`;
    segments.push(`  lane${i}: [ synth${i} ]`, `  synth${i}: [ OUT ]`);
  }
  files[GRAPH_FILE] = `modules:\n${segments.join("\n")}\n`;
  return files;
}

/** …to its OWN `mkdtemp` and nothing outside it, with every mtime aged (docs/benchSettle.md). */
export function writeBenchProject(size: BenchSize): string {
  // The `.st0` suffix is load-bearing: without it the folder is invisible to `Workspace`.
  const dir = join(mkdtempSync(join(tmpdir(), "studio-bench-")), "bench.st0");
  const files = benchProjectFiles(size);
  writeProjectFiles(dir, files);
  // An hour back, or the fixture sits inside `yamlCache`'s 2 s SETTLE_MS and cannot be cached.
  const when = new Date(Date.now() - 3_600_000);
  for (const rel of Object.keys(files)) utimesSync(join(dir, rel), when, when);
  return dir;
}
