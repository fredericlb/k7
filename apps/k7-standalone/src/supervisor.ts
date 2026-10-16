// supervisor.ts — the app's supervisor: @studio/supervisor-host's SupervisorHost over a home and an engine port of its own.
// Not the command-line engine's ~/.k7 and 8765, so the two coexist on one machine (docs/standalone.md).

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { line } from "@frediverse/electron-shell/log";
import type { Snapshot } from "@studio/supervisor-host/hostProtocol";
import { SupervisorHost } from "@studio/supervisor-host/supervisorHost";
import { noticeDown, noticeFrame, noticeSnapshot } from "./notices.ts";

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
  // The rest of the file is the supervisor's; its studios are not: this engine is reached from the LAN only (docs/engine.md).
  let kept: Record<string, unknown> = { port: ENGINE_PORT };
  try {
    if (existsSync(settings))
      kept = JSON.parse(readFileSync(settings, "utf8")) as Record<
        string,
        unknown
      >;
  } catch {
    // Unreadable: the supervisor would read it as its defaults, and so do we.
  }
  const pinned = { ...kept, registryUrls: [registryUrl] };
  if (JSON.stringify(kept) !== JSON.stringify(pinned)) {
    const tmp = `${settings}.tmp`;
    writeFileSync(tmp, JSON.stringify(pinned, null, 2));
    renameSync(tmp, settings);
  }
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
      noticeSnapshot(s);
      watch.onSnapshot?.(s);
    },
    onDown: (why) => {
      noticeDown(why);
      watch.onDown?.(why);
    },
    onNotify: (n) => {
      line("supervisor", `${n.title}: ${n.body}`);
      noticeFrame(n);
    },
  });
  host.start();
  return host;
}
