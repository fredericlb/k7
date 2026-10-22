#!/usr/bin/env node
// devTrayBackend.mjs — what the dev tray runs as its backend: k7's backend from SOURCE under `tsx watch`, restarted
// on every save of a file it imports, its file services from source too. What a reader gets wrong: a restart ends
// the supervisor and the engine with it — the backend holds their job — exactly as restarting the tray does (docs/dev.md).

import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsx = createRequire(import.meta.url).resolve("tsx/cli");
const server = join(repo, "apps", "k7", "backend", "src", "server.ts");

// The bundle's file service would be the one stale piece: the hub starts each from source when none is named.
const env = { ...process.env, STUDIO_FILES_WATCH: "1" };
delete env.STUDIO_FILE_SERVICE_ENTRY;

const isWindows = process.platform === "win32";
// stdin inherited: the backend's own K7_STDIN_STOP still sees the tray close it, and stops its supervisor first.
const watch = spawn(
  process.execPath,
  [tsx, "watch", "--clear-screen=false", server],
  {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    detached: !isWindows,
    // The tray is windowless; a console child of it would open a console window of its own.
    windowsHide: true,
  },
);

/** tsx and whatever it still runs: a backend left behind would hold port 18789 for the next tray. */
function killTree() {
  if (watch.exitCode !== null || watch.pid === undefined) return;
  if (isWindows)
    spawnSync("taskkill", ["/pid", String(watch.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  else {
    try {
      process.kill(-watch.pid, "SIGKILL");
    } catch {}
  }
}

// The tray closed our stdin: the backend is stopping on the same signal; tsx would then wait for a save forever.
process.stdin.on("end", () => setTimeout(killTree, 10_000).unref());
process.stdin.resume();
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, killTree);
process.on("exit", killTree);
watch.on("exit", (code) => process.exit(code ?? 1));
