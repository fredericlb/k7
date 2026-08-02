// engineProcess.ts — start, adopt, and stop the C++ engine. One engine per machine, with
// ~/.lanes/engine.pid as the guard (shared with the CLI). That pidfile is what makes a
// supervisor crash survivable: the engine outlives us and the next supervisor ADOPTS it,
// rather than finding the port held by a process nobody owns.

import type { ChildProcess } from "node:child_process";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import {
  engineRunning,
  ensureEngineDaemon,
  stopEngineDaemon,
} from "@studio/engine-client/engineDaemon";
import type { EngineIdentity } from "./identity.ts";
import { line, pump } from "./logbus.ts";

export type StartResult =
  /** We spawned it: ours to stop. */
  | { kind: "spawned"; child: ChildProcess }
  /** One was already running. It is NOT ours — Stop must leave it alone. */
  | { kind: "adopted" }
  /** No binary anywhere. */
  | { kind: "missing" }
  | { kind: "error"; message: string };

/**
 * Bring an engine up, or take over the one that is already there.
 *
 * ADOPTING rather than refusing is the whole difference from the old standalone host,
 * which exited with "an engine is already running — stop it first". Under a tray that
 * is wrong twice over: a force-killed tray leaves its engine and pidfile behind, and
 * refusing to start would make every launch after a crash a dead end.
 */
export function start(identity: EngineIdentity, port: number): StartResult {
  if (engineRunning()) {
    line("host", "adopting the engine already on the pidfile");
    return { kind: "adopted" };
  }
  const bin = findEngineBinary();
  if (!bin) return { kind: "missing" };

  try {
    const started = ensureEngineDaemon(bin, {
      port,
      host: "0.0.0.0", // reachable on the LAN for Tier 2; loopback still works for Tier 1
      // PIPED, not a log file: the old host wrote to cwd, where nothing reads — the Logs panel looks in ~/.lanes,
      // so the web UI's log view was simply empty. Piping puts it in the merged log.
      stdio: "pipe",
      env: {
        LANES_ENGINE_ID: identity.id,
        LANES_ENGINE_TOKEN: identity.token,
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

/**
 * Stop the engine and clear the pidfile. Reaches the whole tree on both platforms —
 * see engineDaemon's stopEngineDaemon.
 *
 * Called for an engine we OWN, and on quit for an adopted one too: closing the app is
 * terminal, and an engine left listening holds the audio device and both ports.
 */
export function stop(): void {
  stopEngineDaemon();
}
