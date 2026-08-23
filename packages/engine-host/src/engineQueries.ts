// engineQueries.ts — request/reply over ONE long-lived engine connection, replacing a
// fresh WebSocket per call. Each function pairs a send with a one-shot listener and a
// deadline, and every call is queued so exactly one is in flight (replies are typed by
// frame, not by request). Full rationale: docs/supervisorPolicy.md.

import { once } from "node:events";
import { rmSync } from "node:fs";
// engineCONTROL, not engineClient: the supervisor sends no project, and the full client would drag the song compiler in for nothing.
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

  /** Run `fn` with exclusive use of the connection; each link swallows the previous one's rejection, so one timeout cannot wedge the rest. */
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

  /** The audio interfaces the engine offers; NOTE the rename — it reports `type`, the tray's label reads `deviceType`. */
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

  /** Switch the engine to a named interface, resolving with the updated list — the engine answers a set with the same `audio-devices` frame. */
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

  /** How many plugins the engine knows about, from the ENGINE and not a cache file; null means "hasn't answered yet", which is the spinner. */
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

  /** The plugin INSTANCES across EVERY session, each naming its own; engine-global because this client drives no session of its own. */
  listEditPlugins(): Promise<HostEditPlugin[] | null> {
    return this.run(async (client) => {
      const p = EngineQueries.reply<EditPluginInfo[]>(
        client,
        "editPlugins",
        EDIT_PLUGINS_MS,
      );
      client.listEditPlugins();
      return (await p).map((e) => ({
        session: e.session ?? "",
        id: e.id,
        name: e.name ?? "",
        hasNativePluginUI: !!e.hasNativePluginUI,
      }));
    });
  }

  /** The projects this engine is holding, one per app driving it, asked on the DEFAULT session like every query here. */
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

  /** Forget a session, fire-and-forget: the sessions poll shows it gone within two seconds, and waiting for an ack only feels slower. */
  dropSession(session: string): Promise<unknown> {
    return this.run(async (client) => {
      client.dropSession(session);
      return true;
    });
  }

  /** Open a plugin's native editor window, fire-and-forget: the engine acknowledges by drawing it, not over the wire. */
  showNativePluginUI(id: string, session?: string): Promise<unknown> {
    return this.run(async (client) => {
      client.showNativePluginUI(id, session);
      return true;
    });
  }

  /** Ask the engine to re-scan installed plugins; THE UNLINK IS NOT OPTIONAL — with the cache in place the rescan returns the stale list. */
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
