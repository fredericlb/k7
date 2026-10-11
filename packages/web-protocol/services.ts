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

/** How a host moves the loopback ports, as `st0=18789,pl8=18795`: an env var for node, a global for a page. */
export const PORTS_ENV = "STUDIO_PORTS";
export const PORTS_GLOBAL = "__STUDIO_PORTS__";

/** `st0=18789,pl8=18795` as a partial table; an unknown name or a bad number is dropped. */
export function parsePorts(
  spec: string,
): Partial<Record<StudioService, number>> {
  const out: Partial<Record<StudioService, number>> = {};
  for (const pair of spec.split(",")) {
    const [name, value] = pair.split("=").map((x) => x.trim());
    const port = Number(value);
    if (
      name in SERVICE_PORTS &&
      Number.isInteger(port) &&
      port > 0 &&
      port < 65536
    )
      out[name as StudioService] = port;
  }
  return out;
}

/** SERVICE_PORTS, with what the host moved — the desktop app runs on its own pair beside a dev session. */
export function servicePorts(): Record<StudioService, number> {
  const g = globalThis as {
    [PORTS_GLOBAL]?: unknown;
    process?: { env?: Record<string, string | undefined> };
  };
  const fromPage = g[PORTS_GLOBAL];
  const spec =
    typeof fromPage === "string" ? fromPage : g.process?.env?.[PORTS_ENV];
  return spec ? { ...SERVICE_PORTS, ...parsePorts(spec) } : SERVICE_PORTS;
}

/** Where a service answers on the machine it runs on. See SERVICE_PORTS for when to prefer it. */
export function localServiceUrl(service: StudioService): string {
  return `http://127.0.0.1:${servicePorts()[service]}`;
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
  if (isLoopbackHost(parsed.hostname))
    return loopbackServiceUrl(parsed, service);
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
 * How an engine registry says what it is: `GET <registry>/api/registry/hello` answers
 * `{ service: REGISTRY_SERVICE }`, unauthenticated. The supervisor asks BEFORE connecting to an
 * address, since a heartbeat carries the engine's token — a URL that is not a studio must never
 * receive one. It proves the software, not the owner: anyone can run a registry.
 */
export const REGISTRY_HELLO_PATH = "/api/registry/hello";
export const REGISTRY_SERVICE = "st0-registry";

/** A host where services are told apart by PORT rather than subdomain — a bare dev run. */
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/;

/** Whether `hostname` (a URL's, brackets and all for IPv6) is one where services are ports rather than subdomains. */
export const isLoopbackHost = (hostname: string): boolean =>
  LOOPBACK.test(hostname);

/**
 * `serviceUrl` on a loopback host, where a service is its PORT: a subdomain of 127.0.0.1 resolves
 * nowhere. st0 keeps a port no sibling owns (a dev server's), and leaves a sibling's for its own.
 */
function loopbackServiceUrl(parsed: URL, service: StudioService): string {
  const host = `${parsed.protocol}//${parsed.hostname}`;
  const ports = servicePorts();
  if (service === "z0")
    return loopbackServiceUrl(parsed, "st0") + SERVICE_PATHS.z0;
  if (service !== "st0") return `${host}:${ports[service]}`;
  const sibling = (["pl8", "k7"] as const).some(
    (s) => parsed.port === String(ports[s]),
  );
  return sibling ? `${host}:${ports.st0}` : parsed.origin;
}

/**
 * Which studio family a URL belongs to, as one key: st0's origin, whichever service was named —
 * or, on a loopback host where every service is a port of the same host, that host alone.
 * "" for a string that is not a URL.
 */
export function studioFamily(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  if (isLoopbackHost(parsed.hostname))
    return `${parsed.protocol}//${parsed.hostname}`;
  return serviceUrl(parsed.origin, "st0");
}

/**
 * The ONE engine registry — pl8's — for any URL of a studio family, st0's or pl8's alike: an
 * engine heartbeats there, and st0 lists its engines from there. On a loopback host a service
 * is its port, so pl8's dev port stands in for the subdomain. "" for a string that is not a URL.
 */
export function engineRegistryUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
  if (isLoopbackHost(parsed.hostname))
    return `${parsed.protocol}//${parsed.hostname}:${servicePorts().pl8}`;
  return serviceUrl(parsed.origin, "pl8");
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
