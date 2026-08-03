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
import WebSocket from "ws";

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

export interface AudioDeviceInfo {
  name: string;
  type: string; // the driver backend offering it ("ASIO", "Windows Audio", …)
  inputs: number; // input channel count
  outputs: number; // output channel count
  current: boolean; // the device currently open
  isDefault: boolean; // its backend's default device
}

/**
 * One session the engine is holding — a project, not a connection.
 *
 * ENGINE-GLOBAL, unlike everything else here: it is the one question whose answer is about
 * the OTHER sessions, so it is asked on the default session and never filtered. A
 * supervisor listing them drives none of them.
 */
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

// One plugin INSTANCE in the loaded edit; the id is the PluginDoc id showNativePluginUI takes.
export interface EditPluginInfo {
  id: string;
  name: string;
  // Only an external plugin draws its own window: offering it for a built-in would be offering nothing.
  hasNativePluginUI: boolean;
}

export class EngineControl extends EventEmitter {
  protected ws?: WebSocket;
  private outbox: string[] = [];

  /**
   * @param session which project on that engine this client drives — see
   * `@studio/engine-protocol/sessions`. It must match what the app's BROWSER half passes:
   * here the file service compiles and sends the song, there the frontend drives its
   * transport, and two spellings would leave the frontend steering an empty project.
   */
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
      for (const m of this.outbox) ws.send(m);
      this.outbox = [];
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
      // Another project's news on a shared socket. Dropped before the switch, so a frame
      // type that grows a session later is covered without touching its case.
      if (!forSession(msg, this.session)) return;
      switch (msg.type) {
        case "state":
          this.emit("state", {
            playing: !!msg.playing,
            playhead: Number(msg.playhead ?? 0),
            levels: (msg.levels ?? []) as number[],
            inputLevels: (msg.inputLevels ?? []) as number[],
            armed: (msg.armed ?? []) as string[],
            recordEnabled: !!msg.recordEnabled,
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
    // The one choke point every verb goes through, so a command added later is addressed by
    // construction. Omitted when default: the bytes stay identical to before sessions.
    const s = JSON.stringify(
      this.session ? { session: this.session, ...obj } : obj,
    );
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(s);
    else this.outbox.push(s); // flushed on 'open'
  }

  // Ask the engine to forget the song — plugins, editors, Edit, diff baseline — so the next send is built fresh.
  // Sent when switching projects; the engine stays up, keeping its audio device and scan cache.
  flush(): void {
    this.send({ type: "flush" });
  }

  transport(action: TransportAction): void {
    this.send({ type: "transport", action });
  }

  // Audition a sample over [start, start+length) seconds through a one-shot voice, independent of the transport;
  // `length` <= 0 means the file's natural length. The file service resolves clip/slice requests before calling.
  preview(file: string, start: number, length: number): void {
    this.send({ type: "preview", file, start, length });
  }

  // Arm/disarm a track; omitting `armed` toggles, and the ENGINE resolves the toggle, so two surfaces can't both
  // read "off". Deliberately not part of sendProject: a reload must not silently disarm a track about to record.
  arm(track: string, armed?: boolean): void {
    this.send({
      type: "arm",
      track,
      ...(armed === undefined ? {} : { armed }),
    });
  }

  // Ask for the CACHED plugin list (no scanning); `filter` narrows by format substring. Replies with 'plugins'.
  listPlugins(filter?: string): void {
    this.send({ type: "list-plugins", ...(filter ? { filter } : {}) });
  }

  // Ask for an incremental scan and the fresh list. A genuinely forced rescan must DELETE ~/.studio/exts.json
  // first — that cache is the engine's, which is why the unlink lives in engine-host's engineQueries.
  rescanPlugins(force = false): void {
    this.send({ type: "rescan-plugins", ...(force ? { force: true } : {}) });
  }

  // Which plugin INSTANCES the loaded edit holds — what is in the SONG, unlike listPlugins' installed catalogue.
  listEditPlugins(): void {
    this.send({ type: "list-edit-plugins" });
  }

  // Open a plugin's native editor window by PluginDoc id; only external plugins have one.
  showNativePluginUI(id: string): void {
    this.send({ type: "show-native-plugin-ui", id });
  }

  // Follow a plugin's params live, which is what makes a knob turned in its OWN window visible here. Off by default
  // and per-plugin — each watch costs a read per frame — and the watch set is the engine's, shared by every client.
  watchPluginParams(id: string, on = true): void {
    this.send({ type: "watch-plugin-params", id, on });
  }

  // Every session this engine holds. Reply arrives as a 'sessions' event (SessionInfo[]).
  listSessions(): void {
    this.send({ type: "list-sessions" });
  }

  // Forget a session outright — its edit, plugins, meters and broadcast tap. The app driving
  // it is not told; it will simply find an empty project if it sends anything else.
  dropSession(session: string): void {
    this.send({ type: "drop-session", session });
  }

  // Ask the engine for the available audio interfaces. Reply arrives as an 'audioDevices' event (AudioDeviceInfo[]).
  listAudioDevices(): void {
    this.send({ type: "list-audio-devices" });
  }

  // Meter the INTERFACE: one peak (dB) per channel set, in order, plus the master output. Polled by the I/O
  // panel while it is open — it enables the input devices it measures, so nothing asks for it in the background.
  // Reply arrives as an 'ioLevels' event.
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

  // Drop the connection: a long-lived surface reconnects on 'close', a one-shot CLI needs this to exit.
  close(): void {
    this.ws?.close();
    this.ws = undefined;
  }
}
