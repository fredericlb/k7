// migrateTracks.ts — rewrite the four TYPED track modules to the two that replace them, in every
// node of a project or a workspace. A lane is no longer typed by what it carries, so
// `@studio/audio-track` and `@studio/sequence-track` are one `@studio/track`, and the two strudel
// ones are one `@studio/strudel-track`. Nothing resolves the old spellings — a file still
// carrying one names a module that does not exist. See docs/trackModules.md.
//
//   npx tsx packages/song/scripts/migrateTracks.ts <dir> [more dirs…] [--write]

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  LEGACY_TRACK_REFS,
  STRUDEL_TRACK_REF,
} from "@studio/song-schema/moduleTypes";

const args = process.argv.slice(2);
const write = args.includes("--write");
const roots = args.filter((a) => !a.startsWith("--"));
if (!roots.length) {
  console.error(
    "usage: migrateTracks <dir> [more dirs…] [--write]   (dry run without --write)",
  );
  process.exit(2);
}

/** Every *.yaml under `dir`, skipping the places a project keeps things it did not author. */
function* yamlFiles(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git" || name === "_history")
      continue;
    const p = join(dir, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* yamlFiles(p);
    else if (/\.ya?ml$/i.test(name)) yield p;
  }
}

// Longest first, so `…/audio-strudel-track` is never half-matched by `…/audio-track`.
const PAIRS = Object.entries(LEGACY_TRACK_REFS).sort(
  ([a], [b]) => b.length - a.length,
);

let files = 0;
let refs = 0;
// A STREAMING lane's file cannot say what its events are, so these are listed for a human.
const streaming: string[] = [];

for (const root of roots) {
  for (const file of yamlFiles(root)) {
    const before = readFileSync(file, "utf8");
    let after = before;
    let hits = 0;
    for (const [from, to] of PAIRS) {
      const n = after.split(from).length - 1;
      if (!n) continue;
      hits += n;
      if (to === STRUDEL_TRACK_REF) streaming.push(file);
      after = after.split(from).join(to);
    }
    if (!hits) continue;
    files++;
    refs += hits;
    console.log(`${String(hits).padStart(4)}  ${file}`);
    if (write) writeFileSync(file, after, "utf8");
  }
}

console.log(
  `\n${refs} ref${refs === 1 ? "" : "s"} in ${files} file${files === 1 ? "" : "s"}` +
    (write ? " — written" : " — dry run, pass --write to save"),
);

if (streaming.length) {
  console.log(
    `\n${streaming.length} STREAMING lane${streaming.length === 1 ? "" : "s"} — check the wiring by hand:\n` +
      streaming.map((f) => `      ${f}`).join("\n") +
      "\n\n  A written-down lane says what it carries by holding events. A streaming one holds" +
      "\n  nothing until it rolls, so graph.yaml has to say it: name the output the run leaves" +
      "\n  by — `pad#midi: [ synth ]` for notes, `kit#audio: [ … ]` for samples. Left bare, the" +
      "\n  lane takes whatever the pattern turns out to play, down one chain.",
  );
}
