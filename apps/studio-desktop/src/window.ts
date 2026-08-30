// window.ts — st0's window, which IS the app. Opening it starts the engine; closing it stops
// the engine, the file service and the supervisor with it. There is no tray and nothing runs
// on behind the window: whoever wants an engine without one runs `studio-engine`, the same
// supervisor with a terminal in front of it. It holds a strip of TABS above one project view
// each — docs/tabs.md — and its lifetime is docs/lifetime.md.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { tabsUrl } from "@studio/web-protocol/projects";
import { BaseWindow, ipcMain, WebContentsView } from "electron";
import { repoRoot } from "./repoRoot.ts";
import { line } from "./logbus.ts";
import { TabSet } from "./tabs.ts";

/** The strip's height in DIP, and the caption buttons' too — one number, or they disagree. */
const STRIP_HEIGHT = 36;

/** Room for macOS's traffic lights, which sit ON the strip rather than beside it. */
const MAC_INSET = 78;

/**
 * The window's own icon, which only Linux and an UNPACKAGED run need: a packaged build gets
 * its icon from electron-builder (`icon:` in the yml), and macOS takes it from the bundle
 * rather than from the window. Same file either way — st0's, so the two are one app.
 */
function windowIcon(): string | undefined {
  const root = repoRoot();
  if (!root) return undefined;
  const png = join(root, "apps", "st0", "frontend", "public", "icon-512.png");
  return existsSync(png) ? png : undefined;
}

let win: BaseWindow | null = null;
let strip: WebContentsView | null = null;
let tabs: TabSet | null = null;
let wired = false;

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

  const icon = windowIcon();
  const mac = process.platform === "darwin";
  win = new BaseWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "studio",
    // BaseWindow has no `ready-to-show`: the frame paints in our colour, not white — docs/tabs.md.
    backgroundColor: "#101114",
    // The strip IS the title bar, and each platform hands over a different half — docs/tabs.md.
    titleBarStyle: mac ? "hiddenInset" : "hidden",
    ...(mac
      ? {}
      : {
          titleBarOverlay: {
            color: "#101114", // --sh-background, so the strip and the buttons are one bar
            symbolColor: "#92929e", // --sh-muted-foreground
            height: STRIP_HEIGHT,
          },
        }),
    ...(icon ? { icon } : {}),
  });

  strip = new WebContentsView({
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.contentView.addChildView(strip);

  tabs = new TabSet(win.contentView, preloadPath(), pushTabs);
  wireStripCommands();

  // The inset rides in the address because the page is the same build on every platform.
  const inset = mac ? MAC_INSET : 0;
  strip.webContents
    .loadURL(`${tabsUrl(url)}?inset=${inset}&height=${STRIP_HEIGHT}`)
    .catch((e: unknown) => {
      line("host", `the tab strip could not load: ${String(e)}`);
    });
  // On every load, not the first: a strip that reloaded would otherwise come back empty.
  strip.webContents.on("did-finish-load", pushTabs);
  // A view that will not load is a BLANK BAR and nothing else, so it says so — docs/tabs.md.
  strip.webContents.on("did-fail-load", (_e, code, why, url) => {
    if (code !== -3)
      line("host", `the tab strip failed to load ${url}: ${why}`);
  });

  // The home tab, and the only one opened from here: everything else is opened FROM it.
  tabs.open(url, { home: true });
  layout();
  win.on("resize", layout);
  win.on("closed", () => {
    tabs?.destroy();
    tabs = null;
    strip = null;
    win = null;
  });

  win.show();
  // Asked for, not assumed: a just-mapped window can come up BEHIND what was in front.
  win.focus();
}

export function destroyWindow(): void {
  tabs?.destroy();
  tabs = null;
  strip = null;
  win?.destroy();
  win = null;
}

/** Bundled beside main.cjs by scripts/build-main.mjs — both entry points, one outdir. */
function preloadPath(): string {
  return join(__dirname, "preload.cjs");
}

/** The strip above, the tab in front filling the rest. One place, so the two cannot overlap. */
function layout(): void {
  if (!win || !strip || !tabs) return;
  const { width, height } = win.getContentBounds();
  strip.setBounds({ x: 0, y: 0, width, height: STRIP_HEIGHT });
  tabs.setBounds({
    x: 0,
    y: STRIP_HEIGHT,
    width,
    height: Math.max(0, height - STRIP_HEIGHT),
  });
}

/** The strip's picture, pushed rather than polled — it changes on navigation, not on a clock. */
function pushTabs(): void {
  if (strip && tabs) tabs.pushTo(strip);
}

/** The two things the strip can ask for. Registered once: `openWindow` may run again. */
function wireStripCommands(): void {
  if (wired) return;
  wired = true;
  ipcMain.on("studio:tabs:select", (_e, id: number) => tabs?.select(id));
  ipcMain.on("studio:tabs:close", (_e, id: number) => {
    tabs?.close(id);
    // Closing the last tab closes the window, and closing the window quits — docs/lifetime.md.
    if (tabs?.count() === 0) win?.close();
  });
}
