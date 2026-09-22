// services.ts — where each studio service answers. st0, pl8 and k7 each have their OWN
// subdomain; z0 stays a path under st0's, since it hasn't moved — stated once so nothing
// derives it a second way. Browser-safe: no node imports, because the SPAs, the file
// service and the supervisor all have to agree about this.

export type StudioService = "st0" | "pl8" | "k7" | "z0";

/** z0's path under st0's own origin — the one service still living there; docs/addresses.md. */
export const SERVICE_PATHS: Record<"z0", string> = { z0: "/z0" };

/** The label pl8/k7 prepend to st0's own hostname, dev or prod — whichever domain is live. */
const SUBDOMAIN: Record<"pl8" | "k7", string> = { pl8: "play", k7: "k7" };

/**
 * st0's OWN hostname, given any studio hostname — stripping a sibling's label back off if
 * `hostname` was already pl8's or k7's rather than st0's. Pattern-based rather than a fixed
 * table of known domains, so a deployment on its own domain needs nothing configured here.
 */
function st0Hostname(hostname: string): string {
  for (const label of Object.values(SUBDOMAIN)) {
    const prefix = `${label}.`;
    if (hostname.startsWith(prefix)) return hostname.slice(prefix.length);
  }
  return hostname;
}

/** The hosted studio. A constant and not a setting, for the same reason the paths are. */
export const STUDIO_ORIGIN = "https://st0.app";

/** Each backend's port — what a SERVER calls, since node does not trust the dev CA; see docs/addresses.md. */
export const SERVICE_PORTS: Record<StudioService, number> = {
  st0: 8789,
  pl8: 8795,
  k7: 8787,
  z0: 8080,
};

/** Where a service answers on the machine it runs on. See SERVICE_PORTS for when to prefer it. */
export function localServiceUrl(service: StudioService): string {
  return `http://127.0.0.1:${SERVICE_PORTS[service]}`;
}

/**
 * Where a service is, given any URL on studio's origin (of any of its apps): everything
 * but that URL's origin is dropped, then st0/z0 keep it (they still share one origin)
 * while pl8/k7 resolve to their OWN host — `<label>.` prepended to st0's own hostname,
 * whichever domain that turns out to be, dev or prod or a deployment's own.
 */
export function serviceUrl(origin: string, service: StudioService): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return "";
  }
  const base = st0Hostname(parsed.hostname);
  if (service === "st0") {
    // Unchanged (port included) when nothing was stripped — st0 linking to itself, or a bare
    // dev host like localhost:5223. A stripped family root never carries a dev port of its own.
    return base === parsed.hostname
      ? parsed.origin
      : `${parsed.protocol}//${base}`;
  }
  if (service === "z0") return serviceUrl(origin, "st0") + SERVICE_PATHS.z0;
  return `${parsed.protocol}//${SUBDOMAIN[service]}.${base}`;
}

/**
 * Where `/auth/*` actually lives, given the origin a page is CURRENTLY running on — the
 * family root. pl8/k7 answer on their OWN subdomain, but the OIDC provider has exactly ONE
 * registered redirect_uri, at that root, so a page on a sibling subdomain must send the
 * browser there instead of to its own, same-looking-but-wrong `/auth/login`.
 */
export const authOrigin = (origin: string): string => serviceUrl(origin, "st0");

/** The bare origin of any studio URL; "" for a string that is not a URL at all, never a throw. */
export function studioOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}
