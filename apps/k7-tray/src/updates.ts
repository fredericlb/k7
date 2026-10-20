// updates.ts — the tray's updater: @studio/app-updates on the tray's own feed, its lines in the merged log.
// What is checked, downloaded and said is the package's (packages/app-updates/docs/appUpdates.md). See docs/tray.md.

import { createUpdater } from "@studio/app-updates/updates";
import { hostLine } from "./mergedLog.ts";

export const updater = createUpdater({
  product: "tray",
  name: "k7 tray",
  log: (text) => hostLine(text, "update"),
});
