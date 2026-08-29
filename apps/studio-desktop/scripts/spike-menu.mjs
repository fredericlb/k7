// spike-menu.mjs — the one Lot 5 assumption a test cannot settle: does mutating
// MenuItem.label show up in a LIVE tray menu? tray.ts leans on it for the spinner, so that an
// 8fps animation does not rebuild the menu (and, on macOS, close it under the cursor) eight
// times a second.
//
//   npm run app:spike-menu --workspace studio-desktop
//
// Run it on macOS, Windows and Linux. See docs/trayIcon.md.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const work = mkdtempSync(join(tmpdir(), "capot-menuspike-"));

writeFileSync(
  join(work, "main.cjs"),
  `const { app, Menu, Tray, nativeImage } = require("electron");
let tray, menu, n = 0;
// A visible dot, so the tray has something to draw whatever the platform.
const rgba = Buffer.alloc(22 * 22 * 4);
for (let i = 0; i < rgba.length; i += 4) { rgba[i] = rgba[i+1] = rgba[i+2] = 200; rgba[i+3] = 255; }
app.whenReady().then(() => {
  app.dock?.hide();
  tray = new Tray(nativeImage.createFromBuffer(rgba, { width: 22, height: 22 }));
  menu = Menu.buildFromTemplate([
    { id: "counter", label: "Counter: 0", enabled: false },
    { id: "flag", label: "Toggle me", type: "checkbox", checked: false },
    { type: "separator" },
    { label: "Quit", click: () => app.exit(0) },
  ]);
  tray.setContextMenu(menu);
  setInterval(() => {
    n++;
    const c = menu.getMenuItemById("counter");
    const f = menu.getMenuItemById("flag");
    if (c) c.label = "Counter: " + n;
    if (f) f.checked = n % 2 === 0;
  }, 500);
});
app.on("window-all-closed", () => {});
`,
  "utf8",
);

const exe = join(
  root,
  "..",
  "..",
  "node_modules",
  "electron",
  process.platform === "win32" ? "dist/electron.exe" : "dist/electron",
);

console.log(`
Open the tray menu and HOLD IT OPEN for a few seconds.

  PASS  "Counter: N" counts up while the menu is open, and "Toggle me" ticks
        and unticks. tray.ts's in-place spinner works on this platform.

  FAIL  the counter is frozen at whatever it said when the menu opened.
        Then tray.ts must rebuild on every tick instead: drop the 'plugins'
        exclusion from menuSignature() and lower SPINNER_MS to ~500 in main.ts,
        accepting that an open submenu may close under the cursor.

Quit from the menu when you are done.
`);

if (!existsSync(exe)) {
  console.error(
    "error: no Electron runtime. `npm run app:setup --workspace studio-desktop` fetches it —\n" +
      "  electron@44 declares no postinstall, so `npm install` alone never does.",
  );
  process.exit(1);
}

const child = spawn(exe, [join(work, "main.cjs")], { stdio: "inherit" });
child.on("close", () => rmSync(work, { recursive: true, force: true }));
