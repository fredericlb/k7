// compat.ts — the browser's half of an engine's compatibility with a project: asking the engine
// for its catalogue. The score itself is @studio/web-protocol/compat's, shared with the file
// service, which scores the same way on the engine's machine (`/project-compat`) — see
// docs/access.md.

import type { CataloguePlugin } from "@studio/web-protocol/compat";
import { openSocket } from "./rtcSocket.ts";

export {
  type CataloguePlugin,
  type Compatibility,
  compatibility,
  type PluginNeed,
} from "@studio/web-protocol/compat";

/** How long an engine has to list its plugins; a cold one scans first, and that is not worth waiting for. */
const CATALOGUE_TIMEOUT_MS = 3000;

/** Ask one engine for its plugin catalogue on a short-lived socket; null when it did not answer in time. */
export function pluginCatalogue(
  wsUrl: string,
  timeoutMs = CATALOGUE_TIMEOUT_MS,
): Promise<CataloguePlugin[] | null> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    let done = false;
    const finish = (list: CataloguePlugin[] | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* not open */
      }
      resolve(list);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      ws = openSocket(wsUrl);
    } catch {
      return finish(null);
    }
    // A probe query: the engine answers it without a session, as it does `whoami`.
    ws.onopen = () => ws.send(JSON.stringify({ type: "list-plugins" }));
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(String(ev.data)) as {
          type?: string;
          plugins?: CataloguePlugin[];
        };
        if (m.type === "plugins")
          finish(Array.isArray(m.plugins) ? m.plugins : []);
      } catch {
        /* ignore non-JSON frames */
      }
    };
    ws.onerror = () => finish(null);
    ws.onclose = () => finish(null);
  });
}
