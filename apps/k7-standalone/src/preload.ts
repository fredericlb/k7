// preload.ts — tells every page where the app's services answer, whether it is the tab in front, and (to the strip) what the tabs are and how to sign in.
// The ports cannot wait for a fetch: pages derive the services' addresses synchronously at import time (packages/web-protocol/services.ts).

import { contextBridge, ipcRenderer } from "electron";

/** One row of the strip; mirrored by apps/k7/frontend/src/tabs/bridge.ts. */
export interface TabRow {
  id: number;
  url: string;
  title: string;
  active: boolean;
  home: boolean;
}

/** What a page in a tab is told: whether it is the one in front. */
export interface TabState {
  active: boolean;
}

const PREFIX = "--studio-ports=";
const spec = process.argv
  .find((a) => a.startsWith(PREFIX))
  ?.slice(PREFIX.length);
if (spec) contextBridge.exposeInMainWorld("__STUDIO_PORTS__", spec);

const stateSubs = new Set<(s: TabState) => void>();
const rowSubs = new Set<(r: TabRow[]) => void>();
// A window opened beside the tabs is never told anything, and is never behind.
let current: TabState = { active: true };
let latest: TabRow[] = [];
let fullscreen = false;
const fullscreenSubs = new Set<(on: boolean) => void>();

ipcRenderer.on("studio:tab", (_e, s: TabState) => {
  current = s;
  for (const cb of stateSubs) cb(s);
});

ipcRenderer.on("studio:tabs", (_e, r: TabRow[]) => {
  latest = r;
  for (const cb of rowSubs) cb(r);
});

ipcRenderer.on("studio:fullscreen", (_e, on: boolean) => {
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
ipcRenderer.on("studio:engine", (_e, s: unknown) => {
  for (const cb of engineSubs) cb(s);
});
contextBridge.exposeInMainWorld("studioEngine", {
  state: (): Promise<unknown> => ipcRenderer.invoke("studio:engine:state"),
  subscribe(cb: (s: unknown) => void): () => void {
    engineSubs.add(cb);
    return () => {
      engineSubs.delete(cb);
    };
  },
  send: (cmd: string, arg?: string) =>
    ipcRenderer.send("studio:engine:cmd", cmd, arg),
});

// What k7's pages ask of the app itself, from any tab or window of its origin (desktopBridge.ts).
contextBridge.exposeInMainWorld("studioDesktop", {
  state: (): Promise<unknown> => ipcRenderer.invoke("studio:desktop:state"),
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
  select: (id: number) => ipcRenderer.send("studio:tabs:select", id),
  close: (id: number) => ipcRenderer.send("studio:tabs:close", id),
  signIn: (server?: string) => ipcRenderer.send("studio:auth:signIn", server),
  /** Whether the window is fullscreen, which takes the window's own controls off the strip. */
  fullscreen: (): boolean => fullscreen,
  onFullscreen(cb: (on: boolean) => void): () => void {
    fullscreenSubs.add(cb);
    return () => {
      fullscreenSubs.delete(cb);
    };
  },
  server: (): Promise<string> => ipcRenderer.invoke("studio:auth:server"),
  /** Pair with another server beside the main one, in the system browser; false when it cannot be asked. */
  addServer: (server: string): Promise<boolean> =>
    ipcRenderer.invoke("studio:sync:addServer", server),
});
