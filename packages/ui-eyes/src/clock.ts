// clock.ts — the playhead eyes draws against. It must NOT touch the audio engine (the
// whole reason it's a separate package), so it takes a Clock: something that can say what
// second the song is at and whether it's rolling. An EngineClock and a FrameClock both
// implement it, and the compositor can't tell which it has.

export interface Clock {
  nowSec(): number;
  isPlaying(): boolean;
}

/** A Clock that also announces a DISCONTINUITY — a seek or a play/pause edge, which only the realtime driver needs. See docs/realtime.md. */
export interface SeekingClock extends Clock {
  onSeek?: (sec: number, playing: boolean) => void;
}

// Follow the engine's ~20 Hz frames with a monotonic clock between them — the one place in eyes that reads a clock, see docs/realtime.md.
export class EngineClock implements SeekingClock {
  private playing = false;
  private anchorSec = 0; // the playhead the last frame reported
  private anchorWallMs = 0; // performance.now() when it did

  // A frame contradicting the prediction by more than this is a SEEK, not drift: drivers hard-seek on onSeek rather than nudge.
  static readonly SEEK_EPS = 0.3;

  // Fired when a frame reveals a discontinuity, with the authoritative playhead; drivers hard-seek every layer.
  onSeek?: (sec: number, playing: boolean) => void;

  // Feed one state frame: detect a jump against the prediction, then re-anchor. Call it on every frame.
  feed(playing: boolean, playheadSec: number): void {
    const predicted = this.nowSec();
    const jumped = Math.abs(playheadSec - predicted) > EngineClock.SEEK_EPS;
    const edge = playing !== this.playing;
    this.playing = playing;
    this.anchorSec = playheadSec;
    this.anchorWallMs = performance.now();
    if (jumped || edge) this.onSeek?.(playheadSec, playing);
  }

  nowSec(): number {
    return this.playing
      ? this.anchorSec + (performance.now() - this.anchorWallMs) / 1000
      : this.anchorSec;
  }

  isPlaying(): boolean {
    return this.playing;
  }
}

// A deterministic clock for export — frame n / fps, always playing; no wall clock, so a render is reproducible.
export class FrameClock implements Clock {
  private frame = 0;
  constructor(private readonly fps: number) {}
  setFrame(n: number): void {
    this.frame = n;
  }
  nowSec(): number {
    return this.frame / this.fps;
  }
  isPlaying(): boolean {
    return true;
  }
}

/** The transport ITSELF, for a surface with no engine to follow — UNUSED here, kept as the seam; see docs/realtime.md. */
export class TransportClock implements SeekingClock {
  private playing = false;
  private anchorSec = 0; // the position at the last edge
  private anchorWallMs = 0; // performance.now() when it was set

  onSeek?: (sec: number, playing: boolean) => void;

  nowSec(): number {
    return this.playing
      ? this.anchorSec + (performance.now() - this.anchorWallMs) / 1000
      : this.anchorSec;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /** Re-anchor at the current position, then announce. Every mutator below funnels through it. */
  private set(sec: number, playing: boolean): void {
    this.anchorSec = Math.max(0, sec);
    this.anchorWallMs = performance.now();
    this.playing = playing;
    this.onSeek?.(this.anchorSec, playing);
  }

  play(): void {
    if (!this.playing) this.set(this.nowSec(), true);
  }

  pause(): void {
    if (this.playing) this.set(this.nowSec(), false);
  }

  toggle(): void {
    this.playing ? this.pause() : this.play();
  }

  /** Jump, keeping whatever the transport was doing — scrubbing while rolling stays rolling. */
  seek(sec: number): void {
    this.set(sec, this.playing);
  }
}
