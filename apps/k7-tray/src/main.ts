// main.ts — the k7 tray: the menu-bar VIEW over engine/k7-supervisor, which it spawns and drives over NDJSON on stdio.
// No window at start, one settings window on demand; it computes no policy and spawns nothing else. See docs/tray.md.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { runApp } from "@frediverse/electron-shell/lifecycle";
import { RELEASE, releaseLabel } from "@studio/app-updates/release";
import {
  EMPTY_SNAPSHOT,
  type NotifyFrame,
  type Snapshot,
} from "@studio/supervisor-host/hostProtocol";
import { SupervisorHost } from "@studio/supervisor-host/supervisorHost";
import {
  app,
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  Notification,
  nativeImage,
  nativeTheme,
  shell,
  Tray,
} from "electron";
import { autostartEnabled, setAutostart } from "./autostart.ts";
import { hostLine, openMergedLog } from "./mergedLog.ts";
import {
  enginePidPath,
  mergedLogPath,
  settingsPage,
  supervisorBinary,
} from "./paths.ts";
import {
  allowClose,
  hideSettings,
  isSettingsWindow,
  openSettings,
  pushSettings,
} from "./settingsWindow.ts";
import {
  downloadsLine,
  iconState,
  pending,
  statusLine,
  tooltip,
} from "./status.ts";
import { renderPng } from "./trayIcon.ts";
import { updater } from "./updates.ts";
import { differs, view } from "./view.ts";

/** Joins a list into one command argument, as the supervisor splits it (HostProtocol.h `splitUnits`). */
const UNIT = "\u001f";

let snap: Snapshot = EMPTY_SNAPSHOT;
let hostError: string | null = null;
let spinner = 0;
let tray: Tray | null = null;
let host: SupervisorHost | null = null;
let lastMenu = "";

const currentView = () => view(snap, hostError, releaseLabel(RELEASE));

/** Windows and Linux trays are conventionally dark; macOS follows the system appearance, which Electron pushes. */
const darkBar = () =>
  process.platform !== "darwin" || nativeTheme.shouldUseDarkColors;

function drawIcon(): void {
  if (!tray) return;
  const png = renderPng(iconState(snap, hostError, spinner), darkBar());
  tray.setImage(nativeImage.createFromBuffer(png, { scaleFactor: 2 }));
}

function buildMenu(): void {
  if (!tray) return;
  const status = statusLine(snap, hostError);
  const downloads = downloadsLine(snap.downloads);
  const autostart = autostartEnabled();
  const autoCheck = updater.autoCheckEnabled();
  // Rebuilt only when what it shows moved: a menu replaced under an open one closes it.
  const key = JSON.stringify([status, downloads, autostart, autoCheck]);
  if (key === lastMenu) return;
  lastMenu = key;
  const items: MenuItemConstructorOptions[] = [
    { label: status, enabled: false },
    // Only while an instrument downloads: a machine fetching 750 MB has to say so where someone looks.
    ...(downloads ? [{ label: downloads, enabled: false }] : []),
    { type: "separator" },
    {
      label: "Settings…",
      click: () => openSettings(settingsPage(), currentView),
    },
    { type: "separator" },
    {
      label: "Launch at login",
      type: "checkbox",
      checked: autostart,
      click: () => {
        setAutostart(!autostartEnabled());
        buildMenu();
      },
    },
    { label: "Open workspaces root folder", click: openRoot },
    { label: "Show logs", click: openLog },
    { type: "separator" },
    {
      label: "Check for Updates…",
      click: () => void updater.checkForUpdates(true),
    },
    {
      label: "Check for Updates Automatically",
      type: "checkbox",
      checked: autoCheck,
      click: (item) => {
        updater.setAutoCheck(item.checked);
        buildMenu();
      },
    },
    { type: "separator" },
    { label: "Quit k7-tray", click: () => app.quit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

/** The icon, the status line and the tooltip: all the menu bar says on its own. */
function refresh(): void {
  drawIcon();
  buildMenu();
  tray?.setToolTip(tooltip(snap));
}

/** 8 frames a second while the engine is up but not ready; on the view side, so an idle pipe stays silent. */
function spin(): void {
  if (pending(snap)) {
    spinner = (spinner + 1) % 10;
    drawIcon();
  }
  setTimeout(spin, pending(snap) ? 120 : 500);
}

function openRoot(): void {
  const root = snap.paths.root;
  if (!root) return;
  mkdirSync(root, { recursive: true });
  void shell.openPath(root);
}

/** Notepad on Windows: a `.log` usually has no association there, and Notepad always shows text. */
function openLog(): void {
  const log = snap.paths.mergedLog || mergedLogPath();
  if (process.platform === "win32")
    spawn("notepad.exe", [log], { detached: true, stdio: "ignore" }).unref();
  else void shell.openPath(log);
}

/** Passive for what the app raises on its own: a modal per event would let a retrying browser lock the screen. */
function notifyPassive(title: string, body: string): void {
  if (!Notification.isSupported()) {
    hostLine(`could not post a notification: ${title}`);
    return;
  }
  new Notification({ title, body }).show();
}

function onNotify(n: NotifyFrame): void {
  if (n.kind === "modal")
    void dialog.showMessageBox({
      type: "warning",
      title: "k7-tray",
      message: n.title,
      detail: n.body,
    });
  else notifyPassive(n.title, n.body);
}

/** A whole picture every time: it REPLACES what was, so a relaunched supervisor resyncs us in one frame. */
function onSnapshot(next: Snapshot): void {
  const changed = differs(snap, next);
  const asking = next.pairRequests.filter(
    (r) => !snap.pairRequests.some((o) => o.requestId === r.requestId),
  );
  snap = next;
  for (const r of asking)
    notifyPassive(
      `‘${r.name || r.ip}’ wants to pair`,
      `Code ${r.code}. Open Settings → Paired devices to approve.`,
    );
  if (changed) pushSettings(currentView());
  refresh();
}

function onDown(why: string | null): void {
  if (why === hostError) return;
  hostError = why;
  refresh();
  pushSettings(currentView());
}

/** The page's calls, each one line on the pipe; the snapshot that follows is what redraws it. */
function invoke(cmd: string, a: Record<string, unknown>): unknown {
  const s = (k: string) => String(a[k] ?? "");
  const send = (c: string, arg?: string) => host?.send(c, arg);
  switch (cmd) {
    case "settings_view":
      return currentView();
    case "audio_rank":
      return send("audio.priority", (a.names as string[]).join(UNIT));
    case "instance_add":
      return send("weburi.add", s("url"));
    case "instance_remove":
      return send("weburi.remove", s("url"));
    case "instrument_download":
      return send("instruments.download", s("name"));
    case "instrument_remove":
      return send("instruments.remove", s("name"));
    case "plugins_rescan":
      return send("plugins.rescan");
    case "engine_start":
      return send("engine.start");
    case "engine_stop":
      return send("engine.stop");
    case "engine_restart":
      return send("engine.restart");
    case "session_drop":
      return send("session.drop", s("id"));
    case "pair_approve":
      return send("pair.approve", s("requestId"));
    case "pair_deny":
      return send("pair.deny", s("requestId"));
    case "pair_revoke":
      return send("pair.revoke", s("deviceId"));
    case "plugin_show_ui":
      return send("plugin.showUI", `${s("session")}${UNIT}${s("id")}`);
    case "settings_close":
      return hideSettings();
    default:
      throw new Error(`unknown command ${cmd}`);
  }
}

async function boot(): Promise<void> {
  // Before the supervisor opens it for append: one tray launch is one session of the log.
  openMergedLog(mergedLogPath());
  ipcMain.handle(
    "tray:invoke",
    (e, cmd: string, args: Record<string, unknown>) => {
      if (!isSettingsWindow(e.sender.id))
        throw new Error("not the settings window");
      return invoke(cmd, args);
    },
  );
  tray = new Tray(nativeImage.createEmpty());
  // A left click opens the menu on macOS and Linux already; Windows wants it asked for.
  if (process.platform === "win32")
    tray.on("click", () => tray?.popUpContextMenu());
  nativeTheme.on("updated", drawIcon);
  refresh();
  spin();
  // Before the supervisor: a newer build is how a tray that cannot find or run one gets fixed.
  updater.start();

  const bin = supervisorBinary();
  if (!bin) {
    // LOUD: a tray supervising nothing looks exactly like a healthy one.
    hostLine("supervisor not found (no bundled k7-supervisor, no repo build)");
    onDown("supervisor not found");
    return;
  }
  host = new SupervisorHost({
    bin,
    enginePidFile: enginePidPath(),
    log: (text) => hostLine(text),
    onSnapshot,
    onNotify,
    onDown,
  });
  host.start();
}

runApp({
  title: "k7-tray",
  logPath: mergedLogPath(),
  boot,
  stop: async () => {
    allowClose();
    // The supervisor deregisters on its way out, which wants the engine still up; the host backstops what it leaves.
    await host?.stop(3_000);
  },
  // A second launch is a no-op: the tray icon is the way in.
  onSecondInstance: () => {},
  onActivate: () => {},
  windowless: true,
});
