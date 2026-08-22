// audio.ts — the preview behind the start/end controls: decode once, draw a waveform, play the
// whole track or just its window, seek. A store rather than a hook so the decoded buffer
// survives re-renders and selection changes. Ported from the retired Grist editor's
// useEditorAudio; what it dropped and why is in docs/editing.md.

import { useSyncExternalStore } from "react";

export interface AudioState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  peaks: number[];
}

/** How many bars the waveform is drawn with — enough to read a song's shape, cheap to lay out. */
const BARS = 200;

export class Preview {
  private state: AudioState = {
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    peaks: [],
  };
  private listeners = new Set<() => void>();

  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private reversed: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private startOffset = 0;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private raf = 0;
  private rate = 1;
  /** What is decoded right now, so re-selecting the same track does not re-fetch it. */
  loaded: string | null = null;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getState = (): AudioState => this.state;

  private set(patch: Partial<AudioState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private getCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  /** Peak per bar, off the first channel — what the waveform strip draws. */
  private extractPeaks(buf: AudioBuffer): number[] {
    const data = buf.getChannelData(0);
    const per = Math.floor(data.length / BARS);
    const peaks: number[] = [];
    for (let i = 0; i < BARS; i++) {
      let max = 0;
      const off = i * per;
      for (let j = 0; j < per; j++) {
        const abs = Math.abs(data[off + j]);
        if (abs > max) max = abs;
      }
      peaks.push(max);
    }
    return peaks;
  }

  private reverseOf(buf: AudioBuffer): AudioBuffer {
    const out = this.getCtx().createBuffer(
      buf.numberOfChannels,
      buf.length,
      buf.sampleRate,
    );
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const src = buf.getChannelData(ch);
      const dst = out.getChannelData(ch);
      for (let i = 0; i < src.length; i++) dst[i] = src[src.length - 1 - i];
    }
    return out;
  }

  /** Decode one URL. `key` is what `loaded` reports, so a caller can skip a redundant load. */
  async load(url: string, key: string): Promise<void> {
    this.stop();
    this.loaded = null;
    const ctx = this.getCtx();
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(`audio ${res.status}`);
    this.buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    this.reversed = null; // built lazily: only a `reversed` category ever needs it
    this.loaded = key;
    this.set({
      duration: this.buffer.duration,
      peaks: this.extractPeaks(this.buffer),
      currentTime: 0,
    });
  }

  /** Playback speed, from a song's `speed:`. Applied live so a change is audible mid-play. */
  setSpeed(rate: number): void {
    this.rate = rate > 0 ? rate : 1;
    if (this.source) this.source.playbackRate.value = this.rate;
  }

  private tick = (): void => {
    if (!this.state.isPlaying || !this.ctx) return;
    const elapsed = (this.ctx.currentTime - this.startedAt) * this.rate;
    this.set({ currentTime: this.startOffset + elapsed });
    this.raf = requestAnimationFrame(this.tick);
  };

  /** Play from `from` to `to` (both in seconds); `to` omitted plays to the end. */
  play(from = 0, to?: number, backwards = false): void {
    let buf = this.buffer;
    if (backwards) {
      if (!this.reversed && this.buffer)
        this.reversed = this.reverseOf(this.buffer);
      buf = this.reversed;
    }
    if (!buf) return;
    this.stop();
    const ctx = this.getCtx();
    this.source = ctx.createBufferSource();
    this.source.buffer = buf;
    this.source.playbackRate.value = this.rate;
    this.source.connect(ctx.destination);

    this.startOffset = from;
    const span = to && to > from ? to - from : undefined;
    this.source.start(0, from, span);
    this.startedAt = ctx.currentTime;
    this.set({ isPlaying: true });
    this.raf = requestAnimationFrame(this.tick);

    this.source.onended = () => {
      this.set({ isPlaying: false });
      cancelAnimationFrame(this.raf);
    };
    // A source started with a duration ends itself; the timer is the belt to that braces,
    // because `onended` does not fire if the node is collected first.
    if (span)
      this.stopTimer = setTimeout(
        () => this.stop(),
        (span / this.rate) * 1000 + 50,
      );
  }

  /** Move the playhead. Keeps playing if it was, which is what makes a waveform click useful. */
  seek(time: number): void {
    if (!this.buffer) return;
    const t = Math.max(0, Math.min(time, this.buffer.duration - 0.01));
    const wasPlaying = this.state.isPlaying;
    this.stop();
    this.set({ currentTime: t });
    if (wasPlaying) this.play(t);
  }

  stop = (): void => {
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        /* already stopped — starting a fresh source is the point */
      }
      this.source.disconnect();
      this.source = null;
    }
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    cancelAnimationFrame(this.raf);
    this.set({ isPlaying: false });
  };

  dispose(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}

export function usePreview(p: Preview): AudioState {
  return useSyncExternalStore(p.subscribe, p.getState);
}
