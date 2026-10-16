// confirmQuit.ts — before a quit, every k7 page is asked `window.__k7Busy()`; one that is playing or recording gets a native confirm.
// A page that does not answer in time counts as idle: a hung page must never trap the person in the app. See docs/standalone.md.

import { within } from "@frediverse/electron-shell/lifecycle";
import { BaseWindow, dialog, webContents } from "electron";
import { busyReason, type K7Busy } from "./busy.ts";

/** How long a page gets to answer. */
const ASK_MS = 500;

/** Set by apps/k7/frontend/src/desktopBusy.ts. */
const ASK = 'typeof window.__k7Busy === "function" ? window.__k7Busy() : null';

/** What the k7 pages of `origin` are busy with, each page's answer as it gave it. */
async function busyPages(origin: string): Promise<K7Busy[]> {
  const pages = webContents
    .getAllWebContents()
    .filter((w) => !w.isDestroyed() && w.getURL().startsWith(`${origin}/`));
  const answers = await Promise.all(
    pages.map((w) =>
      within(
        w.executeJavaScript(ASK, true).catch(() => null) as Promise<unknown>,
        ASK_MS,
      ),
    ),
  );
  return answers.filter(
    (a): a is K7Busy => a === "playing" || a === "recording",
  );
}

/** The `confirmQuit` hook: true when nothing is busy, or the person confirms. */
export function confirmQuitFor(origin: string): () => Promise<boolean> {
  return async () => {
    const reason = busyReason(await busyPages(origin));
    if (!reason) return true;
    const options = {
      type: "warning" as const,
      message: reason.message,
      detail: reason.detail,
      buttons: ["Quit", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    };
    const parent = BaseWindow.getFocusedWindow();
    const { response } = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    return response === 0;
  };
}
