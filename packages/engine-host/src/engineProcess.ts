// engineProcess.ts — start, adopt, and stop the C++ engine. One engine per machine, with
// ~/.studio/engine.pid as the guard (shared with the CLI). That pidfile is what makes a
// supervisor crash survivable: the engine outlives us and the next supervisor ADOPTS it,
// rather than finding the port held by a process nobody owns.

import type { ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import {
  ENGINE_PID,
  engineRunning,
  ensureEngineDaemon,
  stopEngineDaemon,
} from "@studio/engine-client/engineDaemon";
import type { EngineIdentity } from "./identity.ts";
import { line, pump } from "./logbus.ts";
import { isServing } from "./portProbe.ts";

export type StartResult =
  /** We spawned it: ours to stop. */
  | { kind: "spawned"; child: ChildProcess }
  /** One was already running. It is NOT ours — Stop must leave it alone. */
  | { kind: "adopted" }
  /** No binary anywhere. */
  | { kind: "missing" }
  | { kind: "error"; message: string };

/** Bring an engine up, or ADOPT the one already there — refusing would make every launch after a crash a dead end. See docs/supervisorPolicy.md. */
export async function start(
  identity: EngineIdentity,
  port: number,
): Promise<StartResult> {
  // A pid is not an identity, so the PORT is asked too — and asked here, where a wrong probe costs a spare engine rather than audio.
  if (engineRunning()) {
    if (await isServing(port)) {
      line("host", "adopting the engine already on the pidfile");
      return { kind: "adopted" };
    }
    line(
      "host",
      `pidfile names a live process but nothing answers :${port} — stale, starting a fresh engine`,
    );
    // Cleared, or `ensureEngineDaemon` refuses on the same check and adopts the ghost again; the process itself is somebody else's now.
    rmSync(ENGINE_PID, { force: true });
  }
  const bin = findEngineBinary();
  if (!bin) return { kind: "missing" };

  try {
    const started = ensureEngineDaemon(bin, {
      port,
      host: "0.0.0.0", // reachable on the LAN for Tier 2; loopback still works for Tier 1
      // PIPED, not a log file: the Logs panel reads the merged log in ~/.studio, and a file in cwd is read by nothing.
      stdio: "pipe",
      env: {
        STUDIO_ENGINE_ID: identity.id,
        STUDIO_ENGINE_TOKEN: identity.token,
      },
    });
    if (started === false) return { kind: "adopted" }; // raced us to running
    if (started === true) return { kind: "adopted" }; // no pipes to attach — treat as foreign
    const child = started;
    if (child.stdout) pump(child.stdout, "engine");
    if (child.stderr) pump(child.stderr, "engine");
    line("host", `engine started (pid ${child.pid}) on :${port}`);
    return { kind: "spawned", child };
  } catch (e) {
    return {
      kind: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Is an engine up? (pidfile exists AND that process is alive.) */
export { engineRunning };

/** Stop the engine and clear the pidfile, reaching the whole tree; called on quit even for an ADOPTED engine, which would hold the device. */
export function stop(): void {
  stopEngineDaemon();
}
