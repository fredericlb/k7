// localActions.ts — what the settings page asks for that the supervisor has no command for:
// opening a folder or a log, and the login item. Each is a shell-out with a reason it is not
// the obvious call. See docs/lifetime.md.

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { app, shell } from "electron";
import { line } from "./logbus.ts";

/** Is the login item on? Read from the mechanism that sets it, never remembered. */
export function autostartEnabled(): boolean {
  return app.getLoginItemSettings().openAtLogin;
}

/**
 * Toggle the login item and answer the new state.
 *
 * The Tauri build wrote a macOS LaunchAgent plist; this uses the system API instead, so a
 * user who had autostart on under the old app keeps a stale plist pointing at a bundle path.
 * Removing it is a one-shot migration, not this function's job — see docs/lifetime.md.
 */
export function toggleAutostart(): boolean {
  const next = !autostartEnabled();
  app.setLoginItemSettings({ openAtLogin: next });
  return next;
}

/** Open a folder, creating it first — the workspaces root may not exist before the first project. */
export function openFolder(path: string): void {
  if (!path) return;
  try {
    mkdirSync(path, { recursive: true });
  } catch {}
  void shell.openPath(path);
}

/**
 * Open a text file for reading. Windows gets `notepad` explicitly: a `.log` usually has no
 * file association there, so `openPath` fails with a dialog rather than showing the log.
 */
export function openTextFile(path: string): void {
  if (!path) return;
  if (process.platform === "win32") {
    spawnSync("cmd", ["/c", "start", "", "notepad", path], {
      windowsHide: true,
    });
    return;
  }
  void shell.openPath(path);
}

/** A modal the user must dismiss. Cross-platform here, where the Rust had osascript and a no-op elsewhere. */
export function notifyModal(title: string, body: string): void {
  // Imported lazily: `dialog` pulls in the browser process, and this is a rare path.
  const { dialog } = require("electron") as typeof import("electron");
  dialog.showMessageBox({
    type: "warning",
    title,
    message: title,
    detail: body,
  });
}

/** A passive banner. Best effort — macOS silently drops these from an unsigned bundle, which is why the icon has a dot. */
export function notifyPassive(title: string, body: string): void {
  try {
    const { Notification } = require("electron") as typeof import("electron");
    if (Notification.isSupported()) new Notification({ title, body }).show();
  } catch (e) {
    line("host", `notification failed: ${String(e)}`);
  }
}
