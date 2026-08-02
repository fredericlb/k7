// fileServiceProcess.ts — start, watch and stop the engine-side file service, which
// serves workspaces and every file op to the browser (the C++ engine stays file-free).
// Spawns only when nothing already answers the port and a runtime resolves; otherwise
// reports FAILED rather than a green lie. Full rationale: docs/supervisorPolicy.md.

import { type ChildProcess, spawn } from "node:child_process";
import { createConnection } from "node:net";
import { killTree } from "@lanes/engine-client/processTree";
import * as bundle from "./bundle.ts";
import type { EngineIdentity } from "./identity.ts";
import { line, pump } from "./logbus.ts";

const PROBE_TIMEOUT_MS = 300;

/**
 * Is something serving on the file port? A loopback TCP probe.
 *
 * Non-blocking, unlike the tray's old `connect_timeout` under `spawn_blocking` — this
 * is a socket and a timer, so a dead port costs nothing but the wait.
 */
export function isServing(filePort: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (up: boolean): void => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(up);
    };
    const socket = createConnection({ host: "127.0.0.1", port: filePort });
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export type SpawnResult =
  | { kind: "spawned"; child: ChildProcess }
  /** Someone else is serving the port — the dev watcher. Not a failure. */
  | { kind: "foreign" }
  /** No runtime to spawn and nothing answering. The red-icon case. */
  | { kind: "unavailable" };

/**
 * Ensure a file service is serving `filePort`, spawning one if we can.
 *
 * Every start path goes through here — owned engine, adopted engine, or the manual
 * restart — so the probe is never skipped.
 */
export async function ensure(
  identity: EngineIdentity,
  enginePort: number,
  filePort: number,
  registryUrl: string,
): Promise<SpawnResult> {
  if (await isServing(filePort)) return { kind: "foreign" };

  const runtime = bundle.fileServiceRuntime();
  if (!runtime) return { kind: "unavailable" };

  const child = spawn(runtime.node, [runtime.script], {
    // Its own process group, so killTree can reach the helpers it forks.
    detached: true,
    // Piped, never inherited: our stdout is the tray protocol, and one stray child line would corrupt the frames.
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: {
      ...process.env,
      LANES_ENGINE_PORT: String(enginePort),
      LANES_FILE_PORT: String(filePort),
      LANES_ENGINE_ID: identity.id,
      LANES_ENGINE_TOKEN: identity.token,
      // The file service builds part of its allowlist from this; pass the resolved URL down so the child can't differ.
      LANES_REGISTRY_URL: registryUrl,
      // A packaged app has no useful PATH: point the file service at the staged demo songs, or a new workspace opens empty.
      ...(bundle.demos() ? { LANES_DEMOS: bundle.demos() as string } : {}),
    },
  });
  if (child.stdout) pump(child.stdout, "file");
  if (child.stderr) pump(child.stderr, "file");
  line("host", `file service started (pid ${child.pid}) on :${filePort}`);
  return { kind: "spawned", child };
}

/** Stop a file service WE spawned, tree and all. A no-op for a foreign one — we have no
 *  child, and killing someone else's dev watcher is not ours to do. */
export function stop(child: ChildProcess | null): void {
  if (!child?.pid) return;
  killTree(child.pid);
}
