// bridge.ts — what the desktop app's preload puts on `window`, typed once. Absent on the
// hosted build, and that absence IS the probe: a browser tab is never behind another tab of
// ours. See apps/k7-standalone/docs/tabs.md.

import type { TabRow, TabState } from "@studio/web-protocol/desktop";

export type { TabRow };

interface TabBridge {
  state: () => TabState;
  subscribe: (cb: (s: TabState) => void) => () => void;
}

/** Where a sign-in or a pairing stands; mirrored from apps/k7-standalone/src/accountStatus.ts. */
export type AccountStatus =
  | { state: "idle" }
  | { state: "waiting"; what: "signIn" | "pair" }
  | { state: "error"; code: string; detail?: string }
  | { state: "done"; code: string; detail?: string };

interface TabsBridge {
  list: () => TabRow[];
  subscribe: (cb: (rows: TabRow[]) => void) => () => void;
  select: (id: number) => void;
  close: (id: number) => void;
  /** Sign in through the system browser, syncing with `server` when given — apps/k7-standalone/docs/signIn.md. */
  signIn: (server?: string) => void;
  /** Where the browser trip stands, and its Cancel — apps/k7-standalone/docs/notices.md. */
  authStatus?: () => Promise<AccountStatus | null>;
  onAuthStatus?: (cb: (s: AccountStatus) => void) => () => void;
  cancelSignIn?: () => void;
  /** The k7 server the account syncs with: the last one chosen, app.k7.rocks until then. */
  server?: () => Promise<string | null>;
  /** Pair with another server beside the main one, in the system browser — docs/sync.md, "Several servers". */
  addServer?: (server: string) => Promise<boolean>;
  /** Whether the window is fullscreen, its own controls then off the strip — apps/k7-standalone/docs/tabs.md. */
  fullscreen?: () => boolean;
  onFullscreen?: (cb: (on: boolean) => void) => () => void;
}

declare global {
  interface Window {
    studioTab?: TabBridge;
    studioTabs?: TabsBridge;
    /** The desktop app's release stamp — apps/k7-standalone/docs/menu.md. */
    studioApp?: { version: string };
  }
}

export const tabBridge = (): TabBridge | undefined => window.studioTab;
export const tabsBridge = (): TabsBridge | undefined => window.studioTabs;
/** Inside the Android app, whose views get `k7Android` (engine/k7-runtime/docs/android.md): its account lives on the home page too. */
export const inAndroidApp = (): boolean =>
  !!(window as { k7Android?: unknown }).k7Android;
/** Where an account control belongs on the home page: the desktop app and the Android one, never a browser tab. */
export const hasAccountBar = (): boolean => !!tabsBridge() || inAndroidApp();
