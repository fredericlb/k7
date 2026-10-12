// autostart.ts — "Launch at login": Electron's login items on macOS and Windows, an XDG autostart entry on Linux.
// Electron has no Linux login items, so there the tray writes the XDG `.desktop` file itself.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { app } from "electron";

function desktopEntry(): string {
  const config = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(config, "autostart", "st0-tray.desktop");
}

export function autostartEnabled(): boolean {
  if (process.platform === "linux") return existsSync(desktopEntry());
  return app.getLoginItemSettings().openAtLogin;
}

export function setAutostart(on: boolean): void {
  if (process.platform !== "linux") {
    app.setLoginItemSettings({ openAtLogin: on });
    return;
  }
  const file = desktopEntry();
  if (!on) {
    rmSync(file, { force: true });
    return;
  }
  // An AppImage runs from a temporary mount; $APPIMAGE is the file that survives a reboot.
  const exec = process.env.APPIMAGE || process.execPath;
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(
    file,
    `[Desktop Entry]\nType=Application\nName=st0-tray\nExec="${exec}"\nX-GNOME-Autostart-enabled=true\n`,
  );
}
