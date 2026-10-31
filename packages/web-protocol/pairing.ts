// pairing.ts — how a machine's own backend (the tray's, a phone app's) asks a server for a token and gets it back on its own
// loopback port. Both halves are here because they are ONE rule seen from two sides: the app
// builds the return address, k7's backend validates it, and a second spelling of "is this loopback"
// would be a hole rather than a drift. See apps/k7/backend/docs/handoff.md.
//
// The shape is RFC 8252's for native apps — the system browser, a loopback redirect, any port,
// bound to a state nonce — applied to the studio session rather than to the IdP itself.

import { currentStudioUrl } from "./services.ts";

/** Where a machine's backend listens for its token. One path, so the server's rule and the app's agree. */
export const PAIR_RETURN_PATH = "/desktop/pair";

/** The route on k7's backend that hands a token back. */
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
 * The URL the machine opens in the browser — never in a window of its own
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

/** Where a machine's backend listens for its SYNC device token, beside the API token's path. */
export const SYNC_PAIR_RETURN_PATH = "/desktop/sync-pair";

/** A SERVER's sync return: https, no credentials, exactly SYNC_PAIR_RETURN_PATH; only ever sent after the person confirmed it. */
export function isServerReturn(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    url.pathname === SYNC_PAIR_RETURN_PATH
  );
}

/** Where live sync's relay answers at an origin, as a WebSocket: the file hub's `SYNC_PATH`. */
export const SYNC_RELAY_PATH = "/api/sync";

/** The route on the origin that mints a device token for live sync and hands it back. */
export const SYNC_PAIR_ROUTE = "/api/sync/devices/pair";

/** The server's route that mints the same token for a provider access token, called by a machine's backend, no browser. */
export const SYNC_PAIR_DIRECT_ROUTE = "/api/sync/pair/direct";

/** How the origin's page may ask which account to link: `as` is the one expected, `choose` always asks. */
export interface SyncPairAccount {
  as?: string;
  choose?: boolean;
}

/** The URL the machine opens in the browser to pair itself with the origin's relay; `name` labels the device. */
export function syncPairUrl(
  base: string,
  returnUrl: string,
  state: string,
  name: string,
  account: SyncPairAccount = {},
): string {
  const u = new URL(base.replace(/\/+$/, "") + SYNC_PAIR_ROUTE);
  u.searchParams.set("return", returnUrl);
  u.searchParams.set("state", state);
  u.searchParams.set("name", name);
  if (account.as) u.searchParams.set("as", account.as);
  if (account.choose) u.searchParams.set("choose", "1");
  return u.toString();
}

/** The k7 server a person typed, as an origin (`https://app.k7.rocks`), or null when it cannot be one: no scheme means https. */
export function normalizeServer(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`,
    );
  } catch {
    return null;
  }
  // http only for a server on this machine: a token sent in clear across a network is a token given away.
  if (url.protocol === "http:" && !isLoopbackReturn(url.origin)) return null;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  // A former host answers nothing any more: a server saved or typed under one is its successor.
  return currentStudioUrl(url.origin);
}
