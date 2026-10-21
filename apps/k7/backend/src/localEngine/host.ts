// host.ts — under the tray, this backend runs the machine's supervisor (engine/k7-supervisor) over stdio, and so its
// engine: the page reaches them through ./routes.ts, never through a port of the supervisor's own. Off unless the
// tray names the binary (`K7_SUPERVISOR_BIN`); a hosted backend or the phone's never runs one. See ../../docs/localEngine.md.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { Snapshot } from "@studio/supervisor-host/hostProtocol";
import { SupervisorHost } from "@studio/supervisor-host/supervisorHost";
import { type EngineHostSettings, pinRegistry } from "./settings.ts";

export interface LocalEngineState {
  snapshot: Snapshot | null;
  /** Why the supervisor is away (restarting, not found), or null. */
  down: string | null;
}

export interface LocalEngine {
  state(): LocalEngineState;
  subscribe(cb: (s: LocalEngineState) => void): () => void;
  send(cmd: string, arg?: string): void;
  /** Once this backend listens: the supervisor's first heartbeat goes to it. */
  start(): void;
  /** Before this backend stops: the supervisor deregisters from it on the way out. */
  stop(): Promise<void>;
}

const stamp = (d: Date): string =>
  [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");

/** The supervisor's settings with this backend pinned first; the rest of the file is the supervisor's. */
function pinSettings(home: string, registry: string): void {
  const file = join(home, "engine-host.json");
  let kept: EngineHostSettings = {};
  try {
    if (existsSync(file)) kept = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // Unreadable: the supervisor would read it as its defaults, and so do we.
  }
  const pinned = pinRegistry(kept, registry);
  if (!pinned) return;
  writeFileSync(`${file}.tmp`, JSON.stringify(pinned, null, 2));
  renameSync(`${file}.tmp`, file);
}

/** The host the tray asked for, or null: `registry` is this backend's own address. */
export function localEngineFromEnv(
  registry: string,
  env: NodeJS.ProcessEnv = process.env,
): LocalEngine | null {
  const bin = env.K7_SUPERVISOR_BIN;
  if (!bin) return null;
  const home = env.K7_SUPERVISOR_HOME || join(homedir(), ".k7");
  const roots = [env.STUDIO_FILES_ROOT, env.STUDIO_MEDIATEK].filter(
    (r): r is string => !!r,
  );
  // The supervisor's own format, appended: the tray truncated the file when its session began, and files our stdout there too.
  const mergedLog = join(home, ".studio.log");
  const log = (text: string): void => {
    try {
      appendFileSync(mergedLog, `${stamp(new Date())} [host] ${text}\n`);
    } catch {
      // A log must never take the backend down.
    }
  };

  let current: LocalEngineState = { snapshot: null, down: null };
  const listeners = new Set<(s: LocalEngineState) => void>();
  const publish = (next: LocalEngineState): void => {
    current = next;
    for (const l of listeners) l(current);
  };

  const host = new SupervisorHost({
    bin,
    env: {
      STUDIO_HOME: home,
      STUDIO_REGISTRY_URL: registry,
      STUDIO_ENGINE_ROOTS: roots.join(delimiter),
    },
    enginePidFile: join(home, "engine.pid"),
    log,
    onSnapshot: (snapshot) => publish({ snapshot, down: null }),
    onDown: (down) => publish({ ...current, down }),
    onNotify: (n) => log(`${n.title}: ${n.body}`),
  });

  return {
    state: () => current,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    send: (cmd, arg) => host.send(cmd, arg),
    start() {
      mkdirSync(home, { recursive: true });
      pinSettings(home, registry);
      host.start();
    },
    stop: () => host.stop(),
  };
}
