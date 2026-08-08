// engine.ts — the browser WebSocket link to the C++ engine: same protocol as the Node
// client, native browser WebSocket, transport + live state, auto-reconnecting. The URL is
// not fixed — the caller picks an engine and passes its probed ws address in. Wire shapes
// come from @studio/engine-protocol and are re-exported here.
//
// There is exactly ONE browser implementation of this contract, and this is it. The repo
// already ran the experiment of keeping two implementations of the engine contract in
// step; they diverged anyway. Any app that drives the engine from a browser uses this.

import type {
  EngineState,
  ParamMeta,
  PluginParams,
  PresetInfo,
  TransportAction,
  WaveformEnvelope,
} from "@studio/engine-protocol";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import {
  DEFAULT_SESSION,
  forSession,
  type SessionId,
} from "@studio/engine-protocol/sessions";
import {
  ENGINE_IDLE_PING_MS,
  ENGINE_OUTBOX_MAX,
  ENGINE_OUTBOX_TTL_MS,
  ENGINE_PONG_TIMEOUT_MS,
  ENGINE_RECONNECT_MAX_MS,
  ENGINE_RECONNECT_MIN_MS,
} from "@studio/web-protocol";

export type {
  EngineState,
  ParamMeta,
  PluginParams,
  PresetInfo,
  TransportAction,
  WaveformEnvelope,
} from "@studio/engine-protocol";

/**
 * Marks a stretch of work for a host that watches for stalls, returning its end callback.
 * The engine pushes state at frame rate and params at 20 Hz, so a handler that got slow
 * is invisible in a profile taken afterwards but obvious in a stall report — and whether
 * anyone is watching is the host's business, not this client's. Defaults to doing nothing.
 */
export type BeginActivity = (name: string) => () => void;
const noActivity: BeginActivity = () => () => {};

/**
 * Where to connect, asked again before every attempt.
 *
 * A constant string is accepted and was all this took for a long time. It is wrong for the
 * path that matters: away from the engine's own machine the only route is the relay, whose
 * URL carries a ticket good for one minute (packages/engine-registry/proxy.ts). Frozen at
 * construction, every reconnect after that minute replays a dead ticket and collects a 401,
 * for ever. A function is the caller's chance to fetch a fresh one — in practice, to re-probe.
 *
 * Returning null means "no engine to reach right now": the client backs off and asks again
 * rather than treating it as a failure to connect.
 */
export type EngineUrl = string | (() => string | null | Promise<string | null>);

// The control-query shapes, mirroring engineControl.ts in @studio/engine-client — which a
// browser cannot import (it opens `ws`). Both restate the same wire, which engine-protocol
// does not carry yet; if a third copy ever appears, move them there instead.
/** One session the engine holds — a project, not a connection. Engine-global. */
export interface EngineSessionInfo {
  id: string;
  project: string;
  loaded: boolean;
  playing: boolean;
  tracks: number;
  listeners: number;
}
export interface EngineAudioDevice {
  name: string;
  type: string; // the driver backend offering it ("ASIO", "Windows Audio", …)
  inputs: number;
  outputs: number;
  current: boolean;
  isDefault: boolean;
}
/** One plugin the engine's scan knows about — the installed catalogue, not an instance. */
export interface EnginePluginInfo {
  name: string;
  format: string;
  manufacturer: string;
  id: string;
}
// One plugin INSTANCE in a loaded edit; (session, id) addresses it — an id alone can name several.
export interface EngineEditPlugin {
  session?: string;
  id: string;
  name: string;
  hasNativePluginUI: boolean;
}

type StateCb = (s: EngineState) => void;
type ConnCb = (connected: boolean) => void;
type ParamsCb = (p: PluginParams) => void;
type PresetsCb = (module: string, presets: PresetInfo[]) => void;
type BusyCb = (busy: boolean) => void;
type SessionsCb = (sessions: EngineSessionInfo[]) => void;
type DevicesCb = (devices: EngineAudioDevice[]) => void;
type PluginListCb = (plugins: EnginePluginInfo[]) => void;
type EditPluginsCb = (plugins: EngineEditPlugin[]) => void;
/** An engine-side problem: `subject` is what it is about (a plugin id), "" when general. */
export interface EngineWarning {
  subject: string;
  message: string;
}
type WarningCb = (w: EngineWarning) => void;
/**
 * One wave input the engine can route a track FROM — how the interface groups its channels.
 *
 * `channels` is 1-based and is the set `findWaveInput` matches EXACTLY: a rig that pairs its
 * inputs has no device for channel 2 alone, so asking for it resolves to nothing and reads as
 * silence. Anything offering a choice of input has to offer these sets and not raw numbers.
 */
export interface EngineInputDevice {
  name: string;
  channels: number[];
  enabled: boolean;
}
/** Peak dB per channel set asked for, in order, plus the master output. See EngineClient.ioLevels. */
export interface IoLevels {
  inputs: number[];
  master: number;
  /** The tuner's reading per input, in the same order: Hz, or 0 when nothing convincing was heard. */
  pitches: number[];
  /** How periodic each window was, 0..1 — an uncertain note is shown faded rather than hidden. */
  clarity: number[];
  /** The interface's own grouping. The engine has ridden it along all this time and the browser
   *  was dropping it — it is the one thing that explains a channel that exists and meters nothing. */
  devices: EngineInputDevice[];
}
type IoLevelsCb = (l: IoLevels) => void;
/** One binary audio frame, exactly as it arrived. See @studio/engine-protocol/stream. */
type StreamCb = (frame: ArrayBuffer) => void;

// Every field any engine push carries. One shape rather than a union: the dispatch reads `type` first and the
// rest is optional anyway, and naming it is what lets the dispatch be a method the freeze watchdog can time.
interface EngineMessage {
  type?: string;
  session?: string; // which project the engine is talking about; absent = engine-global
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
  sessions?: EngineSessionInfo[]; // the 'sessions' reply
  // Two replies carry `devices`, and they are different things: the INTERFACES this machine
  // could open, and — on io-levels — how the open one groups its inputs. Told apart by `type`,
  // which the dispatch reads first, so one field is enough and a union would be ceremony.
  devices?: EngineAudioDevice[] | EngineInputDevice[];
  plugins?: unknown[]; // 'plugins' (catalogue) AND 'edit-plugins' (instances) both use this field
}

export class EngineClient {
  private ws?: WebSocket;
  // Held with the time it was queued: what covers a blink is worth replaying, what has been
  // waiting half a minute is a transport verb nobody is waiting for any more.
  private outbox: { at: number; s: string }[] = [];
  private stateCbs = new Set<StateCb>();
  private connCbs = new Set<ConnCb>();
  private paramsCbs = new Set<ParamsCb>();
  private liveParamsCbs = new Set<ParamsCb>();
  private presetsCbs = new Set<PresetsCb>();
  private busyCbs = new Set<BusyCb>();
  private warningCbs = new Set<WarningCb>();
  private ioLevelsCbs = new Set<IoLevelsCb>();
  private sessionsCbs = new Set<SessionsCb>();
  private devicesCbs = new Set<DevicesCb>();
  private pluginListCbs = new Set<PluginListCb>();
  private editPluginsCbs = new Set<EditPluginsCb>();
  // Raw audio frames, handed on undecoded: this client's job is to route bytes, and
  // @studio/engine-browser/stream is what knows how to read them.
  private streamCbs = new Set<StreamCb>();
  private broadcasting = false;
  // Plugins we asked to follow. The subscription lives in the ENGINE, so it is replayed on every open.
  private watched = new Set<string>();
  // Active waveform subscriptions, replayed on reconnect like `watched`. Keyed "id:side".
  private waveformSubs = new Map<string, { id: string; side: string }>();
  private closed = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  /**
   * Which attempt owns the client right now.
   *
   * Bumped by every `connect()`. A socket's handlers capture the value they were born under
   * and do nothing once it has moved on — because a socket the watchdog gave up on can still
   * fire `close` afterwards, and that late event would otherwise schedule a SECOND reconnect
   * beside the one already running. Two ladders, both doubling, is how a quiet retry becomes
   * a flood.
   */
  private gen = 0;
  /** Consecutive failures, for the backoff. Reset by a socket that actually opened. */
  private attempt = 0;
  /** When anything last arrived — the only honest evidence the link still carries. */
  private lastInbound = 0;
  /** When the idle `whoami` went out, or 0 when none is outstanding. */
  private pingSentAt = 0;
  private keepaliveTimer?: ReturnType<typeof setInterval>;
  /**
   * The document last handed to the engine, replayed on every open.
   *
   * The engine diffs against a baseline that survives a dropped socket, so re-sending is
   * cheap and correct. Without it, an engine that RESTARTED comes back empty and the surface
   * goes on driving it — the symptom being that Play does nothing, with nothing in any log to
   * connect it to a connection that blinked.
   */
  private lastProject?: ProjectDoc;

  /**
   * @param session which project on that engine this client drives. One engine hosts
   * several, so leaving it default puts this client in the same one as every other
   * client that did — which is the collision sessions exist to end. See
   * `@studio/engine-protocol/sessions`.
   */
  constructor(
    private readonly url: EngineUrl,
    private readonly beginActivity: BeginActivity = noActivity,
    private readonly session: SessionId = DEFAULT_SESSION,
  ) {}

  connect(): void {
    // A reconnect queued before dispose() must not resurrect the client — onclose's timer can still be pending.
    if (this.closed) return;
    const myGen = ++this.gen;
    void this.resolveUrl().then((url) => {
      // dispose(), or another connect(), landed while we were asking.
      if (this.closed || this.gen !== myGen) return;
      // No engine to reach yet. Not a failure — ask again, on the same ladder.
      if (!url) return this.retryLater(myGen);
      this.open(url, myGen);
    });
  }

  private async resolveUrl(): Promise<string | null> {
    if (typeof this.url === "string") return this.url;
    try {
      return await this.url();
    } catch {
      // The caller's lookup failed — indistinguishable, from here, from no engine.
      return null;
    }
  }

  private open(url: string, myGen: number): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      // A malformed URL throws synchronously; a dead one does not. Both are just "not now".
      this.retryLater(myGen);
      return;
    }
    // Audio frames arrive as binary on this same socket. Without this they would surface
    // as Blobs, which stringify to "[object Blob]" and die silently in the JSON parse.
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      if (this.gen !== myGen) return void ws.close();
      this.attempt = 0;
      this.lastInbound = Date.now();
      this.pingSentAt = 0;
      this.startKeepalive();
      // Say we DRIVE this session, before anything else. The engine counts drivers per session
      // and frees a project whose last one left — so a reconnect that did not re-declare would
      // have the engine let go of the very document the lines below are about to replay. It is a
      // field on hello rather than a verb of its own precisely so it cannot be forgotten: every
      // connection sends one, including this one. See engine/moteur/docs/sessions.md.
      this.sendNow({ type: "hello", role: "driver" });
      // The project FIRST: the subscriptions and the queue below are about a document, and a
      // restarted engine has none until this lands. Ordering is the whole of the fix.
      if (this.lastProject)
        this.sendNow({ type: "project", doc: this.lastProject });
      for (const id of this.watched)
        this.send({ type: "watch-plugin-params", id, on: true });
      for (const [, sub] of this.waveformSubs)
        this.send({
          type: "subscribe-waveform",
          id: sub.id,
          side: sub.side,
        });
      // The broadcast subscription lives in the ENGINE, so it is replayed like the others.
      if (this.broadcasting) this.send({ type: "broadcast", on: true });
      this.flushOutbox();
      this.emitConn(true);
    };
    ws.onclose = () => {
      if (this.gen !== myGen) return;
      this.down(myGen);
    };
    ws.onerror = () => {};
    ws.onmessage = (ev) => {
      if (this.gen !== myGen) return;
      // Anything at all proves the link carries. The engine's own 20 Hz state frame is what
      // usually does it, so a busy client never pings.
      this.lastInbound = Date.now();
      this.pingSentAt = 0;
      // Binary is audio, and never goes near the JSON path — it arrives at ~100 Hz and a
      // parse attempt per frame would be pure waste even though it would fail harmlessly.
      if (ev.data instanceof ArrayBuffer) {
        for (const cb of this.streamCbs) cb(ev.data);
        return;
      }
      let m: EngineMessage;
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      // Breadcrumb by message type, for whatever the host uses to spot a stall. See BeginActivity.
      const doneDispatch = this.beginActivity(`ws ${m.type ?? "?"}`);
      try {
        this.dispatch(m);
      } finally {
        doneDispatch();
      }
    };
  }

  /**
   * The link went down — once per attempt, whoever noticed first.
   *
   * `close` and the watchdog can both arrive for the same socket; the generation bump is what
   * makes the second one a no-op instead of a second reconnect ladder.
   */
  private down(myGen: number): void {
    if (this.gen !== myGen) return;
    this.gen++; // this attempt is over; late events from its socket are now ignored
    this.stopKeepalive();
    this.emitConn(false);
    if (!this.closed) this.retryLater(this.gen);
  }

  /**
   * Wait, then try again — doubling, jittered, capped.
   *
   * It used to be a flat second, for ever. A forgotten background tab on a machine whose
   * engine is off then knocks once a second for as long as the tab lives, and each knock
   * costs the backend a full sequential dial of every address the engine ever advertised.
   * The jitter is for the other half: several tabs dropped by one relay restart would
   * otherwise come back in lockstep.
   */
  private retryLater(myGen: number): void {
    if (this.closed || this.gen !== myGen) return;
    const step = Math.min(
      ENGINE_RECONNECT_MAX_MS,
      ENGINE_RECONNECT_MIN_MS * 2 ** this.attempt,
    );
    this.attempt++;
    const wait = step / 2 + Math.random() * (step / 2);
    this.reconnectTimer = setTimeout(() => {
      if (this.gen === myGen) this.connect();
    }, wait);
  }

  /**
   * Ask, when nothing has been said for a while.
   *
   * There is no ping in this protocol and none under it: the engine's server ships with
   * heartbeats disabled, so a wedged relay or a lapsed NAT leaves a socket that reports OPEN
   * and carries nothing. `whoami` is the probe — the one verb the engine answers whatever
   * state it is in, engine-global so it comes back even to a client driving no session.
   */
  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      const quiet = Date.now() - this.lastInbound;
      if (this.pingSentAt) {
        if (Date.now() - this.pingSentAt > ENGINE_PONG_TIMEOUT_MS) {
          // Open by its own account, and deaf. Drop it ourselves: waiting for a `close` that
          // is not coming is exactly the state this exists to end.
          const gen = this.gen;
          this.ws?.close();
          this.down(gen);
        }
        return;
      }
      if (quiet > ENGINE_IDLE_PING_MS) {
        this.pingSentAt = Date.now();
        this.sendNow({ type: "whoami" });
      }
    }, ENGINE_PONG_TIMEOUT_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = undefined;
    this.pingSentAt = 0;
  }

  /** Replay what is still worth replaying, oldest first, and drop the rest. */
  private flushOutbox(): void {
    const fresh = this.outbox.filter(
      (e) => Date.now() - e.at < ENGINE_OUTBOX_TTL_MS,
    );
    this.outbox = [];
    for (const e of fresh)
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(e.s);
  }

  private dispatch(m: EngineMessage): void {
    // Another project's news, on the socket we share with it. Dropped here rather than per
    // handler so a frame type that grows a session later is covered by construction.
    if (!forSession(m, this.session)) return;
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
          devices: (m.devices ?? []) as EngineInputDevice[],
        });
    else if (m.type === "sessions")
      for (const cb of this.sessionsCbs) cb(m.sessions ?? []);
    else if (m.type === "audio-devices")
      // `devices` is shared with io-levels, which sends a different shape; `type` is what tells
      // them apart, and this branch has already read it.
      for (const cb of this.devicesCbs)
        cb((m.devices ?? []) as EngineAudioDevice[]);
    else if (m.type === "plugins")
      for (const cb of this.pluginListCbs)
        cb((m.plugins ?? []) as EnginePluginInfo[]);
    else if (m.type === "edit-plugins")
      for (const cb of this.editPluginsCbs)
        cb((m.plugins ?? []) as EngineEditPlugin[]);
    else if (m.type === "engine-warning" || m.type === "error")
      for (const cb of this.warningCbs)
        cb({ subject: m.subject ?? "", message: m.message ?? "" });
  }

  dispose(): void {
    this.closed = true;
    this.gen++; // whatever is in flight stops belonging to anyone
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopKeepalive();
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
  // `session` overrides this client's own — a status surface opening a window in a project
  // it does not drive, the same override the Node client and dropSession take. The spread
  // wins over the stamp in send() because it comes after it.
  showNativePluginUI(id: string, session?: string): void {
    this.send({
      type: "show-native-plugin-ui",
      id,
      ...(session === undefined ? {} : { session }),
    });
  }
  // Ask a plugin's current values: the project records only OVERRIDDEN params, and defaults live in the engine.
  /**
   * Apply a project.
   *
   * l8 never calls this — its documents are COMPILED from a folder of YAML, which the
   * file service does, so the browser only ever drives transport. An app that builds a
   * document itself (a module preview, a deck) has nothing to compile and no reason to go
   * through a second process to reach a socket it already holds.
   *
   * Sent as given. The Node client folds groups onto members and strips video first; a
   * document from `@studio/engine-protocol/build` has neither, so both folds are identity
   * — fold before calling if yours might.
   */
  sendProject(doc: ProjectDoc): void {
    // Remembered, not just sent: an engine that restarted has no document, and the surface
    // has no reason to send this again — see `lastProject`.
    this.lastProject = doc;
    this.send({ type: "project", doc });
  }

  /**
   * Forget the loaded project entirely — plugins, edit and diff baseline — so the next one
   * is built from scratch rather than diffed against it.
   *
   * A real protocol verb the engine has always had, missing from this client until a
   * surface wanted to put a song DOWN: l8 switches projects and re-sends, which happens
   * to work, but z0's player ends a round and must leave nothing loaded.
   */
  flush(): void {
    this.send({ type: "flush" });
  }

  /**
   * Forget a whole SESSION — its edit, plugins, meters and broadcast tap — not just its project.
   *
   * `flush` above empties a session and leaves it behind; this removes it. The difference matters
   * because a session's key space is now (service × person), so an engine on a shared machine
   * accumulates one entry per person who has ever pointed at it and frees them only when the
   * process dies. Defaults to this client's own.
   */
  dropSession(session: string = this.session): void {
    this.send({ type: "drop-session", session });
  }

  // Every session this engine holds. Reply arrives on onSessions. Engine-global.
  listSessions(): void {
    this.send({ type: "list-sessions" });
  }
  // The available audio interfaces. Reply arrives on onAudioDevices.
  listAudioDevices(): void {
    this.send({ type: "list-audio-devices" });
  }
  // Open a specific interface. Without `type` the engine takes the first backend offering
  // that name — a coin toss. The engine answers a set with the same audio-devices frame.
  setAudioDevice(name: string, type?: string): void {
    this.send({
      type: "set-audio-device",
      name,
      ...(type ? { deviceType: type } : {}),
    });
  }
  // The CACHED plugin catalogue (no scanning). Reply arrives on onPlugins.
  listPlugins(): void {
    this.send({ type: "list-plugins" });
  }
  // An INCREMENTAL rescan — the engine's exts.json cache is on its machine, so the full
  // rescan (cache deleted first) stays with the supervisor. See engine-host/engineQueries.
  rescanPlugins(): void {
    this.send({ type: "rescan-plugins", force: true });
  }
  // The plugin instances across every session, each row naming its own. Reply on onEditPlugins.
  listEditPlugins(): void {
    this.send({ type: "list-edit-plugins" });
  }

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

  /**
   * Turn the master audio broadcast on or off for THIS connection.
   *
   * Idempotent and replayed across reconnects, like the waveform subscriptions. The engine
   * taps its master plugin list and pushes binary frames; nothing is sent to a connection
   * that never asked, because the stream is ~3 Mbit/s and a tray poll must not pay it.
   */
  broadcast(on: boolean): void {
    if (on === this.broadcasting) return;
    this.broadcasting = on;
    this.send({ type: "broadcast", on });
  }

  /** Raw audio frames. Decode with @studio/engine-browser/stream — see docs/streaming.md. */
  onStreamFrame(cb: StreamCb): () => void {
    this.streamCbs.add(cb);
    return () => this.streamCbs.delete(cb);
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

  onSessions(cb: SessionsCb): () => void {
    this.sessionsCbs.add(cb);
    return () => this.sessionsCbs.delete(cb);
  }
  onAudioDevices(cb: DevicesCb): () => void {
    this.devicesCbs.add(cb);
    return () => this.devicesCbs.delete(cb);
  }
  onPlugins(cb: PluginListCb): () => void {
    this.pluginListCbs.add(cb);
    return () => this.pluginListCbs.delete(cb);
  }
  onEditPlugins(cb: EditPluginsCb): () => void {
    this.editPluginsCbs.add(cb);
    return () => this.editPluginsCbs.delete(cb);
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

  private send(o: object): void {
    const s = this.frame(o);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(s);
      return;
    }
    this.outbox.push({ at: Date.now(), s });
    // Bounded, and the oldest goes: what is queued is a command, and the newest command is
    // the one that still describes what the person wants.
    if (this.outbox.length > ENGINE_OUTBOX_MAX) this.outbox.shift();
  }

  /** Send or drop — for what only means something on THIS socket, and must never be queued. */
  private sendNow(o: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(this.frame(o));
  }

  private frame(o: object): string {
    // Stamped at the ONE choke point every command already goes through: a verb added later
    // is addressed by construction, and forgetting it would silently drive someone else's
    // project. Omitted when default, so the bytes an old client sends stay byte-identical.
    return JSON.stringify(this.session ? { session: this.session, ...o } : o);
  }
  private emitState(s: EngineState): void {
    for (const cb of this.stateCbs) cb(s);
  }
  private emitConn(c: boolean): void {
    for (const cb of this.connCbs) cb(c);
  }
}
