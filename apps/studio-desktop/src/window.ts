// window.ts — st0 in a window, loaded from this app's OWN origin (see docs/server.md).
// Three rules, and each is a bug if you get it wrong: closing must not quit (this is still a
// background supervisor), Chromium must not throttle us when occluded (the playhead and the
// meters would freeze the moment you switch apps), and on macOS the Dock icon follows the
// WINDOW rather than the app, since without one an open window cannot be reached by Cmd-Tab.
// See docs/window.md.

import { app, BrowserWindow, shell } from "electron";
import { line } from "./logbus.ts";

let win: BrowserWindow | null = null;
/** Set on quit, so the close handler stops intercepting and lets the window go. */
let quitting = false;

export function markQuitting(): void {
  quitting = true;
}

export function hasWindow(): boolean {
  return win !== null && !win.isDestroyed();
}

/** Open the window, or bring the existing one forward — never a second one. */
export function openWindow(url: string): void {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }

  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "studio",
    webPreferences: {
      // NOT the default. Chromium throttles timers in an occluded window to about one a
      // minute, so the transport's playhead and the meters would stop the moment the window
      // went behind another — and st0's freeze watchdog would fill the console with stalls
      // that look like a render bug.
      backgroundThrottling: false,
      // The page is st0, served over http from this machine. It gets no node.
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Paint before showing, or the window opens white and fills in.
  win.once("ready-to-show", () => {
    win?.show();
    app.dock?.show();
  });

  // Closing is HIDING, on every platform: the supervisor, the engine and the file service all
  // outlive the window, and Quit is the tray's or the app menu's.
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win?.hide();
    app.dock?.hide();
  });

  win.on("closed", () => {
    win = null;
  });

  // A link out of the app opens in the user's BROWSER, not in a chromeless window with no
  // address bar — which is where an OIDC sign-in has to happen anyway (RFC 8252).
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: "deny" };
  });

  win.loadURL(url).catch((e: unknown) => {
    line("host", `the window could not load ${url}: ${String(e)}`);
  });
}

/** Tear it down for real, on the way out. */
export function destroyWindow(): void {
  quitting = true;
  win?.destroy();
  win = null;
}
