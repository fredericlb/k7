import { projectHints } from "./hints";

const h = projectHints(process.argv[2]) as any;
const keys = Object.keys(h.paths ?? {});
console.log("projectRoot:", JSON.stringify(h.projectRoot));
console.log("total paths:", keys.length);
for (const k of [
  "module",
  "base",
  "sink",
  "track",
  "chain",
  "clip",
  "sequence",
])
  console.log(`  ${k}:`, keys.filter((x) => x.startsWith(k + ":")).length);
console.log(
  "sample module keys:",
  keys.filter((x) => x.startsWith("module:")).slice(0, 6),
);
