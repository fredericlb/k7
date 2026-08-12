// services.ts — where each studio service answers. One origin, one fixed path per service,
// stated once so nothing derives it a second way. Browser-safe: no node imports, because the
// SPAs, the file service and the supervisor all have to agree about this.

/**
 * The path each service is mounted at, under the studio origin.
 *
 * FIXED, and that is the point: `st0.priv.frediver.se/l8` in dev and
 * `studio.frediver.se/l8` in production differ by their ORIGIN and nothing else. The
 * proxy config mirrors what the production edge does — strip the prefix off the API routes, keep
 * it on the SPA's — so a service that moved to a host of its own would break the one session
 * cookie the origin carries. There is nothing here to configure.
 *
 * `st0` is deliberately `""`: the médiathèque is the studio's front door, so it answers at
 * the ORIGIN itself and `serviceUrl(origin, "st0")` is the origin. An empty path is a real
 * entry here rather than a special case at each call site — every caller already concatenates.
 *
 * This table says WHERE a service answers, and nothing about whose session it carries. `z0` is
 * the case that makes the distinction worth stating: the game runs its own login on its own
 * `/z0/auth/callback` and does not share st0's cookie — but its path is as fixed as the
 * others', and it holds a surface that opens a project, which needs an address st0 can write.
 */
export const SERVICE_PATHS = {
  l8: "/l8",
  st0: "",
  k7: "/k7",
  m9: "/m9",
  z0: "/z0",
} as const;

export type StudioService = keyof typeof SERVICE_PATHS;

/** The hosted studio. A constant and not a setting, for the same reason the paths are. */
export const STUDIO_ORIGIN = "https://studio.frediver.se";

/**
 * Each backend's port on the machine that runs it — the other half of the same fixed table.
 * The LAN proxy proxies to these, and each app's vite config names its own.
 *
 * A SERVER calling another studio service uses this rather than the public URL, and the reason
 * is not performance: in a checkout everything is behind a private CA, whose local CA
 * node does not trust, so `https://st0.priv.frediver.se/l8` fails with UNABLE_TO_GET_ISSUER_CERT
 * from a backend while working perfectly in the browser beside it.
 */
export const SERVICE_PORTS: Record<StudioService, number> = {
  l8: 8789,
  st0: 8795,
  k7: 8787,
  m9: 8796,
  z0: 8080,
};

/** Where a service answers on the machine it runs on. See SERVICE_PORTS for when to prefer it. */
export function localServiceUrl(service: StudioService): string {
  return `http://127.0.0.1:${SERVICE_PORTS[service]}`;
}

/**
 * Where a service is, given the origin it is served from.
 *
 * `origin` may be any URL on that origin — a registry URL a backend advertised
 * (`https://st0.priv.frediver.se/l8`), the page's own `location.origin`, whatever the caller has
 * to hand. Everything but the origin is dropped, so no caller has to strip a path first.
 */
export function serviceUrl(origin: string, service: StudioService): string {
  return studioOrigin(origin) + SERVICE_PATHS[service];
}

/** The bare origin of any studio URL, with no trailing slash. Returns "" for a string that
 *  is not a URL at all — a caller with nothing usable gets nothing, never a throw. */
export function studioOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}
