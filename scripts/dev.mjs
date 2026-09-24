#!/usr/bin/env node
// dev.mjs — `npm run dev`: the dev session under Tilt. Each dev server is its own
// restartable resource (list derived by scripts/tilt-tasks.mjs, read by the Tiltfile),
// web UI at http://localhost:10350. Extra args go to `tilt up` (e.g. resource names).
// All this adds is the one-session guard and the backstop that stops the detached
// tray on the way out. See docs/dev.md.

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stopAll } from "../engine/st0-tray/scripts/trayProcess.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 10350;

// One session at a time: a second `tilt up` would fight the first for every dev port.
const free = await new Promise((resolve) => {
  const probe = createServer();
  probe.once("error", () => resolve(false));
  probe.once("listening", () => probe.close(() => resolve(true)));
  probe.listen(PORT, "127.0.0.1");
});
if (!free) {
  console.error(
    `a dev session is already running — the Tilt UI is at http://localhost:${PORT}`,
  );
  process.exit(1);
}

const tilt = spawn(
  "tilt",
  ["up", "--port", String(PORT), ...process.argv.slice(2)],
  { cwd: repo, stdio: "inherit" },
);
tilt.on("error", (e) => {
  console.error(
    `could not start tilt: ${e.message} — is Tilt installed? https://docs.tilt.dev/install.html`,
  );
  process.exit(1);
});

let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  tilt.kill();
  // The tray is DETACHED, and Tilt may end its resource too abruptly to stop it (../docs/dev.md).
  try {
    await stopAll();
  } catch {}
  process.exit(code);
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => void shutdown());
tilt.on("exit", (code) => void shutdown(code ?? 0));
