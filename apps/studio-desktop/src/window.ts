// window.ts — st0's window, which IS the app. Opening it starts the engine; closing it stops
// the engine, the file service and the supervisor with it. There is no tray and nothing runs
// on behind the window: whoever wants an engine without one runs `studio-engine`, the same
// supervisor with a terminal in front of it. See docs/lifetime.md.

import { BrowserWindow, shell } from "electron";
import { line } from "./logbus.ts";

let win: BrowserWindow | null = null;

export function hasWindow(): boolean {
  return win !== null && !win.isDestroyed();
}

/** Open it, or bring the existing one forward — never a second. */
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
      // NOT the default, and the default is wrong here. Chromium throttles timers in an
      // occluded window to about one a minute, so the transport's playhead and the meters
      // would freeze the moment the window went behind another — and st0's freeze watchdog
      // would fill the console with stalls that read as a render bug.
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Paint before showing, or the window opens white and fills in.
  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => {
    win = null;
  });

  // A link out opens in the user's BROWSER, not in a chromeless window with no address bar —
  // which is also where an OIDC sign-in has to happen (RFC 8252 §8.12).
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: "deny" };
  });

  win.loadURL(url).catch((e: unknown) => {
    line("host", `the window could not load ${url}: ${String(e)}`);
  });
}

export function destroyWindow(): void {
  win?.destroy();
  win = null;
}
