// mount.ts — the six lines every service repeated to hold an engine registry: the guard, the
// registry, its routes, the relay, the announcement and the goodbye. One call instead, because
// the copies had already drifted. See docs/shared.md.

import type { Server } from "node:http";
import type {
  Express,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import { advertiseRegistry } from "./advertise.ts";
import { attachEngineProxy } from "./proxy.ts";
import { createRegistry, type EngineRegistry } from "./registry.ts";
import { engineRegistryRouter } from "./router.ts";

/**
 * How large a body may be on the way to an engine's file service.
 *
 * ONE number, because the relay makes these three backends a pipe to a fourth: the file service
 * accepts 8 MB, and a service that parses less turns a legitimate upload into a 413 depending
 * on which origin the browser happened to be on. l8 had raised it and the other two had not,
 * so the same request worked or failed by which app relayed it.
 */
export const ENGINE_BODY_LIMIT = "8mb";

export interface EngineMount {
  /** This service's own registry — see docs/shared.md for why it is not shared. */
  registry: EngineRegistry;
  /**
   * Attach the relay and announce the registry, once the server is listening.
   *
   * Split from the mounting above because a WebSocket upgrade never reaches Express's
   * middleware chain: the relay needs the http.Server, which does not exist until `listen`.
   *
   * `alsoOnStop` runs with the goodbye, before the process leaves. It exists because this
   * installs the signal handlers AND exits in them: a service that registered its own
   * afterwards would simply never see them run.
   */
  serve(server: Server, url: string, alsoOnStop?: () => void): () => void;
}

/**
 * Everything one service needs to hold engines, mounted in the one order that works.
 *
 * The order is the load-bearing part and the reason this is a function rather than a page of
 * documentation: `requireAuth` goes on the browser-facing paths BEFORE the router, so that the
 * engine-facing ones — heartbeat and deregister, where a machine authenticates with its own
 * token — stay open. Written out per service, that ordering was a rule three files had to keep,
 * and the day one of them mounted a guard on all of `/api` the only thing still protecting the
 * heartbeat was that the registry router had already answered.
 *
 * `alsoGuard` is for paths that are this service's own but belong behind the same session —
 * m9 puts its preferences there.
 */
export function mountEngineRegistry(
  app: Express,
  opts: {
    /** The slug the supervisor heartbeats to, and the file name under ~/.studio/web-endpoints. */
    service: string;
    requireAuth: RequestHandler;
    alsoGuard?: string[];
  },
): EngineMount {
  app.use(
    ["/api/engines", "/api/engine", ...(opts.alsoGuard ?? [])],
    opts.requireAuth,
  );
  const registry = createRegistry();
  app.use("/api", engineRegistryRouter(registry));

  return {
    registry,
    serve(server, url, alsoOnStop) {
      attachEngineProxy(server, registry);
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
      // Both, and idempotent: the tray sends one, a terminal sends the other, and a service
      // that leaves its endpoint file behind is heartbeated to a dead port for ever after.
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

/**
 * The last word on an error, and the reason a service that relays bodies needs one: a caller
 * that HANGS UP.
 *
 * A body that stops arriving is an everyday event — a cancelled upload, a closed tab, a socket
 * the relay gave up on. `raw-body` reports it as `BadRequestError: request aborted`, thrown
 * INSIDE the parser where a route's own try/catch cannot see it. Without this it reaches
 * Express's default handler, which prints nine lines of stack and names neither the method nor
 * the path: a normal disconnect dressed as a crash, and undiagnosable.
 *
 * Only pl8 had it, and all three relay the same bytes.
 *
 * MOUNT IT LAST — after every route. Four arguments, `_next` included and unused: that shape is
 * how Express tells an error handler from an ordinary middleware, and dropping it silently
 * turns this into one that never runs.
 */
export function engineErrorHandler(
  err: Error & { type?: string; code?: string; status?: number },
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // A disconnect, and nothing else: `entity.too.large` deliberately is NOT one — that caller is
  // still there and wants its 413, which `err.status` already carries.
  const gone =
    err.type === "request.aborted" ||
    err.code === "ECONNABORTED" ||
    err.code === "ECONNRESET";
  if (gone) console.warn(`↯ ${req.method} ${req.originalUrl}: ${err.message}`);
  else console.error(`✗ ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return void res.end();
  res.status(err.status ?? 500).json({ error: err.message || "server error" });
}
