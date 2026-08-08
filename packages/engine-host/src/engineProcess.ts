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

/**
 * Bring an engine up, or take over the one that is already there.
 *
 * ADOPTING rather than refusing is the whole difference from the old standalone host,
 * which exited with "an engine is already running — stop it first". Under a tray that
 * is wrong twice over: a force-killed tray leaves its engine and pidfile behind, and
 * refusing to start would make every launch after a crash a dead end.
 */
export async function start(
  identity: EngineIdentity,
  port: number,
): Promise<StartResult> {
  // A pid is not an identity. `engineRunning()` only asks whether that number is a live
  // process, and a pidfile outlives the engine that wrote it: overnight the engine died, the
  // OS handed 25096 to an unrelated node, and the next supervisor adopted it. Nothing then
  // spawned an engine, nothing complained, and every app listed a machine that answered
  // nothing — the heartbeat kept going, because it asks the same wrong question.
  //
  // So the port is asked too. Confirming here is free of the risk the same check would carry
  // in the crash watch: this runs at startup, before anything is playing, so a probe that is
  // wrong costs a spare engine rather than somebody's audio.
  if (engineRunning()) {
    if (await isServing(port)) {
      line("host", "adopting the engine already on the pidfile");
      return { kind: "adopted" };
    }
    line(
      "host",
      `pidfile names a live process but nothing answers :${port} — stale, starting a fresh engine`,
    );
    // Cleared, or `ensureEngineDaemon` refuses on the very same check and we adopt the ghost
    // all over again. The process itself is left alone: it is somebody else's now.
    rmSync(ENGINE_PID, { force: true });
  }
  const bin = findEngineBinary();
  if (!bin) return { kind: "missing" };

  try {
    const started = ensureEngineDaemon(bin, {
      port,
      host: "0.0.0.0", // reachable on the LAN for Tier 2; loopback still works for Tier 1
      // PIPED, not a log file: the old host wrote to cwd, where nothing reads — the Logs panel looks in ~/.studio,
      // so the web UI's log view was simply empty. Piping puts it in the merged log.
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
