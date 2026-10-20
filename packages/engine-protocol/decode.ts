// decode.ts — what BOTH engine clients do with a frame once it is parsed: the reply shapes they
// share, the decoders that fill a frame's absent fields, and the queue a down socket holds.
// The Node client and the browser one read these, so a field one of them drops is a field both
// drop. No node and no DOM imports: it runs on either side.

import type {
  EngineLoad,
  EngineState,
  RecorderState,
  WaveformEnvelope,
} from "./types.ts";

/** One plugin the engine's scan knows about — the installed catalogue, not an instance. */
export interface PluginInfo {
  name: string;
  format: string;
  manufacturer: string;
  instrument: boolean;
  role: "instrument" | "audioEffect" | "midiEffect";
  /** What KIND of effect it is, lower case, '' when unknown — an external plugin reports whatever its vendor wrote. */
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

/** One wave input the engine can route a track FROM; `channels` is 1-based and matched EXACTLY. */
export interface EngineInputDevice {
  name: string;
  channels: number[];
  enabled: boolean;
}

/** Peak dB per channel set asked for, in order, plus the master output — the `io-levels` reply. */
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

/** A `state` frame as it arrives: every field may be absent, an older engine sending fewer. */
export interface StateFrame {
  playing?: boolean;
  playhead?: number;
  loop?: { on?: boolean; start?: number; end?: number };
  levels?: number[];
  inputLevels?: number[];
  armed?: string[];
  recordEnabled?: boolean;
  master?: number;
  masterClipped?: boolean;
  waveform?: Record<string, WaveformEnvelope[]>;
  platters?: Record<string, number>;
  recorders?: Record<string, RecorderState>;
  load?: EngineLoad;
}

/** An `io-levels` reply as it arrives. */
export interface IoLevelsFrame {
  inputs?: number[];
  master?: number;
  pitches?: number[];
  clarity?: number[];
  devices?: EngineInputDevice[];
}

/** A `state` frame with every field filled; `loop` and `load` stay absent when the frame carries none. */
export function decodeState(m: StateFrame): EngineState {
  return {
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
    levels: m.levels ?? [],
    inputLevels: m.inputLevels ?? [],
    armed: m.armed ?? [],
    recordEnabled: !!m.recordEnabled,
    master: Number(m.master ?? -100),
    masterClipped: !!m.masterClipped,
    waveform: m.waveform ?? {},
    platters: m.platters ?? {},
    // Dropped here, a recorder never lights, never draws and never saves — packages/song/docs/recorderNode.md.
    recorders: m.recorders ?? {},
    // Left absent when the frame carries none: a store keeps the last one.
    ...(m.load ? { load: m.load } : {}),
  };
}

/** An `io-levels` reply with every field filled. */
export function decodeIoLevels(m: IoLevelsFrame): IoLevels {
  return {
    inputs: m.inputs ?? [],
    master: Number(m.master ?? -100),
    pitches: m.pitches ?? [],
    clarity: m.clarity ?? [],
    devices: m.devices ?? [],
  };
}

/** Where the engine's plugin scan stands — a `plugin-scan` frame; `total` is 0 while the folders are still listed. */
export interface PluginScanStatus {
  scanning: boolean;
  done: number;
  total: number;
  /** The file being LOADED, "" while files are only stat'ed. */
  current: string;
  /** Scans this engine process has finished; it moves when one ends. */
  version: number;
}

/** A `plugin-scan` frame read defensively, or null when it is not one — engine/k7-runtime/docs/protocol.md. */
export function decodePluginScan(m: unknown): PluginScanStatus | null {
  const f = m as Partial<Record<keyof PluginScanStatus | "type", unknown>>;
  if (!f || typeof f !== "object" || f.type !== "plugin-scan") return null;
  const n = (v: unknown) => (typeof v === "number" && v >= 0 ? v : 0);
  return {
    scanning: f.scanning === true,
    done: n(f.done),
    total: n(f.total),
    current: typeof f.current === "string" ? f.current : "",
    version: n(f.version),
  };
}

/** What a client holds while its socket is down: bounded, oldest out, and nothing replayed past its age. */
export class Outbox {
  private held: { at: number; s: string }[] = [];

  /** `max` frames at most; a frame older than `ttlMs` at replay is dropped — web-protocol's ENGINE_OUTBOX_*. */
  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
  ) {}

  push(s: string, now = Date.now()): void {
    this.held.push({ at: now, s });
    // The newest command is the one that still describes what the person wants.
    if (this.held.length > this.max) this.held.shift();
  }

  /** Empty the queue, handing back what is still worth sending, oldest first. */
  drain(now = Date.now()): string[] {
    const fresh = this.held.filter((e) => now - e.at < this.ttlMs);
    this.held = [];
    return fresh.map((e) => e.s);
  }

  get size(): number {
    return this.held.length;
  }
}
