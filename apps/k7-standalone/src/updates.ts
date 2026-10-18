// updates.ts — keeps k7 current from k7.rocks/app_downloads: at start and every few hours, asks the channel's build.
// Windows (NSIS) and the AppImage download it with electron-updater and install it at quit, or on Restart now.
// macOS (ad-hoc signed, it cannot replace itself) and the .deb only say so: Download opens the page. See docs/notices.md.

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
  type PublishedBuild,
} from "./updateCheck.ts";

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

function save(s: UpdateState): void {
  try {
    writeFileSync(file(), `${JSON.stringify(s, null, 2)}\n`);
  } catch (e) {
    line("app", `update check: could not keep its state: ${String(e)}`);
  }
}

const base = (): string => process.env.K7_DOWNLOADS_URL || DOWNLOADS;

/** Whether this install can replace itself: a packaged Windows app or an AppImage. */
const selfUpdating = (): boolean =>
  app.isPackaged &&
  (process.platform === "win32" ||
    (process.platform === "linux" && !!process.env.APPIMAGE));

/** Whether the automatic check runs — the menu's checkbox. */
export const autoCheckEnabled = (): boolean =>
  !load().off && !process.env.K7_NO_UPDATE_CHECK;

export function setAutoCheck(on: boolean): void {
  save({ ...load(), off: !on });
}

/** The newer build, null when there is none, undefined when the page could not be asked. */
async function ask(): Promise<Available | null | undefined> {
  const url = buildUrl(RELEASE, base());
  if (!url) return null;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "k7-desktop" },
      signal: AbortSignal.timeout(10_000),
    });
    // No build on the channel yet is nothing newer, not a failure.
    if (r.status === 404) return null;
    if (!r.ok) return undefined;
    return newerBuild(RELEASE, (await r.json()) as PublishedBuild, base());
  } catch {
    return undefined;
  }
}

/** The page to download from, for an install that cannot replace itself or a download that failed. */
async function tell(found: Available, why?: string): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: "info",
    title: "k7",
    message: `k7 ${found.name} is available`,
    detail:
      why ??
      `This is k7 ${releaseLabel()}. The download page opens in your browser.`,
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
    info: (m) => line("update", String(m)),
    warn: (m) => line("update", String(m)),
    error: (m) => line("update", String(m)),
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
      line("update", `download failed: ${String(e)}`);
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
    title: "k7",
    message: `k7 ${found.name} is ready to install`,
    detail: `This is k7 ${releaseLabel()}. The update installs when k7 quits, or now with a restart.`,
    buttons: ["Restart now", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  // Silent installer, and k7 starts again once it is done.
  if (response === 0) autoUpdater.quitAndInstall(true, true);
}

/** One check; `manual` also says when there is nothing newer or the page did not answer. */
export async function checkForUpdates(manual = false): Promise<void> {
  const found = await ask();
  const state = load();
  if (found !== undefined) save({ ...state, last: Date.now() });
  if (found) {
    // An automatic check tells of a build once; the menu's check always does.
    const toldBefore = state.told === found.stamp;
    if (!selfUpdating()) {
      if (!manual && toldBefore) return;
      save({ ...load(), told: found.stamp });
      line("app", `update check: k7 ${found.name} is available`);
      return tell(found);
    }
    if (ready !== found.stamp) {
      line("app", `update check: downloading k7 ${found.name}`);
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
    title: "k7",
    message: !buildUrl(RELEASE)
      ? `This build (${RELEASE}) is not a release, so there is nothing to compare it with`
      : found === null
        ? `k7 ${releaseLabel()} is the latest`
        : "Could not reach k7.rocks to check for a newer k7",
    buttons: ["OK"],
  });
}

/** At start, a little after the window, then hourly whether the interval has passed; silent offline. */
export function startUpdateChecks(): void {
  const tick = () => {
    if (autoCheckEnabled() && checkDue(load().last, Date.now()))
      void checkForUpdates(false);
  };
  setTimeout(tick, 15_000).unref();
  setInterval(tick, 3600_000).unref();
}
