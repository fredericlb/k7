#!/usr/bin/env node
// start-engine.mjs — `npm run engine:start`: launches the dev tray app `engine:dev` left in
// out/dev — the .app on macOS, engine-tray.exe on Windows. Detached, so this returns
// immediately; quit it from its tray icon.

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // apps/capot/scripts
const OUT_DEV = join(dirname(here), "out", "dev");

let target = null;
if (process.platform === "darwin") {
  const app =
    existsSync(OUT_DEV) && readdirSync(OUT_DEV).find((n) => n.endsWith(".app"));
  if (app) target = join(OUT_DEV, app);
} else if (process.platform === "win32") {
  const exe = join(OUT_DEV, "engine-tray.exe");
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
  const child = spawn(target, [], { detached: true, stdio: "ignore" });
  child.unref();
}
