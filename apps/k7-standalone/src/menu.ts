// menu.ts — the application menu, installed in place of Electron's default, and the About panel filled with the release stamp.
// Cmd/Ctrl+W is the menu's Close Tab: the tab set acts on it, and the window closes only by Close Window. See docs/menu.md.

import { dirname } from "node:path";
import { line } from "@frediverse/electron-shell/log";
import { RELEASE, releaseLabel } from "@studio/app-updates/release";
import { app, BaseWindow, Menu, shell, webContents } from "electron";
import { menuTemplate, type PageCommand } from "./menuTemplate.ts";
import { TabSet } from "./tabs.ts";
import { autoCheckEnabled, checkForUpdates, setAutoCheck } from "./updates.ts";

function onPage(cmd: PageCommand): void {
  const wc = webContents.getFocusedWebContents();
  if (!wc || wc.isDestroyed()) return;
  const z = wc.getZoomLevel();
  if (cmd === "zoomIn") wc.setZoomLevel(z + 0.5);
  else if (cmd === "zoomOut") wc.setZoomLevel(z - 0.5);
  else if (cmd === "resetZoom") wc.setZoomLevel(0);
  else if (cmd === "forceReload") wc.reloadIgnoringCache();
  else wc[cmd]();
}

/** Install the menu; `origin` is k7's, whose `/settings` and `/docs` it opens, and `logPath` the file whose folder it shows. */
export function installMenu(
  origin: string,
  logPath: string,
  icon?: string,
): void {
  app.setAboutPanelOptions({
    applicationName: "k7",
    applicationVersion: releaseLabel(),
    // macOS shows this in parentheses: the stamp itself, so a snapshot names its commit.
    version: RELEASE,
    ...(icon ? { iconPath: icon } : {}),
  });
  const build = (): void => {
    const template = menuTemplate(process.platform, app.isPackaged, {
      about: () => app.showAboutPanel(),
      settings: () => TabSet.front?.navigate(`${origin}/settings`),
      closeTab: () => TabSet.front?.closeActive(),
      closeWindow: () => BaseWindow.getFocusedWindow()?.close(),
      toggleFullscreen: () => {
        const w = BaseWindow.getFocusedWindow();
        // The window is in macOS's simple fullscreen, which isFullScreen does not report (window.ts).
        const mac = process.platform === "darwin";
        if (w)
          w.setFullScreen(
            !(w.isFullScreen() || (mac && w.isSimpleFullScreen())),
          );
      },
      page: onPage,
      docs: () => TabSet.front?.navigate(`${origin}/docs`),
      openLogs: () => {
        void shell.openPath(dirname(logPath)).then((err) => {
          if (err) line("app", `could not open the log folder: ${err}`);
        });
      },
      checkUpdates: () => void checkForUpdates(true),
      autoCheck: {
        on: autoCheckEnabled(),
        set: (on) => {
          setAutoCheck(on);
          build();
        },
      },
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  };
  build();
}
