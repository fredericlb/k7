// engineEvents.ts — the frames the engine pushes, read: one dispatch over every reply type and the
// subscriptions each one feeds. Another session's frame is dropped here, once, before any handler.
// See @studio/engine-protocol/docs/sessions.md and docs/reliability.md.

import type {
  EngineState,
  ParamMeta,
  PluginParams,
  PresetInfo,
} from "@studio/engine-protocol";
import {
  decodeIoLevels,
  decodeState,
  type IoLevels,
  type IoLevelsFrame,
  type PluginInfo,
  type PluginParamInfo,
  type StateFrame,
} from "@studio/engine-protocol/decode";
import { forSession } from "@studio/engine-protocol/sessions";
import { EngineLink } from "./engineLink.ts";

/** One plugin the engine's scan knows about — the name this package has always given `PluginInfo`. */
export type EnginePluginInfo = PluginInfo;

type StateCb = (s: EngineState) => void;
type ParamsCb = (p: PluginParams) => void;
type PresetsCb = (module: string, presets: PresetInfo[]) => void;
type BusyCb = (busy: boolean) => void;
type PluginListCb = (plugins: EnginePluginInfo[]) => void;
/** One parameter of an installed plugin TYPE — the name this package has always given `PluginParamInfo`. */
export type EnginePluginParam = PluginParamInfo;
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
/** The engine runs without external plugins after quick crashes; the file it names is the likeliest culprit — engine/k7-supervisor/docs/crashLoop.md. */
export interface EngineSafeMode {
  crashes: number;
  /** The plugin it died loading, which is certain. */
  diedLoading?: string;
  /** Else the plugin it loaded last, which is only the likeliest. */
  lastPlugin?: string;
}
/** A device paired with this engine; its key never leaves the engine again after the approval. */
export interface PairedDevice {
  deviceId: string;
  name: string;
  created: number;
  lastSeen: number;
}

// Every field any engine push carries, as one shape rather than a union: the dispatch reads `type` first and the rest is optional.
interface EngineMessage extends StateFrame, IoLevelsFrame {
  type?: string;
  session?: string; // which project the engine is talking about; absent = engine-global
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
  plugins?: unknown[]; // 'plugins': the catalogue
  // 'plugin-params': which plugin was asked about, echoed back beside the `id` above so a late reply can be matched.
  format?: string;
  boot?: string; // 'whoami': the engine PROCESS, so a reconnect can tell a restarted engine
  audioToBrowser?: boolean; // …and whether its device is heard by nobody, so the broadcast is the only way to hear it
  protocol?: number; // …the engine wire's version it speaks, absent from an engine older than the field
  build?: string; // …the release stamp it was built from
  safeMode?: EngineSafeMode; // …present only while it runs without external plugins
  requests?: PairRequest[]; // 'pair-requests', to the machine's own clients only
}

export abstract class EngineEvents extends EngineLink {
  private stateCbs = new Set<StateCb>();
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
  /** Whether the engine said nobody hears its device (`whoami`); a client then plays its broadcast — docs/streaming.md. */
  private audioToBrowser = false;
  private audioToBrowserCbs = new Set<(on: boolean) => void>();
  /** The engine's safe mode as `whoami` last said it, null when it is not in it. */
  private safeMode: EngineSafeMode | null = null;
  private safeModeCbs = new Set<(s: EngineSafeMode | null) => void>();

  protected dispatch(m: EngineMessage): void {
    // Another project's news, dropped here rather than per handler so a frame type that grows a session later is covered.
    if (!forSession(m, this.session)) return;
    if (m.type === "state") this.emitState(decodeState(m));
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
    else if (m.type === "whoami") {
      if (typeof m.boot === "string" && m.boot) {
        // A different process behind the same engine id: the supervisor relaunched it, i.e. it died.
        const restarted = this.boot !== null && this.boot !== m.boot;
        this.boot = m.boot;
        if (restarted) for (const cb of this.restartCbs) cb();
      }
      const toBrowser = m.audioToBrowser === true;
      if (toBrowser !== this.audioToBrowser) {
        this.audioToBrowser = toBrowser;
        for (const cb of this.audioToBrowserCbs) cb(toBrowser);
      }
      const safe = readSafeMode(m.safeMode);
      if (JSON.stringify(safe) !== JSON.stringify(this.safeMode)) {
        this.safeMode = safe;
        for (const cb of this.safeModeCbs) cb(safe);
      }
    }
    // `error` is handled at the bottom beside `engine-warning`: dropped here, a refused command would vanish without trace.
    else if (m.type === "io-levels")
      for (const cb of this.ioLevelsCbs) cb(decodeIoLevels(m));
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
  onInstrumentStatus(cb: InstrumentStatusCb): () => void {
    this.instrumentStatusCbs.add(cb);
    return () => this.instrumentStatusCbs.delete(cb);
  }

  /** Whether the engine's sound reaches anyone only through this browser; told now, then on every change. */
  /** Safe mode entered or left, as `whoami` says it; called at once with what is known. */
  onSafeMode(cb: (s: EngineSafeMode | null) => void): () => void {
    this.safeModeCbs.add(cb);
    cb(this.safeMode);
    return () => this.safeModeCbs.delete(cb);
  }
  onAudioToBrowser(cb: (on: boolean) => void): () => void {
    this.audioToBrowserCbs.add(cb);
    cb(this.audioToBrowser);
    return () => this.audioToBrowserCbs.delete(cb);
  }
  onPairRequests(cb: (r: PairRequest[]) => void): () => void {
    this.pairRequestsCbs.add(cb);
    return () => this.pairRequestsCbs.delete(cb);
  }
  onPairedDevices(cb: (d: PairedDevice[]) => void): () => void {
    this.pairedDevicesCbs.add(cb);
    return () => this.pairedDevicesCbs.delete(cb);
  }
  private emitState(s: EngineState): void {
    for (const cb of this.stateCbs) cb(s);
  }
}

/** `whoami`'s safe mode, kept only in the shape the engine sends; anything else is no safe mode. */
export function readSafeMode(v: unknown): EngineSafeMode | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const text = (x: unknown) => (typeof x === "string" && x ? x : undefined);
  const diedLoading = text(o.diedLoading);
  const lastPlugin = text(o.lastPlugin);
  return {
    crashes: Number.isSafeInteger(o.crashes) ? (o.crashes as number) : 0,
    ...(diedLoading ? { diedLoading } : {}),
    ...(lastPlugin ? { lastPlugin } : {}),
  };
}
