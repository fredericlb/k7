// window.ts — the app's one window: the tab strip IS its title bar, and below it the tab in front. See docs/tabs.md.
// The strip is k7's own `/@tabs` page in a view of its own; the window frame is hidden on every platform.
// It opens before the backend answers, on a splash: `start` is what loads the strip and k7's home.

import { join } from "node:path";
import { line } from "@frediverse/electron-shell/log";
import { windowState } from "@frediverse/electron-shell/windowState";
import { tabsUrl } from "@studio/web-protocol/projects";
import {
  app,
  BaseWindow,
  type IpcMainEvent,
  ipcMain,
  type WebContents,
  WebContentsView,
  type WebPreferences,
} from "electron";
import { TabSet } from "./tabs.ts";

/** The strip's height in DIP, and the Windows caption buttons' too — one number, or they disagree. */
const STRIP_HEIGHT = 36;
/** Room for macOS's traffic lights, which sit ON the strip. */
const MAC_INSET = 78;
/** Room for the caption buttons Windows and Linux draw over the strip's right end. */
const CAPTION_INSET = 140;
/** --sh-background and --sh-muted-foreground, so the strip and the caption buttons are one bar. */
const BACKGROUND = "#101114";
const SYMBOLS = "#92929e";
const MIN_SIZE = { width: 900, height: 600 };

export interface TabbedWindowSpec {
  /** The app's origin; the strip is served from it. */
  origin: string;
  /** The home tab's first k7 page — a sign-in that comes back home — loaded by `start`. */
  homeUrl: string;
  /** What the home tab shows until `start`: a page that needs no server. */
  splashUrl: string;
  webPreferences: WebPreferences;
  icon?: string;
  /** The strip's button, or a page's own Sign in: the sign-in runs in the system browser; `server` is the one typed, if any. */
  onSignIn: (server?: string) => void;
  /** The k7 server the account syncs with, for the strip's sign-in form. */
  server: () => string;
  /** Pair the account with another server beside its main one; false when it cannot be asked. */
  onAddServer: (server: string) => Promise<boolean>;
}

export interface TabbedWindow {
  win: BaseWindow;
  focus: () => void;
  /** The backend answers: the strip and the home page load. */
  start: () => void;
  /** The start failed: the home tab shows `url`, a page that needs no server. */
  fail: (url: string) => void;
  /** Another account: the project tabs close and home loads `url`. */
  reset: (url: string) => void;
}

export function openTabbedWindow(spec: TabbedWindowSpec): TabbedWindow {
  const mac = process.platform === "darwin";
  // Where it was left, fitted onto a display that is still there (docs/standalone.md, "The first window").
  const kept = windowState(
    join(app.getPath("userData"), "window-state.json"),
    { width: 1440, height: 900 },
    MIN_SIZE,
  );
  const win = new BaseWindow({
    ...kept.bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: "k7",
    backgroundColor: BACKGROUND,
    titleBarStyle: "hidden",
    ...(mac
      ? {
          trafficLightPosition: { x: 14, y: (STRIP_HEIGHT - 14) / 2 },
          // Pre-Lion fullscreen: native fullscreen keeps a window below the notch, over a black band (docs/tabs.md).
          simpleFullscreen: true,
        }
      : {
          titleBarOverlay: {
            color: BACKGROUND,
            symbolColor: SYMBOLS,
            height: STRIP_HEIGHT,
          },
        }),
    ...(spec.icon ? { icon: spec.icon } : {}),
  });
  if (kept.maximized) win.maximize();
  kept.track(win);

  const strip = new WebContentsView({ webPreferences: spec.webPreferences });
  // Empty until `start`, and the same colour as the frame rather than a white bar.
  strip.setBackgroundColor(BACKGROUND);
  win.contentView.addChildView(strip);
  const tabs = new TabSet({
    parent: win.contentView,
    origin: spec.origin,
    webPreferences: spec.webPreferences,
    icon: spec.icon,
    // Pushed rather than polled: the picture changes on navigation, not on a clock.
    onChanged: () => {
      if (!strip.webContents.isDestroyed())
        strip.webContents.send("studio:tabs", tabs.list());
    },
    onSignIn: spec.onSignIn,
  });

  // Only the strip may drive the tabs: every tab carries the same preload.
  const fromStrip = (e: IpcMainEvent) => e.sender === strip.webContents;
  // …and the account is the strip's business or the home page's, where its control sits (docs/signIn.md).
  const fromChrome = (e: { sender: WebContents }) =>
    e.sender === strip.webContents || tabs.isHome(e.sender);
  const onSelect = (e: IpcMainEvent, id: number) => {
    if (fromStrip(e)) tabs.select(id);
  };
  const onClose = (e: IpcMainEvent, id: number) => {
    if (fromStrip(e)) tabs.close(id);
  };
  const onSignIn = (e: IpcMainEvent, server?: unknown) => {
    if (fromChrome(e))
      spec.onSignIn(typeof server === "string" ? server : undefined);
  };
  ipcMain.on("studio:tabs:select", onSelect);
  ipcMain.on("studio:tabs:close", onClose);
  ipcMain.on("studio:auth:signIn", onSignIn);
  ipcMain.handle("studio:auth:server", (e) =>
    fromChrome(e) ? spec.server() : null,
  );
  ipcMain.handle("studio:sync:addServer", (e, server: unknown) =>
    fromChrome(e) && typeof server === "string"
      ? spec.onAddServer(server)
      : false,
  );

  // The insets ride in the address because the page is the same build on every platform.
  const stripUrl = `${tabsUrl(spec.origin)}?inset=${mac ? MAC_INSET : 0}&right=${mac ? 0 : CAPTION_INSET}`;
  // Fullscreen hides macOS's traffic lights: the room kept for them would be a dark gap left of the tabs.
  const tellFullscreen = () => {
    if (!strip.webContents.isDestroyed())
      strip.webContents.send(
        "studio:fullscreen",
        win.isFullScreen() || win.isSimpleFullScreen(),
      );
  };
  win.on("enter-full-screen", tellFullscreen);
  win.on("leave-full-screen", tellFullscreen);
  // On every load, not the first: a strip that reloaded would otherwise come back empty.
  strip.webContents.on("did-finish-load", () => {
    strip.webContents.send("studio:tabs", tabs.list());
    tellFullscreen();
  });
  // The strip never navigates and opens nothing.
  strip.webContents.on("will-navigate", (e) => e.preventDefault());
  strip.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  const layout = () => {
    const { width, height } = win.getContentBounds();
    strip.setBounds({ x: 0, y: 0, width, height: STRIP_HEIGHT });
    tabs.setBounds({
      x: 0,
      y: STRIP_HEIGHT,
      width,
      height: Math.max(0, height - STRIP_HEIGHT),
    });
  };
  layout();
  win.on("resize", layout);
  // Simple fullscreen is a resize, and says nothing else: the strip is re-told on every one.
  win.on("resize", tellFullscreen);

  tabs.openHome(spec.splashUrl);

  win.on("closed", () => {
    ipcMain.off("studio:tabs:select", onSelect);
    ipcMain.off("studio:tabs:close", onClose);
    ipcMain.off("studio:auth:signIn", onSignIn);
    ipcMain.removeHandler("studio:auth:server");
    ipcMain.removeHandler("studio:sync:addServer");
    tabs.destroy();
    strip.webContents.close();
  });

  return {
    win,
    focus: () => {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    },
    reset: (url) => tabs.reset(url),
    start: () => {
      strip.webContents.loadURL(stripUrl).catch((e: unknown) => {
        line("app", `the tab strip could not load: ${String(e)}`);
      });
      tabs.reset(spec.homeUrl);
    },
    fail: (url) => tabs.reset(url),
  };
}
