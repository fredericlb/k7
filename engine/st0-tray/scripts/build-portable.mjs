#!/usr/bin/env node
// build-portable.mjs — `npm run engine:portable`: ONE Windows .exe carrying the tray, the supervisor and the engine.
// electron-builder's `portable` target over the installer's own staging, so the two cannot carry different things.
// Windows only. See docs/buildPortable.md.

import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildNumber, distDir, run } from "./buildTools.mjs";
import { buildSupervisor } from "./supervisorBuild.mjs";

const here = dirname(fileURLToPath(import.meta.url)); // engine/st0-tray/scripts
const trayDir = dirname(here);
const repo = join(trayDir, "..", "..");
const engineDir = join(repo, "engine", "st0-engine");
const OUT = distDir(repo);

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

if (process.platform !== "win32")
  fail(
    "the portable build is Windows-only — elsewhere `npm run engine:build` is the deliverable.",
  );

// `--skip-engine`: reuse whatever is already built (docs/buildPortable.md).
const skipEngine = process.argv.includes("--skip-engine");
// `--dir-only`: stop at the unpacked app, which runs as it stands.
const dirOnly = process.argv.includes("--dir-only");

const BUILD = buildNumber();
const PRESET = process.env.STUDIO_ENGINE_PRESET || "windows-msvc";

if (!skipEngine) {
  console.log(`\n=== engine (${PRESET}) ===`);
  run("node", [join("scripts", "build.mjs"), PRESET], engineDir);
  console.log("\n=== supervisor ===");
  buildSupervisor(repo);
}

console.log("\n=== tray (portable) ===");
const out = join(trayDir, "out");
rmSync(out, { recursive: true, force: true });
run(
  "npm",
  ["run", "package", "--", "--win", dirOnly ? "dir" : "portable"],
  trayDir,
  { STUDIO_BUILD: BUILD },
);

if (dirOnly) {
  console.log(
    `\n✔ unpacked app in ${join(out, "win-unpacked")} — st0-tray.exe runs from there.`,
  );
  process.exit(0);
}

const exe = existsSync(out)
  ? readdirSync(out).find((n) => n.toLowerCase().endsWith(".exe"))
  : undefined;
if (!exe) fail(`no portable .exe in ${out} — check the build output above.`);
const dest = join(OUT, `st0-portable_${BUILD}.exe`);
cpSync(join(out, exe), dest);
console.log(`\n✔ ${dest}`);
