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

/**
 * One parameter of an installed plugin TYPE — its name, what it spans, its named settings.
 *
 * The same three facts `@studio/song`'s `BuiltinParam` and the browser client's
 * `EnginePluginParam` carry, in the same shape and for the same reason: one panel generator
 * reads all three, and a second spelling would mean a second generator.
 */
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

// One plugin INSTANCE in a loaded edit; the id is the PluginDoc id showNativePluginUI takes.
export interface EditPluginInfo {
  // Which project holds it. The reply is engine-global and covers every session, so the pair
  // (session, id) is what addresses one instance — an id alone can name several.
  session?: string;
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
        // A plugin TYPE's whole list, on its own event and under its own name — `plugin-params`
        // below is a loaded INSTANCE's current values, a name → number map. Sharing either would
        // feed a list into the path that reads it as a map.
        //
        // The format and the id ride back with the answer, because the ask takes seconds and a
        // caller may have asked about another plugin meanwhile. Matching on them is what stops a
        // late reply from answering the wrong question.
        case "plugin-param-list":
          this.emit("pluginParamList", {
            format: String(msg.format ?? ""),
            id: String(msg.id ?? ""),
            // Whether the plugin was LOADED at all, which an empty list cannot say — and on this
            // machine twenty-seven refuse to, which read as twenty-seven plugins publishing
            // nothing until the engine started asking. One is a licence to go and fix, the other
            // is a fact about the plugin; only the flag tells a caller which it has.
            found: msg.found !== false,
            params: (msg.params ?? []) as PluginParamInfo[],
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

  // Whether rolling THIS session records its armed tracks; omitting `enabled` toggles, and the
  // ENGINE resolves the toggle so two surfaces can't both read "off". Per session, like `arm` —
  // it was a process-global for a while, which made a deck's record light l8's as well.
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

  // Ask for an incremental scan and the fresh list. A genuinely forced rescan must DELETE ~/.studio/exts.json
  // first — that cache is the engine's, which is why the unlink lives in engine-host's engineQueries.
  rescanPlugins(force = false): void {
    this.send({ type: "rescan-plugins", ...(force ? { force: true } : {}) });
  }

  /**
   * Every parameter an installed plugin TYPE has, by loading one and asking. Replies with a
   * 'pluginParamList' event carrying the format and id back.
   *
   * SLOW — seconds, for a plugin whose binary has to be loaded and constructed — because that
   * is the only way to learn them: a plugin registers its parameters in its constructor, and
   * the scan cache carries a name, a format and a path and nothing else. The engine answers on
   * a thread of its own, on an offline engine that opens no device, so asking does not disturb
   * whatever is playing.
   *
   * `id` is the scan's `fileOrIdentifier` — the binary, not the display name. Two plugins can
   * share a name; only the path resolves to one.
   */
  listPluginParams(format: string, id: string): void {
    this.send({ type: "list-plugin-params", format, id });
  }

  /**
   * …and that plugin's own window, on an ORPHAN instance in no project.
   *
   * Same binary and the same seconds as the list above, for the other half of the same question:
   * what a parameter is called, and what the plugin looks like when you turn it. The instance
   * lives on the engine's offline edit, on no track and no session, and NOTHING it is told is
   * saved — it is somewhere to look at a plugin, never somewhere to set one.
   *
   * The window opens on the ENGINE's screen. There is no reply, and there is nothing useful one
   * could say: a caller elsewhere on the network has told a musician's machine to show a window.
   */
  showNativePluginUIOf(format: string, id: string): void {
    this.send({ type: "show-native-plugin-ui-of", format, id });
  }

  // Which plugin INSTANCES the engine's edits hold — what is in the SONGS, unlike listPlugins'
  // installed catalogue. Engine-global: it answers for every session, each row naming its own.
  listEditPlugins(): void {
    this.send({ type: "list-edit-plugins" });
  }

  // Open a plugin's native editor window by PluginDoc id; only external plugins have one.
  // `session` overrides this client's own, for a supervisor opening a window in a project it
  // does not drive — the same override dropSession takes.
  showNativePluginUI(id: string, session?: string): void {
    this.send({
      type: "show-native-plugin-ui",
      id,
      ...(session === undefined ? {} : { session }),
    });
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

  // Group two interface inputs into one stereo device, or split them apart. `channel` is 1-based and names its
  // PAIR: the interface pairs even/odd hardware channels, so either half says the same thing. Nothing comes back —
  // the device layout rides on `ioLevels`. Sent here to REPLAY what preferences remember, on every connect, for
  // the same reason setAudioDevice is: the engine keeps no memory of either.
  setInputStereo(channel: number, stereo: boolean): void {
    this.send({ type: "set-input-stereo", channel, stereo });
  }

  // Drop the connection: a long-lived surface reconnects on 'close', a one-shot CLI needs this to exit.
  close(): void {
    this.ws?.close();
    this.ws = undefined;
  }
}
