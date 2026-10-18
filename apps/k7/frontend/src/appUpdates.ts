// appUpdates.ts — the home menu's Check for updates: only inside the desktop app or the Android app, which each ask
// k7.rocks/app_downloads and answer in their own dialogs (docs/app-downloads.md at the root). A browser has nothing to update.

import { engineCall } from "./settings/androidEngine";

const desktopCheck = () => window.studioApp?.checkForUpdates;
// Android only: the iPhone app shares the channel, and an iPhone app cannot replace itself.
const inAndroid = () => !!(window as { k7Android?: unknown }).k7Android;

/** Whether this page runs inside an app that can update itself. */
export const canCheckForUpdates = (): boolean =>
  !!desktopCheck() || inAndroid();

/** Ask the app to check now; it says what it found itself. */
export function checkForUpdates(): void {
  const desktop = desktopCheck();
  if (desktop) desktop();
  else void engineCall("checkUpdates").catch(() => {});
}
