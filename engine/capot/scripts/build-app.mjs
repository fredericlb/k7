#!/usr/bin/env node
// build-app.mjs — `npm run app:pack`: the C++ engine, then everything the app carries staged
// FLAT, then electron-builder, then the artifacts into out/. The orchestrator only; the
// staging itself is stage.mjs, shared with the Tauri build until that goes.
// See docs/buildEngine.md.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { extname, join } from "node:path";
import {
  BUILD_NUMBER,
  engineDir,
  findEngineBinary,
  PRESET,
  repo,
  run,
  stageAll,
  trayDir,
} from "./stage.mjs";

const OUT = join(trayDir, "out");
const STAGING = join(trayDir, "staging");
const skipEngine = process.argv.includes("--no-engine");

// ── 1. the C++ engine ─────────────────────────────────────────────────────────

if (!skipEngine) {
  const script = { win32: "build:win", darwin: "build:mac" }[process.platform];
  if (script) {
    run("npm", ["run", script, "--workspace", "moteur"], repo);
  } else {
    console.log(`\n=== engine (${PRESET}) ===`);
    run("cmake", ["--preset", PRESET], engineDir);
    run("cmake", ["--build", "--preset", PRESET], engineDir);
  }
}

const engineBin = findEngineBinary();
if (!engineBin) {
  console.error(
    "error: no engine binary under engine/moteur/build — build it first.",
  );
  process.exit(1);
}

// ── 2. what the app carries ───────────────────────────────────────────────────

console.log("\n=== staging ===");
// Replaced wholesale: a leftover from a previous platform would ship silently.
rmSync(STAGING, { recursive: true, force: true });
await stageAll(STAGING, engineBin);

// The main process, stamped with the same build number the menu shows.
run("node", [join(trayDir, "scripts", "build-main.mjs")], trayDir, {
  STUDIO_BUILD: BUILD_NUMBER,
});

// ── 3. the app ────────────────────────────────────────────────────────────────

console.log(`\n=== electron-builder (build ${BUILD_NUMBER}) ===`);
const builder = join(
  repo,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-builder.cmd" : "electron-builder",
);
if (!existsSync(builder)) {
  console.error(
    "error: electron-builder is not installed — run `npm install`.",
  );
  process.exit(1);
}
const status = spawnSync(
  builder,
  ["--config", join(trayDir, "electron-builder.yml")],
  {
    cwd: trayDir,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, STUDIO_BUILD: BUILD_NUMBER },
  },
).status;
if (status !== 0) process.exit(status ?? 1);

// ── 4. collect ────────────────────────────────────────────────────────────────

// electron-builder writes straight into out/, so this only reports — and the standalone
// engine goes beside the app, for running it with no app at all.
const ARTIFACT = new Set([
  ".app",
  ".dmg",
  ".exe",
  ".msi",
  ".deb",
  ".rpm",
  ".appimage",
  ".zip",
]);
mkdirSync(OUT, { recursive: true });
const made = existsSync(OUT)
  ? readdirSync(OUT).filter((n) => ARTIFACT.has(extname(n).toLowerCase()))
  : [];
console.log(`\n=== out/ ===`);
for (const n of made) console.log(`  ${n}`);
if (!made.length)
  console.log("  (nothing — check electron-builder's output above)");
