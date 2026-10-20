// preload.ts — the settings page's only way to the main process: `window.k7Tray`, an invoke and a listen.
// The page computes nothing, so this is the whole surface it needs; the main process checks who is calling.

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("k7Tray", {
  core: {
    invoke: (cmd: string, args?: Record<string, unknown>) =>
      ipcRenderer.invoke("tray:invoke", cmd, args ?? {}),
  },
  event: {
    listen: (name: string, cb: (e: { payload: unknown }) => void) => {
      const handler = (_e: unknown, payload: unknown) => cb({ payload });
      ipcRenderer.on(name, handler);
      return Promise.resolve(() => ipcRenderer.off(name, handler));
    },
  },
});
