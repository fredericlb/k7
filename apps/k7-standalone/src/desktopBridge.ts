// desktopBridge.ts — what k7's pages learn of the app around them (`window.studioDesktop`): the server it syncs with.
// Answered to a page of the app's own origin in ANY tab or window, not only the strip and home: a project's playlist links there too. See docs/standalone.md.

import { DESKTOP_IPC } from "@studio/web-protocol/desktop";
import { ipcMain } from "electron";
import { fromApp } from "./engineBridge.ts";

/** Mirrored by `DesktopState` in apps/k7/frontend/src/desktop.ts. */
interface DesktopState {
  server: string | null;
  lanUrls: string[];
}

/** What a page is told: no LAN address, since this app's backend answers its own machine only (apps/k7/backend/docs/standalone.md). */
const desktopState = (server: string | null): DesktopState => ({
  server,
  lanUrls: [],
});

/** Answer `studio:desktop:state` for the app's own pages; anything else gets null, as a hosted origin would. */
export function installDesktopBridge(
  origin: string,
  server: () => string | null,
): void {
  ipcMain.handle(DESKTOP_IPC.desktopState, (e) =>
    fromApp(e, origin) ? desktopState(server()) : null,
  );
}
