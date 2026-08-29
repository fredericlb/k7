// migrateTrackMixer.ts — give every audio lane the channel strip it lacks: a `Mixer` module of its
// own, wired at the end of its run, just before the mixer's sum.
//
//   npx tsx packages/song/scripts/migrateTrackMixer.ts <projet.st0> [more…] [--write]
//
// Before this, `track new` wrote a lane and nothing else, so a song's faders — the one on a lane's
// timeline gutter, the one on its card, the whole Mixer view — had nowhere to write and did
// nothing. See packages/song/docs/trackMixer.md.
//
// Idempotent (a lane whose run already ends on a mixer is skipped), dry by default, and through the
// yaml Document API, so graph.yaml's comments and key order come back byte-identical.

import { loadGraph } from "../src/graph.ts";
import { applyTrackMixer, planTrackMixer } from "../src/trackMixerFile.ts";

const args = process.argv.slice(2);
const write = args.includes("--write");
const roots = args.filter((a) => !a.startsWith("--"));
if (!roots.length) {
  console.error(
    "usage: migrateTrackMixer <projet.st0> [more…] [--write]   (dry run without --write)",
  );
  process.exit(2);
}

let touched = 0;
for (const root of roots) {
  let g: ReturnType<typeof loadGraph>;
  try {
    g = loadGraph(root);
  } catch (e) {
    console.error(`${root}: ${(e as Error).message}`);
    continue;
  }
  // Lanes only. A group holds no material and a bus is already somebody's strip.
  const lanes = Object.keys(g.tracks);
  if (!lanes.length) {
    console.log(`${root}: no lanes`);
    continue;
  }
  for (const lane of lanes) {
    // The graph is re-read per lane on a write: each strip changes it, and the next plan reads the new one.
    let plan: ReturnType<typeof planTrackMixer>;
    try {
      plan = planTrackMixer(root, lane, write ? loadGraph(root) : g);
    } catch (e) {
      console.error(`${root}: ${lane} — ${(e as Error).message}`);
      continue;
    }
    if (!plan) {
      console.log(`${root}: ${lane} — already has a strip`);
      continue;
    }
    if (!write) {
      console.log(
        `${root}: ${lane} + ${plan.rel}, wired ${plan.after ? `after ${plan.after}` : "straight to the sum"}`,
      );
      continue;
    }
    applyTrackMixer(root, plan);
    touched++;
    console.log(`${root}: ${lane} + ${plan.rel}`);
  }
}
if (!write) console.log("\ndry run — pass --write to apply");
else console.log(`\n${touched} strip(s) written`);
