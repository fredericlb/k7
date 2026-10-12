// lifecycle.ts — one copy of the app, a boot that reports its failure, and a quit that waits for the app's own teardown.
// Quit is held until `stop` resolves: the servers are children, and an app that exits first leaves them holding the ports.

import { app, dialog } from "electron";
import { line } from "./log.ts";

export interface AppSpec {
  /** Shown in the error box a failed boot opens: "<title> could not start". */
  title: string;
  /** Named in that box, so the person knows where to look. */
  logPath: string;
  /** Starts the servers and opens the window; a throw ends the app. */
  boot: () => Promise<void>;
  /** Stops what boot started, in the order it needs. */
  stop: () => Promise<void>;
  /** A second launch: bring the window forward. */
  onSecondInstance: () => void;
  /** The Dock icon clicked with no window open (macOS). */
  onActivate: () => void;
  /** The Dock icon of an unpackaged run, which would otherwise be Electron's. */
  devIcon?: string;
}

export function runApp(spec: AppSpec): void {
  if (!app.requestSingleInstanceLock()) app.exit(0);
  app.on("second-instance", spec.onSecondInstance);

  app.whenReady().then(() => {
    if (!app.isPackaged && spec.devIcon) app.dock?.setIcon(spec.devIcon);
    return spec.boot().catch((e: unknown) => {
      const why = e instanceof Error ? e.message : String(e);
      line("app", `failed to start: ${why}`);
      dialog.showErrorBox(
        `${spec.title} could not start`,
        `${why}\n\nLog: ${spec.logPath}`,
      );
      app.quit();
    });
  });

  app.on("activate", spec.onActivate);
  app.on("window-all-closed", () => app.quit());

  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    void (async () => {
      line("app", "quitting");
      await spec.stop();
      app.exit(0);
    })();
  });

  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const)
    process.on(sig, () => app.quit());
}
