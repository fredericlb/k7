// desktop.ts — is st0 running inside the desktop app, and if so, what can it change?
//
// The detection is a PROBE, not a build flag: `/desktop/state` exists only where the app
// serves st0 itself, and a hosted backend answers 404. So the same bundle is shipped to both
// and the settings screen is simply absent on the web — nothing to keep in step, and no user
// agent to sniff. See apps/st0-desktop/docs/settings.md.

import type {
  HostCommandName,
  HostSnapshot,
} from "@studio/engine-host/hostProtocol";

/** Mirrors `DesktopState` on the app's side; type-only, so the web build carries none of it. */
export interface DesktopState {
  snapshot: HostSnapshot | null;
  hostError: string | null;
  build: string;
  autostart: boolean;
  identity: string;
  server: string | null;
  paired: boolean;
  lanUrls: string[];
  /** The project the window is on, or null — what a second window would open on. */
  frontProject: string | null;
}

/** What the app can do that the supervisor has no command for. */
export type LocalAction =
  | "autostart"
  | "openRoot"
  | "openLog"
  | "openSettingsFile"
  | "setServer"
  | "pair"
  | "unpair"
  | "secondWindow";

/**
 * Asked once and remembered: a hosted origin will never grow the route mid-session, and every
 * screen that wants to know would otherwise re-probe.
 */
let known: boolean | null = null;

export const desktop = {
  /** Read the whole screen's state, or null when this is not the desktop app. */
  state: async (): Promise<DesktopState | null> => {
    try {
      const res = await fetch("/desktop/state");
      if (!res.ok) {
        known = false;
        return null;
      }
      known = true;
      return (await res.json()) as DesktopState;
    } catch {
      // A hosted origin with no such route, or no origin at all: both mean "not the app".
      known = false;
      return null;
    }
  },

  /** What the last probe found, without asking again — for a header that only needs a link. */
  get isDesktop(): boolean | null {
    return known;
  },

  /**
   * Send the supervisor the same command the tray menu sends. Fire and forget, deliberately:
   * the ANSWER is the next snapshot, and inventing a result here would be reporting something
   * the supervisor never said.
   */
  command: async (cmd: HostCommandName, arg?: string): Promise<void> => {
    await fetch("/desktop/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cmd, arg }),
    });
  },

  /** The app's own rows: autostart, opening a folder, pairing with a server. */
  local: async (
    what: LocalAction,
    arg?: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    const res = await fetch("/desktop/local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ what, arg }),
    });
    return (await res.json().catch(() => ({ ok: false }))) as {
      ok: boolean;
      error?: string;
    };
  },
};
