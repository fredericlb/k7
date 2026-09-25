// bundle.mjs — builds js/entry.js into one IIFE script QuickJS can evaluate as a plain global script.
// Run from the repo root's node: `node engine/st0-engine/spikes/strudel-quickjs/js/bundle.mjs`.

import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "build", "strudel.bundle.js");

const result = await build({
  entryPoints: [join(here, "entry.js")],
  bundle: true,
  format: "iife",
  platform: "neutral",
  target: "es2020",
  mainFields: ["module", "main"],
  minify: true,
  metafile: true,
  outfile: out,
  logLevel: "warning",
});
const bytes = Object.values(result.metafile.outputs)[0].bytes;
console.log(`${out} ${(bytes / 1024).toFixed(0)} KiB`);
