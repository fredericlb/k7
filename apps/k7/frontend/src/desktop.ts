// desktop.ts — is this page served by the tray's backend on a computer, and if so, which server does it sync with?
// Asked of the backend itself (../localApp.ts, then /api/sync/remote): the same bundle ships to every host. A phone
// app's backend is local too, but its shell answers these questions natively. See ../docs/localApp.md.

import { localApp } from "./localApp";
import { inAndroidApp } from "./tabs/bridge";

export interface DesktopState {
  /** The active k7 server this machine syncs with, as an https origin; null while none is saved. */
  server: string | null;
  /** The account its active server link is for there, when the backend says. */
  account?: string;
  /** Addresses another device on the LAN could open; a loopback-only backend offers none. */
  lanUrls: string[];
}

/** `wss://app.k7.rocks/api/sync` → `https://app.k7.rocks`: the relay's server, as a page links to it. */
export function serverOf(relay: string | null): string | null {
  if (!relay) return null;
  try {
    const u = new URL(relay);
    u.protocol = u.protocol === "ws:" ? "http:" : "https:";
    return u.origin;
  } catch {
    return null;
  }
}

export const desktop = {
  /** The machine's state, or null when this page is served by a server or a phone app. */
  state: async (): Promise<DesktopState | null> => {
    if (inAndroidApp() || !(await localApp())) return null;
    try {
      const r = await fetch("/api/sync/remote", { cache: "no-store" });
      const remote = r.ok
        ? ((await r.json()) as { url?: string | null; as?: string | null })
        : {};
      return {
        server: serverOf(remote.url ?? null),
        ...(remote.as ? { account: remote.as } : {}),
        lanUrls: [],
      };
    } catch {
      return { server: null, lanUrls: [] };
    }
  },
};
