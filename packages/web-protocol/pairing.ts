// pairing.ts — how a desktop app asks a server for a token and gets it back on its own
// loopback port. Both halves are here because they are ONE rule seen from two sides: the app
// builds the return address, pl8 validates it, and a second spelling of "is this loopback"
// would be a hole rather than a drift. See apps/st0-desktop/docs/pairing.md.
//
// The shape is RFC 8252's for native apps — the system browser, a loopback redirect, any port,
// bound to a state nonce — applied to the studio session rather than to the IdP itself.

/** Where the desktop listens for its token. One path, so pl8's rule and the app's agree. */
export const PAIR_RETURN_PATH = "/desktop/pair";

/** The route on pl8 that hands a token back. */
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
 * (RFC 8252 §8.12). `base` is where **pl8** answers, i.e. `serviceUrl(server, "pl8")`, and the
 * route is appended to its PATH rather than resolved against its origin: pl8 is mounted under
 * `/pl8`, and `new URL("/api/…", base)` would silently drop that and hit st0's backend.
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
