// backend-boot.mjs — what NodeMobile runs in the iOS app: k7's bundled backend on a WORKER thread, started and
// stopped by BackendHost.swift over two pipes. A worker because node's own process.env is the app's environment,
// which the engine and the supervisor read too, and a worker can be started again where node cannot.
// Usage (from Swift): node backend-boot.mjs <controlFd> <statusFd>. See engine/k7-runtime/docs/ios.md.

import { createReadStream, writeSync } from "node:fs";
import { createInterface } from "node:readline";
import { Worker } from "node:worker_threads";

const [controlFd, statusFd] = process.argv.slice(2).map(Number);
let worker = null;
let stopTimer = null;

/** One status line to Swift; a pipe it closed is the app going away, and nothing is left to tell. */
function tell(msg) {
  try {
    writeSync(statusFd, `${JSON.stringify(msg)}\n`);
  } catch {
    // Never process.exit on this thread: it is the app's process, and exit would end the app.
  }
}

/** The backend with `env` as its whole environment; its stdin end is its stop, as under the desktop app. */
function start(entry, env) {
  if (worker) return;
  const w = new Worker(entry, {
    env: { ...env, ELECTRON_SHELL_STDIN_STOP: "1" },
    stdin: true,
  });
  worker = w;
  w.on("error", (e) => tell({ t: "error", message: String(e?.stack ?? e) }));
  w.on("exit", (code) => {
    if (worker === w) worker = null;
    clearTimeout(stopTimer);
    tell({ t: "exit", code });
  });
  tell({ t: "started" });
}

/** Ask it to stop, and end it after `graceMs` if it has not. */
function stop(graceMs) {
  const w = worker;
  if (!w) return tell({ t: "exit", code: null });
  w.stdin.end();
  stopTimer = setTimeout(() => void w.terminate(), graceMs);
}

const control = createInterface({
  input: createReadStream(null, { fd: controlFd, autoClose: false }),
});
control.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.t === "start") start(msg.entry, msg.env);
  else if (msg.t === "stop") stop(msg.graceMs ?? 8_000);
});
// The app closed its end: the worker goes, and node's loop drains back into Swift.
control.on("close", () => void worker?.terminate());
