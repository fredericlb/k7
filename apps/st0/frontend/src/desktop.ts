// desktop.ts — is st0 running inside the desktop app, and if so, what can it change?
//
// The detection is a PROBE, not a build flag: `/desktop/state` exists only where the app
// serves st0 itself, and a hosted backend answers 404. So the same bundle is shipped to both
// and the settings screen is simply absent on the web — nothing to keep in step, and no user
// agent to sniff. See apps/st0-desktop/docs/settings.md.

/** Mirrors `DesktopState` on the app's side; type-only, so the web build carries none of it. */
export interface DesktopState {
  server: string | null;
  lanUrls: string[];
}

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
};
