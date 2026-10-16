// addresses.ts — the rehearsal address a host must recognise BEFORE its sign-in gate: a public
// page. Light on purpose, the host's entry imports it.

import { withinPrefix } from "./host";

/** The nametag a public page's address names, or null when it is not one. */
export function publicPageAt(pathname: string, prefix: string): string | null {
  const rest = withinPrefix(pathname, prefix);
  const hit = rest === null ? null : /^\/@([^/]+)\/?$/.exec(rest);
  return hit ? decodeURIComponent(hit[1]) : null;
}
