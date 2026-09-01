#!/usr/bin/env node
// start-engine.mjs — `npm run engine:start`: launches the dev tray app `engine:dev` left in
// out/dev — the .app on macOS, st0-tray.exe on Windows. Detached, so this returns
// immediately; quit it from its tray icon. Its stdout lands in .cache/dev/tray.log, which
// is where a panic thrown before the merged log exists is the only trace left.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // engine/st0-tray/scripts
const trayDir = dirname(here); //                      engine/st0-tray
const OUT_DEV = join(trayDir, "out", "dev");
// The tray's own stdout — where a Rust panic thrown before logbus::init is the only trace left.
const LOG_DIR = join(trayDir, ".cache", "dev");
const LOG = join(LOG_DIR, "tray.log");

let target = null;
if (process.platform === "darwin") {
  const app =
    existsSync(OUT_DEV) && readdirSync(OUT_DEV).find((n) => n.endsWith(".app"));
  if (app) target = join(OUT_DEV, app);
} else if (process.platform === "win32") {
  const exe = join(OUT_DEV, "st0-tray.exe");
  if (existsSync(exe)) target = exe;
} else {
  console.error(
    "error: no packaged tray app on this platform (macOS/Windows only).",
  );
  process.exit(1);
}

if (!target) {
  console.error(
    `error: no dev app under ${OUT_DEV} — build it first (npm run engine:dev).`,
  );
  process.exit(1);
}

console.log(`▸ starting ${target}`);
if (process.platform === "darwin") {
  // `open` hands the .app to LaunchServices and returns; the app outlives us.
  spawn("open", [target], { stdio: "inherit" });
} else {
  mkdirSync(LOG_DIR, { recursive: true });
  const log = openSync(LOG, "a");
  const child = spawn(target, [], {
    detached: true,
    windowsHide: true, // a debug build is a console subsystem app; without this a terminal pops up
    stdio: ["ignore", log, log],
  });
  child.unref();
  console.log(`  stdout → ${LOG}`);
}
