#!/usr/bin/env node
// devTrayBackend.mjs — what the dev tray runs as its backend: k7's backend from SOURCE under `tsx watch`, restarted
// on every save of a file it imports, its file services from source too. What a reader gets wrong: the tray's stdin
// stays HERE — `tsx watch` reads its own stdin, and a backend sharing that pipe never starts on Windows (docs/dev.md).

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
// No stdin reaches the backend, so its stop-on-end would stop it at once: this shim ends it instead.
delete env.K7_STDIN_STOP;

const isWindows = process.platform === "win32";
const watch = spawn(
  process.execPath,
  [tsx, "watch", "--clear-screen=false", server],
  {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "inherit", "inherit"],
    detached: !isWindows,
    // The tray is windowless; a console child of it would open a console window of its own.
    windowsHide: true,
  },
);

/** tsx and all it runs — the backend, its file services, its supervisor and engine; one left would hold 18789. */
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

// Unix gets a stop first: the backend's SIGTERM handler deregisters the supervisor and drains its requests.
function stop() {
  if (isWindows || watch.pid === undefined) return killTree();
  try {
    process.kill(-watch.pid, "SIGTERM");
  } catch {}
  setTimeout(killTree, 10_000).unref();
}

// The tray closed our stdin: it is quitting or restarting the backend.
process.stdin.on("end", stop);
process.stdin.resume();
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, stop);
process.on("exit", killTree);
watch.on("exit", (code) => process.exit(code ?? 1));
