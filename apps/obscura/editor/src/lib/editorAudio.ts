import {
  createEffectChain,
  type EffectChain,
  getDetune,
  getPlaybackRate,
  PitchWobble,
} from "@studio/player-web/effects";
import { useSyncExternalStore } from "react";

// Framework-free port of composables/useEditorAudio.ts — the preview engine
// behind the track panel's play/range/seek controls and its waveform. The Vue
// refs became a snapshot object + subscribe so React consumes it via
// useSyncExternalStore; the audio graph is unchanged.

export interface EditorAudioState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  waveformData: number[];
}

export class EditorAudio {
  private state: EditorAudioState = {
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    waveformData: [],
  };
  private listeners = new Set<() => void>();

  private audioCtx: AudioContext | null = null;
  private audioBuffer: AudioBuffer | null = null;
  private reversedBuffer: AudioBuffer | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private effectChainInstance: EffectChain | null = null;
  private pitchWobble: PitchWobble | null = null;
  private currentEffects: Record<string, number> = {};
  private startedAt = 0;
  private startOffset = 0;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private rafId = 0;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getState = (): EditorAudioState => this.state;

  private set(patch: Partial<EditorAudioState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private getCtx(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
      this.gainNode = this.audioCtx.createGain();
    }
    return this.audioCtx;
  }

  private connectEffectChain(): void {
    if (!this.audioCtx || !this.gainNode) return;
    this.gainNode.disconnect();
    if (this.effectChainInstance) this.effectChainInstance.disconnect();

    const hasEffects = Object.keys(this.currentEffects).length > 0;
    if (hasEffects) {
      this.effectChainInstance = createEffectChain(
        this.audioCtx,
        this.currentEffects,
      );
      this.gainNode.connect(this.effectChainInstance.input);
      this.effectChainInstance.output.connect(this.audioCtx.destination);
    } else {
      this.effectChainInstance = null;
      this.gainNode.connect(this.audioCtx.destination);
    }
  }

  private disconnectWobble(): void {
    if (this.pitchWobble) {
      this.pitchWobble.disconnect();
      this.pitchWobble = null;
    }
  }

  private applySourceEffects(): void {
    if (!this.sourceNode) return;
    this.sourceNode.playbackRate.value = getPlaybackRate(this.currentEffects);
    this.sourceNode.detune.value = getDetune(this.currentEffects);
  }

  private applyWobble(): void {
    this.disconnectWobble();
    if (!this.sourceNode || !this.audioCtx) return;
    const intensity = this.currentEffects.pitchvar;
    if (intensity && intensity > 0) {
      this.pitchWobble = new PitchWobble(
        this.audioCtx,
        this.sourceNode.detune,
        intensity,
      );
    }
  }

  setEffects(effects: Record<string, number>): void {
    this.currentEffects = effects;
    this.applySourceEffects();
    const wobbleIntensity = effects.pitchvar ?? 0;
    if (wobbleIntensity > 0 && this.pitchWobble) {
      this.pitchWobble.update(wobbleIntensity);
    } else {
      this.applyWobble();
    }
    if (!this.audioCtx || !this.gainNode) return;
    if (this.effectChainInstance && this.state.isPlaying) {
      this.effectChainInstance.update(effects);
    } else {
      this.connectEffectChain();
    }
  }

  /** Get the output node to connect sources to. */
  private getOutputNode(): AudioNode {
    const ctx = this.getCtx();
    return this.gainNode ?? ctx.destination;
  }

  private extractWaveform(buffer: AudioBuffer, bars = 200): number[] {
    const channelData = buffer.getChannelData(0);
    const samplesPerBar = Math.floor(channelData.length / bars);
    const peaks: number[] = [];
    for (let i = 0; i < bars; i++) {
      let max = 0;
      const offset = i * samplesPerBar;
      for (let j = 0; j < samplesPerBar; j++) {
        const abs = Math.abs(channelData[offset + j]);
        if (abs > max) max = abs;
      }
      peaks.push(max);
    }
    return peaks;
  }

  private createReversedBuffer(buffer: AudioBuffer): AudioBuffer {
    const ctx = this.getCtx();
    const reversed = ctx.createBuffer(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate,
    );
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const src = buffer.getChannelData(ch);
      const dst = reversed.getChannelData(ch);
      for (let i = 0; i < src.length; i++) {
        dst[i] = src[src.length - 1 - i];
      }
    }
    return reversed;
  }

  async loadAudio(url: string): Promise<void> {
    this.stop();
    const ctx = this.getCtx();
    const resp = await fetch(url, { cache: "no-store" });
    const arrayBuf = await resp.arrayBuffer();
    this.audioBuffer = await ctx.decodeAudioData(arrayBuf);
    this.reversedBuffer = this.createReversedBuffer(this.audioBuffer);
    this.set({
      duration: this.audioBuffer.duration,
      waveformData: this.extractWaveform(this.audioBuffer),
      currentTime: 0,
    });
  }

  private updateTime = (): void => {
    if (this.state.isPlaying && this.audioCtx) {
      this.set({
        currentTime:
          this.audioCtx.currentTime - this.startedAt + this.startOffset,
      });
      this.rafId = requestAnimationFrame(this.updateTime);
    }
  };

  play(from = 0, to?: number): void {
    if (!this.audioBuffer) return;
    this.startFrom(this.audioBuffer, from, to);
  }

  /** Play using the reversed buffer. from/to are offsets into it. */
  playReversed(from = 0, to?: number): void {
    if (!this.reversedBuffer) return;
    this.startFrom(this.reversedBuffer, from, to);
  }

  private startFrom(buffer: AudioBuffer, from: number, to?: number): void {
    this.stop();
    const ctx = this.getCtx();
    this.connectEffectChain();
    this.sourceNode = ctx.createBufferSource();
    this.sourceNode.buffer = buffer;
    this.sourceNode.connect(this.getOutputNode());

    this.startOffset = from;
    const playDuration = to && to > from ? to - from : undefined;

    this.applySourceEffects();
    this.applyWobble();
    this.sourceNode.start(0, from, playDuration);
    this.startedAt = ctx.currentTime;
    this.set({ isPlaying: true });
    this.rafId = requestAnimationFrame(this.updateTime);

    this.sourceNode.onended = () => {
      this.set({ isPlaying: false });
      cancelAnimationFrame(this.rafId);
    };

    if (playDuration) {
      this.stopTimer = setTimeout(() => this.stop(), playDuration * 1000 + 50);
    }
  }

  seek(time: number, reversed = false): void {
    const buf = reversed ? this.reversedBuffer : this.audioBuffer;
    if (!buf) return;
    const clampedTime = Math.max(0, Math.min(time, buf.duration - 0.01));
    const wasPlaying = this.state.isPlaying;
    if (this.sourceNode) {
      this.sourceNode.onended = null;
      try {
        this.sourceNode.stop();
      } catch {
        /* ignore */
      }
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    cancelAnimationFrame(this.rafId);
    this.set({ currentTime: clampedTime });
    if (wasPlaying) {
      const ctx = this.getCtx();
      this.connectEffectChain();
      this.sourceNode = ctx.createBufferSource();
      this.sourceNode.buffer = buf;
      this.sourceNode.connect(this.getOutputNode());
      this.applySourceEffects();
      this.applyWobble();
      this.startOffset = clampedTime;
      this.sourceNode.start(0, clampedTime);
      this.startedAt = ctx.currentTime;
      this.set({ isPlaying: true });
      this.rafId = requestAnimationFrame(this.updateTime);
      this.sourceNode.onended = () => {
        this.set({ isPlaying: false });
        cancelAnimationFrame(this.rafId);
      };
    }
  }

  stop = (): void => {
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
      } catch {
        /* ignore */
      }
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    this.disconnectWobble();
    if (this.effectChainInstance) {
      this.effectChainInstance.disconnect();
      this.effectChainInstance = null;
    }
    this.set({ isPlaying: false });
    cancelAnimationFrame(this.rafId);
  };

  dispose(): void {
    this.stop();
    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}

export function useEditorAudioState(a: EditorAudio): EditorAudioState {
  return useSyncExternalStore(a.subscribe, a.getState);
}
