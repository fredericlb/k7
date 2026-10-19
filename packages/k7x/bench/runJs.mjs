// runJs.mjs — the TypeScript parser's half of compare.ts, run as plain JS in a fresh node so its first pass is truly cold.
// A reader would get wrong what it imports: the esbuild bundle of src/parse.ts that compare.ts writes, not the source.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [bundle, list, iterArg] = process.argv.slice(2);
const { parseTree } = await import(pathToFileURL(bundle).href);
const files = readFileSync(list, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((f) => readFileSync(f, "utf8"));

let sink = 0;
const pass = () => {
  const t = performance.now();
  for (const text of files) {
    try {
      sink += parseTree(text).entries.length;
    } catch {
      sink++;
    }
  }
  return performance.now() - t;
};

const cold = pass();
const runs = Array.from({ length: Number(iterArg ?? 50) }, pass).sort(
  (a, b) => a - b,
);
const bytes = files.reduce((n, t) => n + Buffer.byteLength(t), 0);
console.log(
  JSON.stringify({
    cold,
    min: runs[0],
    median: runs[runs.length >> 1],
    files: files.length,
    bytes,
    sink,
  }),
);
