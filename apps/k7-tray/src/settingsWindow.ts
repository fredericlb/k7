// settingsWindow.ts — the tray's one window, built on first open and only HIDDEN after: closing it must not end the app.
// It draws the view the main process pushes and sends commands back through the preload's bridge.

import { join } from "node:path";
import { BrowserWindow, shell } from "electron";
import type { View } from "./view.ts";

let win: BrowserWindow | null = null;
let quitting = false;

/** Let the window really close, once the app is on its way out. */
export function allowClose(): void {
  quitting = true;
}

export function isSettingsWindow(id: number): boolean {
  return win !== null && !win.isDestroyed() && win.webContents.id === id;
}

export function openSettings(page: string, current: () => View): void {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    win.webContents.send("settings:view", current());
    return;
  }
  win = new BrowserWindow({
    title: "k7 engine",
    width: 560,
    height: 640,
    minWidth: 380,
    minHeight: 300,
    center: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, "preload.cjs"),
    },
  });
  win.removeMenu();
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win?.hide();
  });
  // The page is local; any link it holds belongs in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  void win.loadFile(page);
}

export function hideSettings(): void {
  win?.hide();
}

/** Redraw the open window; a no-op when it was never opened, the usual case. */
export function pushSettings(view: View): void {
  if (win && !win.isDestroyed()) win.webContents.send("settings:view", view);
}
