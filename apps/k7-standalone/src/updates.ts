// updates.ts — the desktop app's updater, @studio/app-updates on the desktop feed, and the home page's way to run its check.
// What is checked, downloaded and said is the package's (packages/app-updates/docs/appUpdates.md). See docs/notices.md.

import { createUpdater } from "@studio/app-updates/updates";
import { DESKTOP_IPC } from "@studio/web-protocol/desktop";
import { ipcMain } from "electron";
import { fromApp } from "./engineBridge.ts";

const updater = createUpdater({ product: "desktop", name: "k7" });

export const { autoCheckEnabled, setAutoCheck, checkForUpdates } = updater;

/** The automatic checks, and the home menu's entry, from k7's own pages only: the menu's check, dialogs included. */
export function startUpdateChecks(origin: string): void {
  ipcMain.on(DESKTOP_IPC.checkUpdates, (e) => {
    if (fromApp(e, origin)) void checkForUpdates(true);
  });
  updater.start();
}
