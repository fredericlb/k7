// desktop.ts — is k7 running inside the desktop app, and if so, which server does it sync with?
//
// The detection is the PRELOAD's bridge, not a build flag: `window.studioDesktop` exists only
// in the app's windows (apps/k7-standalone/src/desktopBridge.ts), so the same bundle ships to
// both and a browser tab simply has none. An IPC call rather than a route, so no other device
// on the network can ask. See apps/k7-standalone/docs/standalone.md.

/** Mirrors `DesktopState` in apps/k7-standalone/src/desktopBridge.ts. */
export interface DesktopState {
  server: string | null;
  lanUrls: string[];
}

interface DesktopBridge {
  state: () => Promise<DesktopState | null>;
}

declare global {
  interface Window {
    studioDesktop?: DesktopBridge;
  }
}

const bridge = (): DesktopBridge | undefined =>
  typeof window === "undefined" ? undefined : window.studioDesktop;

export const desktop = {
  /** The app's state, or null when this is not the desktop app. */
  state: async (): Promise<DesktopState | null> => {
    const b = bridge();
    if (!b) return null;
    try {
      return await b.state();
    } catch {
      // The main process gone mid-quit: nothing left to point at.
      return null;
    }
  },

  /** Whether this page is in the desktop app, known without asking. */
  get isDesktop(): boolean {
    return !!bridge();
  },
};
