// main.ts — the desktop app: a window onto st0, and the engine that window needs. The
// supervisor runs IN this process and starts the engine and the file service; closing the
// window stops all three. Nothing runs on behind the window.
//
// The ORDER in whenReady is load-bearing: the kill-on-close job before ANY spawn — and this
// process is now a member, since the engine is spawned from here — and the log truncate
// before the supervisor opens the same file for append. See docs/lifetime.md.

import { networkInterfaces } from "node:os";
import { settingsPath } from "@studio/engine-client/paths";
import type { HostSnapshot } from "@studio/engine-host/hostProtocol";
import { ensureEngineIdentity } from "@studio/engine-host/identity";
import { loadSettings, saveSettings } from "@studio/engine-host/settings";
import { pairUrl } from "@studio/web-protocol/pairing";
import { serviceUrl } from "@studio/web-protocol/services";
import { app, shell } from "electron";
import { clearDevPid, writeDevPid } from "./devPid.ts";
import { assignSelf, init as initJob } from "./job.ts";
import {
  autostartEnabled,
  notifyModal,
  notifyPassive,
  openFolder,
  openTextFile,
  toggleAutostart,
} from "./localActions.ts";
import { initMergedLog, line } from "./logbus.ts";
import { repoRoot } from "./repoRoot.ts";
import { backstop, enginePid } from "./pidkill.ts";
import { bundledDist } from "./server/frontend.ts";
import { adoptIdentity, currentIdentity } from "./server/identity.ts";
import { type LocalServer, startLocalServer } from "./server/index.ts";
import { armPairing, pairingReturnUrl } from "./server/pairing.ts";
import { SupervisorLink } from "./supervisorLink.ts";
import { destroyWindow, openWindow } from "./window.ts";

declare const __STUDIO_BUILD__: string;

let host: SupervisorLink | null = null;
let web: LocalServer | null = null;
// What the settings page draws from — the SAME snapshot, and there is only one.
let snapshot: HostSnapshot | null = null;
let hostError: string | null = null;
let paths = { root: "", mergedLog: "", webOrigins: "" };

// Keyed on the bundle identifier, not the path — a second launch must raise the first window
// rather than start a second engine.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on("second-instance", () => {
  if (web) openWindow(web.url);
});

app.whenReady().then(() => {
  // FIRST, and we join it ourselves: membership is inherited, and the engine is spawned from here.
  initJob();
  assignSelf();

  if (!app.isPackaged) writeDevPid();

  // Before the supervisor is spawned, because it opens the same file for append.
  initMergedLog();
  line("host", `studio ${__STUDIO_BUILD__} starting`);

  host = new SupervisorLink(
    {
      onSnapshot: (s) => {
        paths = s.paths ?? paths;
        snapshot = s;
        hostError = null;
      },
      onNotify: (kind, title, body) =>
        kind === "modal"
          ? notifyModal(title, body)
          : notifyPassive(title, body),
      onHostError: (message) => {
        hostError = message;
      },
    },
    // Told rather than probed: `process.execPath` is Electron here — see docs/supervisor.md.
    app.isPackaged ? process.resourcesPath : null,
    app.isPackaged ? null : repoRoot(),
  );
  host.start();

  void startWeb();

  // macOS keeps an app alive with no windows; clicking the Dock icon reopens rather than
  // starting a second copy.
  app.on("activate", () => {
    if (web) openWindow(web.url);
  });
});

/** The window IS the app, so the last one closing ends it — engine, file service and all. */
app.on("window-all-closed", () => app.quit());

let quitting = false;
app.on("before-quit", (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  void (async () => {
    // BEFORE the teardown: it removes the pidfile, so a shutdown that got that far and no
    // further would leave the backstop below with nothing to read — see pidkill.ts.
    const engine = enginePid();
    line("host", "quitting: stopping the engine…");
    // The supervisor first: its exit is what DEREGISTERS, and that wants to happen while the
    // engine is still up and the registry entry still means something.
    await host?.shutdownAndWait();
    // Then the backstop, for the case where it never got there — hung on an unresponsive
    // registry and killed past its deadline, or already crashed.
    if (backstop(engine))
      line("host", "the engine outlived the teardown — killed by the backstop");
    await web?.close();
    clearDevPid();
    destroyWindow();
    line("host", "quit");
    app.quit();
  })();
});

// launchd stops a login item with SIGTERM, and Ctrl-C in dev must behave the same.
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  process.on(sig, () => app.quit());
}

/** The addresses a SECOND DEVICE can use — the same listener, seen from the LAN (docs/externals.md). */
function lanUrls(port: number): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === "IPv4" && !i.internal)
        out.push(`http://${i.address}:${port}`);
    }
  }
  return out;
}

/** The rows the supervisor has no command for. The settings page is the only caller. */
async function localAction(
  what: string,
  arg?: string,
): Promise<{ ok: boolean; error?: string }> {
  switch (what) {
    case "autostart":
      toggleAutostart();
      return { ok: true };
    case "openRoot":
      openFolder(paths.root);
      return { ok: true };
    case "openLog":
      openTextFile(paths.mergedLog);
      return { ok: true };
    case "openSettingsFile":
      openTextFile(settingsPath());
      return { ok: true };
    case "setServer":
      if (!arg) return { ok: false, error: "no address" };
      saveSettings({ ...loadSettings(), serverUrl: arg });
      return { ok: true };
    case "pair":
      return await beginPairing();
    case "unpair":
      saveSettings({ ...loadSettings(), serverUrl: null, serverToken: null });
      return { ok: true };
    default:
      return { ok: false, error: `unknown action: ${what}` };
  }
}

/** Open the pairing round trip in the SYSTEM browser — never a window of ours (RFC 8252 §8.12). */
async function beginPairing(): Promise<{ ok: boolean; error?: string }> {
  const { serverUrl } = loadSettings();
  if (!serverUrl) return { ok: false, error: "no server is set" };
  if (!web) return { ok: false, error: "the local server is not up" };
  const state = armPairing();
  await shell.openExternal(
    pairUrl(serviceUrl(serverUrl, "pl8"), pairingReturnUrl(web.url), state),
  );
  return { ok: true };
}

/**
 * Serve st0 from this machine, then open the window on it. The port is REMEMBERED: one that
 * moves every launch breaks four things at once — see server/port.ts.
 */
async function startWeb(): Promise<void> {
  const settings = loadSettings();
  const distDir = app.isPackaged ? bundledDist(process.resourcesPath) : null;
  try {
    web = await startLocalServer({
      port: settings.webPort,
      distDir,
      // In dev the SPA comes from the session's vite, so the window runs the same origin
      // contract a packaged build has rather than a second arrangement nobody exercises.
      viteUrl: distDir ? undefined : "http://localhost:5223",
      remote: () => {
        const s = loadSettings();
        return { serverUrl: s.serverUrl, serverToken: s.serverToken };
      },
      cache: () => {
        const s = loadSettings();
        return {
          filePort: s.filePort,
          engineToken: ensureEngineIdentity().token,
          user: currentIdentity(),
        };
      },
      desktop: {
        state: () => ({
          snapshot,
          hostError,
          build: __STUDIO_BUILD__,
          autostart: autostartEnabled(),
          identity: currentIdentity(),
          server: loadSettings().serverUrl,
          paired: loadSettings().serverToken !== null,
          lanUrls: lanUrls(web?.port ?? settings.webPort),
        }),
        send: (cmd, arg) => host?.send(cmd, arg),
        local: localAction,
      },
      onPaired: ({ token, identity }) => {
        saveSettings({ ...loadSettings(), serverToken: token });
        // The workspaces move with the identity, or every offline project stops being listed
        // and reads as "my songs are gone" — see server/identity.ts.
        if (identity) adoptIdentity(identity);
      },
    });
    if (web.port !== settings.webPort) {
      saveSettings({ ...settings, webPort: web.port });
      line("host", `web port ${settings.webPort} was taken — kept ${web.port}`);
    }
    openWindow(web.url);
  } catch (e) {
    // With no origin there is no window, and the app has nothing left to be.
    line("host", `no local server: ${String(e)} — quitting`);
    app.quit();
  }
}
