// engineControl.ts — the WebSocket link to the C++ engine, minus the project: connect,
// send a command, emit the reply as an event. Nothing here knows what a song is, and that
// is the point — importing @studio/song in this file would silently pull ~3 MB of
// compiler into the supervisor's bundle. Outgoing messages buffer until the socket opens.

import { EventEmitter } from "node:events";
import type {
  EngineState,
  TransportAction,
  WaveformEnvelope,
} from "@studio/engine-protocol";
import {
  DEFAULT_SESSION,
  forSession,
  type SessionId,
} from "@studio/engine-protocol/sessions";
import { ENGINE_OUTBOX_MAX, ENGINE_OUTBOX_TTL_MS } from "@studio/web-protocol";
import WebSocket from "ws";
import { enginePathMap, mapFrame } from "./enginePaths";

// The wire shapes shared with the browser client live in @studio/engine-protocol, so the two can't drift.
export type { EngineState, TransportAction } from "@studio/engine-protocol";

// A finished take, ready to become a clip. Position in SECONDS: the engine has no tempo map, so the brain converts.
export interface RecordedTake {
  track: string;
  file: string; // absolute path of the .wav
  start: number; // seconds
  length: number; // seconds
}

export interface PluginInfo {
  name: string;
  format: string;
  manufacturer: string;
  instrument: boolean;
  role: "instrument" | "audioEffect" | "midiEffect";
  // What KIND of effect it is, lower case, '' when unknown — an external plugin reports whatever its vendor wrote.
  category?: string;
  id: string;
}

/** One parameter of an installed plugin TYPE, in `@studio/song`'s `BuiltinParam` shape so one panel generator reads both. */
export interface PluginParamInfo {
  name: string;
  min: number;
  max: number;
  def?: number;
  states?: { label: string; value: number }[];
}

export interface AudioDeviceInfo {
  name: string;
  type: string; // the driver backend offering it ("ASIO", "Windows Audio", …)
  inputs: number; // input channel count
  outputs: number; // output channel count
  current: boolean; // the device currently open
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
  // Stamped, because what is queued is REPLAYED — same bound and TTL as `engine-browser/src/engine.ts`, from the constants both read.
  private outbox: { at: number; s: string }[] = [];

  /** @param session which project this client drives; it must match what the app's BROWSER half passes — see `@studio/engine-protocol/docs/sessions.md`. */
  constructor(
    protected readonly url: string,
    protected readonly session: SessionId = DEFAULT_SESSION,
  ) {
    super();
  }

  connect(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on("open", () => {
      // Replay what is still worth replaying, oldest first, and drop the rest.
      const now = Date.now();
      const fresh = this.outbox.filter(
        (e) => now - e.at < ENGINE_OUTBOX_TTL_MS,
      );
      this.outbox = [];
      for (const e of fresh) ws.send(e.s);
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
      // Spelled back into our own path style, `state` excepted: it arrives at meter rate and carries no path.
      const pathMap = msg.type === "state" ? null : enginePathMap();
      if (pathMap) msg = mapFrame(msg, pathMap.back);
      switch (msg.type) {
        case "state":
          this.emit("state", {
            playing: !!msg.playing,
            playhead: Number(msg.playhead ?? 0),
            levels: (msg.levels ?? []) as number[],
            inputLevels: (msg.inputLevels ?? []) as number[],
            armed: (msg.armed ?? []) as string[],
            recordEnabled: !!msg.recordEnabled,
            // The master's peak and its overload latch: this client drives no meter, but it publishes the frame whole.
            master: Number(msg.master ?? -100),
            masterClipped: !!msg.masterClipped,
            // Empty unless a waveform tap is subscribed — the Node client has none, so in practice this stays {}.
            waveform: (msg.waveform ?? {}) as Record<
              string,
              WaveformEnvelope[]
            >,
          } satisfies EngineState);
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
        case "audio-devices":
          this.emit("audioDevices", (msg.devices ?? []) as AudioDeviceInfo[]);
          break;
        case "io-levels":
          this.emit("ioLevels", {
            inputs: (msg.inputs ?? []) as number[],
            master: Number(msg.master ?? -100),
          });
          break;
        case "sessions":
          this.emit("sessions", (msg.sessions ?? []) as SessionInfo[]);
          break;
        case "session-dropped":
          this.emit("sessionDropped", String(msg.session ?? ""));
          break;
        case "edit-plugins":
          this.emit("editPlugins", (msg.plugins ?? []) as EditPluginInfo[]);
          break;
        case "preset-saved":
          this.emit("presetSaved", {
            id: String(msg.id ?? ""),
            path: String(msg.path ?? ""),
          });
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
    const pathMap = enginePathMap();
    const s = JSON.stringify(
      this.session ? { session: this.session, ...obj } : obj,
      pathMap
        ? (_k, v) => (typeof v === "string" ? pathMap.out(v) : v)
        : undefined,
    );
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(s);
      return;
    }
    this.outbox.push({ at: Date.now(), s }); // flushed on 'open'
    // Bounded, and the oldest goes: this queue holds a blink, never a ten-minute backlog handed over at once.
    if (this.outbox.length > ENGINE_OUTBOX_MAX) this.outbox.shift();
  }

  // Forget the song — plugins, editors, Edit, diff baseline — so the next send is built fresh; the engine keeps its device and scan cache.
  flush(): void {
    this.send({ type: "flush" });
  }

  transport(action: TransportAction): void {
    this.send({ type: "transport", action });
  }

  // Audition a sample over [start, start+length) seconds through a one-shot voice; `length` <= 0 means the file's natural length.
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

  // Ask for an incremental scan and the fresh list; a genuinely forced rescan must DELETE the engine's own ~/.st0/exts.json first.
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
