// updates.ts — keeps an app current from k7.rocks/app_downloads: at start and every few hours, asks its channel's build.
// Windows (NSIS) and the AppImage download it with electron-updater and install it at quit, or on Restart now.
// macOS (ad-hoc signed, it cannot replace itself) and the .deb only say so: Download opens the page. See docs/appUpdates.md.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openExternalSafely } from "@frediverse/electron-shell/external";
import { line } from "@frediverse/electron-shell/log";
import { app, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import { RELEASE, releaseLabel } from "./release.ts";
import {
  type Available,
  buildUrl,
  checkDue,
  DOWNLOADS,
  feedUrl,
  newerBuild,
  type Product,
  type PublishedBuild,
  productBase,
} from "./updateCheck.ts";

export interface UpdaterOptions {
  /** Whose feed to follow on /app_downloads. */
  product: Product;
  /** What the dialogs call the app: `k7`, `k7 tray`. */
  name: string;
  /** Where the check's lines go; electron-shell's log by default. */
  log?: (text: string) => void;
}

export interface Updater {
  /** Whether the automatic check runs — the menu's checkbox. */
  autoCheckEnabled(): boolean;
  setAutoCheck(on: boolean): void;
  /** One check; `manual` also says when there is nothing newer or the page did not answer. */
  checkForUpdates(manual?: boolean): Promise<void>;
  /** At every start, a few seconds in, then hourly whether the interval has passed; silent offline. */
  start(): void;
}

/** What the check keeps between runs: when it last asked, whether it is off, and the build it last told of. */
interface UpdateState {
  last?: number;
  off?: boolean;
  told?: string;
}

const file = (): string => join(app.getPath("userData"), "updates.json");

function load(): UpdateState {
  try {
    return JSON.parse(readFileSync(file(), "utf8")) as UpdateState;
  } catch {
    return {};
  }
}

/** Whether this install can replace itself: a packaged Windows app or an AppImage. */
const selfUpdating = (): boolean =>
  app.isPackaged &&
  (process.platform === "win32" ||
    (process.platform === "linux" && !!process.env.APPIMAGE));

/** electron-updater's autoUpdater is one per process, so one app makes one updater. */
export function createUpdater(opts: UpdaterOptions): Updater {
  const log = opts.log ?? ((text: string) => line("update", text));
  const page = (): string => process.env.K7_DOWNLOADS_URL || DOWNLOADS;
  const base = (): string => productBase(opts.product, page());

  function save(s: UpdateState): void {
    try {
      writeFileSync(file(), `${JSON.stringify(s, null, 2)}\n`);
    } catch (e) {
      log(`update check: could not keep its state: ${String(e)}`);
    }
  }

  const autoCheckEnabled = (): boolean =>
    !load().off && !process.env.K7_NO_UPDATE_CHECK;

  function setAutoCheck(on: boolean): void {
    save({ ...load(), off: !on });
  }

  /** The newer build, null when there is none, undefined when the page could not be asked. */
  async function ask(): Promise<Available | null | undefined> {
    const url = buildUrl(RELEASE, base());
    if (!url) return null;
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": `k7-${opts.product}` },
        signal: AbortSignal.timeout(10_000),
      });
      // No build on the channel yet is nothing newer, not a failure.
      if (r.status === 404) return null;
      if (!r.ok) return undefined;
      return newerBuild(RELEASE, (await r.json()) as PublishedBuild, page());
    } catch {
      return undefined;
    }
  }

  /** The page to download from, for an install that cannot replace itself or a download that failed. */
  async function tell(found: Available, why?: string): Promise<void> {
    const { response } = await dialog.showMessageBox({
      type: "info",
      title: opts.name,
      message: `${opts.name} ${found.name} is available`,
      detail:
        why ??
        `This is ${opts.name} ${releaseLabel()}. The download page opens in your browser.`,
      buttons: ["Download", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) openExternalSafely(found.url);
  }

  let wired = false;
  /** The stamp downloaded and waiting for a restart, and the one downloading now. */
  let ready: string | null = null;
  let fetching: Promise<boolean> | null = null;

  function wire(): void {
    if (wired) return;
    wired = true;
    autoUpdater.logger = {
      info: (m) => log(String(m)),
      warn: (m) => log(String(m)),
      error: (m) => log(String(m)),
      debug: () => {},
    };
    // Our own check decides what is newer: a snapshot's semver prerelease does not sort by date.
    autoUpdater.allowDowngrade = true;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
  }

  /** Downloads the channel's build in the background; true once it is ready to install. */
  function download(): Promise<boolean> {
    wire();
    const url = feedUrl(RELEASE, base());
    if (!url) return Promise.resolve(false);
    autoUpdater.setFeedURL({ provider: "generic", url });
    fetching ??= autoUpdater
      .checkForUpdates()
      .then(async (r) => {
        if (!r?.isUpdateAvailable || !r.downloadPromise) return false;
        await r.downloadPromise;
        return true;
      })
      .catch((e) => {
        log(`download failed: ${String(e)}`);
        return false;
      })
      .finally(() => {
        fetching = null;
      });
    return fetching;
  }

  async function offerRestart(found: Available): Promise<void> {
    const { response } = await dialog.showMessageBox({
      type: "info",
      title: opts.name,
      message: `${opts.name} ${found.name} is ready to install`,
      detail: `This is ${opts.name} ${releaseLabel()}. The update installs when ${opts.name} quits, or now with a restart.`,
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    // Silent installer, and the app starts again once it is done.
    if (response === 0) autoUpdater.quitAndInstall(true, true);
  }

  async function checkForUpdates(manual = false): Promise<void> {
    const found = await ask();
    const state = load();
    if (found !== undefined) save({ ...state, last: Date.now() });
    if (found) {
      // An automatic check tells of a build once; the menu's check always does.
      const toldBefore = state.told === found.stamp;
      if (!selfUpdating()) {
        if (!manual && toldBefore) return;
        save({ ...load(), told: found.stamp });
        log(`update check: ${opts.name} ${found.name} is available`);
        return tell(found);
      }
      if (ready !== found.stamp) {
        log(`update check: downloading ${opts.name} ${found.name}`);
        if (!(await download())) {
          if (manual)
            await tell(
              found,
              "The update could not be downloaded; the download page opens in your browser.",
            );
          return;
        }
        ready = found.stamp;
      }
      if (!manual && toldBefore) return;
      save({ ...load(), told: found.stamp });
      return offerRestart(found);
    }
    if (!manual) return;
    await dialog.showMessageBox({
      type: "info",
      title: opts.name,
      message: !buildUrl(RELEASE)
        ? `This build (${RELEASE}) is not a release, so there is nothing to compare it with`
        : found === null
          ? `${opts.name} ${releaseLabel()} is the latest`
          : `Could not reach k7.rocks to check for a newer ${opts.name}`,
      buttons: ["OK"],
    });
  }

  function start(): void {
    setTimeout(() => {
      if (autoCheckEnabled()) void checkForUpdates(false);
    }, 5_000).unref();
    setInterval(() => {
      if (autoCheckEnabled() && checkDue(load().last, Date.now()))
        void checkForUpdates(false);
    }, 3600_000).unref();
  }

  return { autoCheckEnabled, setAutoCheck, checkForUpdates, start };
}
