// mount.ts — the six things a service needs to hold an engine registry: the guard, the
// registry, its routes, the relay, the announcement and the goodbye. One call rather than one
// hand-written copy per service, since those drift. See docs/shared.md.

import type { Server } from "node:http";
import { join } from "node:path";
import { TunnelHub } from "@studio/engine-tunnel/hub";
import { ENGINE_PROXY_PATH } from "@studio/web-protocol";
import type { Express, Request, RequestHandler } from "express";
import { advertiseRegistry } from "./advertise.ts";
import { BINDINGS_FILE, createBindings } from "./bindings.ts";
import { throttledLog } from "./heartbeat.ts";
import { createOwners, OWNERS_FILE } from "./owners.ts";
import { attachEngineProxy } from "./proxy.ts";
import { createRegistry, type EngineRegistry } from "./registry.ts";
import { engineRegistryRouter } from "./router.ts";

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
    /** Where the engines' secret bindings and owners are kept across restarts; in memory alone when absent — docs/token.md. */
    stateDir?: string;
    /** The email of the account a device token belongs to: given, a heartbeat proves its engine's owner — docs/heartbeat.md. */
    deviceOf?: (token: string) => string | null;
    /** Whether a request's account administers the origin, and so may reset an engine's owner — docs/ownership.md. */
    isAdmin?: (req: Request) => boolean;
  },
): EngineMount {
  app.use(
    ["/api/engines", ENGINE_PROXY_PATH, ...(opts.alsoGuard ?? [])],
    opts.requireAuth,
  );
  const registry = createRegistry({
    bindings: createBindings(
      opts.stateDir ? join(opts.stateDir, BINDINGS_FILE) : undefined,
    ),
    owners: createOwners(
      opts.stateDir ? join(opts.stateDir, OWNERS_FILE) : undefined,
    ),
  });
  const complain = throttledLog((l) => console.warn(`[registry] ${l}`));
  const renderKey = process.env.STUDIO_RENDER_KEY?.trim() || undefined;
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
    renderKey,
  });
  const deviceOf = opts.deviceOf;
  app.use(
    "/api",
    engineRegistryRouter(registry, tunnels, undefined, {
      isAdmin: opts.isAdmin,
      heartbeat: deviceOf
        ? {
            requireDevice: process.env.STUDIO_REGISTRY_REQUIRE_DEVICE === "1",
            deviceOf,
            renderKey,
          }
        : undefined,
    }),
  );

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
