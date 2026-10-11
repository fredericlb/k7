// backends.ts — st0's and pl8's own servers, run unchanged as children under tsx with Electron as their node.
// Each runs under guard.ts, which leads its process group and stops it when the pipe from this process closes — on a crash too.

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { line, relay } from "./log.ts";
import { sourceRoot } from "./paths.ts";

export interface Backend {
  name: string;
  port: number;
  child: ChildProcess;
}

/** dist/guard.cjs, beside main.cjs — unpacked from the asar when packaged, since a child node reads it from disk. */
const guardScript = (): string =>
  join(__dirname, "guard.cjs").replace(
    /app\.asar([/\\])/,
    "app.asar.unpacked$1",
  );

/** Start `apps/<app>/backend/src/server.ts` on `port`, with `env` over this process's own. */
export function startBackend(
  app: "st0" | "pl8",
  port: number,
  env: Record<string, string>,
  cwd: string,
): Backend {
  const root = sourceRoot();
  const dir = join(root, "apps", app, "backend");
  const tsx = join(root, "node_modules", "tsx", "dist", "cli.mjs");
  const full: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
    // Electron as plain node, inherited by every file service pl8 spawns with `process.execPath`.
    ELECTRON_RUN_AS_NODE: "1",
    PORT: String(port),
    // cwd is outside the checkout so no env.yaml is found; tsx still reads the backend's own tsconfig.
    TSX_TSCONFIG_PATH: join(dir, "tsconfig.json"),
  };
  delete full.NODE_OPTIONS;
  delete full.TRUSTED_ORIGINS;
  mkdirSync(cwd, { recursive: true });
  const child = spawn(
    process.execPath,
    [guardScript(), tsx, join(dir, "src", "server.ts")],
    {
      cwd,
      env: full,
      // stdin is the guard's lifeline: never written, and closed by the OS however this process ends.
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    },
  );
  child.stdout?.on("data", relay(app));
  child.stderr?.on("data", relay(app));
  child.on("exit", (code, signal) => line(app, `exited (${code ?? signal})`));
  return { name: app, port, child };
}

/** Resolve once the backend answers HTTP at all; reject if it exits or never does. */
export async function waitListening(
  b: Backend,
  timeoutMs = 60_000,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (b.child.exitCode !== null)
      throw new Error(`${b.name} exited (${b.child.exitCode})`);
    try {
      await fetch(`http://127.0.0.1:${b.port}/`);
      return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `${b.name} did not answer on ${b.port} within ${timeoutMs / 1000} s`,
  );
}

/** Stop the backend and everything it spawned; SIGKILL whatever is still there after the grace period. */
export async function stopBackend(b: Backend, graceMs = 3_000): Promise<void> {
  const pid = b.child.pid;
  if (pid === undefined || b.child.exitCode !== null) return;
  const exited = new Promise<void>((r) => b.child.once("exit", () => r()));
  // The guard's own way out first; the sweep below is for a guard that did not take it.
  b.child.stdin?.end();
  await Promise.race([
    exited,
    new Promise((r) => setTimeout(r, graceMs + 1_000)),
  ]);
  if (b.child.exitCode !== null || b.child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"]);
    return;
  }
  const signalGroup = (sig: NodeJS.Signals) => {
    try {
      process.kill(-pid, sig);
    } catch {
      /* already gone */
    }
  };
  signalGroup("SIGKILL");
}
