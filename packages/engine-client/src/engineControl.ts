// engineControl.ts — the WebSocket link to the C++ engine, minus the project: connect,
// send a command, emit the reply as an event. Nothing here knows what a song is, and that
// is the point — importing @studio/song in this file would silently pull ~3 MB of
// compiler into the supervisor's bundle. Outgoing messages buffer until the socket opens.

import { EventEmitter } from "node:events";
import type { TransportAction } from "@studio/engine-protocol";
import {
  decodeIoLevels,
  decodePluginScan,
  decodeState,
  Outbox,
  type PluginInfo,
  type PluginParamInfo,
  type PluginScanStatus,
} from "@studio/engine-protocol/decode";
import {
  DEFAULT_SESSION,
  forSession,
  type SessionId,
} from "@studio/engine-protocol/sessions";
import { ENGINE_OUTBOX_MAX, ENGINE_OUTBOX_TTL_MS } from "@studio/web-protocol";
import WebSocket from "ws";

// The wire shapes shared with the browser client live in @studio/engine-protocol, so the two can't drift.
export type { EngineState, TransportAction } from "@studio/engine-protocol";
export type {
  IoLevels,
  PluginInfo,
  PluginParamInfo,
  PluginScanStatus,
} from "@studio/engine-protocol/decode";

// A finished take, ready to become a clip. Position in SECONDS: the engine has no tempo map, so the brain converts.
export interface RecordedTake {
  track: string;
  file: string; // absolute path of the .wav
  start: number; // seconds
  length: number; // seconds
}

export interface AudioDeviceInfo {
  name: string;
  type: string; // the driver backend offering it ("ASIO", "Windows Audio", …)
  inputs: number; // input channel count
  outputs: number; // output channel count
  current: boolean; // the device currently open — its OUTPUT side
  currentInput: boolean; // the device the open setup takes its INPUTS from, which may be another one
  isDefault: boolean; // its backend's default device
}

/** One session the engine is holding — a project, not a connection; ENGINE-GLOBAL, so it is asked on the default session and never filtered. */
export interface SessionInfo {
  id: string;
  /** The loaded project's name; "" when the session holds nothing yet. */
  project: string;
  loaded: boolean;
  playing: boolean;
  tracks: number;
  /** How many sockets are subscribed to this session's audio. */
  listeners: number;
}

// One plugin INSTANCE in a loaded edit; the id is the PluginDoc id showNativePluginUI takes.
export interface EditPluginInfo {
  // Which project holds it: the reply covers every session, so the pair (session, id) is what addresses one instance.
  session?: string;
  id: string;
  name: string;
  // Only an external plugin draws its own window: offering it for a built-in would be offering nothing.
  hasNativePluginUI: boolean;
}

export class EngineControl extends EventEmitter {
  protected ws?: WebSocket;
  // Stamped, because what is queued is REPLAYED — the same queue as the browser client's.
  private outbox = new Outbox(ENGINE_OUTBOX_MAX, ENGINE_OUTBOX_TTL_MS);
  /** The engine's scan as last heard on this link; null until it has said, which an older engine never does. */
  pluginScan: PluginScanStatus | null = null;

  /** @param session which project this client drives; it must match what the app's BROWSER half passes — see `@studio/engine-protocol/docs/sessions.md`. */
  constructor(
    protected readonly url: string,
    protected readonly session: SessionId = DEFAULT_SESSION,
  ) {
    super();
  }

  connect(): void {
    // An upgrade never answered ends as an error and a close, which its owner reconnects on; nothing else would end it.
    const ws = new WebSocket(this.url, { handshakeTimeout: 10_000 });
    this.ws = ws;

    ws.on("open", () => {
      // Replay what is still worth replaying, oldest first, and drop the rest.
      for (const s of this.outbox.drain()) ws.send(s);
      this.emit("open");
    });
    ws.on("close", () => this.emit("close"));
    ws.on("error", (err) => this.emit("wserror", err));
    ws.on("message", (data) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      // Another project's news on a shared socket, dropped before the switch so a frame type that grows a session later is covered.
      if (!forSession(msg, this.session)) return;
      switch (msg.type) {
        case "state":
          this.emit("state", decodeState(msg));
          break;
        case "armed":
          this.emit("armed", {
            track: String(msg.track ?? ""),
            armed: !!msg.armed,
          });
          break;
        case "recorded":
          this.emit("recorded", {
            track: String(msg.track ?? ""),
            file: String(msg.file ?? ""),
            start: Number(msg.start ?? 0),
            length: Number(msg.length ?? 0),
          } satisfies RecordedTake);
          break;
        case "applied":
          this.emit("applied", (msg.changes ?? []) as string[]);
          break;
        case "flushed":
          this.emit("flushed");
          break;
        case "plugins":
          this.emit("plugins", (msg.plugins ?? []) as PluginInfo[]);
          break;
        // Where the engine's scan stands, kept as well as emitted: a gate asks it of a link opened mid-scan.
        case "plugin-scan": {
          const scan = decodePluginScan(msg);
          if (!scan) break;
          this.pluginScan = scan;
          this.emit("pluginScan", scan);
          break;
        }
        case "audio-devices":
          this.emit("audioDevices", (msg.devices ?? []) as AudioDeviceInfo[]);
          break;
        case "io-levels":
          this.emit("ioLevels", decodeIoLevels(msg));
          break;
        case "sessions":
          this.emit("sessions", (msg.sessions ?? []) as SessionInfo[]);
          break;
        case "edit-plugins":
          this.emit("editPlugins", (msg.plugins ?? []) as EditPluginInfo[]);
          break;
        // A plugin TYPE's whole list, under its own name because `plugin-params` below is an INSTANCE's values, and it rides its format and id back.
        case "plugin-param-list":
          this.emit("pluginParamList", {
            format: String(msg.format ?? ""),
            id: String(msg.id ?? ""),
            // Whether the plugin was LOADED at all, which an empty list cannot say — a machine to fix, or a fact about the plugin.
            found: msg.found !== false,
            params: (msg.params ?? []) as PluginParamInfo[],
          });
          break;
        // Whether the orphan window opened; its ABSENCE is the interesting state, so a caller treats a timeout as a failure to report.
        case "native-plugin-ui-opened":
          this.emit("nativePluginUiOpened", {
            format: String(msg.format ?? ""),
            id: String(msg.id ?? ""),
            ok: msg.ok === true,
          });
          break;
        // Whether a base was written; the path rides back for the same reason the list above carries its format and id.
        case "plugin-base-saved":
          this.emit("pluginBaseSaved", {
            format: String(msg.format ?? ""),
            id: String(msg.id ?? ""),
            path: String(msg.path ?? ""),
            ok: msg.ok === true,
          });
          break;
        case "plugin-params":
          this.emit("pluginParams", {
            id: String(msg.id ?? ""),
            params: (msg.params ?? {}) as Record<string, number>,
          });
          break;
        // The watch feed, on its OWN event: 'pluginParams' is the cue to PERSIST, and this fires while a knob is moving.
        case "plugin-params-live":
          this.emit("pluginParamsLive", {
            id: String(msg.id ?? ""),
            params: (msg.params ?? {}) as Record<string, number>,
          });
          break;
        case "error":
          this.emit("engineError", String(msg.message ?? "unknown error"));
          break;
      }
    });
  }

  protected send(obj: object): void {
    // The one choke point every verb goes through, omitted when default so the bytes stay identical to before sessions.
    const s = JSON.stringify(
      this.session ? { session: this.session, ...obj } : obj,
    );
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(s);
      return;
    }
    this.outbox.push(s); // flushed on 'open'
  }

  // Forget the song — plugins, editors, Edit, diff baseline — so the next send is built fresh; the engine keeps its device and scan cache.
  flush(): void {
    this.send({ type: "flush" });
  }

  transport(action: TransportAction): void {
    this.send({ type: "transport", action });
  }

  // Audition a sample over [start, start+length) seconds through a one-shot voice; `length` <= 0 means to the end of the file, capped by the engine at 30 s.
  preview(file: string, start: number, length: number): void {
    this.send({ type: "preview", file, start, length });
  }

  // Arm/disarm a track; omitting `armed` toggles, and the ENGINE resolves it, so two surfaces can't both read "off".
  arm(track: string, armed?: boolean): void {
    this.send({
      type: "arm",
      track,
      ...(armed === undefined ? {} : { armed }),
    });
  }

  // Whether rolling THIS session records its armed tracks; omitting `enabled` toggles, and it is per session like `arm`.
  setRecordEnabled(enabled?: boolean): void {
    this.send({
      type: "record-enable",
      ...(enabled === undefined ? {} : { enabled }),
    });
  }

  // Ask for the CACHED plugin list (no scanning); `filter` narrows by format substring. Replies with 'plugins'.
  listPlugins(filter?: string): void {
    this.send({ type: "list-plugins", ...(filter ? { filter } : {}) });
  }

  /** Ask where the engine's plugin scan stands; answered as 'pluginScan', and broadcast the same way while one runs. */
  askPluginScan(): void {
    this.send({ type: "plugin-scan" });
  }

  // Ask for an incremental scan and the fresh list; a genuinely forced rescan must DELETE the engine's own ~/.k7/exts.json first.
  rescanPlugins(force = false): void {
    this.send({ type: "rescan-plugins", ...(force ? { force: true } : {}) });
  }

  /** Every parameter an installed plugin TYPE has, by loading one and asking; SLOW, and `id` is the scan's `fileOrIdentifier`, not a display name. */
  listPluginParams(format: string, id: string): void {
    this.send({ type: "list-plugin-params", format, id });
  }

  /** …and that plugin's own window, on an ORPHAN instance in no project: nothing it is told is saved, and it opens on the ENGINE's screen. */
  showNativePluginUIOf(format: string, id: string): void {
    this.send({ type: "show-native-plugin-ui-of", format, id });
  }

  /** Keep what that orphan window holds, as a `.vstpreset` at `path` on the ENGINE's machine; `pluginBaseSaved` with `ok:false` left no file. */
  snapshotPluginBase(format: string, id: string, path: string): void {
    this.send({ type: "snapshot-plugin-base", format, id, path });
  }

  // Which plugin INSTANCES the engine's edits hold, unlike listPlugins' installed catalogue; engine-global, each row naming its session.
  listEditPlugins(): void {
    this.send({ type: "list-edit-plugins" });
  }

  // Open a plugin's native editor by PluginDoc id; `session` overrides this client's own, for a supervisor opening a foreign window.
  showNativePluginUI(id: string, session?: string): void {
    this.send({
      type: "show-native-plugin-ui",
      id,
      ...(session === undefined ? {} : { session }),
    });
  }

  // Follow a plugin's params live, off by default and per-plugin — each watch costs a read per frame, and the set is the engine's.
  watchPluginParams(id: string, on = true): void {
    this.send({ type: "watch-plugin-params", id, on });
  }

  // Every session this engine holds. Reply arrives as a 'sessions' event (SessionInfo[]).
  listSessions(): void {
    this.send({ type: "list-sessions" });
  }

  // Forget a session outright — its edit, plugins, meters and broadcast tap; the app driving it is not told.
  dropSession(session: string): void {
    this.send({ type: "drop-session", session });
  }

  // Ask the engine for the available audio interfaces. Reply arrives as an 'audioDevices' event (AudioDeviceInfo[]).
  listAudioDevices(): void {
    this.send({ type: "list-audio-devices" });
  }

  // Meter the INTERFACE — one peak (dB) per channel set plus the master out, replied as 'ioLevels'; it enables the devices it measures.
  ioLevels(channels: number[][]): void {
    this.send({ type: "io-levels", channels });
  }

  // Open a specific interface. Without `type` the engine takes the first backend offering that name — a coin toss.
  setAudioDevice(name: string, type?: string): void {
    this.send({
      type: "set-audio-device",
      name,
      ...(type ? { deviceType: type } : {}),
    });
  }

  // Group two interface inputs into one stereo device, or split them; `channel` is 1-based and names its PAIR, and the engine remembers neither.
  setInputStereo(channel: number, stereo: boolean): void {
    this.send({ type: "set-input-stereo", channel, stereo });
  }

  // Drop the connection: a long-lived surface reconnects on 'close', a one-shot CLI needs this to exit.
  close(): void {
    this.ws?.close();
    this.ws = undefined;
  }
}
