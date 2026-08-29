// main.ts — the Electron shell: windowless, and it owns the process
// lifetime, the single-instance lock, the tray and the supervisor child, and nothing else.
// The ORDER in whenReady is load-bearing: the kill-on-close job before ANY spawn (membership
// is inherited), and the log truncate before the supervisor opens the same file for append.
// See docs/tray.md.

import { loadSettings, saveSettings } from "@studio/engine-host/settings";
import { app, nativeTheme } from "electron";
import { clearDevPid, writeDevPid } from "./devPid.ts";
import { HostLink } from "./host.ts";
import { resolve as resolveHostCmd } from "./hostCmd.ts";
import { init as initJob } from "./job.ts";
import {
  autostartEnabled,
  notifyModal,
  notifyPassive,
  openFolder,
  openOriginsFile,
  openTextFile,
  promptForOrigin,
  toggleAutostart,
} from "./localActions.ts";
import { initMergedLog, line } from "./logbus.ts";
import { backstop } from "./pidkill.ts";
import { routeMenuId } from "./route.ts";
import { bundledDist } from "./server/frontend.ts";
import { type LocalServer, startLocalServer } from "./server/index.ts";
import { StudioTray } from "./tray.ts";
import { destroyWindow, markQuitting, openWindow } from "./window.ts";

declare const __STUDIO_BUILD__: string;

/** The tick that animates both the icon badge and the menu's braille spinner, so they cannot disagree. */
const SPINNER_MS = 120;

let tray: StudioTray | null = null;
let host: HostLink | null = null;
let spinner: NodeJS.Timeout | null = null;
let web: LocalServer | null = null;
// The last snapshot's paths, for the rows that open something — sent by the supervisor rather
// than recomputed, so ~/.studio has one definition.
let paths = { root: "", mergedLog: "", webOrigins: "" };

// Keyed on the bundle identifier, not the path — a second launch must be a silent no-op.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

function onMenuClick(id: string): void {
  const action = routeMenuId(id);
  if (!action) return;
  if (action.kind === "command") {
    host?.send(action.cmd, action.arg);
    return;
  }
  switch (action.what) {
    case "openWindow":
      if (web) openWindow(web.url);
      else line("host", "no local server yet — nothing to open");
      break;
    case "autostart":
      tray?.setAutostart(toggleAutostart());
      break;
    case "openRoot":
      openFolder(paths.root);
      break;
    case "openLog":
      openTextFile(paths.mergedLog);
      break;
    case "addWebUi": {
      const origin = promptForOrigin();
      // Off macOS there is no prompt, so the origins file is opened for hand-editing.
      if (origin) host?.send("weburi.add", origin);
      else openOriginsFile(paths.webOrigins);
      break;
    }
    case "quit":
      app.quit();
      break;
  }
}

app.whenReady().then(() => {
  // FIRST, above everything: job membership is inherited at creation, so a process spawned
  // before the job exists is never in it, ever.
  initJob();

  // Unpackaged only, and before anything else can fail: the restart scripts cannot find an
  // `electron` process by name, so this is how they know which instance is ours.
  if (!app.isPackaged) writeDevPid();

  // Before the supervisor is spawned, because it opens the same file for append.
  initMergedLog();
  line("host", `studio-capot ${__STUDIO_BUILD__} starting`);

  // No Dock icon and no app-switcher entry; LSUIElement in electron-builder.yml is the other half.
  app.dock?.hide();

  tray = new StudioTray(__STUDIO_BUILD__, onMenuClick);
  tray.start();
  tray.setAutostart(autostartEnabled());

  // Push-based, which is what deletes supervisor.rs's five-second appearance poll.
  nativeTheme.on("updated", () => tray?.repaint());

  // A tray that never appeared looks exactly like a healthy one, so say so out loud.
  if (process.platform === "linux") {
    line(
      "host",
      "linux: if no icon appears, this desktop has no StatusNotifierItem host — install the AppIndicator extension",
    );
  }

  host = new HostLink(
    {
      onSnapshot: (s) => {
        paths = s.paths ?? paths;
        tray?.setSnapshot(s);
      },
      onNotify: (kind, title, body) =>
        kind === "modal"
          ? notifyModal(title, body)
          : notifyPassive(title, body),
      onHostError: (message) => tray?.setHostError(message),
    },
    resolveHostCmd({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
    }),
  );
  host.start();

  spinner = setInterval(() => tray?.tick(), SPINNER_MS);

  // The app's own origin, and the window onto it. Not opened here: the app starts with the
  // machine and lives in the menu bar, so a window on every login would be the wrong default.
  void startWeb();

  // macOS: clicking the Dock icon of a running app reopens its window rather than doing nothing.
  app.on("activate", () => {
    if (web) openWindow(web.url);
  });
});

/**
 * Serve st0 from this machine, and REMEMBER the port. A port that moves every launch breaks
 * four things at once — see server/port.ts — so what was actually bound is written back.
 */
async function startWeb(): Promise<void> {
  const settings = loadSettings();
  const distDir = app.isPackaged ? bundledDist(process.resourcesPath) : null;
  try {
    web = await startLocalServer({
      port: settings.webPort,
      distDir,
      // In dev the SPA comes from the session's vite, so the origin contract is the same one
      // a packaged build has rather than a second arrangement nobody exercises.
      viteUrl: distDir ? undefined : "http://localhost:5223",
    });
    if (web.port !== settings.webPort) {
      saveSettings({ ...settings, webPort: web.port });
      line("host", `web port ${settings.webPort} was taken — kept ${web.port}`);
    }
  } catch (e) {
    line("host", `no local server: ${String(e)}`);
  }
}

// Quit is the supervisor's cue to deregister while the engine is still up, so the app has to
// stay alive for it. `quitting` stops the second before-quit from re-entering the teardown.
let quitting = false;
app.on("before-quit", (event) => {
  if (quitting) return;
  quitting = true;
  // Before anything else: the window's own close handler intercepts to HIDE, and would
  // swallow the quit.
  markQuitting();
  event.preventDefault();
  void (async () => {
    if (spinner) clearInterval(spinner);
    destroyWindow();
    await host?.shutdownAndWait();
    // After the supervisor, for the case where it never got there: it hung on an
    // unresponsive registry and was killed past its deadline, or had already crashed.
    backstop();
    await web?.close();
    clearDevPid();
    tray?.destroy();
    app.quit();
  })();
});

// There are no windows, so the default "quit when the last one closes" must not apply.
app.on("window-all-closed", () => {});

// launchd stops a LaunchAgent with SIGTERM, and Ctrl-C in dev must behave the same.
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  process.on(sig, () => app.quit());
}
