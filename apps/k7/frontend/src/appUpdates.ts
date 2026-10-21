// appUpdates.ts — the home menu's Check for updates: only inside the Android app, which asks k7.rocks/app_downloads and
// answers in its own dialog (docs/app-downloads.md at the root). The tray checks from its own menu; a browser has nothing to update.

import { engineCall } from "./settings/androidEngine";

// Android only: the iPhone app shares the channel, and an iPhone app cannot replace itself.
const inAndroid = () => !!(window as { k7Android?: unknown }).k7Android;

/** Whether this page runs inside an app that can update itself. */
export const canCheckForUpdates = (): boolean => inAndroid();

/** Ask the app to check now; it says what it found itself. */
export function checkForUpdates(): void {
  void engineCall("checkUpdates").catch(() => {});
}
