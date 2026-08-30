// bridge.ts — what the desktop app's preload puts on `window`, typed once. Absent on the
// hosted build, and that absence IS the probe: a browser tab is never behind another tab of
// ours. See apps/st0-desktop/docs/tabs.md.

export interface TabRow {
  id: number;
  url: string;
  title: string;
  active: boolean;
  /** The one that cannot be closed and draws as an icon — see apps/st0-desktop/docs/tabs.md. */
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
}

declare global {
  interface Window {
    studioTab?: TabBridge;
    studioTabs?: TabsBridge;
  }
}

export const tabBridge = (): TabBridge | undefined => window.studioTab;
export const tabsBridge = (): TabsBridge | undefined => window.studioTabs;
