// compat.ts — can THIS engine play THAT project: the share of the plugins the project needs its
// engine to host (internal ones and VSTs alike) that the engine's catalogue has. Jsdsp, Faust and
// offline modules are left out, being built from the project's own source wherever it plays.
//
// The project's needs come from the file service's `/project-plugins`; the catalogue from the
// engine itself, `list-plugins` on a socket of its own — see docs/access.md.

import { openSocket } from "./rtcSocket.ts";

/** One plugin a project asks its engine for, as authored: `format` lowercased ("internal", "vst3"…). */
export interface PluginNeed {
  format: string;
  name: string;
}

/** One entry of an engine's catalogue — `list-plugins`' shape, trimmed to what matching reads. */
export interface CataloguePlugin {
  format: string;
  name: string;
  /** A built-in's xmlTypeName, which is how a module names it (`4osc`, where the catalogue says "4OSC"). */
  id?: string;
}

export interface Compatibility {
  /** 0–100: needs the engine has over needs the project has, floored so that only a full house reads 100. */
  score: number;
  missing: PluginNeed[];
}

const key = (format: string, name: string): string =>
  `${format.toLowerCase()}|${name.toLowerCase()}`;

/** Score one catalogue against one project's needs; a project needing nothing is 100 anywhere. */
export function compatibility(
  needs: PluginNeed[],
  catalogue: CataloguePlugin[],
): Compatibility {
  const have = new Set<string>();
  for (const p of catalogue) {
    have.add(key(p.format, p.name));
    // A built-in answers to its type name too, which is what a module authors.
    if (p.id && p.format.toLowerCase() === "internal")
      have.add(key(p.format, p.id));
  }
  const wanted = new Map<string, PluginNeed>();
  for (const n of needs) wanted.set(key(n.format, n.name), n);
  if (!wanted.size) return { score: 100, missing: [] };
  const missing = [...wanted].filter(([k]) => !have.has(k)).map(([, n]) => n);
  return {
    score: Math.floor(((wanted.size - missing.length) / wanted.size) * 100),
    missing,
  };
}

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
