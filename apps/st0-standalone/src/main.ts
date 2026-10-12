// main.ts — st0 and pl8 as one desktop app: both backends, the supervisor and its engine, and a window on st0.
// Sign-in is the OIDC library's dev stub (no issuer configured), so the window opens on /auth/login first. See docs/standalone.md.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertPortsFree, persistentSecret } from "@studio/electron-shell/boot";
import { runApp } from "@studio/electron-shell/lifecycle";
import { line, openLog } from "@studio/electron-shell/log";
import {
  type Server,
  stopServer,
  waitListening,
} from "@studio/electron-shell/servers";
import { openAppWindow } from "@studio/electron-shell/window";
import { PORTS_ENV } from "@studio/web-protocol/services";
import type { BrowserWindow } from "electron";
import { startBackend } from "./backends.ts";
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

let backends: Server[] = [];
let supervisor: Supervisor | null = null;
let win: BrowserWindow | null = null;

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
  win = openAppWindow({
    url: `${ST0}/auth/login?return_to=${encodeURIComponent("/")}`,
    ours: (url) => url.startsWith(ST0) || url.startsWith(PL8),
    webPreferences,
    icon: appIcon(),
    options: {
      width: 1440,
      height: 900,
      minWidth: 900,
      minHeight: 600,
      title: "st0",
      backgroundColor: "#101114",
    },
  });
  win.on("closed", () => {
    win = null;
  });
}

async function boot(): Promise<void> {
  const dirs = stateDirs();
  mkdirSync(dirs.root, { recursive: true });
  openLog(dirs.log);
  line("app", `state in ${dirs.root}`);
  await assertPortsFree([PORTS.st0, PORTS.pl8]);

  const engine = engineBinary();
  const shared: Record<string, string> = {
    SESSION_SECRET: persistentSecret(dirs.root),
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

runApp({
  title: "st0",
  logPath: stateDirs().log,
  boot,
  stop: async () => {
    // The supervisor first: it deregisters from pl8, which must still be up to hear it.
    await supervisor?.stop();
    await Promise.all(backends.map((b) => stopServer(b)));
  },
  onSecondInstance: () => win?.show(),
  onActivate: () => {
    if (!win && backends.length) openWindow();
  },
  devIcon: appIcon(),
});
