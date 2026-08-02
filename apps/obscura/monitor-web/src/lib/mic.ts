import { useSyncExternalStore } from "react";
import type { WSMessage, WSSubscriber } from "./monitor";

// Framework-free port of composables/useMic.ts: mic passthrough to the
// speakers with an RMS-driven duck factor fed into the audio engine so
// songs dip when the presenter is speaking.

export interface MicDeps {
  subscribe: (fn: WSSubscriber) => () => void;
  sendWS: (msg: { type: string; payload: unknown }) => void;
  // Audio engine duck factor in [0, 1]. Multiplied into the master gain.
  setDuck: (value: number) => void;
}

export interface MicState {
  enabled: boolean;
  gainPct: number;
  error: string | null;
}

// RMS thresholds: below THRESHOLD the mic is silent; at KNEE we hit the max
// attenuation (factor 0.5, ~−6 dB).
const DUCK_THRESHOLD = 0.02;
const DUCK_KNEE = 0.2;
const DUCK_MAX_ATTEN = 0.5;

export class Mic {
  private state: MicState = { enabled: false, gainPct: 100, error: null };
  private listeners = new Set<() => void>();

  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserData: Uint8Array<ArrayBuffer> | null = null;
  private duckingRaf = 0;

  private deps: MicDeps;
  private unsub: () => void;

  constructor(deps: MicDeps) {
    this.deps = deps;
    this.unsub = deps.subscribe((msg: WSMessage) => {
      if (msg.type !== "remote_action") return;
      const action = (msg.payload as { action?: string }).action;
      if (action === "set_mic_gain") {
        const v = (msg.payload as { gainPct?: number }).gainPct;
        if (typeof v === "number") {
          this.setGainPct(v);
          this.broadcastState();
        }
      }
    });
  }

  subscribeState = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getState = (): MicState => this.state;

  private set(patch: Partial<MicState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private broadcastState(): void {
    this.deps.sendWS({
      type: "remote_action",
      payload: {
        action: "mic_state_change",
        enabled: this.state.enabled,
        gainPct: this.state.gainPct,
      },
    });
  }

  private applyGain(): void {
    if (this.gainNode) this.gainNode.gain.value = this.state.gainPct / 100;
  }

  setGainPct(pct: number): void {
    this.set({ gainPct: Math.max(0, Math.min(200, Math.round(pct))) });
    this.applyGain();
  }

  private startDucking(): void {
    if (this.duckingRaf) return;
    const tick = () => {
      if (!this.analyser || !this.analyserData) {
        this.duckingRaf = 0;
        return;
      }
      this.analyser.getByteTimeDomainData(this.analyserData);
      let sumSq = 0;
      for (let i = 0; i < this.analyserData.length; i++) {
        const v = (this.analyserData[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / this.analyserData.length);
      const voice = Math.max(
        0,
        Math.min(1, (rms - DUCK_THRESHOLD) / (DUCK_KNEE - DUCK_THRESHOLD)),
      );
      this.deps.setDuck(1 - DUCK_MAX_ATTEN * voice);
      this.duckingRaf = requestAnimationFrame(tick);
    };
    this.duckingRaf = requestAnimationFrame(tick);
  }

  private stopDucking(): void {
    if (this.duckingRaf) cancelAnimationFrame(this.duckingRaf);
    this.duckingRaf = 0;
  }

  private async enable(): Promise<void> {
    this.set({ error: null });
    try {
      if (!this.ctx) this.ctx = new AudioContext();
      if (this.ctx.state === "suspended") await this.ctx.resume();
      if (!this.stream) {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      }
      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = this.state.gainPct / 100;
      this.source.connect(this.gainNode);
      this.gainNode.connect(this.ctx.destination);
      // Tap pre-gain source for level detection so the slider doesn't change
      // duck aggressiveness.
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.2;
      this.analyserData = new Uint8Array(this.analyser.fftSize);
      this.source.connect(this.analyser);
      this.startDucking();
      this.set({ enabled: true });
    } catch (e) {
      this.set({ error: (e as Error)?.message ?? "mic error", enabled: false });
    }
  }

  disable(): void {
    this.stopDucking();
    this.deps.setDuck(1);
    try {
      this.analyser?.disconnect();
    } catch {
      /* ignore */
    }
    this.analyser = null;
    this.analyserData = null;
    try {
      this.gainNode?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.source?.disconnect();
    } catch {
      /* ignore */
    }
    this.gainNode = null;
    this.source = null;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.set({ enabled: false });
  }

  async toggle(): Promise<void> {
    if (this.state.enabled) this.disable();
    else await this.enable();
    this.broadcastState();
  }

  onGainInput(pct: number): void {
    this.setGainPct(pct);
    this.broadcastState();
  }

  dispose(): void {
    this.unsub();
    this.disable();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}

export function useMicState(m: Mic): MicState {
  return useSyncExternalStore(m.subscribeState, m.getState);
}
