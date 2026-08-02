// supervisor.ts — the engine supervisor proper: owns the ~/.lanes contract, keeps the
// registry entry live, maintains the web-UI allowlist, and answers the tray's commands.
// One mutable `state`, slow loops that mutate it, and publish() emitting a snapshot ONLY
// when the bytes changed — which is what keeps an idle app quiet on the wire.

import type { ChildProcess } from "node:child_process";
import { engineRunning } from "@studio/engine-client/engineDaemon";
import {
  mergedLogPath,
  rootDir,
  webOriginsPath,
} from "@studio/engine-client/paths";
import { gatherAddresses } from "./addresses.ts";
import { desiredSwitch, menuSignature, signature } from "./audioPolicy.ts";
import * as engineProcess from "./engineProcess.ts";
import { EngineQueries } from "./engineQueries.ts";
import * as fileService from "./fileServiceProcess.ts";
import type {
  EngineRunState,
  HostAudioDevice,
  HostCommand,
  HostEditPlugin,
  HostOwnership,
  HostSnapshot,
} from "./hostProtocol.ts";
import { type EngineIdentity, ensureEngineIdentity } from "./identity.ts";
import { emit, listen } from "./ipcStdio.ts";
import { line } from "./logbus.ts";
import { deregister, heartbeat, resolveRegistryUrl } from "./registryClient.ts";
import { loadSettings, type Settings, saveSettings } from "./settings.ts";
import {
  addOrigin,
  clearPending,
  loadOrigins,
  pendingOrigins,
  pendingStamp,
  removeOrigin,
  seedDefault,
} from "./webOrigins.ts";

const HEARTBEAT_MS = 5000;
const PENDING_POLL_MS = 2000;
/** Both process watches. Fast enough that a crash is noticed before the user is, slow
 *  enough to be free — each tick is a pidfile stat or a socket connect. */
const WATCH_MS = 2000;
/** Relaunch backoff for a crashing engine: 1s doubling to 30s. An engine that dies on
 *  startup (a bad audio device, a missing DLL) would otherwise be relaunched forever at
 *  one per second, and the log would be nothing but that. */
const BACKOFF_MAX_S = 30;
/** The audio poll. Fast, because this is what notices an interface being plugged in or
 *  pulled out — a menu listing a device you unplugged a minute ago is worse than
 *  useless, and the recovery in `desiredSwitch` can only be as prompt as this tick. */
const DEVICES_POLL_MS = 2000;
/** The loaded project's plugin instances. A user swaps songs at human speed, not
 *  interface-unplug speed. */
const EDIT_PLUGINS_POLL_MS = 3000;
/** The plugin count once it is known: the scan is expensive and the answer barely
 *  moves. Until it lands we ask at `PLUGINS_POLL_FAST_MS` to keep the spinner honest. */
const PLUGINS_POLL_MS = 60_000;
const PLUGINS_POLL_FAST_MS = 2000;
/** Bound on the deregister we do while shutting down: a hung registry must not hold the
 *  quit open. The tray gives us ~3s in total before it kills us. */
const DEREGISTER_TIMEOUT_MS = 1500;

export interface SupervisorOptions {
  own: HostOwnership;
}

interface State {
  own: HostOwnership;
  identity: EngineIdentity;
  settings: Settings;
  registryUrl: string;
  status: EngineRunState;
  error: string | null;
  ownsEngine: boolean;
  userStopped: boolean;
  fileServiceFailed: boolean;
  lastHeartbeatOk: boolean;
  pluginCount: number | null;
  audioDevices: HostAudioDevice[];
  audioMenuSig: string;
  editPlugins: HostEditPlugin[];
  editPluginsSig: string;
  webOrigins: string[];
  webPending: string[];
  /** mtime+size of pending-origins.json when we last parsed it, so the poll can skip
   *  the read entirely on a quiet tick. */
  pendingStamp: string;
  /** Origins we have already raised a banner for. One per origin, EVER — a blocked
   *  browser retries endlessly, and this is what stops a notification storm. */
  notified: Set<string>;
  shuttingDown: boolean;

  // --- owned processes ------------------------------------------------------
  /** The engine we spawned. Null when adopted (or stopped) — and `ownsEngine` is the
   *  flag that says which, because a foreign engine must never be killed from here. */
  engineChild: ChildProcess | null;
  /** The file service we spawned. Null when the dev watcher owns the port. */
  fileChild: ChildProcess | null;
  /** Seconds to wait before the next relaunch attempt. */
  backoff: number;

  // --- audio policy ---------------------------------------------------------
  /** The last automatic switch we asked for, as {target, sig}. Guards the reconcile
   *  loop against retrying a failing switch every two seconds: the same target is only
   *  re-attempted once the set of visible devices changes. */
  lastAttempt: { target: string; sig: string } | null;
}

function snapshot(s: State): HostSnapshot {
  return {
    owns: s.own,
    status: s.status,
    ...(s.error ? { error: s.error } : {}),
    ownsEngine: s.ownsEngine,
    userStopped: s.userStopped,
    engineId: s.identity.id,
    // Only while the TRAY still spawns the engine — it needs the token. Drops off the wire once we own the process.
    ...(s.own.engine ? {} : { engineToken: s.identity.token }),
    enginePort: s.settings.port,
    filePort: s.settings.filePort,
    fileServiceFailed: s.fileServiceFailed,
    registryUrl: s.registryUrl,
    lastHeartbeatOk: s.lastHeartbeatOk,
    pluginCount: s.pluginCount,
    audioDevices: s.audioDevices,
    audioPreferred: s.settings.audioDevice,
    audioFallback: s.settings.audioFallback,
    audioMenuSig: s.audioMenuSig,
    editPlugins: s.editPlugins,
    editPluginsSig: s.editPluginsSig,
    webOrigins: s.webOrigins,
    webPending: s.webPending,
    attention: s.webPending.length > 0,
    paths: {
      root: rootDir(),
      mergedLog: mergedLogPath(),
      webOrigins: webOriginsPath(),
    },
  };
}

export async function startSupervisor(opts: SupervisorOptions): Promise<void> {
  // First run only: trust the hosted studio, before anything reads the list, so it is in the very first snapshot.
  seedDefault();

  const settings = loadSettings();
  const state: State = {
    own: opts.own,
    identity: ensureEngineIdentity(),
    settings,
    registryUrl: resolveRegistryUrl(settings.registryUrl),
    status: "stopped",
    error: null,
    ownsEngine: false,
    userStopped: false,
    fileServiceFailed: false,
    lastHeartbeatOk: false,
    pluginCount: null,
    audioDevices: [],
    audioMenuSig: "",
    editPlugins: [],
    editPluginsSig: "",
    webOrigins: loadOrigins(),
    webPending: [],
    pendingStamp: "",
    notified: new Set(),
    shuttingDown: false,
    engineChild: null,
    fileChild: null,
    backoff: 1,
    lastAttempt: null,
  };

  const engine = new EngineQueries(settings.port);

  // Declared up front: `shutdown` clears them and can fire from listen's end callback before the loops are installed.
  let beatTimer: NodeJS.Timeout | undefined;
  let pendingTimer: NodeJS.Timeout | undefined;
  let crashTimer: NodeJS.Timeout | undefined;
  let fileTimer: NodeJS.Timeout | undefined;
  let devicesTimer: NodeJS.Timeout | undefined;
  let editPluginsTimer: NodeJS.Timeout | undefined;
  let pluginsTimer: NodeJS.Timeout | undefined;

  let lastFrame = "";
  const publish = (): void => {
    const frame = JSON.stringify({ t: "state", ...snapshot(state) });
    if (frame === lastFrame) return; // nothing the tray draws has moved
    lastFrame = frame;
    emit(JSON.parse(frame));
  };

  const notify = (
    kind: "passive" | "modal",
    title: string,
    body: string,
  ): void => {
    emit({ t: "notify", kind, title, body });
  };

  // --- the engine and the file service --------------------------------------

  /** Bring the file service up for whatever engine is running, owned or adopted.
   *
   *  The ADOPT case is why this is called from every start path: a force-killed tray
   *  leaves its engine and pidfile behind but NOT its file service, so a launch that
   *  adopted the orphan and skipped this would come up with no file service at all —
   *  the "no answer on :8770" the web UI shows. */
  const ensureFileService = async (): Promise<void> => {
    if (state.fileChild) return;
    const r = await fileService.ensure(
      state.identity,
      state.settings.port,
      state.settings.filePort,
      state.registryUrl,
      state.settings.mediatekDir,
      {
        url: state.settings.mediatekUrl,
        token: state.settings.mediatekToken,
      },
    );
    if (r.kind === "spawned") {
      state.fileChild = r.child;
      // A child that exits on its own is noticed here; the watch is for the case where nothing tells us.
      r.child.once("exit", () => {
        if (state.fileChild === r.child) {
          state.fileChild = null;
          if (!state.shuttingDown && !state.userStopped) {
            state.fileServiceFailed = true;
            publish();
          }
        }
      });
    }
    // "foreign" clears the flag as firmly as "spawned": this is the one place that actually looked.
    state.fileServiceFailed = r.kind === "unavailable";
  };

  /** Returns whether an engine is running afterwards — spawned or adopted. */
  const startEngine = async (): Promise<boolean> => {
    state.userStopped = false;
    const r = engineProcess.start(state.identity, state.settings.port);
    switch (r.kind) {
      case "spawned":
        state.engineChild = r.child;
        state.ownsEngine = true;
        state.status = "running";
        state.error = null;
        break;
      case "adopted":
        state.engineChild = null;
        state.ownsEngine = false;
        state.status = "running";
        state.error = null;
        break;
      case "missing":
        state.status = "error";
        state.error = "engine binary not found (build it)";
        break;
      case "error":
        state.status = "error";
        state.error = `spawn failed: ${r.message}`;
        break;
    }
    const running = state.status === "running";
    if (running) await ensureFileService();
    publish();
    return running;
  };

  const stopEngine = (): void => {
    state.userStopped = true;
    // Only kill an ENGINE we own. The file service is always ours, so stop it unconditionally.
    if (state.ownsEngine) engineProcess.stop();
    fileService.stop(state.fileChild);
    state.engineChild = null;
    state.fileChild = null;
    state.ownsEngine = false;
    state.status = "stopped";
    state.error = null;
    // The file service went with it — clear the failure, so a stopped engine shows a plain red dot, not a "down".
    state.fileServiceFailed = false;
    state.pluginCount = null;
    state.editPlugins = [];
    state.editPluginsSig = "";
    state.audioDevices = [];
    state.audioMenuSig = "";
    state.lastAttempt = null;
    // The socket died with the engine: drop our end, so the next start redials instead of waiting out a dead handle.
    engine.close();
    publish();
  };

  /**
   * Relaunch the engine if it died and the user didn't stop it.
   *
   * A dead process is nobody's any more, so taking over an ADOPTED engine that died is
   * fine — that is why this doesn't check `ownsEngine`.
   */
  let backoffUntil = 0;
  const crashWatch = async (): Promise<void> => {
    if (state.shuttingDown || state.userStopped) {
      state.backoff = 1;
      return;
    }
    if (state.status === "stopped") return; // never started, or stopped on purpose
    if (engineRunning()) {
      state.backoff = 1;
      return;
    }
    if (Date.now() < backoffUntil) return;

    line("host", "engine is gone — relaunching");
    state.engineChild = null;
    state.status = "error";
    state.error = "engine exited — restarting…";
    publish();
    const up = await startEngine();
    if (!up) {
      backoffUntil = Date.now() + state.backoff * 1000;
      state.backoff = Math.min(state.backoff * 2, BACKOFF_MAX_S);
    }
  };

  /**
   * Watch the file service and flag it when it isn't there.
   *
   * Unlike the engine's crash-watch this NEVER relaunches: a file service that keeps
   * falling over is something the user should see and act on, not have papered over —
   * and the restart is one menu click away.
   *
   * Reports BOTH ways, because it is a live reading rather than a failure record:
   * restart `npm run dev` and the icon should go green again on its own.
   */
  const fileServiceWatch = async (): Promise<void> => {
    if (state.shuttingDown || state.userStopped) return;
    if (state.status !== "running") return;
    if (state.fileChild) return; // ours, and its 'exit' handler is the watch
    const up = await fileService.isServing(state.settings.filePort);
    if (state.fileServiceFailed === !up) return;
    // Re-check the gate: the probe took time, and a stop may have landed meanwhile.
    if (state.shuttingDown || state.userStopped || state.status !== "running")
      return;
    state.fileServiceFailed = !up;
    publish();
  };

  // --- engine queries -------------------------------------------------------
  // Three polls, because the engine pushes none of this — no callback for an unplugged interface or a new song.
  // They share ONE connection (see engineQueries) and are serialised through it.

  /**
   * Poll the audio interfaces and keep the engine on the right one.
   *
   * The policy — preferred if present, else fallback, else leave it alone — is in
   * audioPolicy.ts. What lives here is the part that needs the world: asking, switching,
   * and not asking again pointlessly.
   */
  const pollDevices = async (): Promise<void> => {
    if (state.status !== "running") return;
    const devices = await engine.listAudioDevices();
    if (!devices) return;
    state.audioDevices = devices;

    const want = desiredSwitch(
      devices,
      state.settings.audioDevice,
      state.settings.audioFallback,
    );
    const sig = signature(devices);
    if (want) {
      // Don't retry a switch that didn't take until the device SET changes, or a refused device is retried forever.
      const same =
        state.lastAttempt?.target === want && state.lastAttempt?.sig === sig;
      if (!same) {
        state.lastAttempt = { target: want, sig };
        const type = devices.find((d) => d.name === want)?.deviceType ?? "";
        const updated = await engine.setAudioDevice(want, type);
        if (updated) state.audioDevices = updated;
      }
    } else {
      state.lastAttempt = null;
    }

    // The tray rebuilds its submenu on this, so the signature — not the device array — decides whether anything moved.
    state.audioMenuSig = menuSignature(
      state.audioDevices,
      state.settings.audioDevice,
      state.settings.audioFallback,
    );
    publish();
  };

  const pollPlugins = async (): Promise<void> => {
    if (state.status !== "running") return;
    const n = await engine.pluginCount();
    if (n === null) return; // no answer yet — leave the spinner alone
    if (n === state.pluginCount) return;
    state.pluginCount = n;
    publish();
  };

  const pollEditPlugins = async (): Promise<void> => {
    if (state.status !== "running") return;
    const plugins = await engine.listEditPlugins();
    if (!plugins) return;
    // Signature from the OPENABLE plugin ids, so only an add or a remove churns the submenu.
    const sig = plugins
      .filter((p) => p.hasNativePluginUI)
      .map((p) => p.id)
      .join("\n");
    if (sig === state.editPluginsSig) return;
    state.editPlugins = plugins;
    state.editPluginsSig = sig;
    publish();
  };

  // --- registry -------------------------------------------------------------
  // Gated on the engine being up — announcing a dead one puts a stale entry in every picker for the TTL. The
  // pidfile is the gate rather than our own status, being ground truth across a crash we haven't noticed.
  const beat = async (): Promise<void> => {
    if (!engineRunning()) {
      state.lastHeartbeatOk = false;
      publish();
      return;
    }
    const presence = gatherAddresses(
      state.settings.port,
      state.settings.filePort,
    );
    const ok = await heartbeat(state.registryUrl, state.identity, presence);
    state.lastHeartbeatOk = ok;
    publish();
  };

  // --- the refused-origin poll ----------------------------------------------
  // Poll the origins CORS turned away: that list changes while the user stares at the menu bar, so it can't wait
  // for a click. Cheap — a stat, and a parse only when it moved.
  const pollPending = (): void => {
    const stamp = pendingStamp();
    if (stamp === state.pendingStamp) return;
    state.pendingStamp = stamp;
    state.webOrigins = loadOrigins();
    state.webPending = pendingOrigins();
    publish();
    // Tell the user once per ORIGIN: the only other signal is a broken page whose browser can't say why.
    for (const origin of state.webPending) {
      if (state.notified.has(origin)) continue;
      state.notified.add(origin);
      notify(
        "passive",
        "A web UI was blocked",
        `${origin} tried to reach this engine. Allow it from the menu bar: Web UI ▸ ${origin}`,
      );
    }
  };

  // Re-read allowlist and pending, then publish — every weburi command ends here, so the menu follows one path.
  const refreshOrigins = (): void => {
    state.webOrigins = loadOrigins();
    state.webPending = pendingOrigins();
    state.pendingStamp = pendingStamp();
    publish();
  };

  // --- commands -------------------------------------------------------------

  const reply = (id: number, ok: boolean, message?: string): void => {
    emit({ t: "result", id, ok, ...(message ? { message } : {}) });
  };

  /** Repoint the registry: persist it, adopt it live, and re-announce so the engine
   *  appears in the new backend without waiting for the next tick. */
  const setRegistryUrl = async (url: string): Promise<void> => {
    const old = state.registryUrl;
    state.settings.registryUrl = url;
    state.registryUrl = url;
    saveSettings(state.settings);
    publish();
    if (!engineRunning()) return; // nothing announced yet; the next start registers there
    // Leave no ghost behind in the old registry, then announce to the new one.
    if (old !== url) await deregister(old, state.identity);
    const presence = gatherAddresses(
      state.settings.port,
      state.settings.filePort,
    );
    state.lastHeartbeatOk = await heartbeat(url, state.identity, presence);
    publish();
  };

  const onCommand = async (cmd: HostCommand): Promise<void> => {
    const arg = cmd.arg ?? "";
    switch (cmd.cmd) {
      case "engine.start": {
        const up = await startEngine();
        reply(cmd.id, up, state.error ?? undefined);
        return;
      }
      case "engine.stop":
        stopEngine();
        // Drop out of the picker NOW rather than aging out of the TTL: that immediacy is Stop versus Restart.
        await deregister(state.registryUrl, state.identity);
        reply(cmd.id, true);
        return;
      case "engine.restart": {
        stopEngine();
        const up = await startEngine();
        reply(cmd.id, up, state.error ?? undefined);
        return;
      }
      case "fileService.restart": {
        if (state.status !== "running") {
          reply(cmd.id, false, "the engine isn't running");
          return;
        }
        fileService.stop(state.fileChild);
        state.fileChild = null;
        await ensureFileService();
        publish();
        if (state.fileServiceFailed) {
          notify(
            "modal",
            "Couldn't restart the file service",
            "No file-service runtime was found (the bundled node, or the dev watcher).",
          );
        }
        reply(cmd.id, !state.fileServiceFailed);
        return;
      }
      case "waveforms.clear": {
        // Destructive: the next waveform request re-decodes. Only reachable while a file service of ours is up.
        if (state.status !== "running") {
          reply(cmd.id, false, "the engine isn't running");
          return;
        }
        let ok = false;
        try {
          const res = await fetch(
            `http://127.0.0.1:${state.settings.filePort}/waveforms/clear`,
            { method: "POST", signal: AbortSignal.timeout(5000) },
          );
          ok = res.ok;
        } catch {
          ok = false;
        }
        notify(
          "modal",
          ok ? "Waveform cache cleared" : "Couldn't clear waveform cache",
          ok
            ? "All cached waveforms have been removed."
            : "The file service is not reachable.",
        );
        reply(cmd.id, ok);
        return;
      }
      case "weburi.add": {
        const origin = addOrigin(arg);
        if (!origin) {
          reply(cmd.id, false, "not a valid web UI address");
          return;
        }
        clearPending(origin);
        refreshOrigins();
        // A lanes web UI is single-origin, so adding one also points this engine at it — which is what puts the
        // engine in that UI's picker.
        await setRegistryUrl(origin);
        reply(cmd.id, true, origin);
        return;
      }
      case "weburi.allow": {
        // Unlike "add", this does NOT repoint the registry: the blocked browser already found this engine, so moving it
        // could only break what works. Approval widens one thing — which origins the file service will talk to.
        const origin = addOrigin(arg);
        if (!origin) {
          reply(cmd.id, false, "not a valid web UI address");
          return;
        }
        clearPending(arg);
        refreshOrigins();
        reply(cmd.id, true, origin);
        return;
      }
      case "weburi.remove":
        removeOrigin(arg);
        refreshOrigins();
        reply(cmd.id, true);
        return;
      case "weburi.deny":
        clearPending(arg);
        refreshOrigins();
        reply(cmd.id, true);
        return;
      case "registry.set":
        await setRegistryUrl(arg);
        reply(cmd.id, true);
        return;
      case "registry.deregister":
        // The Stop menu item: drop out of the picker NOW rather than aging out.
        state.lastHeartbeatOk = false;
        publish();
        await deregister(state.registryUrl, state.identity);
        reply(cmd.id, true);
        return;
      case "audio.select": {
        // Two independent effects: REMEMBER the pick (so reconcile can restore it after a replug) and switch now.
        // A refused switch must not lose the preference.
        state.settings.audioDevice = arg || null;
        state.lastAttempt = null; // a deliberate pick deserves a fresh attempt
        saveSettings(state.settings);
        publish();
        const type =
          state.audioDevices.find((d) => d.name === arg)?.deviceType ?? "";
        const updated = await engine.setAudioDevice(arg, type);
        if (updated) {
          state.audioDevices = updated;
          state.audioMenuSig = menuSignature(
            updated,
            state.settings.audioDevice,
            state.settings.audioFallback,
          );
          publish();
        }
        reply(cmd.id, updated !== null);
        return;
      }
      case "audio.fallback":
        // An empty arg means "no fallback" — a real choice. It switches nothing now, only where to go if the pick leaves.
        state.settings.audioFallback = arg || null;
        state.lastAttempt = null; // a new fallback deserves a fresh attempt
        saveSettings(state.settings);
        state.audioMenuSig = menuSignature(
          state.audioDevices,
          state.settings.audioDevice,
          state.settings.audioFallback,
        );
        publish();
        reply(cmd.id, true);
        return;
      case "plugins.rescan":
        // Show the spinner at once: the scan runs detached inside the engine and its count returns via pollPlugins.
        state.pluginCount = null;
        publish();
        await engine.rescanPlugins();
        reply(cmd.id, true);
        return;
      case "plugin.showUI":
        await engine.showNativePluginUI(arg);
        reply(cmd.id, true);
        return;
      case "shutdown":
        await shutdown();
        return;
      default:
        // A command for a subsystem we don't own yet — answering keeps a mis-staged tray debuggable rather than inert.
        reply(cmd.id, false, `${cmd.cmd} is not owned by the supervisor yet`);
        return;
    }
  };

  // --- lifetime -------------------------------------------------------------

  const shutdown = async (): Promise<void> => {
    if (state.shuttingDown) return;
    state.shuttingDown = true;
    clearInterval(beatTimer);
    clearInterval(pendingTimer);
    clearInterval(crashTimer);
    clearInterval(fileTimer);
    clearInterval(devicesTimer);
    clearInterval(editPluginsTimer);
    clearTimeout(pluginsTimer);
    engine.close();
    // Deregister FIRST, while the entry still means something — but bounded, or a hung registry hangs the tray's Quit.
    await Promise.race([
      deregister(state.registryUrl, state.identity),
      new Promise((r) => setTimeout(r, DEREGISTER_TIMEOUT_MS)),
    ]);
    // Then tear down, and unlike Stop this does NOT spare an adopted engine: one left listening holds the audio
    // device and both ports for whatever launches next.
    fileService.stop(state.fileChild);
    engineProcess.stop();
    process.exit(0);
  };

  // stdin ending IS the tray going away — the whole teardown on Unix, the belt to the job object on Windows.
  listen(
    (cmd) => {
      void onCommand(cmd).catch((e) => {
        reply(cmd.id, false, String(e));
      });
    },
    () => void shutdown(),
  );
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  refreshOrigins(); // the first snapshot: the tray draws nothing until it arrives

  // Start (or adopt) the engine HERE rather than on a tray command: nothing should wait for a menu to be built.
  if (opts.own.engine) await startEngine();

  await beat();
  beatTimer = setInterval(() => void beat(), HEARTBEAT_MS);
  pendingTimer = setInterval(pollPending, PENDING_POLL_MS);
  if (opts.own.engine)
    crashTimer = setInterval(() => void crashWatch(), WATCH_MS);
  if (opts.own.fileService) {
    fileTimer = setInterval(() => void fileServiceWatch(), WATCH_MS);
  }
  if (opts.own.engineQueries) {
    devicesTimer = setInterval(() => void pollDevices(), DEVICES_POLL_MS);
    editPluginsTimer = setInterval(
      () => void pollEditPlugins(),
      EDIT_PLUGINS_POLL_MS,
    );
    // Self-rescheduling: ask hard until the scan lands (keeping the spinner honest), then back off to once a minute.
    const schedulePlugins = (): void => {
      const known = state.pluginCount !== null;
      pluginsTimer = setTimeout(
        () => {
          void pollPlugins().finally(schedulePlugins);
        },
        known ? PLUGINS_POLL_MS : PLUGINS_POLL_FAST_MS,
      );
    };
    schedulePlugins();
  }
}
