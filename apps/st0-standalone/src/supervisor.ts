// supervisor.ts — the app's supervisor: @studio/supervisor-host's SupervisorHost over a home and an engine port of its own.
// Not the tray's ~/.st0 and 8765, so the two coexist on one machine (docs/standalone.md).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { line } from "@frediverse/electron-shell/log";
import { SupervisorHost } from "@studio/supervisor-host/supervisorHost";

/** Not the tray's 8765: the supervisor adopts whatever engine already listens on its port. */
export const ENGINE_PORT = 8766;

export function startSupervisor(
  bin: string,
  home: string,
  registryUrl: string,
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
      // No Downloads tab here to choose in, so every instrument is fetched (engine/st0-supervisor/docs/instruments.md).
      STUDIO_INSTRUMENTS: "all",
      STUDIO_REGISTRY_URL: registryUrl,
    },
    enginePidFile: join(home, "engine.pid"),
    onSnapshot: (s) => {
      const status = s.error ? `${s.status}: ${s.error}` : s.status;
      if (status !== lastStatus) line("supervisor", `status ${status}`);
      lastStatus = status;
    },
    onNotify: (n) => line("supervisor", `${n.title}: ${n.body}`),
  });
  host.start();
  return host;
}
