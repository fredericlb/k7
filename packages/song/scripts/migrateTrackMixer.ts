// migrateTrackMixer.ts — give every lane the channel strip it lacks, sound and picture alike: a node on
// k7's own strip, wired at the end of its run, just before the sum it ends on.
//
//   npx tsx packages/song/scripts/migrateTrackMixer.ts <projet.k7> [more…] [--write]
//
// The same back-fill a project's open runs for its picture lanes (laneStrip.ts `stripLanes`).
// Idempotent, dry by default, and as document edits, so comments and key order come back intact.
// See packages/song/docs/trackMixer.md.

import { pictureLanes, soundLanes, stripLanes } from "../src/laneStrip.ts";

const args = process.argv.slice(2);
const write = args.includes("--write");
const roots = args.filter((a) => !a.startsWith("--"));
if (!roots.length) {
  console.error(
    "usage: migrateTrackMixer <projet.k7> [more…] [--write]   (dry run without --write)",
  );
  process.exit(2);
}

let touched = 0;
for (const root of roots) {
  try {
    // Lanes only, of both kinds: a group holds no material and a bus is already somebody's strip.
    const done = stripLanes(
      root,
      (g) => [...soundLanes(g), ...pictureLanes(g)],
      {
        dry: !write,
      },
    );
    for (const w of done.warnings) console.error(`${root}: ${w}`);
    for (const p of done.planned)
      console.log(
        `${root}: ${p.lane} + ${p.rel}, wired ${p.after ? `after ${p.after}` : "straight to the sum"}`,
      );
    if (!done.planned.length) console.log(`${root}: every lane has its strip`);
    touched += write ? done.planned.length : 0;
  } catch (e) {
    console.error(`${root}: ${(e as Error).message}`);
  }
}
if (!write) console.log("\ndry run — pass --write to apply");
else console.log(`\n${touched} strip(s) written`);
