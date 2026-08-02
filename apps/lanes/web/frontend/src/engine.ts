// engine.ts — the browser WebSocket link to the C++ engine: same protocol as the Node
// client, native browser WebSocket, transport + live state, auto-reconnecting. The URL is
// not fixed — the user picks an engine from the registry and its probed ws address is
// passed in. Wire shapes come from @lanes/engine-protocol and are re-exported here.

import type {
  EngineState,
  ParamMeta,
  PluginParams,
  TransportAction,
  WaveformEnvelope,
} from "@lanes/engine-protocol";
import { beginActivity } from "./freezeWatchdog";
import type { PresetInfo } from "./types";

export type {
  EngineState,
  ParamMeta,
  PluginParams,
  TransportAction,
  WaveformEnvelope,
} from "@lanes/engine-protocol";

type StateCb = (s: EngineState) => void;
type ConnCb = (connected: boolean) => void;
type ParamsCb = (p: PluginParams) => void;
type PresetsCb = (module: string, presets: PresetInfo[]) => void;
type BusyCb = (busy: boolean) => void;
/** An engine-side problem: `subject` is what it is about (a plugin id), "" when general. */
export interface EngineWarning {
  subject: string;
  message: string;
}
type WarningCb = (w: EngineWarning) => void;
/** Peak dB per channel set asked for, in order, plus the master output. See EngineClient.ioLevels. */
export interface IoLevels {
  inputs: number[];
  master: number;
  /** The tuner's reading per input, in the same order: Hz, or 0 when nothing convincing was heard. */
  pitches: number[];
  /** How periodic each window was, 0..1 — an uncertain note is shown faded rather than hidden. */
  clarity: number[];
}
type IoLevelsCb = (l: IoLevels) => void;

// Every field any engine push carries. One shape rather than a union: the dispatch reads `type` first and the
// rest is optional anyway, and naming it is what lets the dispatch be a method the freeze watchdog can time.
interface EngineMessage {
  type?: string;
  playing?: boolean;
  playhead?: number;
  levels?: number[];
  inputLevels?: number[];
  armed?: string[];
  recordEnabled?: boolean;
  waveform?: Record<string, WaveformEnvelope[]>;
  id?: string;
  params?: Record<string, number>;
  module?: string;
  presets?: PresetInfo[];
  meta?: Record<string, ParamMeta>;
  busy?: boolean;
  subject?: string;
  message?: string;
  inputs?: number[]; // io-levels: one peak per channel set asked for
  master?: number; // …and the level leaving the master
  pitches?: number[]; // …the tuner's Hz per input (0 = no confident note)
  clarity?: number[]; // …and how periodic each window was
}

export class EngineClient {
  private ws?: WebSocket;
  private outbox: string[] = [];
  private stateCbs = new Set<StateCb>();
  private connCbs = new Set<ConnCb>();
  private paramsCbs = new Set<ParamsCb>();
  private liveParamsCbs = new Set<ParamsCb>();
  private presetsCbs = new Set<PresetsCb>();
  private busyCbs = new Set<BusyCb>();
  private warningCbs = new Set<WarningCb>();
  private ioLevelsCbs = new Set<IoLevelsCb>();
  // Plugins we asked to follow. The subscription lives in the ENGINE, so it is replayed on every open.
  private watched = new Set<string>();
  // Active waveform subscriptions, replayed on reconnect like `watched`. Keyed "id:side".
  private waveformSubs = new Map<string, { id: string; side: string }>();
  private closed = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly url: string) {}

  connect(): void {
    // A reconnect queued before dispose() must not resurrect the client — onclose's timer can still be pending.
    if (this.closed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      for (const m of this.outbox) ws.send(m);
      this.outbox = [];
      for (const id of this.watched)
        this.send({ type: "watch-plugin-params", id, on: true });
      for (const [, sub] of this.waveformSubs)
        this.send({
          type: "subscribe-waveform",
          id: sub.id,
          side: sub.side,
        });
      this.emitConn(true);
    };
    ws.onclose = () => {
      this.emitConn(false);
      if (!this.closed)
        this.reconnectTimer = setTimeout(() => this.connect(), 1000); // retry
    };
    ws.onerror = () => {};
    ws.onmessage = (ev) => {
      let m: EngineMessage;
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      // Breadcrumb by message type: the engine pushes state at frame rate and params at 20 Hz, so a handler that
      // got slow is invisible in a profile taken after the fact but obvious in a stall report. See freezeWatchdog.
      const doneDispatch = beginActivity(`ws ${m.type ?? "?"}`);
      try {
        this.dispatch(m);
      } finally {
        doneDispatch();
      }
    };
  }

  private dispatch(m: EngineMessage): void {
    if (m.type === "state")
      this.emitState({
        playing: !!m.playing,
        playhead: Number(m.playhead ?? 0),
        levels: (m.levels ?? []) as number[],
        inputLevels: (m.inputLevels ?? []) as number[],
        armed: (m.armed ?? []) as string[],
        recordEnabled: !!m.recordEnabled,
        waveform: (m.waveform ?? {}) as Record<string, WaveformEnvelope[]>,
      });
    else if (m.type === "plugin-params" && m.id)
      for (const cb of this.paramsCbs)
        cb({ id: m.id, params: m.params ?? {}, meta: m.meta ?? undefined });
    else if (m.type === "plugin-params-live" && m.id)
      for (const cb of this.liveParamsCbs)
        cb({ id: m.id, params: m.params ?? {} });
    else if (m.type === "presets" && m.module)
      for (const cb of this.presetsCbs) cb(m.module, m.presets ?? []);
    else if (m.type === "busy") for (const cb of this.busyCbs) cb(!!m.busy);
    // Both kinds of engine-side trouble. `error` was being DROPPED here: the engine has
    // broadcast it all along and nothing in the browser listened, so a refused command
    // or an unknown message vanished without trace.
    else if (m.type === "io-levels")
      for (const cb of this.ioLevelsCbs)
        cb({
          inputs: (m.inputs ?? []) as number[],
          master: Number(m.master ?? -100),
          pitches: (m.pitches ?? []) as number[],
          clarity: (m.clarity ?? []) as number[],
        });
    else if (m.type === "engine-warning" || m.type === "error")
      for (const cb of this.warningCbs)
        cb({ subject: m.subject ?? "", message: m.message ?? "" });
  }

  dispose(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  transport(action: TransportAction): void {
    this.send({ type: "transport", action });
  }
  // Global record enable, held by the engine and echoed in the state frame, so every surface shows one light.
  setRecordEnabled(on: boolean): void {
    this.send({ type: "record-enable", enabled: on });
  }
  // Scrub the playhead to an absolute position (seconds) — the minimap's click-to-seek.
  seek(seconds: number): void {
    this.send({
      type: "transport",
      action: "seek",
      position: Math.max(0, seconds),
    });
  }
  // The transport loop [start, end) in seconds; the engine wraps playback and starts play from the loop top.
  loop(start: number, end: number, enabled: boolean): void {
    this.send({
      type: "transport",
      action: "loop",
      start: Math.max(0, start),
      end: Math.max(0, end),
      enabled,
    });
  }
  showNativePluginUI(id: string): void {
    this.send({ type: "show-native-plugin-ui", id });
  }
  // Ask a plugin's current values: the project records only OVERRIDDEN params, and defaults live in the engine.
  getPluginParams(id: string): void {
    this.send({ type: "get-plugin-params", id });
  }
  // Follow a plugin's values live, so a knob turned in its own native window moves the widget here too.
  // Idempotent and replayed across reconnects; unwatch what scrolls away — each watch costs a read per frame.
  watchPluginParams(id: string, on = true): void {
    if (on === this.watched.has(id)) return;
    if (on) this.watched.add(id);
    else this.watched.delete(id);
    this.send({ type: "watch-plugin-params", id, on });
  }
  // Set one parameter live WITHOUT persisting — the drag path. Nothing is echoed back, which would fight the drag.
  setPluginParam(id: string, name: string, value: number): void {
    this.send({ type: "set-plugin-param", id, name, value });
  }
  // Ask what presets a module's plugin offers; the answer arrives on onPresets. Empty for a built-in.
  listPresets(module: string): void {
    this.send({ type: "list-presets", module });
  }
  // Apply a preset and persist it to the module's .vstpreset: `sel.path` picks a file, else `sel.index` a program.
  setPreset(module: string, sel: { index?: number; path?: string }): void {
    this.send({
      type: "set-preset",
      module,
      index: sel.index ?? -1,
      path: sel.path ?? "",
    });
  }

  // Subscribe to a module's waveform: the engine taps the chain and broadcasts envelope points at 20 Hz.
  // No track index: the engine finds the plugin by id and the track from the plugin. One used to be required,
  // and since the graph has none to give, this sent 0 — which an engine older than that change still honours,
  // metering the song's FIRST track. Omitting it makes such an engine refuse the subscription instead.
  subscribeWaveform(id: string, side: "input" | "output"): void {
    const key = `${id}:${side}`;
    if (this.waveformSubs.has(key)) return;
    this.waveformSubs.set(key, { id, side });
    this.send({ type: "subscribe-waveform", id, side });
  }
  unsubscribeWaveform(id: string, side: "input" | "output"): void {
    const key = `${id}:${side}`;
    if (!this.waveformSubs.has(key)) return;
    this.waveformSubs.delete(key);
    this.send({ type: "unsubscribe-waveform", id, side });
  }

  onState(cb: StateCb): () => void {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }
  // The engine is applying a project and answers nothing meanwhile, so a surface must refuse to queue a Play.
  // A disconnect leaves this stuck true — the caller clears it on the connection callback.
  onBusy(cb: BusyCb): () => void {
    this.busyCbs.add(cb);
    return () => this.busyCbs.delete(cb);
  }

  // Problems the engine hit — a plugin it could not create, a model it refused. These
  // used to exist only on its stderr, which nothing reads when the tray ADOPTS an engine
  // rather than spawning it; a plugin silently doing nothing looked exactly like one that
  // worked. Surfaces should show these.
  onWarning(cb: WarningCb): () => void {
    this.warningCbs.add(cb);
    return () => this.warningCbs.delete(cb);
  }

  // Meter the INTERFACE — one peak per channel set, plus the master out. Request/reply rather than a state-frame
  // field: it enables the input devices it measures, so it is asked for only while the I/O panel is on screen.
  ioLevels(channels: number[][]): void {
    this.send({ type: "io-levels", channels });
  }
  onIoLevels(cb: IoLevelsCb): () => void {
    this.ioLevelsCbs.add(cb);
    return () => this.ioLevelsCbs.delete(cb);
  }

  onPluginParams(cb: ParamsCb): () => void {
    this.paramsCbs.add(cb);
    return () => this.paramsCbs.delete(cb);
  }
  // The watch feed: same payload as onPluginParams, but a separate channel because this one fires mid-gesture.
  onPluginParamsLive(cb: ParamsCb): () => void {
    this.liveParamsCbs.add(cb);
    return () => this.liveParamsCbs.delete(cb);
  }
  onPresets(cb: PresetsCb): () => void {
    this.presetsCbs.add(cb);
    return () => this.presetsCbs.delete(cb);
  }
  onConnected(cb: ConnCb): () => void {
    this.connCbs.add(cb);
    return () => this.connCbs.delete(cb);
  }

  private send(o: unknown): void {
    const s = JSON.stringify(o);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(s);
    else this.outbox.push(s);
  }
  private emitState(s: EngineState): void {
    for (const cb of this.stateCbs) cb(s);
  }
  private emitConn(c: boolean): void {
    for (const cb of this.connCbs) cb(c);
  }
}
