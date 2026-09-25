// golden.mjs — runs the SAME bundle under Node over the corpus and writes the events the C++ side must reproduce.
// It loads the bundle, not entry.js, so a divergence is QuickJS's and never a bundling difference.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const bundle = readFileSync(join(root, "build", "strudel.bundle.js"), "utf8");
vm.runInThisContext(bundle);

// The windows mirror the clock's: whole cycles, and a look-ahead slice that splits one.
const WINDOWS = [
  [0, 1],
  [0, 8],
  [3.25, 3.75],
];

const out = {};
for (const file of readdirSync(join(root, "corpus")).sort()) {
  if (!file.endsWith(".strudel")) continue;
  await globalThis.strudelSpike.load(readFileSync(join(root, "corpus", file), "utf8"));
  out[file] = WINDOWS.map(([a, b]) => JSON.parse(globalThis.strudelSpike.queryJson(a, b)));
}
writeFileSync(join(root, "build", "golden.json"), JSON.stringify(out));
console.log(`golden: ${Object.keys(out).length} patterns`);
