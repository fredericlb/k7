// engineBridge.ts — the built-in engine, as k7's own pages see it: the supervisor's latest snapshot pushed
// to them, and a few of its commands taken from them. Only a page of the app's own origin is answered,
// and only the commands listed here: a page from elsewhere must not stop the engine or rank devices.
// See docs/engine.md.

import { line } from "@frediverse/electron-shell/log";
import type { Snapshot } from "@studio/supervisor-host/hostProtocol";
import type { SupervisorHost } from "@studio/supervisor-host/supervisorHost";
import {
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  webContents,
} from "electron";

/** What a page may ask of the supervisor: the engine's life, the interfaces' order, a plugin rescan, the instruments it keeps. */
const ALLOWED = new Set([
  "engine.start",
  "engine.stop",
  "engine.restart",
  "audio.priority",
  "plugins.rescan",
  "instruments.download",
  "instruments.remove",
]);

let latest: Snapshot | null = null;
let down: string | null = null;

/** Whether a message comes from a page of the app's own origin. */
export function fromApp(
  e: IpcMainEvent | IpcMainInvokeEvent,
  origin: string,
): boolean {
  try {
    return new URL(e.senderFrame?.url ?? "").origin === origin;
  } catch {
    return false;
  }
}

/** The state pages draw: the supervisor's picture, and why it is away when it is. */
const state = () => ({ snapshot: latest, down });

/** Push the state to every page of the app's origin: the tabs, the strip, a settings page wherever it is. */
function push(origin: string): void {
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    try {
      if (new URL(wc.getURL()).origin === origin)
        wc.send("studio:engine", state());
    } catch {
      // A page with no URL yet hears the next push, or asks.
    }
  }
}

/** Record what the supervisor said, and tell the pages. */
export function engineSnapshot(origin: string, s: Snapshot): void {
  latest = s;
  down = null;
  push(origin);
}

/** The supervisor is away (restarting, failed); `null` when it is back. */
export function engineDown(origin: string, why: string | null): void {
  down = why;
  push(origin);
}

/** Answer the pages: the state on ask, and the allowed commands, forwarded to `host`. */
export function installEngineBridge(
  origin: string,
  host: () => SupervisorHost | null,
): void {
  ipcMain.handle("studio:engine:state", (e) =>
    fromApp(e, origin) ? state() : null,
  );
  ipcMain.on("studio:engine:cmd", (e, cmd: unknown, arg: unknown) => {
    if (!fromApp(e, origin) || typeof cmd !== "string" || !ALLOWED.has(cmd))
      return;
    const h = host();
    if (!h) return;
    line("app", `engine: ${cmd}`);
    h.send(cmd, typeof arg === "string" ? arg : undefined);
  });
}
