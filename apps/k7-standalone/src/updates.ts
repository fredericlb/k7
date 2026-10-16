// updates.ts — tells the person a newer k7 exists: at start and at most daily, a GitHub API call and a dialog with Download.
// It never downloads or runs anything: Download opens the release page in the system browser. See docs/notices.md.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openExternalSafely } from "@frediverse/electron-shell/external";
import { line } from "@frediverse/electron-shell/log";
import { app, dialog } from "electron";
import { RELEASE, releaseLabel } from "./release.ts";
import {
  type Available,
  checkDue,
  type GithubRelease,
  newerRelease,
  RELEASES_REPO,
  releaseApiUrl,
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

/** Whether the automatic check runs — the menu's checkbox. */
export const autoCheckEnabled = (): boolean =>
  !load().off && !process.env.K7_NO_UPDATE_CHECK;

export function setAutoCheck(on: boolean): void {
  save({ ...load(), off: !on });
}

/** The newer build, null when there is none, undefined when GitHub could not be asked. */
async function ask(): Promise<Available | null | undefined> {
  const url = releaseApiUrl(
    RELEASE,
    process.env.K7_RELEASES_REPO || RELEASES_REPO,
  );
  if (!url) return null;
  try {
    const r = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "k7-desktop",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return undefined;
    return newerRelease(RELEASE, (await r.json()) as GithubRelease);
  } catch {
    return undefined;
  }
}

async function tell(found: Available): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: "info",
    title: "k7",
    message: `k7 ${found.name} is available`,
    detail: `This is k7 ${releaseLabel()}. The download page opens in your browser; nothing is installed for you.`,
    buttons: ["Download", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) openExternalSafely(found.url);
}

/** One check; `manual` also says when there is nothing newer or GitHub did not answer. */
export async function checkForUpdates(manual = false): Promise<void> {
  const found = await ask();
  const state = load();
  if (found !== undefined) save({ ...state, last: Date.now() });
  if (found) {
    // An automatic check tells of a build once; the menu's check always does.
    if (!manual && state.told === found.name) return;
    save({ ...load(), told: found.name });
    line("app", `update check: k7 ${found.name} is available`);
    return tell(found);
  }
  if (!manual) return;
  await dialog.showMessageBox({
    type: "info",
    title: "k7",
    message: !releaseApiUrl(RELEASE)
      ? `This build (${RELEASE}) is not a release, so there is nothing to compare it with`
      : found === null
        ? `k7 ${releaseLabel()} is the latest`
        : "Could not reach GitHub to check for a newer k7",
    buttons: ["OK"],
  });
}

/** At start, a little after the window, then hourly whether a day has passed; silent offline. */
export function startUpdateChecks(): void {
  const tick = () => {
    if (autoCheckEnabled() && checkDue(load().last, Date.now()))
      void checkForUpdates(false);
  };
  setTimeout(tick, 15_000).unref();
  setInterval(tick, 3600_000).unref();
}
