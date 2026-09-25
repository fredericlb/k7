// gen-strudel-bundle.mjs — bundle @studio/song-strudel's engineEntry.ts into the one script PatternPlugin runs in QuickJS.
// The output is generated AND committed, so building the engine needs no Node; run it after touching events.ts or bumping @strudel/*.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const moteur = join(here, "..");
const entry = join(moteur, "..", "..", "packages", "song-strudel", "src", "engineEntry.ts");
const out = join(moteur, "engine", "strudel", "strudel.bundle.js");

const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: "iife",
  platform: "neutral",
  target: "es2020",
  mainFields: ["module", "main"],
  minify: true,
  legalComments: "eof",
  metafile: true,
  outfile: out,
  logLevel: "warning",
});
const bytes = Object.values(result.metafile.outputs)[0].bytes;
console.log(`${out} — ${(bytes / 1024).toFixed(0)} KiB`);
