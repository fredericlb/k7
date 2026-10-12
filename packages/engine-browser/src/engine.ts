// engine.ts — the browser WebSocket link to the C++ engine: same protocol as the Node
// client, native browser WebSocket, transport + live state, auto-reconnecting. The URL is
// not fixed — the caller picks an engine and passes its probed ws address in. Wire shapes
// come from @studio/engine-protocol and are re-exported here.
//
// There is exactly ONE browser implementation of this contract, and this is it. The repo
// already ran the experiment of keeping two implementations of the engine contract in
// step; they diverged anyway. Any app that drives the engine from a browser uses this.

import type {
  EngineLoad,
  EngineState,
  ParamMeta,
  PluginParams,
  PresetInfo,
  RecorderState,
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
  ENGINE_CONNECT_DEADLINE_MS,
  ENGINE_IDLE_PING_MS,
  ENGINE_OUTBOX_MAX,
  ENGINE_OUTBOX_TTL_MS,
  ENGINE_PONG_TIMEOUT_MS,
  ENGINE_RECONNECT_MAX_MS,
  ENGINE_RECONNECT_MIN_MS,
} from "@studio/web-protocol";
import { pairFrameFor } from "./pairing.ts";
import { openSocket } from "./rtcSocket.ts";

export type {
  EngineLoad,
  EngineState,
  ParamMeta,
  PluginLoad,
  PluginParams,
  PresetInfo,
  RecorderState,
  TransportAction,
  WaveformEnvelope,
} from "@studio/engine-protocol";

/** Marks a stretch of work for a host that watches for stalls, returning its end callback — see docs/reliability.md. */
export type BeginActivity = (name: string) => () => void;
const noActivity: BeginActivity = () => () => {};

/** Add up work by name, for a host that watches for stalls — see apps/st0/frontend/docs/shell.md. */
export type Tally = (name: string, ms: number, bytes?: number) => void;
const noTally: Tally = () => {};

/** Where to connect, asked again before every attempt; null means "none right now" — see docs/reliability.md. */
export type EngineUrl = string | (() => string | null | Promise<string | null>);

// The control-query shapes, mirroring engineControl.ts in @studio/engine-client, which a browser cannot import (it opens `ws`).

/** One plugin the engine's scan knows about — the installed catalogue, not an instance. */
export interface EnginePluginInfo {
  name: string;
  format: string;
  manufacturer: string;
  id: string;
}

type StateCb = (s: EngineState) => void;
type ConnCb = (connected: boolean) => void;
type ParamsCb = (p: PluginParams) => void;
type PresetsCb = (module: string, presets: PresetInfo[]) => void;
type BusyCb = (busy: boolean) => void;
type PluginListCb = (plugins: EnginePluginInfo[]) => void;
/** One parameter of an installed plugin TYPE, in `@studio/song`'s `BuiltinParam` shape so one panel generator serves both. */
export interface EnginePluginParam {
  name: string;
  min: number;
  max: number;
  def?: number;
  states?: { label: string; value: number }[];
}
type PluginParamListCb = (p: {
  format: string;
  id: string;
  params: EnginePluginParam[];
}) => void;
/** Per `@instruments/…` ref asked about: whether it is on the engine's machine — engine docs/protocol.md. */
export type InstrumentStatusCb = (status: Record<string, boolean>) => void;
/** An engine-side problem: `subject` is what it is about (a plugin id), "" when general. */
export interface EngineWarning {
  subject: string;
  message: string;
  /** An `error` reply's machine-readable reason, e.g. "unpaired" or "local-only" — docs/pairing.md. */
  code?: string;
}
type WarningCb = (w: EngineWarning) => void;
/** One wave input the engine can route a track FROM; `channels` is 1-based and matched EXACTLY — see docs/meters.md. */
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
  /** The interface's own grouping — the one thing that explains a channel that exists and meters nothing. */
  devices: EngineInputDevice[];
}
type IoLevelsCb = (l: IoLevels) => void;
/** A LAN device waiting for the musician, as the engine lists them to the machine's own clients — docs/pairing.md. */
export interface PairRequest {
  requestId: string;
  name: string;
  ip: string;
  /** What the device shows; the musician checks the two match before approving. */
  code: string;
  since: number;
}
/** A device paired with this engine; its key never leaves the engine again after the approval. */
export interface PairedDevice {
  deviceId: string;
  name: string;
  created: number;
  lastSeen: number;
}
/** One binary audio frame, exactly as it arrived. See @studio/engine-protocol/stream. */
type StreamCb = (frame: ArrayBuffer) => void;

// Every field any engine push carries, as one shape rather than a union: the dispatch reads `type` first and the rest is optional.
interface EngineMessage {
  type?: string;
  session?: string; // which project the engine is talking about; absent = engine-global
  playing?: boolean;
  playhead?: number;
  loop?: { on?: boolean; start?: number; end?: number }; // `state` only: the transport loop, in seconds
  levels?: number[];
  // `master` is the same number on `state` and on `io-levels`, so it is declared once, below, with io-levels' own fields.
  masterClipped?: boolean; // …`state` only: did it overload since the last frame
  inputLevels?: number[];
  armed?: string[];
  recordEnabled?: boolean;
  waveform?: Record<string, WaveformEnvelope[]>;
  platters?: Record<string, number>; // `state` only: each platter's own needle — docs/turntable.md
  // …and `state` only too: each recorder node's light, takes and envelope — docs/recorder.md.
  recorders?: Record<string, RecorderState>;
  load?: EngineLoad; // `state` only, one frame in four — engine docs/load.md
  id?: string;
  // Two replies carry `params`, told apart by `type`: `plugin-param-list` (a TYPE's list) is an array, the live feeds are name -> value.
  params?: Record<string, number> | EnginePluginParam[];
  module?: string;
  presets?: PresetInfo[];
  status?: Record<string, boolean>; // `instrument-status` only
  meta?: Record<string, ParamMeta>;
  busy?: boolean;
  subject?: string;
  message?: string;
  code?: string; // `error` only: why it was refused
  inputs?: number[]; // io-levels: one peak per channel set asked for
  master?: number; // …and the level leaving the master — see the note beside `levels`
  pitches?: number[]; // …the tuner's Hz per input (0 = no confident note)
  clarity?: number[]; // …and how periodic each window was
  devices?: EngineInputDevice[]; // io-levels: how the open interface groups its inputs
  plugins?: unknown[]; // 'plugins': the catalogue
  // 'plugin-params': which plugin was asked about, echoed back beside the `id` above so a late reply can be matched.
  format?: string;
  boot?: string; // 'whoami': the engine PROCESS, so a reconnect can tell a restarted engine
  requests?: PairRequest[]; // 'pair-requests', to the machine's own clients only
}

/** What lets a sound go: a note-off, a note-on at velocity 0, a sustain pedal released, all notes off. */
export function endsANote(data: readonly number[]): boolean {
  const kind = (data[0] ?? 0) & 0xf0;
  const [, a = 0, b = 0] = data;
  if (kind === 0x80) return true;
  if (kind === 0x90) return b === 0;
  if (kind === 0xb0) return (a === 64 && b < 64) || a === 120 || a === 123;
  return false;
}

export class EngineClient {
  private ws?: WebSocket;
  // Held with the time it was queued, so a stale transport verb is dropped rather than replayed — see docs/reliability.md.
  private outbox: { at: number; s: string }[] = [];
  private stateCbs = new Set<StateCb>();
  private connCbs = new Set<ConnCb>();
  private paramsCbs = new Set<ParamsCb>();
  private liveParamsCbs = new Set<ParamsCb>();
  private presetsCbs = new Set<PresetsCb>();
  private busyCbs = new Set<BusyCb>();
  private warningCbs = new Set<WarningCb>();
  private restartCbs = new Set<() => void>();
  private pairRequestsCbs = new Set<(r: PairRequest[]) => void>();
  private pairedDevicesCbs = new Set<(d: PairedDevice[]) => void>();
  /** The engine PROCESS last met on this link, from `whoami`; another one after a reconnect is a restart. */
  private boot: string | null = null;
  private ioLevelsCbs = new Set<IoLevelsCb>();
  private pluginListCbs = new Set<PluginListCb>();
  private pluginParamListCbs = new Set<PluginParamListCb>();
  private instrumentStatusCbs = new Set<InstrumentStatusCb>();
  // Raw audio frames, handed on undecoded — @studio/engine-browser/stream is what knows how to read them.
  private streamCbs = new Set<StreamCb>();
  private broadcasting = false;
  // Plugins we asked to follow, replayed on every open, and COUNTED: the graph leaving must not silence the mastering strip's.
  private watched = new Map<string, number>();
  // Active waveform subscriptions, replayed on reconnect like `watched`. Keyed "id:side", COUNTED: two widgets may share a tap.
  private waveformSubs = new Map<
    string,
    { id: string; side: string; count: number }
  >();
  private closed = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  /** Which attempt owns the client, bumped by every `connect()` so a late event schedules no second ladder — see docs/reliability.md. */
  private gen = 0;
  /** Consecutive failures, for the backoff. Reset by a socket that actually opened. */
  private attempt = 0;
  /** When anything last arrived — the only honest evidence the link still carries. */
  private lastInbound = 0;
  /** When the idle `whoami` went out, or 0 when none is outstanding. */
  private pingSentAt = 0;
  private keepaliveTimer?: ReturnType<typeof setInterval>;
  /** The document last handed to the engine, replayed on every open — see docs/reliability.md. */
  private lastProject?: ProjectDoc;

  /** @param session which project on that engine this client drives — see `@studio/engine-protocol/docs/sessions.md`. */
  constructor(
    private readonly url: EngineUrl,
    private readonly beginActivity: BeginActivity = noActivity,
    private readonly session: SessionId = DEFAULT_SESSION,
    private readonly tally: Tally = noTally,
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // A lookup that never answers is no engine too: without a deadline the ladder would stop here for good.
      return await Promise.race([
        this.url(),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), ENGINE_CONNECT_DEADLINE_MS);
        }),
      ]);
    } catch {
      // The caller's lookup failed — indistinguishable, from here, from no engine.
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private open(url: string, myGen: number): void {
    let ws: WebSocket;
    try {
      ws = openSocket(url);
    } catch {
      // A malformed URL throws synchronously; a dead one does not. Both are just "not now".
      this.retryLater(myGen);
      return;
    }
    // Audio frames arrive as binary here; without this they surface as Blobs and die silently in the JSON parse.
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    // A dial that neither opens nor closes — a half-open path after a sleep — is ended here, so the ladder runs again.
    const deadline = setTimeout(() => {
      if (this.gen !== myGen || ws.readyState !== WebSocket.CONNECTING) return;
      try {
        ws.close();
      } catch {
        // Closing a socket that never opened may throw; it is being abandoned either way.
      }
      this.down(myGen);
    }, ENGINE_CONNECT_DEADLINE_MS);
    ws.onopen = () => {
      clearTimeout(deadline);
      if (this.gen !== myGen) return void ws.close();
      this.attempt = 0;
      this.lastInbound = Date.now();
      this.pingSentAt = 0;
      this.startKeepalive();
      // The device's key before anything: over the LAN the engine answers nothing else until it sees one (docs/pairing.md).
      const pair = pairFrameFor(url);
      if (pair) ws.send(pair);
      // Say we DRIVE this session first: the engine frees a project whose last driver left — see engine/st0-engine/docs/sessions.md.
      this.sendNow({ type: "hello", role: "driver" });
      // The project FIRST: the subscriptions and the queue below are about a document a restarted engine does not have yet.
      if (this.lastProject)
        this.sendNow({ type: "project", doc: this.lastProject });
      for (const id of this.watched.keys())
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
      clearTimeout(deadline);
      if (this.gen !== myGen) return;
      this.down(myGen);
    };
    // `onclose` owns the retry, but this logs: it is the only place a refused dial says anything at all.
    ws.onerror = () => {
      if (this.gen === myGen) console.warn(`engine socket error: ${url}`);
    };
    ws.onmessage = (ev) => {
      if (this.gen !== myGen) return;
      // Anything at all proves the link carries, and the engine's own 20 Hz state frame usually does it.
      this.lastInbound = Date.now();
      this.pingSentAt = 0;
      // Binary is audio and never goes near the JSON path — it arrives at ~100 Hz.
      if (ev.data instanceof ArrayBuffer) {
        for (const cb of this.streamCbs) cb(ev.data);
        return;
      }
      // The clock starts BEFORE the parse: the type is not known until after it, so a span cannot
      // open there — which left the parse of a large frame attributed to nothing at all.
      const began = performance.now();
      const text = String(ev.data);
      let m: EngineMessage;
      try {
        m = JSON.parse(text);
      } catch {
        this.tally("ws <unparseable>", performance.now() - began, text.length);
        return;
      }
      // Breadcrumb by message type, for whatever the host uses to spot a stall. See BeginActivity.
      const doneDispatch = this.beginActivity(`ws ${m.type ?? "?"}`);
      try {
        this.dispatch(m);
      } finally {
        doneDispatch();
      }
      // Parse AND dispatch, added up per type: a thread saturated by short frames has no span long
      // enough to name, and this is the line that names it anyway.
      this.tally(`ws ${m.type ?? "?"}`, performance.now() - began, text.length);
    };
  }

  /** The link went down — once per attempt, whoever noticed first; the generation bump makes the second notice a no-op. */
  private down(myGen: number): void {
    if (this.gen !== myGen) return;
    this.gen++; // this attempt is over; late events from its socket are now ignored
    this.stopKeepalive();
    this.emitConn(false);
    if (!this.closed) this.retryLater(this.gen);
  }

  /** Wait, then try again — doubling, jittered, capped. See docs/reliability.md. */
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

  /** Ask `whoami` when nothing has been said for a while — this protocol has no ping. See docs/reliability.md. */
  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      const quiet = Date.now() - this.lastInbound;
      if (this.pingSentAt) {
        if (Date.now() - this.pingSentAt > ENGINE_PONG_TIMEOUT_MS) {
          // Open by its own account, and deaf: drop it ourselves rather than wait for a `close` that is not coming.
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
      if (this.ws?.readyState === WebSocket.OPEN)
        try {
          this.ws.send(e.s);
        } catch {
          // The link went again mid-replay: the rest is lost with it, as a blink's would be.
          break;
        }
  }

  private dispatch(m: EngineMessage): void {
    // Another project's news, dropped here rather than per handler so a frame type that grows a session later is covered.
    if (!forSession(m, this.session)) return;
    if (m.type === "state")
      this.emitState({
        playing: !!m.playing,
        playhead: Number(m.playhead ?? 0),
        ...(m.loop
          ? {
              loop: {
                on: !!m.loop.on,
                start: Number(m.loop.start ?? 0),
                end: Number(m.loop.end ?? 0),
              },
            }
          : {}),
        levels: (m.levels ?? []) as number[],
        inputLevels: (m.inputLevels ?? []) as number[],
        armed: (m.armed ?? []) as string[],
        recordEnabled: !!m.recordEnabled,
        master: Number(m.master ?? -100),
        masterClipped: !!m.masterClipped,
        waveform: (m.waveform ?? {}) as Record<string, WaveformEnvelope[]>,
        platters: (m.platters ?? {}) as Record<string, number>,
        // Dropped here, a recorder never lights, never draws and never saves — packages/song/docs/recorderNode.md.
        recorders: (m.recorders ?? {}) as Record<string, RecorderState>,
        // Left absent when the frame carries none: the store keeps the last one.
        ...(m.load ? { load: m.load } : {}),
      });
    else if (m.type === "plugin-params" && m.id)
      for (const cb of this.paramsCbs)
        cb({
          id: m.id,
          params: (m.params ?? {}) as Record<string, number>,
          meta: m.meta ?? undefined,
        });
    else if (m.type === "plugin-params-live" && m.id)
      for (const cb of this.liveParamsCbs)
        cb({ id: m.id, params: (m.params ?? {}) as Record<string, number> });
    else if (m.type === "presets" && m.module)
      for (const cb of this.presetsCbs) cb(m.module, m.presets ?? []);
    else if (m.type === "busy") for (const cb of this.busyCbs) cb(!!m.busy);
    else if (m.type === "whoami" && typeof m.boot === "string" && m.boot) {
      // A different process behind the same engine id: the supervisor relaunched it, i.e. it died.
      const restarted = this.boot !== null && this.boot !== m.boot;
      this.boot = m.boot;
      if (restarted) for (const cb of this.restartCbs) cb();
    }
    // `error` is handled at the bottom beside `engine-warning`: dropped here, a refused command would vanish without trace.
    else if (m.type === "io-levels")
      for (const cb of this.ioLevelsCbs)
        cb({
          inputs: (m.inputs ?? []) as number[],
          master: Number(m.master ?? -100),
          pitches: (m.pitches ?? []) as number[],
          clarity: (m.clarity ?? []) as number[],
          devices: (m.devices ?? []) as EngineInputDevice[],
        });
    else if (m.type === "plugins")
      for (const cb of this.pluginListCbs)
        cb((m.plugins ?? []) as EnginePluginInfo[]);
    else if (m.type === "plugin-param-list")
      // `plugin-param-LIST`, not `plugin-params`: a TYPE's list rather than an instance's values, and it rides its format and id back — see docs/params.md.
      for (const cb of this.pluginParamListCbs)
        cb({
          format: m.format ?? "",
          id: m.id ?? "",
          params: (m.params ?? []) as EnginePluginParam[],
        });
    else if (m.type === "instrument-status")
      for (const cb of this.instrumentStatusCbs) cb(m.status ?? {});
    else if (m.type === "pair-requests")
      for (const cb of this.pairRequestsCbs) cb(m.requests ?? []);
    else if (m.type === "paired-devices")
      // `devices` is io-levels' field too; this branch has read `type`, so the cast is the shape the engine sends.
      for (const cb of this.pairedDevicesCbs)
        cb((m.devices ?? []) as unknown as PairedDevice[]);
    else if (m.type === "engine-warning" || m.type === "error")
      for (const cb of this.warningCbs)
        cb({
          subject: m.subject ?? "",
          message: m.message ?? "",
          code: m.code,
        });
  }

  // The machine's own clients only: the engine refuses these over the LAN, a paired phone included (docs/pairing.md).
  listPairRequests(): void {
    this.send({ type: "list-pair-requests" });
  }
  approvePairing(requestId: string): void {
    this.send({ type: "pair-approve", requestId });
  }
  denyPairing(requestId: string): void {
    this.send({ type: "pair-deny", requestId });
  }
  listPairedDevices(): void {
    this.send({ type: "list-paired-devices" });
  }
  unpairDevice(deviceId: string): void {
    this.send({ type: "unpair-device", deviceId });
  }
  onPairRequests(cb: (r: PairRequest[]) => void): () => void {
    this.pairRequestsCbs.add(cb);
    return () => this.pairRequestsCbs.delete(cb);
  }
  onPairedDevices(cb: (d: PairedDevice[]) => void): () => void {
    this.pairedDevicesCbs.add(cb);
    return () => this.pairedDevicesCbs.delete(cb);
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
  /**
   * Audition ONE note through a track's own chain — the piano roll's click, released by the engine
   * after 100 ms. Sent straight down this socket rather than through the file service, unlike a
   * sample `preview`: there is no path to resolve, only a track the loaded song already names.
   */
  previewNote(track: string, key: number, vel = 1): void {
    // A preview is for now: one heard thirty seconds late, after a reconnect, is not the one that was asked for.
    this.sendNow({
      type: "note-preview",
      track,
      key: Math.max(0, Math.min(127, Math.round(key))),
      vel: Math.max(0, Math.min(1, vel)),
    });
  }
  /** A keyboard PLAYED into a track's chain: one channel message, held until its own note-off — engine/st0-engine/docs/protocol.md. */
  liveMidi(track: string, data: readonly number[]): void {
    const msg = { type: "midi-live", track, data: [...data] };
    // Played notes are for now and are dropped while the link is down; what ENDS a note is kept, or it would hang.
    if (endsANote(data)) this.send(msg);
    else this.sendNow(msg);
  }
  /**
   * A RECORDER node's two ENGINE verbs. Free-running: neither consults the transport, which is
   * what makes this usable in a rig that never presses play. `on` omitted TOGGLES that node —
   * and that node only. `save` is not here: the engine's job ends at a wav on disk, and sending
   * it anywhere is the file service's, which runs on the machine the file is on.
   * See engine/st0-engine/docs/recorder.md.
   */
  recorder(node: string, action: "record" | "clear", on?: boolean): void {
    const msg = {
      type: "recorder",
      node,
      action,
      ...(on === undefined ? {} : { on }),
    };
    // A toggle or a clear replayed late does the opposite of now — a second press, a newer take erased — so only a stated `on` waits.
    if (action === "record" && on !== undefined) this.send(msg);
    else this.sendNow(msg);
  }
  /** Apply a project, sent as given and remembered for replay — see docs/reliability.md. */
  sendProject(doc: ProjectDoc): void {
    // Remembered, not just sent: an engine that restarted has no document — see `lastProject`.
    this.lastProject = doc;
    this.send({ type: "project", doc });
  }

  /** Forget the loaded project entirely — plugins, edit and diff baseline — so the next one is built from scratch. */
  flush(): void {
    this.send({ type: "flush" });
  }

  /** Forget a whole SESSION, not just its project; defaults to this client's own — see @studio/engine-protocol/docs/sessions.md. */
  dropSession(session: string = this.session): void {
    this.send({ type: "drop-session", session });
  }

  // The CACHED plugin catalogue (no scanning). Reply arrives on onPlugins.
  listPlugins(): void {
    this.send({ type: "list-plugins" });
  }
  /** Every parameter of one INSTALLED plugin, by `format` and catalogue `id`; SLOW, and externals only — see docs/params.md. */
  listPluginParams(format: string, id: string): void {
    this.send({ type: "list-plugin-params", format, id });
  }

  /** Whether each sampled instrument `refs` names is on the engine's machine; answered on onInstrumentStatus, to this socket only. */
  instrumentStatus(refs: string[]): void {
    this.sendNow({ type: "instrument-status", refs });
  }
  onInstrumentStatus(cb: InstrumentStatusCb): () => void {
    this.instrumentStatusCbs.add(cb);
    return () => this.instrumentStatusCbs.delete(cb);
  }

  getPluginParams(id: string): void {
    this.send({ type: "get-plugin-params", id });
  }
  // Follow a plugin's values live, idempotent and replayed; unwatch what scrolls away, since each watch costs a read per frame.
  watchPluginParams(id: string, on = true): void {
    const n = this.watched.get(id) ?? 0;
    // Only the first watcher and the last one leaving reach the engine; the ones between are counted here.
    if (on) {
      this.watched.set(id, n + 1);
      if (n === 0) this.send({ type: "watch-plugin-params", id, on: true });
      return;
    }
    if (n === 0) return;
    if (n > 1) return void this.watched.set(id, n - 1);
    this.watched.delete(id);
    this.send({ type: "watch-plugin-params", id, on: false });
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

  // Subscribe to a module's waveform: the engine taps the chain and broadcasts envelope points at 20 Hz — see docs/meters.md.
  subscribeWaveform(id: string, side: "input" | "output"): void {
    const key = `${id}:${side}`;
    const sub = this.waveformSubs.get(key);
    if (sub) {
      sub.count++;
      return;
    }
    this.waveformSubs.set(key, { id, side, count: 1 });
    this.send({ type: "subscribe-waveform", id, side });
  }
  // The engine's tap goes with the LAST widget reading it, not the first to unmount.
  unsubscribeWaveform(id: string, side: "input" | "output"): void {
    const key = `${id}:${side}`;
    const sub = this.waveformSubs.get(key);
    if (!sub) return;
    if (--sub.count > 0) return;
    this.waveformSubs.delete(key);
    this.send({ type: "unsubscribe-waveform", id, side });
  }

  /** Turn the master audio broadcast on or off for THIS connection; nothing is sent to a connection that never asked. */
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
  // The engine is applying a project and answers nothing meanwhile; a disconnect leaves this stuck true, so the caller clears it.
  onBusy(cb: BusyCb): () => void {
    this.busyCbs.add(cb);
    return () => this.busyCbs.delete(cb);
  }

  // Problems the engine hit — a plugin it could not create, a model it refused; surfaces should show these, since stderr is nobody's.
  onWarning(cb: WarningCb): () => void {
    this.warningCbs.add(cb);
    return () => this.warningCbs.delete(cb);
  }

  /** The engine came back as ANOTHER process — it crashed (or was restarted) and lost what it held. */
  onEngineRestart(cb: () => void): () => void {
    this.restartCbs.add(cb);
    return () => this.restartCbs.delete(cb);
  }

  // Meter the INTERFACE — one peak per channel set, plus the master out; it enables the devices it measures, so ask only while on screen.
  ioLevels(channels: number[][]): void {
    this.send({ type: "io-levels", channels });
  }
  onIoLevels(cb: IoLevelsCb): () => void {
    this.ioLevelsCbs.add(cb);
    return () => this.ioLevelsCbs.delete(cb);
  }

  onPlugins(cb: PluginListCb): () => void {
    this.pluginListCbs.add(cb);
    return () => this.pluginListCbs.delete(cb);
  }
  onPluginParamList(cb: PluginParamListCb): () => void {
    this.pluginParamListCbs.add(cb);
    return () => this.pluginParamListCbs.delete(cb);
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
      // A channel closing under us throws rather than refusing; the message waits like any other then.
      try {
        this.ws.send(s);
        return;
      } catch {}
    }
    this.outbox.push({ at: Date.now(), s });
    // Bounded, and the oldest goes: the newest command is the one that still describes what the person wants.
    if (this.outbox.length > ENGINE_OUTBOX_MAX) this.outbox.shift();
  }

  /** Send or drop — for what only means something on THIS socket, and must never be queued. */
  private sendNow(o: object): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(this.frame(o));
    } catch {
      // Dropped, which is what this verb means when the link is not there.
    }
  }

  private frame(o: object): string {
    // Stamped at the ONE choke point every command goes through, and omitted when default so an old client's bytes stay identical.
    return JSON.stringify(this.session ? { session: this.session, ...o } : o);
  }
  private emitState(s: EngineState): void {
    for (const cb of this.stateCbs) cb(s);
  }
  private emitConn(c: boolean): void {
    for (const cb of this.connCbs) cb(c);
  }
}
