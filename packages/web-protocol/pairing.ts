// pairing.ts — how a desktop app asks a server for a token and gets it back on its own
// loopback port. Both halves are here because they are ONE rule seen from two sides: the app
// builds the return address, st0's backend validates it, and a second spelling of "is this loopback"
// would be a hole rather than a drift. See apps/st0/backend/docs/handoff.md.
//
// The shape is RFC 8252's for native apps — the system browser, a loopback redirect, any port,
// bound to a state nonce — applied to the studio session rather than to the IdP itself.

/** Where the desktop listens for its token. One path, so the server's rule and the app's agree. */
export const PAIR_RETURN_PATH = "/desktop/pair";

/** The route on st0's backend that hands a token back. */
export const PAIR_ROUTE = "/api/token/pair";

/**
 * Is this a return address a token may be sent to?
 *
 * This predicate IS the security of the pairing route: anything looser lets a link mint
 * somebody's token into an address of the sender's choosing. Loopback http only — not
 * https (there is no certificate for 127.0.0.1), not a hostname that merely resolves to
 * loopback (DNS is the attacker's to control), and not a private LAN address, which is
 * another machine.
 */
export function isLoopbackReturn(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/**
 * The URL the desktop opens in the system browser — never in a window of its own
 * (RFC 8252 §8.12). `base` is where the token route answers, i.e. `serviceUrl(server, "pl8")`,
 * and the route is appended to its PATH rather than resolved against its origin: a base mounted
 * under a path prefix keeps it, where `new URL("/api/…", base)` would silently drop it.
 */
export function pairUrl(
  base: string,
  returnUrl: string,
  state: string,
): string {
  const u = new URL(base.replace(/\/+$/, "") + PAIR_ROUTE);
  u.searchParams.set("return", returnUrl);
  u.searchParams.set("state", state);
  return u.toString();
}

/** Where the desktop listens for its SYNC device token, beside the API token's path. */
export const SYNC_PAIR_RETURN_PATH = "/desktop/sync-pair";

/** The route on the origin that mints a device token for live sync and hands it back. */
export const SYNC_PAIR_ROUTE = "/api/sync/devices/pair";

/** The URL the desktop opens in the system browser to pair this machine with the origin's relay; `name` labels the device. */
export function syncPairUrl(
  base: string,
  returnUrl: string,
  state: string,
  name: string,
): string {
  const u = new URL(base.replace(/\/+$/, "") + SYNC_PAIR_ROUTE);
  u.searchParams.set("return", returnUrl);
  u.searchParams.set("state", state);
  u.searchParams.set("name", name);
  return u.toString();
}
