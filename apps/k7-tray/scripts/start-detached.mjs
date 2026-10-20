#!/usr/bin/env node
// start-detached.mjs — `npm run tray:start`: launches the tray from this checkout, detached, so this returns at once.
// It runs Electron on the unpackaged app, which finds the repo's supervisor build; quit it from its tray icon.
// Its stdout lands in .cache/dev/tray.log, the only trace of a crash before the merged log is open.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // apps/k7-tray/scripts
const trayDir = dirname(here); //                      apps/k7-tray
const LOG_DIR = join(trayDir, ".cache", "dev");

if (!existsSync(join(trayDir, "dist", "main.cjs"))) {
  console.error(
    "error: no dist/main.cjs — build it first (npm run build:main).",
  );
  process.exit(1);
}

const electron = createRequire(import.meta.url)("electron");
const env = { ...process.env };
// VS Code's terminals export it, and with it set Electron is plain node and opens nothing.
delete env.ELECTRON_RUN_AS_NODE;
mkdirSync(LOG_DIR, { recursive: true });
const log = openSync(join(LOG_DIR, "tray.log"), "a");
const child = spawn(electron, [trayDir], {
  env,
  detached: true,
  windowsHide: true,
  stdio: ["ignore", log, log],
});
child.unref();
console.log(
  `▸ started the tray (pid ${child.pid}) — stdout → ${join(LOG_DIR, "tray.log")}`,
);
