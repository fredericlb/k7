import { useSyncExternalStore } from "react";
import {
  createEffectChain,
  type EffectChain,
  getDetune,
  getPlaybackRate,
  PitchWobble,
} from "./audioEffects";

// Framework-free port of shared/composables/useSongPreloader.ts: category preload,
// pause/resume, mic ducking, playback-rate override, fusion dual-source, reversed
// buffers, multi-track, trim scheduling. The Vue refs became a snapshot object +
// subscribe so React consumes it via useSyncExternalStore.
//
// There were two copies. online's was a solo-game trim of monitor-web's — the same
// engine minus the methods it never called, with the state fields for them still
// declared. This is monitor-web's, which was the superset; nothing was arbitrated away.

export interface SongEntry {
  artist?: string;
  title?: string;
  path?: string;
  fullSong?: string;
  from?: number;
  to?: number;
  tracks?: { path?: string; fullSong?: string }[];
}

export interface PreloaderState {
  total: number;
  loaded: number;
  loading: boolean;
  progress: number; // 0..1
  isPlaying: boolean;
  isPaused: boolean;
  failedPaths: string[];
  /**
   * Effects the CURRENT engine cannot apply, which the round is being played without.
   *
   * Optional, so this preloader — which can do all of them — never sets it and still
   * satisfies the type. It exists for the moteur-backed player, where two of obscura's nine
   * sliders have no equivalent. Surfacing it here rather than throwing is deliberate: a
   * game must not crash mid-round, and a difficulty effect that silently did nothing would
   * mean the players heard an easier song than the round claimed, with nothing to show it.
   */
  unsupported?: string[];
}

export class SongPreloader {
  private state: PreloaderState = {
    total: 0,
    loaded: 0,
    loading: false,
    progress: 0,
    isPlaying: false,
    isPaused: false,
    failedPaths: [],
  };
  private listeners = new Set<() => void>();

  private cache = new Map<string, AudioBuffer>();
  private reversedCache = new Map<string, AudioBuffer>();
  private audioCtx: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  // Master duck node: sits between all output and destination so the mic
  // passthrough can reduce main audio volume when voice is detected.
  private duckGain: GainNode | null = null;
  private secondSource: AudioBufferSourceNode | null = null;
  private secondGainNode: GainNode | null = null;
  private multiSources: AudioBufferSourceNode[] = [];
  private multiGainNodes: GainNode[] = [];
  private playStartTime = 0;
  private pauseOffset = 0;
  private currentFrom = 0;
  private currentTo = 0;
  private stopTimer: number | null = null;
  private effectChain: EffectChain | null = null;
  private pitchWobble: PitchWobble | null = null;
  private currentEffects: Record<string, number> = {};
  private inflight = 0;
  private playToken = 0;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getState = (): PreloaderState => this.state;

  private set(patch: Partial<PreloaderState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private clearStopTimer(): void {
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
  }

  private scheduleStop(bufferPos: number): void {
    this.clearStopTimer();
    if (this.currentTo > 0 && bufferPos < this.currentTo) {
      const remaining = this.currentTo - bufferPos;
      this.stopTimer = window.setTimeout(() => this.stop(), remaining * 1000);
    }
  }

  private ensureContext(): void {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
      this.gainNode = this.audioCtx.createGain();
      this.duckGain = this.audioCtx.createGain();
      this.duckGain.gain.value = 1;
      this.duckGain.connect(this.audioCtx.destination);
    }
  }

  private connectEffectChain(): void {
    if (!this.audioCtx || !this.gainNode) return;
    this.gainNode.disconnect();
    if (this.effectChain) this.effectChain.disconnect();
    const out: AudioNode = this.duckGain ?? this.audioCtx.destination;
    if (Object.keys(this.currentEffects).length > 0) {
      this.effectChain = createEffectChain(this.audioCtx, this.currentEffects);
      this.gainNode.connect(this.effectChain.input);
      this.effectChain.output.connect(out);
    } else {
      this.effectChain = null;
      this.gainNode.connect(out);
    }
  }

  private disconnectWobble(): void {
    if (this.pitchWobble) {
      this.pitchWobble.disconnect();
      this.pitchWobble = null;
    }
  }

  private applySourceEffects(source: AudioBufferSourceNode | null): void {
    if (!source) return;
    source.playbackRate.value = getPlaybackRate(this.currentEffects);
    source.detune.value = getDetune(this.currentEffects);
  }

  private applyWobble(source: AudioBufferSourceNode | null): void {
    this.disconnectWobble();
    if (!source || !this.audioCtx) return;
    const intensity = this.currentEffects.pitchvar;
    if (intensity && intensity > 0) {
      this.pitchWobble = new PitchWobble(
        this.audioCtx,
        source.detune,
        intensity,
      );
    }
  }

  setEffects(effects: Record<string, number>): void {
    this.currentEffects = effects;
    this.applySourceEffects(this.currentSource);
    this.applySourceEffects(this.secondSource);
    const wobbleIntensity = effects.pitchvar ?? 0;
    if (wobbleIntensity > 0 && this.pitchWobble) {
      this.pitchWobble.update(wobbleIntensity);
    } else {
      this.applyWobble(this.currentSource);
    }
    if (!this.audioCtx || !this.gainNode) return;
    if (this.effectChain && this.state.isPlaying) {
      this.effectChain.update(effects);
    } else {
      this.connectEffectChain();
    }
  }

  /** Clear all cached buffers before loading a new category. */
  unload(): void {
    this.cache.clear();
    this.reversedCache.clear();
    this.inflight = 0;
    this.set({ total: 0, loaded: 0, progress: 0, failedPaths: [] });
  }

  private collectPaths(song: SongEntry): string[] {
    const out = new Set<string>();
    if (song.path) out.add(song.path);
    if (song.fullSong) out.add(song.fullSong);
    for (const track of song.tracks ?? []) {
      if (track.path) out.add(track.path);
      if (track.fullSong) out.add(track.fullSong);
    }
    return [...out];
  }

  private async fetchAndDecode(path: string): Promise<void> {
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`${response.status} for ${path}`);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioCtx!.decodeAudioData(arrayBuffer);
      this.cache.set(path, audioBuffer);
    } catch (e) {
      console.warn(`Failed to preload "${path}":`, e);
      this.set({ failedPaths: [...this.state.failedPaths, path] });
    } finally {
      const loaded = this.state.loaded + 1;
      this.set({
        loaded,
        progress: this.state.total === 0 ? 1 : loaded / this.state.total,
      });
    }
  }

  /**
   * Preload one song's paths. Idempotent — cached paths are skipped, so the
   * progressive-load scheme can call it repeatedly.
   */
  async preloadSong(song: SongEntry): Promise<void> {
    this.ensureContext();
    const todo = this.collectPaths(song).filter((p) => !this.cache.has(p));
    if (todo.length === 0) {
      if (this.state.total === 0) this.set({ progress: 1 });
      return;
    }
    this.set({ total: this.state.total + todo.length, loading: true });
    this.inflight++;
    try {
      await Promise.all(todo.map((p) => this.fetchAndDecode(p)));
    } finally {
      this.inflight--;
      if (this.inflight === 0) this.set({ loading: false });
    }
  }

  /**
   * Preload songs for a single category. Unloads previous buffers first,
   * then fetches and decodes all paths.
   */
  async preloadCategory(songs: SongEntry[]): Promise<void> {
    this.ensureContext();
    this.unload();
    if (songs.length === 0) {
      this.set({ progress: 1 });
      return;
    }
    await Promise.all(songs.map((s) => this.preloadSong(s)));
    // Give every decoded AudioBuffer time to fully settle on the audio
    // thread before the next play() call — without this, the first song
    // after preload can drop out or start mid-sample.
    await new Promise<void>((r) => setTimeout(r, 2000));
  }

  stopMulti(): void {
    for (const src of this.multiSources) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    this.multiSources = [];
    this.multiGainNodes = [];
  }

  async playMulti(tracks: { path: string; from?: number }[]): Promise<void> {
    if (!this.audioCtx) return;
    this.stop();
    this.set({ isPaused: false });
    if (this.audioCtx.state === "suspended") await this.audioCtx.resume();

    // Honour each track's own `from` so per-track offsets line up hooks.
    const starts: number[] = [];
    for (const track of tracks) {
      const buffer = this.cache.get(track.path);
      if (!buffer) {
        console.warn("[preloader] buffer not found for", track.path);
        continue;
      }
      const gn = this.audioCtx.createGain();
      gn.connect(this.duckGain ?? this.audioCtx.destination);
      gn.gain.value = 1;
      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(gn);
      this.multiSources.push(source);
      this.multiGainNodes.push(gn);
      starts.push(track.from ?? 0);
    }
    for (let i = 0; i < this.multiSources.length; i++) {
      this.multiSources[i].start(0, starts[i]);
    }
    this.playStartTime = this.audioCtx.currentTime;
    this.set({ isPlaying: true });
  }

  muteMultiTrack(index: number): void {
    if (index >= 0 && index < this.multiGainNodes.length) {
      this.multiGainNodes[index].gain.value = 0;
    }
  }

  stopSecond(): void {
    if (this.secondSource) {
      this.secondSource.onended = null;
      try {
        this.secondSource.stop();
      } catch {
        /* already stopped */
      }
      this.secondSource = null;
    }
  }

  stop(): void {
    this.clearStopTimer();
    if (this.currentSource && this.audioCtx) {
      const pos =
        this.currentFrom + (this.audioCtx.currentTime - this.playStartTime);
      this.pauseOffset =
        this.currentTo > 0 ? Math.min(pos, this.currentTo) : pos;
      this.currentSource.onended = null;
      try {
        this.currentSource.stop();
      } catch {
        /* already stopped */
      }
      this.currentSource = null;
    }
    this.stopSecond();
    this.stopMulti();
    this.disconnectWobble();
    if (this.effectChain) {
      this.effectChain.disconnect();
      this.effectChain = null;
    }
    this.set({ isPlaying: false });
  }

  /** Call synchronously inside a user-gesture handler before any await. */
  resumeContext(): void {
    this.ensureContext();
    if (this.audioCtx && this.audioCtx.state === "suspended") {
      void this.audioCtx.resume();
    }
  }

  setPlaybackRate(rate: number): void {
    if (this.currentSource) this.currentSource.playbackRate.value = rate;
    if (this.secondSource) this.secondSource.playbackRate.value = rate;
  }

  setGain(value: number): void {
    if (this.gainNode) this.gainNode.gain.value = value;
  }

  /**
   * Audio ducking driven by the mic level: factor 1 = no duck, 0.5 = max
   * attenuation (−6 dB). Smoothed via setTargetAtTime so rapid level
   * changes don't pop.
   */
  setDuck(factor: number): void {
    if (!this.duckGain || !this.audioCtx) return;
    const clamped = Math.max(0.5, Math.min(1, factor));
    this.duckGain.gain.setTargetAtTime(
      clamped,
      this.audioCtx.currentTime,
      0.05,
    );
  }

  /** Current playback position in seconds (absolute buffer position). */
  getCurrentTime(): number {
    if (this.state.isPlaying && this.audioCtx) {
      return (
        this.currentFrom + (this.audioCtx.currentTime - this.playStartTime)
      );
    }
    return this.pauseOffset;
  }

  getBuffer(path: string): AudioBuffer | undefined {
    return this.cache.get(path);
  }

  setSecondGain(value: number): void {
    if (this.secondGainNode) this.secondGainNode.gain.value = value;
  }

  private async ensureBuffer(path: string): Promise<AudioBuffer | null> {
    let buffer = this.cache.get(path);
    if (buffer) return buffer;
    if (!this.audioCtx) return null;
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`${response.status} for ${path}`);
      const arrayBuffer = await response.arrayBuffer();
      buffer = await this.audioCtx.decodeAudioData(arrayBuffer);
      this.cache.set(path, buffer);
      return buffer;
    } catch (e) {
      console.warn("[preloader] failed to load", path, e);
      if (!this.state.failedPaths.includes(path)) {
        this.set({ failedPaths: [...this.state.failedPaths, path] });
      }
      return null;
    }
  }

  async play(path: string, from = 0, to = 0): Promise<void> {
    this.ensureContext();
    if (!this.audioCtx) return;
    const token = ++this.playToken;
    this.stop();
    this.set({ isPaused: false });
    this.pauseOffset = from;
    this.currentFrom = from;
    this.currentTo = to;
    this.setGain(1);
    this.connectEffectChain();
    const buffer = await this.ensureBuffer(path);
    if (!buffer || token !== this.playToken) return;
    if (this.audioCtx.state === "suspended") await this.audioCtx.resume();
    if (token !== this.playToken) return;
    const source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode ?? this.audioCtx.destination);
    source.onended = () => {
      if (token === this.playToken) this.set({ isPlaying: false });
    };
    source.start(0, from);
    this.applySourceEffects(source);
    this.applyWobble(source);
    this.playStartTime = this.audioCtx.currentTime;
    this.currentSource = source;
    this.set({ isPlaying: true });
    this.scheduleStop(from);
  }

  pause(): void {
    if (!this.audioCtx || !this.state.isPlaying) return;
    this.clearStopTimer();
    this.pauseOffset =
      this.currentFrom + (this.audioCtx.currentTime - this.playStartTime);
    this.stop();
    this.set({ isPaused: true });
  }

  async resume(path: string): Promise<void> {
    if (!this.audioCtx) return;
    this.stop();
    this.connectEffectChain();
    const buffer = this.cache.get(path);
    if (!buffer) {
      console.warn("[preloader] buffer not found for", path);
      return;
    }
    if (this.audioCtx.state === "suspended") await this.audioCtx.resume();
    const source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode ?? this.audioCtx.destination);
    source.onended = () => this.set({ isPlaying: false, isPaused: false });
    source.start(0, this.pauseOffset);
    this.applySourceEffects(source);
    this.applyWobble(source);
    this.playStartTime = this.audioCtx.currentTime;
    this.currentSource = source;
    this.set({ isPlaying: true, isPaused: false });
    this.scheduleStop(this.pauseOffset);
  }

  private getOrCreateReversedBuffer(path: string): AudioBuffer | null {
    if (this.reversedCache.has(path)) return this.reversedCache.get(path)!;
    const original = this.cache.get(path);
    if (!original || !this.audioCtx) return null;
    const reversed = this.audioCtx.createBuffer(
      original.numberOfChannels,
      original.length,
      original.sampleRate,
    );
    for (let ch = 0; ch < original.numberOfChannels; ch++) {
      const src = original.getChannelData(ch);
      const dst = reversed.getChannelData(ch);
      for (let i = 0; i < src.length; i++) dst[i] = src[src.length - 1 - i];
    }
    this.reversedCache.set(path, reversed);
    return reversed;
  }

  async playReversed(path: string, from = 0, to = 0): Promise<void> {
    if (!this.audioCtx) return;
    this.stop();
    this.set({ isPaused: false });
    this.pauseOffset = from;
    this.currentFrom = from;
    this.currentTo = to;
    this.setGain(1);
    this.connectEffectChain();
    const buffer = this.getOrCreateReversedBuffer(path);
    if (!buffer) {
      console.warn("[preloader] reversed buffer not found for", path);
      return;
    }
    if (this.audioCtx.state === "suspended") await this.audioCtx.resume();
    const source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode ?? this.audioCtx.destination);
    source.onended = () => this.set({ isPlaying: false });
    source.start(0, from);
    this.applySourceEffects(source);
    this.applyWobble(source);
    this.playStartTime = this.audioCtx.currentTime;
    this.currentSource = source;
    this.set({ isPlaying: true });
    this.scheduleStop(from);
  }

  async playDual(
    path1: string,
    path2: string,
    from = 0,
    to = 0,
    from2?: number,
    _to2?: number,
  ): Promise<void> {
    if (!this.audioCtx) return;
    this.stop();
    this.set({ isPaused: false });
    this.pauseOffset = from;
    this.currentFrom = from;
    this.currentTo = to;
    this.setGain(1);

    const buf1 = this.cache.get(path1);
    const buf2 = this.cache.get(path2);
    if (!buf1 || !buf2) {
      console.warn("[preloader] buffer not found for", !buf1 ? path1 : path2);
      return;
    }
    if (this.audioCtx.state === "suspended") await this.audioCtx.resume();

    if (!this.secondGainNode) {
      this.secondGainNode = this.audioCtx.createGain();
      this.secondGainNode.connect(this.duckGain ?? this.audioCtx.destination);
    }
    this.secondGainNode.gain.value = 1;

    const src1 = this.audioCtx.createBufferSource();
    src1.buffer = buf1;
    src1.connect(this.gainNode ?? this.audioCtx.destination);
    src1.onended = () => this.set({ isPlaying: false });

    const src2 = this.audioCtx.createBufferSource();
    src2.buffer = buf2;
    src2.connect(this.secondGainNode);

    src1.start(0, from);
    src2.start(0, from2 ?? from);
    this.playStartTime = this.audioCtx.currentTime;
    this.currentSource = src1;
    this.secondSource = src2;
    this.set({ isPlaying: true });
    this.scheduleStop(from);
  }
}

/** Hook: subscribe to a preloader's reactive snapshot. */
export function usePreloaderState(p: SongPreloader): PreloaderState {
  return useSyncExternalStore(p.subscribe, p.getState);
}
