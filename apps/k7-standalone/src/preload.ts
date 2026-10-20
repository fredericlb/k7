// preload.ts — tells every page where the app's services answer, whether it is the tab in front, and (to the strip) what the tabs are and how to sign in.
// The ports cannot wait for a fetch: pages derive the services' addresses synchronously at import time (packages/web-protocol/services.ts).

import { RELEASE } from "@studio/app-updates/release";
import {
  DESKTOP_IPC,
  type TabRow,
  type TabState,
} from "@studio/web-protocol/desktop";
import { contextBridge, ipcRenderer } from "electron";
import type { AccountStatus } from "./accountStatus.ts";

const PREFIX = "--studio-ports=";
const spec = process.argv
  .find((a) => a.startsWith(PREFIX))
  ?.slice(PREFIX.length);
if (spec) contextBridge.exposeInMainWorld("__STUDIO_PORTS__", spec);
// The release stamp, for the settings page (docs/menu.md), and the home menu's Check for updates (docs/notices.md).
contextBridge.exposeInMainWorld("studioApp", {
  version: RELEASE,
  checkForUpdates: () => ipcRenderer.send(DESKTOP_IPC.checkUpdates),
});

const stateSubs = new Set<(s: TabState) => void>();
const rowSubs = new Set<(r: TabRow[]) => void>();
// A window opened beside the tabs is never told anything, and is never behind.
let current: TabState = { active: true };
let latest: TabRow[] = [];
let fullscreen = false;
const fullscreenSubs = new Set<(on: boolean) => void>();

ipcRenderer.on(DESKTOP_IPC.tab, (_e, s: TabState) => {
  current = s;
  for (const cb of stateSubs) cb(s);
});

ipcRenderer.on(DESKTOP_IPC.tabs, (_e, r: TabRow[]) => {
  latest = r;
  for (const cb of rowSubs) cb(r);
});

const authSubs = new Set<(s: AccountStatus) => void>();
ipcRenderer.on(DESKTOP_IPC.authStatus, (_e, s: AccountStatus) => {
  for (const cb of authSubs) cb(s);
});

ipcRenderer.on(DESKTOP_IPC.fullscreen, (_e, on: boolean) => {
  fullscreen = on;
  for (const cb of fullscreenSubs) cb(on);
});

contextBridge.exposeInMainWorld("studioTab", {
  state: (): TabState => current,
  subscribe(cb: (s: TabState) => void): () => void {
    stateSubs.add(cb);
    return () => {
      stateSubs.delete(cb);
    };
  },
});

// The built-in engine, for k7's pages: the main process answers only its own origin (engineBridge.ts).
const engineSubs = new Set<(s: unknown) => void>();
ipcRenderer.on(DESKTOP_IPC.engine, (_e, s: unknown) => {
  for (const cb of engineSubs) cb(s);
});
contextBridge.exposeInMainWorld("studioEngine", {
  state: (): Promise<unknown> => ipcRenderer.invoke(DESKTOP_IPC.engineState),
  subscribe(cb: (s: unknown) => void): () => void {
    engineSubs.add(cb);
    return () => {
      engineSubs.delete(cb);
    };
  },
  send: (cmd: string, arg?: string) =>
    ipcRenderer.send(DESKTOP_IPC.engineCmd, cmd, arg),
});

// What k7's pages ask of the app itself, from any tab or window of its origin (desktopBridge.ts).
contextBridge.exposeInMainWorld("studioDesktop", {
  state: (): Promise<unknown> => ipcRenderer.invoke(DESKTOP_IPC.desktopState),
});

// Same preload for the strip: one file is one thing to bundle, and the main process ignores these from any other page.
contextBridge.exposeInMainWorld("studioTabs", {
  list: (): TabRow[] => latest,
  subscribe(cb: (r: TabRow[]) => void): () => void {
    rowSubs.add(cb);
    return () => {
      rowSubs.delete(cb);
    };
  },
  select: (id: number) => ipcRenderer.send(DESKTOP_IPC.tabsSelect, id),
  close: (id: number) => ipcRenderer.send(DESKTOP_IPC.tabsClose, id),
  signIn: (server?: string) => ipcRenderer.send(DESKTOP_IPC.signIn, server),
  /** Where a sign-in or a pairing stands, for the account bar (docs/notices.md). */
  authStatus: (): Promise<AccountStatus | null> =>
    ipcRenderer.invoke(DESKTOP_IPC.authStatus),
  onAuthStatus(cb: (s: AccountStatus) => void): () => void {
    authSubs.add(cb);
    return () => {
      authSubs.delete(cb);
    };
  },
  /** Abandon the browser trip in progress: its loopback port closes. */
  cancelSignIn: () => ipcRenderer.send(DESKTOP_IPC.authCancel),
  /** Whether the window is fullscreen, which takes the window's own controls off the strip. */
  fullscreen: (): boolean => fullscreen,
  onFullscreen(cb: (on: boolean) => void): () => void {
    fullscreenSubs.add(cb);
    return () => {
      fullscreenSubs.delete(cb);
    };
  },
  server: (): Promise<string> => ipcRenderer.invoke(DESKTOP_IPC.server),
  /** Pair with another server beside the main one, in the system browser; false when it cannot be asked. */
  addServer: (server: string): Promise<boolean> =>
    ipcRenderer.invoke(DESKTOP_IPC.addServer, server),
});
