// main.ts — k7 (its media library included) as one desktop app: its backend, the supervisor and its engine, and a window on k7.
// Signed out it runs as a local user; signing in to k7's IdP happens in the system browser. See docs/signIn.md.

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  assertPortsFree,
  persistentSecret,
} from "@frediverse/electron-shell/boot";
import { runApp } from "@frediverse/electron-shell/lifecycle";
import { line, openLog } from "@frediverse/electron-shell/log";
import { installPermissions } from "@frediverse/electron-shell/permissions";
import {
  type Server,
  stopServer,
  waitListening,
} from "@frediverse/electron-shell/servers";
import type { SupervisorHost } from "@studio/supervisor-host/supervisorHost";
import { LOCAL_SIGN_IN } from "@studio/web-protocol/handoff";
import { PORTS_ENV } from "@studio/web-protocol/services";
import { app, session } from "electron";
import standalone from "../../k7/backend/standalone.json";
import { startBackend } from "./backends.ts";
import { installDesktopBridge } from "./desktopBridge.ts";
import {
  engineDown,
  engineSnapshot,
  installEngineBridge,
} from "./engineBridge.ts";
import { addServer, pairIfNeeded } from "./pairSync.ts";
import {
  appIcon,
  engineBinary,
  librarySource,
  stateDirs,
  supervisorBinary,
} from "./paths.ts";
import { chooseServer, chosenServer } from "./server.ts";
import { signIn } from "./signIn.ts";
import { failedPage, startingPage } from "./splash.ts";
import { startSupervisor } from "./supervisor.ts";
import { openTabbedWindow, type TabbedWindow } from "./window.ts";

// Not the dev session's 8789, so the two run side by side; every process is told through PORTS_ENV.
const PORTS = { k7: standalone.port };
const PORTS_SPEC = `k7=${PORTS.k7}`;
// Inherited by the backend, the file services it starts and the supervisor.
process.env[PORTS_ENV] = PORTS_SPEC;
const K7 = `http://127.0.0.1:${PORTS.k7}`;
/** Where a signed-out window lands: the local user, unless a session is already there. */
const LOCAL_HOME = `${K7}${LOCAL_SIGN_IN}?return_to=${encodeURIComponent("/")}`;

/** k7's own IdP, as a PUBLIC client: the app cannot keep a secret. Overridable, and an empty issuer means local only. */
const OIDC = {
  issuer: process.env.K7_OIDC_ISSUER ?? standalone.env.OIDC_ISSUER,
  clientId: process.env.K7_OIDC_CLIENT_ID ?? standalone.env.OIDC_CLIENT_ID,
};

/** What every window gets, the ones a page opens included: the preload publishes the ports to the page. */
const webPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  preload: join(__dirname, "preload.cjs"),
  additionalArguments: [`--studio-ports=${PORTS_SPEC}`],
};

/** Widened past the shell's defaults for the rehearsal bench, an app frame inside an app page that records and plays MIDI. */
const K7_GRANTS = {
  media: "app",
  midi: "app",
  "screen-wake-lock": "app",
} as const;

let backends: Server[] = [];
let supervisor: SupervisorHost | null = null;
let win: TabbedWindow | null = null;
/** The backend answered: a window opened from now on loads k7 at once. */
let started = false;

/** No service worker here: one left by an earlier run hangs the first navigation, and a local origin has nothing to precache — docs/standalone.md. */
async function noServiceWorker(): Promise<void> {
  await session.defaultSession.clearStorageData({
    storages: ["serviceworkers", "cachestorage"],
  });
  // Refused rather than left to register again, so the next start has none to clear.
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: [`${K7}/sw.js`] },
    (_details, callback) => callback({ cancel: true }),
  );
}

/** Any sign-out — the strip's, the user menu's, an expired session — falls back to the local user. */
function watchSignOut(): void {
  session.defaultSession.cookies.on("changed", (_e, cookie, cause, removed) => {
    if (cookie.name !== "studio.sid") return;
    // A new session may be a newly signed-in account: pair it with the origin's relay if it is not yet.
    if (!removed) return void pairIfNeeded(K7).catch(() => undefined);
    // An overwrite is a new session replacing the old one, not a sign-out.
    if (cause === "overwrite") return;
    line("app", `signed out (${cause})`);
    win?.reset(LOCAL_HOME);
  });
}

function openWindow(): void {
  win = openTabbedWindow({
    origin: K7,
    homeUrl: LOCAL_HOME,
    splashUrl: startingPage(),
    webPreferences,
    icon: appIcon(),
    onSignIn: (server) => {
      // A server typed in the strip is kept for pairing; one that is no server address leaves the last choice.
      if (server && !chooseServer(server))
        return line("app", `not a server address: ${server}`);
      signIn(K7, (redeemUrl) => {
        win?.reset(redeemUrl);
        win?.focus();
      });
    },
    server: chosenServer,
    // Another server beside the main one, asked from the home page (docs/sync.md, "Several servers").
    onAddServer: (server) => addServer(K7, server),
  });
  win.win.on("closed", () => {
    win = null;
  });
  if (started) win.start();
}

async function boot(): Promise<void> {
  const dirs = stateDirs();
  mkdirSync(dirs.root, { recursive: true });
  openLog(dirs.log, { echo: !app.isPackaged });
  line("app", `state in ${dirs.root}`);
  // Before the first page, the splash included: what k7's frames may use, everything else refused (docs/standalone.md, "Permissions").
  installPermissions(session.defaultSession, {
    origins: [K7],
    grants: K7_GRANTS,
  });
  // At once, on a splash: a cold start or a first library seed would otherwise show nothing for seconds.
  openWindow();
  await assertPortsFree([PORTS.k7]);

  const engine = engineBinary();
  const seed = librarySource();
  // The table the phone starts its backend with too: apps/k7/backend/docs/standalone.md says why each value.
  const env: Record<string, string> = {
    ...standalone.env,
    ...dirs.backend,
    SESSION_SECRET: persistentSecret(dirs.root),
    OIDC_ISSUER: OIDC.issuer,
    OIDC_CLIENT_ID: OIDC.clientId,
    ...(engine ? { STUDIO_ENGINE: engine } : {}),
    // The hub copies `k7-core` from here the first time it has no folder for it.
    ...(seed ? { STUDIO_LIBRARY_SEED: `k7-core=${seed}` } : {}),
  };

  // Before the supervisor: its first snapshot may arrive before any page asks.
  installEngineBridge(K7, () => supervisor);
  installDesktopBridge(K7, chosenServer);
  const sup = supervisorBinary();
  if (sup && existsSync(sup))
    supervisor = startSupervisor(sup, dirs.engineHome, K7, {
      onSnapshot: (s) => engineSnapshot(K7, s),
      onDown: (why) => engineDown(K7, why),
    });
  else line("app", "no k7-supervisor build found — running without an engine");

  backends = [startBackend(PORTS.k7, env, dirs.root)];
  // The workers are cleared while the backend starts; both before the first k7 page.
  await Promise.all([
    ...backends.map((b) => waitListening(b)),
    noServiceWorker(),
  ]);
  line("app", "backend up");
  watchSignOut();
  started = true;
  if (win) win.start();
  else openWindow();
}

runApp({
  title: "k7",
  logPath: stateDirs().log,
  boot,
  // Shown in the window when it is open; the app then quits when it is closed.
  showFailure: (why) => {
    win?.fail(failedPage(why, stateDirs().log));
    return win !== null;
  },
  stop: async () => {
    // The supervisor first: it deregisters from k7, which must still be up to hear it.
    await supervisor?.stop();
    await Promise.all(backends.map((b) => stopServer(b)));
  },
  onSecondInstance: () => win?.focus(),
  onActivate: () => {
    if (!win && started) openWindow();
  },
  devIcon: appIcon(),
});
