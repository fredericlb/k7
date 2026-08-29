#!/usr/bin/env node
// fetch-electron.mjs — `npm run app:setup`: download the Electron runtime into node_modules.
// NOT redundant with `npm install`: electron@44 declares NO scripts at all, so npm never runs
// its install.js and `node_modules/electron/dist` simply never appears. The failure is
// `spawn ENOENT` on a path that looks installed, which reads as a corrupt tree rather than a
// missing step. Idempotent — a present dist is left alone. See docs/lifetime.md.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const electronDir = join(here, "..", "..", "..", "node_modules", "electron");
const dist = join(electronDir, "dist");

if (existsSync(dist)) {
  console.log(`electron runtime already present → ${dist}`);
  process.exit(0);
}

const install = join(electronDir, "install.js");
if (!existsSync(install)) {
  console.error(
    `error: ${electronDir} is not installed — run \`npm install\` at the repo root first.`,
  );
  process.exit(1);
}

console.log("▸ downloading the Electron runtime (~100 MB, once per platform)…");
await import(`file://${install}`);
console.log(
  existsSync(dist)
    ? `  → ${dist}`
    : "  (install.js ran but dist is still absent)",
);
