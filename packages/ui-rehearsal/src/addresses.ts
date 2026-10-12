// addresses.ts — the two rehearsal addresses a host must recognise BEFORE its sign-in gate or its
// frame: a public page and the phone's microphone. Light on purpose, the host's entry imports it.

import { withinPrefix } from "./host";

/** The nametag a public page's address names, or null when it is not one. */
export function publicPageAt(pathname: string, prefix: string): string | null {
  const rest = withinPrefix(pathname, prefix);
  const hit = rest === null ? null : /^\/@([^/]+)\/?$/.exec(rest);
  return hit ? decodeURIComponent(hit[1]) : null;
}

/** Is this address the phone's microphone page? */
export function isRemoteMic(pathname: string, prefix: string): boolean {
  const rest = withinPrefix(pathname, prefix);
  return rest === "/remote" || rest === "/remote/";
}
