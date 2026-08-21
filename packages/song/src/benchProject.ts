// benchProject.ts — a synthetic project of N lanes, written to a temp folder, for the benches.
//
// Not a fixture committed under `engine/capot/songs/`: those hold ONE lane, and the numbers this
// repo quotes (`graphDoc` at ~278 ms) were taken on a song of some seventy nodes. A one-lane
// fixture would measure startup and nothing else. Parameterised because what a bench has to show
// here is the CURVE — a cost that doubles when the song doubles is fine, one that quadruples is
// the finding.

import { mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeProjectFiles } from "./scaffold";
import { GRAPH_FILE } from "./yaml/graphSchema";

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

/**
 * The file map for a song of `lanes` sequence lanes, each running its own synth into OUT.
 *
 * Every lane is its own NODE of the shared `synth` module, which is the shape a real song has —
 * pointing them all at one module would sum them into a single instrument and, more to the point
 * here, would stop the module map growing with the song.
 */
export function benchProjectFiles(size: BenchSize): Record<string, string> {
  const files: Record<string, string> = {
    "project.yaml":
      "project:\n  name: bench\n  tempo: 120\n  sampleRate: 48000\n" +
      '  timeSignature: "4/4"\n',
    "settings.yaml": "metronome: false\ncount_in: 0\n",
    "modules/io/OUT/module.yaml": "io: out\n",
    "modules/instruments/synth/module.yaml":
      "plugin:\n  type: internal\n  name: 4osc\n",
  };

  const notes = Array.from(
    { length: size.notesPerLane },
    (_, n) => `  - { t: ${n * 0.5}, d: 0.25, k: ${36 + (n % 24)} }`,
  ).join("\n");

  const segments: string[] = [];
  for (let i = 0; i < size.lanes; i++) {
    files[`nodes/lane${i}.yaml`] =
      `extends: "@studio/track"\nevents:\n  - { ref: seq${i}, start: "1:1:1" }\n`;
    files[`nodes/synth${i}.yaml`] = `extends: "@project/instruments/synth"\n`;
    files[`sequences/seq${i}.yaml`] = `notes:\n${notes}\n`;
    segments.push(`  lane${i}: [ synth${i} ]`, `  synth${i}: [ OUT ]`);
  }
  files[GRAPH_FILE] = `modules:\n${segments.join("\n")}\n`;
  return files;
}

/**
 * …written to a fresh temp folder, whose path is returned, with every file's mtime aged.
 *
 * Its OWN `mkdtemp` every time, and nothing outside it. On Windows `process.env.HOME` does not
 * move `~/.studio`, so a bench that wrote anywhere near the real one would leave a residue that
 * fails the next run — a trap this repo has already been caught by once.
 *
 * The ageing is what makes the number mean anything: see docs/benchSettle.md.
 */
export function writeBenchProject(size: BenchSize): string {
  // `<tmp>/…/bench.st0`, and the suffix is load-bearing: the file service decides what is a
  // project by the folder's NAME (`PROJECT_SUFFIXES`), so a bare temp dir compiles perfectly
  // through `@studio/song` and is invisible to `Workspace`. Both halves of the harness have to
  // be able to open it.
  const dir = join(mkdtempSync(join(tmpdir(), "studio-bench-")), "bench.st0");
  const files = benchProjectFiles(size);
  writeProjectFiles(dir, files);
  // Stamp every file an hour back, so `yamlCache` may actually cache it. A file written a
  // millisecond ago is inside SETTLE_MS (2 s), which the cache refuses on purpose — a stamp that
  // young could still be reproduced by the next write. A bench that writes its fixture and
  // measures at once therefore times a cache that CANNOT hit, until the wall clock catches up
  // and then one that does: 109 ms then 21 ms at 64 lanes, straddled by an average describing
  // neither. An hour back rather than a sleep — the point is a fixture in the state a real song
  // is in, written days ago, not a slower bench. The map's keys ARE the relative paths, so this
  // needs no walk. docs/benchSettle.md.
  const when = new Date(Date.now() - 3_600_000);
  for (const rel of Object.keys(files)) utimesSync(join(dir, rel), when, when);
  return dir;
}
