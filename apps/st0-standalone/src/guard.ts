// guard.ts — runs one backend and dies with the app: its stdin is a pipe from the main process, and the OS closes it however that process ends.
// It leads the backend's process group, so stopping takes the file services pl8 spawned along with it. See docs/standalone.md.

import { spawn, spawnSync } from "node:child_process";

const GRACE_MS = 3_000;

const child = spawn(process.execPath, process.argv.slice(2), {
  stdio: ["ignore", "inherit", "inherit"],
});

let stopping = false;

/** SIGTERM to the whole group, then SIGKILL — which ends this guard too. */
function stopGroup(): void {
  if (stopping) return;
  stopping = true;
  if (process.platform === "win32") {
    if (child.pid)
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    process.exit(0);
  }
  const signal = (sig: NodeJS.Signals) => {
    try {
      process.kill(-process.pid, sig);
    } catch {
      /* the group is already gone */
    }
  };
  signal("SIGTERM");
  setTimeout(() => signal("SIGKILL"), GRACE_MS);
}

// Its own SIGTERM, sent by stopGroup to the group, must not end it before the SIGKILL sweep.
process.on("SIGTERM", stopGroup);
process.stdin.on("end", stopGroup);
process.stdin.on("error", stopGroup);
process.stdin.resume();
// A backend that dies on its own still leaves its file services in the group, so they are swept too.
child.on("exit", (code, sig) => {
  console.error(`backend exited (${code ?? sig})`);
  stopGroup();
});
