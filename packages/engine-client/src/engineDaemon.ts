// engineDaemon.ts — start/stop the shared engine as a background daemon, tracked by
// ~/.studio/engine.pid. One engine serves whichever project is active, and
// ensureEngineDaemon() is idempotent, so every surface can "ensure" it without racing. It
// reports whether THIS call started it, so an owner stops only what it started.

import { type ChildProcess, spawn } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { enginePidPath } from "./paths";
import { killTree } from "./processTree";

export const ENGINE_PID = enginePidPath();

// The engine's output is redirected into the project folder, so its log sits next to the song.
export const ENGINE_LOG_NAME = ".studio-engine.log";
export const engineLogPath = (dir: string): string =>
  join(dir, ENGINE_LOG_NAME);

function readPid(): number | null {
  try {
    const n = parseInt(readFileSync(ENGINE_PID, "utf8").trim(), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // exists but not signalable
  }
}

export function engineRunning(): boolean {
  const pid = readPid();
  return pid != null && alive(pid);
}

export interface EngineDaemonOptions {
  port?: number;
  // The bind interface (STUDIO_ENGINE_HOST): loopback by default, "0.0.0.0" from the supervisor for LAN browsers.
  host?: string;
  logDir?: string;
  // Extra environment for the child — the supervisor passes the engine's identity. Merged over the parent env.
  env?: NodeJS.ProcessEnv;
  // "file" (default) writes a log and unrefs, so the engine outlives a CLI invocation; "pipe" returns streams and is NOT unref'd.
  stdio?: "file" | "pipe";
}

// Start the daemon unless one is running: the ChildProcess in "pipe" mode, true when it started one otherwise, false when one was up.
export function ensureEngineDaemon(
  bin: string,
  opts: EngineDaemonOptions = {},
): boolean | ChildProcess {
  const { port = 8765, host, logDir, env, stdio: mode = "file" } = opts;
  if (engineRunning()) return false;
  mkdirSync(dirname(ENGINE_PID), { recursive: true });

  let stdio: "ignore" | "pipe" | ["ignore", number, number] = "ignore";
  let logFd: number | undefined;
  if (mode === "pipe") {
    stdio = "pipe";
  } else if (logDir) {
    try {
      logFd = openSync(engineLogPath(logDir), "w"); // fresh log per engine launch
      stdio = ["ignore", logFd, logFd];
    } catch {
      /* unwritable folder — fall back to discarding output rather than failing to start */
    }
  }

  const child = spawn(bin, [String(port)], {
    // Its own process group either way, so a stop can signal the whole tree rather than just the engine.
    detached: true,
    stdio,
    windowsHide: true,
    env: {
      ...process.env,
      ...(host ? { STUDIO_ENGINE_HOST: host } : {}),
      ...env,
    },
  });
  if (logFd !== undefined) closeSync(logFd); // the child holds its own dup; don't leak ours
  // Only in "file" mode: in "pipe" the caller reads the streams, and releasing the handle would strand the pumps.
  if (mode === "file") child.unref();
  if (child.pid) writeFileSync(ENGINE_PID, String(child.pid), "utf8");
  return mode === "pipe" ? child : true;
}

export function stopEngineDaemon(): void {
  const pid = readPid();
  // The whole TREE, not the pid: a scan child left behind keeps the audio device and the port — see docs/processTree.md.
  if (pid != null) killTree(pid);
  rmSync(ENGINE_PID, { force: true }); // force: absent pidfile is not an error
}
