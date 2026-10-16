// bridge.ts — what the desktop app's preload puts on `window`, typed once. Absent on the
// hosted build, and that absence IS the probe: a browser tab is never behind another tab of
// ours. See apps/k7-standalone/docs/tabs.md.

export interface TabRow {
  id: number;
  url: string;
  title: string;
  active: boolean;
  /** The one that cannot be closed and draws as an icon — see apps/k7-standalone/docs/tabs.md. */
  home: boolean;
}

interface TabBridge {
  state: () => { active: boolean };
  subscribe: (cb: (s: { active: boolean }) => void) => () => void;
}

interface TabsBridge {
  list: () => TabRow[];
  subscribe: (cb: (rows: TabRow[]) => void) => () => void;
  select: (id: number) => void;
  close: (id: number) => void;
  /** Sign in through the system browser, syncing with `server` when given — apps/k7-standalone/docs/signIn.md. */
  signIn: (server?: string) => void;
  /** The k7 server the account syncs with: the last one chosen, st0.app until then. */
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
  }
}

export const tabBridge = (): TabBridge | undefined => window.studioTab;
export const tabsBridge = (): TabsBridge | undefined => window.studioTabs;
/** Inside the Android app, whose views get `k7Android` (engine/k7-runtime/docs/android.md): its account lives on the home page too. */
export const inAndroidApp = (): boolean =>
  !!(window as { k7Android?: unknown }).k7Android;
/** Where an account control belongs on the home page: the desktop app and the Android one, never a browser tab. */
export const hasAccountBar = (): boolean => !!tabsBridge() || inAndroidApp();
