// localActions.ts — the menu rows the supervisor has no command for: opening a folder, a log
// or the origins file, and toggling the login item. Each is a shell-out, and each has a reason
// it is not the obvious call. See docs/tray.md.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
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
 * Removing it is a one-shot migration, not this function's job — see docs/tray.md.
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

/**
 * Ask for a web UI origin. macOS has a native text prompt through osascript; Electron has no
 * cross-platform equivalent without a window, so elsewhere the origins file is opened for
 * hand-editing. The "Blocked just now — allow?" rows are the real path there anyway: the
 * browser that was refused names itself, so nothing has to be typed.
 */
export function promptForOrigin(): string | null {
  if (process.platform !== "darwin") return null;
  const script =
    'display dialog "Allow a web UI to reach this engine.\\n\\nIts origin, e.g. https://studio.example.com" ' +
    'default answer "https://" with icon note with title "studio-capot"';
  const out = spawnSync("osascript", ["-e", script], { encoding: "utf8" });
  if (out.status !== 0) return null;
  const m = out.stdout.match(/text returned:(.*)$/);
  const value = m?.[1]?.trim();
  return value ? value : null;
}

/**
 * Ask for a studio server's address. Same shape as `promptForOrigin`, and the same limitation:
 * macOS has a native text prompt, elsewhere the settings file is opened for hand-editing —
 * which `settings.ts` was designed for ("small and hand-editable on purpose").
 */
export function promptForServer(current: string | null): string | null {
  if (process.platform !== "darwin") return null;
  const script =
    'display dialog "The studio server to connect this machine to.\n\nIts address, e.g. https://studio.example.com" ' +
    `default answer ${JSON.stringify(current ?? "https://")} with icon note with title "studio-capot"`;
  const out = spawnSync("osascript", ["-e", script], { encoding: "utf8" });
  if (out.status !== 0) return null;
  const value = out.stdout.match(/text returned:(.*)$/)?.[1]?.trim();
  return value ? value : null;
}

/** Off macOS: make sure the origins file exists, then open it — an absent file opens as nothing at all. */
export function openOriginsFile(path: string): void {
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ origins: [] }, null, 2)}\n`, {
      flag: "wx",
    });
  } catch {
    // Already there, which is the common case.
  }
  openTextFile(path);
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
