// services.ts — where each studio service answers. Every one is k7's origin, `app.<domain>`: pl8
// (the media library) is served BY k7, and `docs.<domain>` is the same app showing its
// documentation alone. `st0.app` and its `play.` / `k7.` aliases are FORMER hosts that
// saved URLs still reach, each read as the current origin. Browser-safe: no node imports, because
// the SPAs, the file service and the supervisor all have to agree about this — docs/addresses.md.

export type StudioService = "k7" | "pl8";

/** The alias hosts k7 also answers on — pl8's and the rehearsal recorder's former addresses, kept for saved URLs. */
const ALIAS_LABELS = ["play", "k7"];

/** k7's label in front of its domain, and the documentation's beside it. */
const APP_LABEL = "app";
const DOCS_LABEL = "docs";

/** The former hosts, each read as the one that replaced it — docs/addresses.md. */
const LEGACY_HOSTS: Record<string, string> = {
  "st0.app": "app.k7.rocks",
  "priv.st0.app": "app.priv.k7.rocks",
};

/** The services with an address of their own — the others are served by k7's process. */
type Addressed = Exclude<StudioService, "pl8">;

/**
 * k7's OWN hostname, given any studio hostname — an alias's label stripped back off, `docs.`
 * swapped for `app.`, and a former host read as its successor. Pattern-based apart from
 * LEGACY_HOSTS, so a deployment on its own domain needs nothing configured here.
 */
function k7Hostname(hostname: string): string {
  let host = hostname;
  for (const label of ALIAS_LABELS) {
    const rest = host.slice(label.length + 1);
    // Stripped only off a real domain: `k7.rocks` is a domain, not an alias of `rocks`.
    if (host.startsWith(`${label}.`) && rest.includes(".")) {
      host = rest;
      break;
    }
  }
  if (host.startsWith(`${DOCS_LABEL}.`))
    host = `${APP_LABEL}.${host.slice(DOCS_LABEL.length + 1)}`;
  return LEGACY_HOSTS[host] ?? host;
}

/** A former host's successor, its `play.` and `k7.` aliases included, or null: by name only, so another deployment's hosts are never rewritten. */
function successorOf(hostname: string): string | null {
  if (LEGACY_HOSTS[hostname]) return LEGACY_HOSTS[hostname];
  for (const label of ALIAS_LABELS) {
    const rest = hostname.slice(label.length + 1);
    if (hostname.startsWith(`${label}.`) && LEGACY_HOSTS[rest])
      return LEGACY_HOSTS[rest];
  }
  return null;
}

/** `url` moved off a former host onto its successor, scheme, path and query kept; any other URL as it was — docs/addresses.md. */
export function currentStudioUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const next = successorOf(parsed.hostname);
  if (!next) return url;
  const bare = url === parsed.origin;
  parsed.hostname = next;
  parsed.port = "";
  // An origin stays an origin: URL would add a "/" the stored value never had.
  return bare ? parsed.origin : parsed.toString();
}

/** Whether `hostname` is the documentation's host — the app showing its docs and nothing else. */
export const isDocsHost = (hostname: string): boolean =>
  hostname.startsWith(`${DOCS_LABEL}.`);

/** Whether `hostname` is an alias or a former host, whose pages move to k7's own origin. */
export const isLegacyHost = (hostname: string): boolean =>
  !isDocsHost(hostname) && k7Hostname(hostname) !== hostname;

/** The hosted studio. A constant and not a setting, for the same reason the paths are. */
export const STUDIO_ORIGIN = "https://app.k7.rocks";

/** Each backend's port — what a SERVER calls, since node does not trust the dev CA; see docs/addresses.md. */
export const SERVICE_PORTS: Record<Addressed, number> = {
  k7: 8789,
};

/** How a host moves the loopback ports, as `k7=18789`: an env var for node, a global for a page. */
export const PORTS_ENV = "STUDIO_PORTS";
export const PORTS_GLOBAL = "__STUDIO_PORTS__";

/** `k7=18789` as a partial table; an unknown name (pl8 included) or a bad number is dropped. */
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

/** SERVICE_PORTS, with what the host moved, and pl8 on k7's — the desktop app runs on its own ports beside a dev session. */
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
  return { ...ports, pl8: ports.k7 };
}

/** Where a service answers on the machine it runs on. See SERVICE_PORTS for when to prefer it. */
export function localServiceUrl(service: StudioService): string {
  return `http://127.0.0.1:${servicePorts()[service]}`;
}

/**
 * Where a service is, given any URL on studio's origin (of any of its apps): everything
 * but that URL's origin is dropped, an alias label stripped, and every service keeps what
 * is left — they share one origin.
 */
export function serviceUrl(origin: string, _service: StudioService): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return "";
  }
  const base = k7Hostname(parsed.hostname);
  // Unchanged (port included) when nothing was stripped: k7 itself, or a loopback dev host.
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
export const REGISTRY_SERVICE = "k7-registry";

/** A host where services are told apart by PORT rather than subdomain — a bare dev run. */
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/;

/** Whether `hostname` (a URL's, brackets and all for IPv6) is one where services are ports rather than subdomains. */
export const isLoopbackHost = (hostname: string): boolean =>
  LOOPBACK.test(hostname);

/** A socket peer address on this machine — `127.0.0.0/8`, `::1`, or either IPv4 one in its IPv4-mapped spelling. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const a = address.replace(/^::ffff:/i, "");
  return a === "::1" || /^127(\.\d{1,3}){3}$/.test(a);
}

/**
 * Which studio family a URL belongs to, as one key: k7's origin, whichever service was named —
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
  return serviceUrl(parsed.origin, "k7");
}

/**
 * The ONE engine registry — k7's origin — for any URL of a studio family, the `play.` and `k7.`
 * aliases included: an engine heartbeats there, and k7 lists its engines from there. On a loopback host
 * a service is its port, so k7's backend port stands in. "" for a string that is not a URL.
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
    return `${parsed.protocol}//${parsed.hostname}:${servicePorts().k7}`;
  return serviceUrl(parsed.origin, "k7");
}

/**
 * Where `/auth/*` actually lives, given the origin a page is CURRENTLY running on — the
 * family root. The `play.` and `k7.` aliases still answer, but the OIDC provider has exactly
 * ONE registered redirect_uri, at that root, so a page on an alias must send the browser
 * there instead of to its own, same-looking-but-wrong `/auth/login`.
 */
export const authOrigin = (origin: string): string => serviceUrl(origin, "k7");

/** The bare origin of any studio URL; "" for a string that is not a URL at all, never a throw. */
export function studioOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}
