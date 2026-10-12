// window.ts — the app's window: its own pages open as more windows of the app, anything else in the system browser.

import {
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  shell,
  type WebPreferences,
} from "electron";

export interface WindowSpec {
  /** The first page. */
  url: string;
  /** Whether a URL is one of the app's own pages. */
  ours: (url: string) => boolean;
  /** Given to every window, the ones a page opens included — a preload among them. */
  webPreferences: WebPreferences;
  /** Linux and Windows draw it on the window; macOS takes the bundle's. */
  icon?: string;
  options?: BrowserWindowConstructorOptions;
}

export function openAppWindow(spec: WindowSpec): BrowserWindow {
  const win = new BrowserWindow({
    ...spec.options,
    ...(spec.icon ? { icon: spec.icon } : {}),
    webPreferences: spec.webPreferences,
  });
  const { icon } = spec;
  if (icon)
    win.webContents.on("did-create-window", (child) => child.setIcon(icon));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (spec.ours(url))
      return {
        action: "allow",
        overrideBrowserWindowOptions: { webPreferences: spec.webPreferences },
      };
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!spec.ours(url)) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });
  void win.loadURL(spec.url);
  return win;
}
