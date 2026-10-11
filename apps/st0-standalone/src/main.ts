// main.ts — st0 and pl8 as one desktop app: both backends, the supervisor and its engine, and a window on st0.
// Sign-in is the OIDC library's dev stub (no issuer configured), so the window opens on /auth/login first. See docs/standalone.md.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { PORTS_ENV } from "@studio/web-protocol/services";
import { app, BrowserWindow, dialog, shell } from "electron";
import {
  type Backend,
  startBackend,
  stopBackend,
  waitListening,
} from "./backends.ts";
import { line, openLog } from "./log.ts";
import {
  appIcon,
  engineBinary,
  librarySource,
  stateDirs,
  supervisorBinary,
} from "./paths.ts";
import { Supervisor } from "./supervisor.ts";

// Not the dev session's 8789/8795, so the two run side by side; every process is told through PORTS_ENV.
const PORTS = { st0: 18789, pl8: 18795 };
const PORTS_SPEC = `st0=${PORTS.st0},pl8=${PORTS.pl8}`;
// Inherited by both backends, the file services they start and the supervisor.
process.env[PORTS_ENV] = PORTS_SPEC;
const ST0 = `http://127.0.0.1:${PORTS.st0}`;
const PL8 = `http://127.0.0.1:${PORTS.pl8}`;

/** What every window gets, the ones a page opens included: the preload publishes the ports to the page. */
const webPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  preload: join(__dirname, "preload.cjs"),
  additionalArguments: [`--studio-ports=${PORTS_SPEC}`],
};

let backends: Backend[] = [];
let supervisor: Supervisor | null = null;
let win: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => win?.show());

/** Whether something already answers on `port` — a dev session, or a second copy of the stack. */
function portBusy(port: number): Promise<boolean> {
  return new Promise((res) => {
    const s = createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => {
      s.destroy();
      res(true);
    });
    s.once("error", () => res(false));
  });
}

/** The session secret both backends sign and verify the cookie with, kept so a restart keeps the session. */
function sessionSecret(dir: string): string {
  const at = join(dir, "session-secret");
  if (existsSync(at)) return readFileSync(at, "utf8").trim();
  const s = randomBytes(32).toString("hex");
  writeFileSync(at, s, { mode: 0o600 });
  return s;
}

/** First run only: the origin's library list names a local clone source, since the dev user can never be an admin. */
function seedLibraries(filesRoot: string): void {
  const list = join(filesRoot, "libraries.json");
  const source = librarySource();
  if (existsSync(list) || !source) return;
  mkdirSync(filesRoot, { recursive: true });
  writeFileSync(
    list,
    JSON.stringify({ libraries: [{ name: "st0", uri: source }] }, null, 2),
  );
  line("app", `libraries: st0 ← ${source}`);
}

function openWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "st0",
    backgroundColor: "#101114",
    // Linux and Windows draw it on the window; macOS takes the bundle's (or the Dock's, below).
    icon: appIcon(),
    webPreferences,
  });
  // Windows a page opens get the same icon.
  win.webContents.on("did-create-window", (child) => child.setIcon(appIcon()));
  const ours = (url: string) => url.startsWith(ST0) || url.startsWith(PL8);
  // A page of ours opens as another window of the app; anything else goes to the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (ours(url))
      return {
        action: "allow",
        overrideBrowserWindowOptions: { webPreferences },
      };
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!ours(url)) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });
  win.on("closed", () => {
    win = null;
  });
  void win.loadURL(`${ST0}/auth/login?return_to=${encodeURIComponent("/")}`);
}

async function boot(): Promise<void> {
  const dirs = stateDirs();
  mkdirSync(dirs.root, { recursive: true });
  openLog(dirs.log);
  line("app", `state in ${dirs.root}`);

  for (const port of [PORTS.st0, PORTS.pl8])
    if (await portBusy(port))
      throw new Error(
        `port ${port} is already in use — is another copy of the app still running?`,
      );

  const secret = sessionSecret(dirs.root);
  const engine = engineBinary();
  const shared: Record<string, string> = {
    SESSION_SECRET: secret,
    // Empty on purpose: no issuer is what selects the dev stub, and no domain keeps the cookie host-only over http.
    OIDC_ISSUER: "",
    OIDC_CLIENT_ID: "",
    COOKIE_DOMAIN: "",
    STUDIO_HOME: dirs.serverHome,
    ...(engine ? { STUDIO_ENGINE: engine } : {}),
  };
  seedLibraries(dirs.files);

  const sup = supervisorBinary();
  if (sup && existsSync(sup)) {
    supervisor = new Supervisor(sup, dirs.engineHome, PL8);
    supervisor.start();
  } else
    line("app", "no st0-supervisor build found — running without an engine");

  backends = [
    startBackend(
      "st0",
      PORTS.st0,
      { ...shared, STUDIO_PREFS_DIR: join(dirs.prefs, "st0") },
      dirs.root,
    ),
    startBackend(
      "pl8",
      PORTS.pl8,
      {
        ...shared,
        STUDIO_FILES_ROOT: dirs.files,
        STUDIO_MEDIATEK: dirs.mediatek,
      },
      dirs.root,
    ),
  ];
  await Promise.all(backends.map((b) => waitListening(b)));
  line("app", "backends up");
  openWindow();
}

app.whenReady().then(() => {
  // Unpackaged, the bundle is Electron's own, so the Dock would show Electron's icon.
  if (!app.isPackaged) app.dock?.setIcon(appIcon());
  return boot().catch((e: unknown) => {
    const why = e instanceof Error ? e.message : String(e);
    line("app", `failed to start: ${why}`);
    dialog.showErrorBox(
      "st0 could not start",
      `${why}\n\nLog: ${stateDirs().log}`,
    );
    app.quit();
  });
});

app.on("activate", () => {
  if (!win && backends.length) openWindow();
});
app.on("window-all-closed", () => app.quit());

let quitting = false;
app.on("before-quit", (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  void (async () => {
    line("app", "quitting");
    // The supervisor first: it deregisters from pl8, which must still be up to hear it.
    await supervisor?.stop();
    await Promise.all(backends.map((b) => stopBackend(b)));
    app.exit(0);
  })();
});

for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const)
  process.on(sig, () => app.quit());
