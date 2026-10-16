// desktop.ts — the desktop app's preload contract: what its strip and its tabs are told, and the IPC
// channels between its pages and its main process. Typed once for the preload, the main process and
// k7's pages; apps/k7-standalone/docs/tabs.md says why the strip and the tabs are separate pages.

/** One row of the strip. */
export interface TabRow {
  id: number;
  url: string;
  title: string;
  active: boolean;
  /** The one that cannot be closed and draws as an icon — see apps/k7-standalone/docs/tabs.md. */
  home: boolean;
}

/** What a page in a tab is told: whether it is the one in front. */
export interface TabState {
  active: boolean;
}

/** Every IPC channel between the desktop app's pages and its main process. */
export const DESKTOP_IPC = {
  tab: "studio:tab",
  tabs: "studio:tabs",
  fullscreen: "studio:fullscreen",
  tabsSelect: "studio:tabs:select",
  tabsClose: "studio:tabs:close",
  signIn: "studio:auth:signIn",
  server: "studio:auth:server",
  authStatus: "studio:auth:status",
  authCancel: "studio:auth:cancel",
  addServer: "studio:sync:addServer",
  engine: "studio:engine",
  engineState: "studio:engine:state",
  engineCmd: "studio:engine:cmd",
  desktopState: "studio:desktop:state",
} as const;
