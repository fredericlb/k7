#!/usr/bin/env node
// start-engine.mjs — `npm run engine:start`: launches the dev app, detached, so this returns
// immediately; quit it from its tray icon. Its stdout lands in .cache/dev/tray.log, which is
// where a crash thrown before the merged log exists is the only trace left. Deliberately not
// under ~/.studio, whose layout is a contract a dev script has no business adding to.
// See docs/restartTray.md.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // apps/studio-desktop/scripts
const trayDir = dirname(here); //                      apps/studio-desktop
const repo = join(trayDir, "..", "..");
const MAIN = join(trayDir, "dist", "main.cjs");
const LOG_DIR = join(trayDir, ".cache", "dev");
const LOG = join(LOG_DIR, "tray.log");

const ELECTRON = join(
  repo,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32"
    ? "electron.exe"
    : process.platform === "darwin"
      ? "Electron.app/Contents/MacOS/Electron"
      : "electron",
);

if (!existsSync(MAIN)) {
  console.error(
    `error: no ${MAIN} — build it first (npm run app:build --workspace studio-desktop).`,
  );
  process.exit(1);
}
if (!existsSync(ELECTRON)) {
  console.error(
    "error: electron is not installed. `npm install`, and check node_modules/electron/dist exists —\n" +
      "its postinstall is what downloads the runtime and npm can skip it (npm install-scripts ls).",
  );
  process.exit(1);
}

console.log(`▸ starting ${MAIN}`);
mkdirSync(LOG_DIR, { recursive: true });
// "w", not "a": this log's whole job is to explain THIS launch, and trayProcess tails it when
// the app dies before the merged log exists. Appending would show a previous run's crash.
const log = openSync(LOG, "w");
// Detached and unref'd: `npm run dev` must not hold the app's lifetime, and the app is the
// thing the user quits from its own menu.
// A header naming the platform: under WSL this tree is mirrored, and a log from the other
// side reads as a local crash — which is exactly how a Linux linker error once got blamed
// for a Windows launch.
writeSync(log, `--- ${process.platform} ${ELECTRON}\n`);
const child = spawn(ELECTRON, [MAIN], {
  detached: true,
  windowsHide: true,
  stdio: ["ignore", log, log],
});
child.unref();
console.log(`  stdout → ${LOG}`);
