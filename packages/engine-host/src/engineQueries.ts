// engineQueries.ts — request/reply over ONE long-lived engine connection, replacing a
// fresh WebSocket per call. Each function pairs a send with a one-shot listener and a
// deadline, and every call is queued so exactly one is in flight (replies are typed by
// frame, not by request). Full rationale: docs/supervisorPolicy.md.

import { once } from "node:events";
import { rmSync } from "node:fs";
// engineCONTROL, not engineClient: the supervisor never sends a project, and the full client would drag the
// song compiler and Strudel into this bundle for nothing.
import {
  type AudioDeviceInfo,
  type EditPluginInfo,
  EngineControl,
  type PluginInfo,
  type SessionInfo,
} from "@studio/engine-client/engineControl";
import { extsCachePath } from "@studio/engine-client/paths";
import type {
  HostAudioDevice,
  HostEditPlugin,
  HostSession,
} from "./hostProtocol.ts";
import { line } from "./logbus.ts";

// The tray's per-call deadlines, preserved: a plugin list can be thousands of entries and a switch opens hardware.
const DEVICES_MS = 6000;
const PLUGINS_MS = 8000;
const SET_DEVICE_MS = 8000;
const EDIT_PLUGINS_MS = 6000;
const SESSIONS_MS = 6000;
/** How long to wait for the socket to come up before giving up on a call. */
const CONNECT_MS = 4000;

export class EngineQueries {
  private client: EngineControl | null = null;
  private open = false;
  /** The tail of the in-flight chain. Every call appends to it, so they serialise. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly port: number) {}

  /** Drop the connection (on engine stop). The next call redials. */
  close(): void {
    this.client?.close();
    this.client = null;
    this.open = false;
  }

  private async connect(): Promise<EngineControl | null> {
    if (this.client && this.open) return this.client;
    if (this.client) this.client.close();

    const client = new EngineControl(`ws://127.0.0.1:${this.port}`);
    this.client = client;
    this.open = false;
    // Errors are routine — the engine may not be up yet — so absorb them rather than let them reach the process.
    client.on("wserror", () => {});
    client.on("close", () => {
      if (this.client === client) this.open = false;
    });
    client.connect();
    try {
      await once(client, "open", { signal: AbortSignal.timeout(CONNECT_MS) });
    } catch {
      client.close();
      if (this.client === client) this.client = null;
      return null;
    }
    this.open = true;
    return client;
  }

  /**
   * Run `fn` with exclusive use of the connection.
   *
   * The chain is never broken by a failure: each link swallows the previous one's
   * rejection before running, so one timed-out call cannot wedge every later call.
   */
  private run<T>(fn: (client: EngineControl) => Promise<T>): Promise<T | null> {
    const result = this.queue.then(
      () => this.exclusive(fn),
      () => this.exclusive(fn),
    );
    this.queue = result.catch(() => {});
    return result;
  }

  private async exclusive<T>(
    fn: (client: EngineControl) => Promise<T>,
  ): Promise<T | null> {
    const client = await this.connect();
    if (!client) return null;
    try {
      return await fn(client);
    } catch {
      // A timeout usually means the engine went away mid-call: force a redial rather than keep a half-dead socket.
      this.open = false;
      return null;
    }
  }

  /** Wait for one typed reply, or throw on the deadline. */
  private static reply<T>(
    client: EngineControl,
    event: string,
    ms: number,
  ): Promise<T> {
    return once(client, event, { signal: AbortSignal.timeout(ms) }).then(
      (args) => args[0] as T,
    );
  }

  /**
   * The audio interfaces the engine offers.
   *
   * NOTE the field rename. The engine reports `type`, which `engineClient` surfaces as
   * `AudioDeviceInfo.type`, but `setAudioDevice` SENDS it as `deviceType` and the tray's
   * label reads `{name} [{deviceType}]`. Getting this backwards produces a menu of
   * devices with blank backends that still switch correctly — which is exactly the kind
   * of bug that survives a review.
   */
  listAudioDevices(): Promise<HostAudioDevice[] | null> {
    return this.run(async (client) => {
      const p = EngineQueries.reply<AudioDeviceInfo[]>(
        client,
        "audioDevices",
        DEVICES_MS,
      );
      client.listAudioDevices();
      return (await p).map(toHostDevice);
    });
  }

  /** Switch the engine to a named interface; resolves with the updated device list
   *  (the engine answers a set with the same `audio-devices` frame). */
  setAudioDevice(
    name: string,
    deviceType: string,
  ): Promise<HostAudioDevice[] | null> {
    return this.run(async (client) => {
      const p = EngineQueries.reply<AudioDeviceInfo[]>(
        client,
        "audioDevices",
        SET_DEVICE_MS,
      );
      client.setAudioDevice(name, deviceType || undefined);
      return (await p).map(toHostDevice);
    });
  }

  /**
   * How many plugins the engine knows about. Null until its scan finishes.
   *
   * The COUNT, from the engine, deliberately — not a local cache file's key count. An
   * empty cache means "unknown, don't judge"; null here means "the engine hasn't
   * answered yet", which is what the tray's spinner is for. The two are not the same
   * fact and must not be conflated.
   */
  pluginCount(): Promise<number | null> {
    return this.run(async (client) => {
      const p = EngineQueries.reply<PluginInfo[]>(
        client,
        "plugins",
        PLUGINS_MS,
      );
      client.listPlugins();
      return (await p).length;
    });
  }

  /** The plugin INSTANCES in the currently loaded project. Empty when none is loaded. */
  listEditPlugins(): Promise<HostEditPlugin[] | null> {
    return this.run(async (client) => {
      const p = EngineQueries.reply<EditPluginInfo[]>(
        client,
        "editPlugins",
        EDIT_PLUGINS_MS,
      );
      client.listEditPlugins();
      return (await p).map((e) => ({
        id: e.id,
        name: e.name ?? "",
        hasNativePluginUI: !!e.hasNativePluginUI,
      }));
    });
  }

  /**
   * The projects this engine is holding — one per app driving it.
   *
   * Asked on the DEFAULT session, like every query here, and that is not an oversight: the
   * supervisor drives no project, and this is the one question whose answer is about the
   * others. Every other query in this class is engine-global for the same reason.
   */
  listSessions(): Promise<HostSession[] | null> {
    return this.run(async (client) => {
      const p = EngineQueries.reply<SessionInfo[]>(
        client,
        "sessions",
        SESSIONS_MS,
      );
      client.listSessions();
      return (await p).map((s) => ({
        id: s.id,
        project: s.project ?? "",
        loaded: !!s.loaded,
        playing: !!s.playing,
        tracks: Number(s.tracks ?? 0),
        listeners: Number(s.listeners ?? 0),
      }));
    });
  }

  /** Forget a session. Fire-and-forget: the sessions poll shows it gone within two seconds,
   *  and waiting for the ack would only make the menu feel slower than the truth. */
  dropSession(session: string): Promise<unknown> {
    return this.run(async (client) => {
      client.dropSession(session);
      return true;
    });
  }

  /** Open a plugin's native editor window. Fire-and-forget: the engine acknowledges by
   *  drawing the window, not over the wire. */
  showNativePluginUI(id: string): Promise<unknown> {
    return this.run(async (client) => {
      client.showNativePluginUI(id);
      return true;
    });
  }

  /**
   * Ask the engine to re-scan installed plugins.
   *
   * THE UNLINK IS NOT OPTIONAL. `ensurePluginsScanned` loads `~/.studio/exts.json`
   * when it exists and returns the stale list immediately — so without deleting it
   * first, "Rescan plugins" appears to work and changes nothing. The cache belongs to
   * the engine, not to the client, which is why this can't live in EngineControl.
   *
   * Fire-and-forget beyond that: the scan runs on a detached thread inside the engine
   * and the result arrives via the plugin-count poll.
   */
  rescanPlugins(): Promise<unknown> {
    try {
      rmSync(extsCachePath(), { force: true });
    } catch {
      // An unremovable cache means the rescan returns the stale list — say so, rather than silently doing nothing.
      line(
        "host",
        "could not delete exts.json — the rescan may return stale results",
      );
    }
    return this.run(async (client) => {
      client.rescanPlugins(true);
      return true;
    });
  }
}

function toHostDevice(d: AudioDeviceInfo): HostAudioDevice {
  return { name: d.name, deviceType: d.type ?? "", current: !!d.current };
}
