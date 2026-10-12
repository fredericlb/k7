// main.ts — st0 (its media library included) as one desktop app: its backend, the supervisor and its engine, and a window on st0.
// Signed out it runs as a local user; signing in to st0's IdP happens in the system browser. See docs/signIn.md.

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  assertPortsFree,
  persistentSecret,
} from "@frediverse/electron-shell/boot";
import { runApp } from "@frediverse/electron-shell/lifecycle";
import { line, openLog } from "@frediverse/electron-shell/log";
import {
  type Server,
  stopServer,
  waitListening,
} from "@frediverse/electron-shell/servers";
import type { SupervisorHost } from "@studio/supervisor-host/supervisorHost";
import { LOCAL_SIGN_IN } from "@studio/web-protocol/handoff";
import { PORTS_ENV } from "@studio/web-protocol/services";
import { session } from "electron";
import standalone from "../../st0/backend/standalone.json";
import { startBackend } from "./backends.ts";
import {
  engineDown,
  engineSnapshot,
  installEngineBridge,
} from "./engineBridge.ts";
import { pairIfNeeded } from "./pairSync.ts";
import {
  appIcon,
  engineBinary,
  librarySource,
  stateDirs,
  supervisorBinary,
} from "./paths.ts";
import { chooseServer, chosenServer } from "./server.ts";
import { signIn } from "./signIn.ts";
import { startSupervisor } from "./supervisor.ts";
import { openTabbedWindow, type TabbedWindow } from "./window.ts";

// Not the dev session's 8789, so the two run side by side; every process is told through PORTS_ENV.
const PORTS = { st0: standalone.port };
const PORTS_SPEC = `st0=${PORTS.st0}`;
// Inherited by the backend, the file services it starts and the supervisor.
process.env[PORTS_ENV] = PORTS_SPEC;
const ST0 = `http://127.0.0.1:${PORTS.st0}`;
/** Where a signed-out window lands: the local user, unless a session is already there. */
const LOCAL_HOME = `${ST0}${LOCAL_SIGN_IN}?return_to=${encodeURIComponent("/")}`;

/** st0's own IdP, as a PUBLIC client: the app cannot keep a secret. Overridable, and an empty issuer means local only. */
const OIDC = {
  issuer: process.env.ST0_OIDC_ISSUER ?? standalone.env.OIDC_ISSUER,
  clientId: process.env.ST0_OIDC_CLIENT_ID ?? standalone.env.OIDC_CLIENT_ID,
};

/** What every window gets, the ones a page opens included: the preload publishes the ports to the page. */
const webPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  preload: join(__dirname, "preload.cjs"),
  additionalArguments: [`--studio-ports=${PORTS_SPEC}`],
};

let backends: Server[] = [];
let supervisor: SupervisorHost | null = null;
let win: TabbedWindow | null = null;

/** No service worker here: one left by an earlier run hangs the first navigation, and a local origin has nothing to precache — docs/standalone.md. */
async function noServiceWorker(): Promise<void> {
  await session.defaultSession.clearStorageData({
    storages: ["serviceworkers", "cachestorage"],
  });
  // Refused rather than left to register again, so the next start has none to clear.
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: [`${ST0}/sw.js`] },
    (_details, callback) => callback({ cancel: true }),
  );
}

/** Any sign-out — the strip's, the user menu's, an expired session — falls back to the local user. */
function watchSignOut(): void {
  session.defaultSession.cookies.on("changed", (_e, cookie, cause, removed) => {
    if (cookie.name !== "studio.sid") return;
    // A new session may be a newly signed-in account: pair it with the origin's relay if it is not yet.
    if (!removed) return void pairIfNeeded(ST0).catch(() => undefined);
    // An overwrite is a new session replacing the old one, not a sign-out.
    if (cause === "overwrite") return;
    line("app", `signed out (${cause})`);
    win?.reset(LOCAL_HOME);
  });
}

function openWindow(): void {
  win = openTabbedWindow({
    origin: ST0,
    homeUrl: LOCAL_HOME,
    webPreferences,
    icon: appIcon(),
    onSignIn: (server) => {
      // A server typed in the strip is kept for pairing; one that is no server address leaves the last choice.
      if (server && !chooseServer(server))
        return line("app", `not a server address: ${server}`);
      signIn(ST0, (redeemUrl) => {
        win?.reset(redeemUrl);
        win?.focus();
      });
    },
    server: chosenServer,
  });
  win.win.on("closed", () => {
    win = null;
  });
}

async function boot(): Promise<void> {
  const dirs = stateDirs();
  mkdirSync(dirs.root, { recursive: true });
  openLog(dirs.log);
  line("app", `state in ${dirs.root}`);
  await assertPortsFree([PORTS.st0]);

  const engine = engineBinary();
  const seed = librarySource();
  // The table the phone starts its backend with too: apps/st0/backend/docs/standalone.md says why each value.
  const env: Record<string, string> = {
    ...standalone.env,
    ...dirs.backend,
    SESSION_SECRET: persistentSecret(dirs.root),
    OIDC_ISSUER: OIDC.issuer,
    OIDC_CLIENT_ID: OIDC.clientId,
    ...(engine ? { STUDIO_ENGINE: engine } : {}),
    // The hub copies `st0` from here the first time it has no folder for it.
    ...(seed ? { STUDIO_LIBRARY_SEED: `st0=${seed}` } : {}),
  };

  // Before the supervisor: its first snapshot may arrive before any page asks.
  installEngineBridge(ST0, () => supervisor);
  const sup = supervisorBinary();
  if (sup && existsSync(sup))
    supervisor = startSupervisor(sup, dirs.engineHome, ST0, {
      onSnapshot: (s) => engineSnapshot(ST0, s),
      onDown: (why) => engineDown(ST0, why),
    });
  else line("app", "no st0-supervisor build found — running without an engine");

  backends = [startBackend(PORTS.st0, env, dirs.root)];
  await Promise.all(backends.map((b) => waitListening(b)));
  line("app", "backend up");
  await noServiceWorker();
  watchSignOut();
  openWindow();
}

runApp({
  title: "st0",
  logPath: stateDirs().log,
  boot,
  stop: async () => {
    // The supervisor first: it deregisters from st0, which must still be up to hear it.
    await supervisor?.stop();
    await Promise.all(backends.map((b) => stopServer(b)));
  },
  onSecondInstance: () => win?.focus(),
  onActivate: () => {
    if (!win && backends.length) openWindow();
  },
  devIcon: appIcon(),
});
