// preload.ts — the two things a page in a tab cannot learn from the DOM: whether it is the
// tab in front, and what the other tabs are. A backgrounded tab lets its project go, so
// being told has to be reliable — Chromium's own visibility does not follow a detached
// WebContentsView. See docs/tabs.md.

import { contextBridge, ipcRenderer } from "electron";

/** One row of the strip. `title` is the page's, so it changes as the tab navigates. */
export interface TabRow {
  id: number;
  url: string;
  title: string;
  active: boolean;
  /** The one that cannot be closed and draws as an icon — see apps/studio-desktop/docs/tabs.md. */
  home: boolean;
}

/** What a PROJECT page is told: whether it is the one in front, and nothing else. */
export interface TabState {
  active: boolean;
}

const state = new Set<(s: TabState) => void>();
const rows = new Set<(r: TabRow[]) => void>();
let current: TabState = { active: true };
let latest: TabRow[] = [];

ipcRenderer.on("studio:tab", (_e, s: TabState) => {
  current = s;
  for (const cb of state) cb(s);
});

ipcRenderer.on("studio:tabs", (_e, r: TabRow[]) => {
  latest = r;
  for (const cb of rows) cb(r);
});

// What a project page reads. Its presence is also the probe: a hosted st0 has no preload.
contextBridge.exposeInMainWorld("studioTab", {
  state: (): TabState => current,
  subscribe(cb: (s: TabState) => void): () => void {
    state.add(cb);
    return () => {
      state.delete(cb);
    };
  },
});

// What the STRIP reads and drives. Same preload, since one file is one thing to bundle.
contextBridge.exposeInMainWorld("studioTabs", {
  list: (): TabRow[] => latest,
  subscribe(cb: (r: TabRow[]) => void): () => void {
    rows.add(cb);
    return () => {
      rows.delete(cb);
    };
  },
  select: (id: number) => ipcRenderer.send("studio:tabs:select", id),
  close: (id: number) => ipcRenderer.send("studio:tabs:close", id),
});
