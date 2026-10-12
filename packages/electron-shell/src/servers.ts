// servers.ts — an app's Node servers, run unchanged as children under tsx with Electron as their node.
// Each runs under guard.ts, which leads its process group and stops it when the pipe from this process closes — on a crash too.

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { line, relay } from "./log.ts";

export interface Server {
  name: string;
  port: number;
  child: ChildProcess;
}

export interface ServerSpec {
  /** The prefix of its lines in the merged log. */
  name: string;
  port: number;
  /** The server's TypeScript entry, run by tsx. */
  entry: string;
  /** tsx's cli.mjs. */
  tsx: string;
  /** The server's own tsconfig, which tsx would not find from `cwd`. */
  tsconfig: string;
  /** Laid over this process's environment. */
  env: Record<string, string>;
  /** Variables of this process's environment the server must not inherit. */
  unset?: string[];
  /** Kept outside any checkout — docs/shell.md. */
  cwd: string;
}

/** dist/guard.cjs, beside main.cjs — unpacked from the asar when packaged, since a child node reads it from disk. */
const guardScript = (): string =>
  join(__dirname, "guard.cjs").replace(
    /app\.asar([/\\])/,
    "app.asar.unpacked$1",
  );

/** Start one server on its port, its process group led by the guard. */
export function startServer(spec: ServerSpec): Server {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...spec.env,
    // Electron as plain node, inherited by whatever the server spawns with `process.execPath`.
    ELECTRON_RUN_AS_NODE: "1",
    PORT: String(spec.port),
    TSX_TSCONFIG_PATH: spec.tsconfig,
  };
  for (const name of ["NODE_OPTIONS", ...(spec.unset ?? [])]) delete env[name];
  mkdirSync(spec.cwd, { recursive: true });
  const child = spawn(process.execPath, [guardScript(), spec.tsx, spec.entry], {
    cwd: spec.cwd,
    env,
    // stdin is the guard's lifeline: never written, and closed by the OS however this process ends.
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  child.stdout?.on("data", relay(spec.name));
  child.stderr?.on("data", relay(spec.name));
  child.on("exit", (code, signal) =>
    line(spec.name, `exited (${code ?? signal})`),
  );
  return { name: spec.name, port: spec.port, child };
}

/** Resolve once the server answers HTTP at all; reject if it exits or never does. */
export async function waitListening(
  s: Server,
  timeoutMs = 60_000,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (s.child.exitCode !== null)
      throw new Error(`${s.name} exited (${s.child.exitCode})`);
    try {
      await fetch(`http://127.0.0.1:${s.port}/`);
      return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `${s.name} did not answer on ${s.port} within ${timeoutMs / 1000} s`,
  );
}

/** Stop the server and everything it spawned; SIGKILL whatever is still there after the grace period. */
export async function stopServer(s: Server, graceMs = 3_000): Promise<void> {
  const pid = s.child.pid;
  if (pid === undefined || s.child.exitCode !== null) return;
  const exited = new Promise<void>((r) => s.child.once("exit", () => r()));
  // The guard's own way out first; the sweep below is for a guard that did not take it.
  s.child.stdin?.end();
  await Promise.race([
    exited,
    new Promise((r) => setTimeout(r, graceMs + 1_000)),
  ]);
  if (s.child.exitCode !== null || s.child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"]);
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}
