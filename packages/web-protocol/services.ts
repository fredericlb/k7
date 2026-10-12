// services.ts — where each studio service answers. Every one is st0's origin: z0 is a path under
// it, and pl8 (the media library) and k7 (the rehearsal recorder) are served BY st0 — `play.` and
// `k7.` are only alias hosts that saved URLs still reach. Stated once so nothing derives it a
// second way. Browser-safe: no node imports, because the SPAs, the file service and the
// supervisor all have to agree about this.

export type StudioService = "st0" | "pl8" | "k7" | "z0";

/** z0's path under st0's own origin — the one service still living there; docs/addresses.md. */
export const SERVICE_PATHS: Record<"z0", string> = { z0: "/z0" };

/** The alias hosts st0 also answers on — pl8's and k7's former addresses, kept for saved URLs. */
const ALIAS_LABELS = ["play", "k7"];

/** The services with an address of their own — the others are served by st0's process. */
type Addressed = Exclude<StudioService, "pl8" | "k7">;

/** A service and the one whose address it shares — pl8 and k7 are served by st0's own process. */
const addressOf = (service: StudioService): Addressed =>
  service === "pl8" || service === "k7" ? "st0" : service;

/**
 * st0's OWN hostname, given any studio hostname — stripping an alias's label back off.
 * Pattern-based rather than a fixed table of known domains, so a deployment on its
 * own domain needs nothing configured here.
 */
function st0Hostname(hostname: string): string {
  for (const label of ALIAS_LABELS) {
    const prefix = `${label}.`;
    if (hostname.startsWith(prefix)) return hostname.slice(prefix.length);
  }
  return hostname;
}

/** The hosted studio. A constant and not a setting, for the same reason the paths are. */
export const STUDIO_ORIGIN = "https://st0.app";

/** Each backend's port — what a SERVER calls, since node does not trust the dev CA; see docs/addresses.md. */
export const SERVICE_PORTS: Record<Addressed, number> = {
  st0: 8789,
  z0: 8080,
};

/** How a host moves the loopback ports, as `st0=18789,z0=18080`: an env var for node, a global for a page. */
export const PORTS_ENV = "STUDIO_PORTS";
export const PORTS_GLOBAL = "__STUDIO_PORTS__";

/** `st0=18789,z0=18080` as a partial table; an unknown name (pl8 and k7 included) or a bad number is dropped. */
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

/** SERVICE_PORTS, with what the host moved, and pl8 and k7 on st0's — the desktop app runs on its own ports beside a dev session. */
export function servicePorts(): Record<StudioService, number> {
  const g = globalThis as {
    [PORTS_GLOBAL]?: unknown;
    process?: { env?: Record<string, string | undefined> };
  };
  const fromPage = g[PORTS_GLOBAL];
  const spec =
    typeof fromPage === "string" ? fromPage : g.process?.env?.[PORTS_ENV];
  const ports = spec
    ? { ...SERVICE_PORTS, ...parsePorts(spec) }
    : SERVICE_PORTS;
  return { ...ports, pl8: ports.st0, k7: ports.st0 };
}

/** Where a service answers on the machine it runs on. See SERVICE_PORTS for when to prefer it. */
export function localServiceUrl(service: StudioService): string {
  return `http://127.0.0.1:${servicePorts()[service]}`;
}

/**
 * Where a service is, given any URL on studio's origin (of any of its apps): everything
 * but that URL's origin is dropped, an alias label stripped, and every service keeps what
 * is left — they share one origin, z0 a path under it.
 */
export function serviceUrl(origin: string, named: StudioService): string {
  const service = addressOf(named);
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return "";
  }
  const base = st0Hostname(parsed.hostname);
  if (service === "z0") return serviceUrl(origin, "st0") + SERVICE_PATHS.z0;
  // Unchanged (port included) when nothing was stripped: st0 itself, or a loopback dev host.
  return base === parsed.hostname
    ? parsed.origin
    : `${parsed.protocol}//${base}`;
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
 * The ONE engine registry — st0's origin — for any URL of a studio family, the `play.` and `k7.`
 * aliases included: an engine heartbeats there, and st0 lists its engines from there. On a loopback host
 * a service is its port, so st0's backend port stands in. "" for a string that is not a URL.
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
    return `${parsed.protocol}//${parsed.hostname}:${servicePorts().st0}`;
  return serviceUrl(parsed.origin, "st0");
}

/**
 * Where `/auth/*` actually lives, given the origin a page is CURRENTLY running on — the
 * family root. The `play.` and `k7.` aliases still answer, but the OIDC provider has exactly
 * ONE registered redirect_uri, at that root, so a page on an alias must send the browser
 * there instead of to its own, same-looking-but-wrong `/auth/login`.
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
