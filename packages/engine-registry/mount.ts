// mount.ts — the six things a service needs to hold an engine registry: the guard, the
// registry, its routes, the relay, the announcement and the goodbye. One call rather than one
// hand-written copy per service, since those drift. See docs/shared.md.

import type { Server } from "node:http";
import { join } from "node:path";
import { TunnelHub } from "@studio/engine-tunnel/hub";
import type {
  Express,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import { advertiseRegistry } from "./advertise.ts";
import { BINDINGS_FILE, createBindings } from "./bindings.ts";
import { throttledLog } from "./heartbeat.ts";
import { attachEngineProxy } from "./proxy.ts";
import { createRegistry, type EngineRegistry } from "./registry.ts";
import { engineRegistryRouter } from "./router.ts";

/** How large a body may be on the way to an engine's file service — ONE number, matching what the file service accepts. See docs/shared.md. */
export const ENGINE_BODY_LIMIT = "8mb";

export interface EngineMount {
  /** This service's own registry — see docs/shared.md for why it is not shared. */
  registry: EngineRegistry;
  /** The engines that dialled IN, each reachable however far away — packages/engine-tunnel/docs/tunnel.md. */
  tunnels: TunnelHub;
  /** Attach the relay and announce the registry once the server is listening; `alsoOnStop` runs with the goodbye. See docs/shared.md. */
  serve(server: Server, url: string, alsoOnStop?: () => void): () => void;
}

/** Everything one service needs to hold engines, in the ONE order that works — the ordering is the load-bearing part, see docs/shared.md. */
export function mountEngineRegistry(
  app: Express,
  opts: {
    /** The service's slug, and its file name under ~/.k7/web-endpoints. */
    service: string;
    requireAuth: RequestHandler;
    alsoGuard?: string[];
    /** False when the host closes gracefully itself and calls the returned goodbye; default true. */
    exitOnSignal?: boolean;
    /** Where the engines' secret bindings are kept across restarts; in memory alone when absent — docs/token.md. */
    stateDir?: string;
  },
): EngineMount {
  app.use(
    ["/api/engines", "/api/engine", ...(opts.alsoGuard ?? [])],
    opts.requireAuth,
  );
  const registry = createRegistry({
    bindings: createBindings(
      opts.stateDir ? join(opts.stateDir, BINDINGS_FILE) : undefined,
    ),
  });
  const complain = throttledLog((l) => console.warn(`[registry] ${l}`));
  // Only an engine this registry lists may hold a tunnel: its token, and its secret once the id is bound to one.
  const tunnels = new TunnelHub({
    verify: (id, token, secret) => {
      if (registry.verifyTunnel(id, token, secret)) return true;
      complain(
        `${id}|tunnel`,
        `refused a tunnel for engine ${id}: not listed, or the wrong token or secret`,
      );
      return false;
    },
    // The deployment's render machine, which renders for a server with no engine binary (docs/server-engine.md).
    renderKey: process.env.STUDIO_RENDER_KEY?.trim() || undefined,
  });
  app.use("/api", engineRegistryRouter(registry, tunnels));

  return {
    registry,
    tunnels,
    serve(server, url, alsoOnStop) {
      attachEngineProxy(server, registry, tunnels);
      const unadvertise = advertiseRegistry(opts.service, url);
      let said = false;
      const bye = () => {
        if (said) return;
        said = true;
        unadvertise();
        try {
          alsoOnStop?.();
        } catch {
          /* on the way out — a failed cleanup must not stop the rest */
        }
      };
      if (opts.exitOnSignal === false) return bye;
      // Both, and idempotent: a service that leaves its endpoint file behind is heartbeated to a dead port for ever after.
      process.on("SIGINT", () => {
        bye();
        process.exit(0);
      });
      process.on("SIGTERM", () => {
        bye();
        process.exit(0);
      });
      return bye;
    },
  };
}

/** The last word on an error, for the caller that HANGS UP mid-body; MOUNT IT LAST, and keep the unused `_next` — see docs/shared.md. */
export function engineErrorHandler(
  err: Error & { type?: string; code?: string; status?: number },
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // A disconnect and nothing else: `entity.too.large` is deliberately not one, since that caller is still there and wants its 413.
  const gone =
    err.type === "request.aborted" ||
    err.code === "ECONNABORTED" ||
    err.code === "ECONNRESET";
  if (gone) console.warn(`↯ ${req.method} ${req.originalUrl}: ${err.message}`);
  else console.error(`✗ ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return void res.end();
  res.status(err.status ?? 500).json({ error: err.message || "server error" });
}
