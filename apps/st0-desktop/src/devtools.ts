// devtools.ts — F12 opens the DevTools of whichever view has focus. Wired per WebContentsView
// rather than through a menu: the window is a BaseWindow, so there is no menu bar and the
// default toggle-devtools role has no BrowserWindow to act on. See docs/window.md.

import type { WebContents } from "electron";

/**
 * The strip and every tab are separate `webContents`, so each gets its own binding and F12
 * opens the one you are looking at. DETACHED on purpose: this window lays its views out by
 * hand, and docked DevTools would take half of a view whose bounds nothing recomputes.
 */
export function wireDevTools(wc: WebContents): void {
  wc.on("before-input-event", (_event, input) => {
    if (input.type !== "keyDown" || input.key !== "F12") return;
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: "detach" });
  });
}
