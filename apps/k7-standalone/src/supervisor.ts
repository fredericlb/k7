// supervisor.ts — the app's supervisor: @studio/supervisor-host's SupervisorHost over a home and an engine port of its own.
// Not the command-line engine's ~/.k7 and 8765, so the two coexist on one machine (docs/standalone.md).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { line } from "@frediverse/electron-shell/log";
import type { Snapshot } from "@studio/supervisor-host/hostProtocol";
import { SupervisorHost } from "@studio/supervisor-host/supervisorHost";

/** Not the command-line engine's 8765: the supervisor adopts whatever engine already listens on its port. */
export const ENGINE_PORT = 8766;

export function startSupervisor(
  bin: string,
  home: string,
  registryUrl: string,
  watch: {
    onSnapshot?: (s: Snapshot) => void;
    onDown?: (why: string | null) => void;
  } = {},
): SupervisorHost {
  mkdirSync(home, { recursive: true });
  const settings = join(home, "engine-host.json");
  // First run only: after that the file is the supervisor's, edited through its own commands.
  if (!existsSync(settings))
    writeFileSync(
      settings,
      JSON.stringify(
        { registryUrls: [registryUrl], port: ENGINE_PORT },
        null,
        2,
      ),
    );
  let lastStatus = "";
  const host = new SupervisorHost({
    bin,
    env: {
      STUDIO_HOME: home,
      STUDIO_REGISTRY_URL: registryUrl,
    },
    enginePidFile: join(home, "engine.pid"),
    onSnapshot: (s) => {
      const status = s.error ? `${s.status}: ${s.error}` : s.status;
      if (status !== lastStatus) line("supervisor", `status ${status}`);
      lastStatus = status;
      watch.onSnapshot?.(s);
    },
    onDown: (why) => watch.onDown?.(why),
    onNotify: (n) => line("supervisor", `${n.title}: ${n.body}`),
  });
  host.start();
  return host;
}
