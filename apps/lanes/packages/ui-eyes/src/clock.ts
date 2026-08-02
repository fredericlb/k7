// clock.ts — the playhead eyes draws against. It must NOT touch the audio engine (the
// whole reason it's a separate package), so it takes a Clock: something that can say what
// second the song is at and whether it's rolling. An EngineClock and a FrameClock both
// implement it, and the compositor can't tell which it has.

export interface Clock {
  nowSec(): number;
  isPlaying(): boolean;
}

// Follow the engine's ~20 Hz frames with a wall clock between them: 50 ms of jitter is a visible stutter at 30 fps,
// so a frame sets an anchor and wall time carries it forward. Same interpolation patternClock does in the brain.
// This is the one place in eyes that reads Date.now().
export class EngineClock implements Clock {
  private playing = false;
  private anchorSec = 0; // the playhead the last frame reported
  private anchorWallMs = 0; // Date.now() when it did

  // A frame contradicting the prediction by more than this is a SEEK, not drift — nudging playbackRate would take
  // minutes to converge, so drivers hard-seek on onSeek instead.
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
    this.anchorWallMs = Date.now();
    if (jumped || edge) this.onSeek?.(playheadSec, playing);
  }

  nowSec(): number {
    return this.playing
      ? this.anchorSec + (Date.now() - this.anchorWallMs) / 1000
      : this.anchorSec;
  }

  isPlaying(): boolean {
    return this.playing;
  }
}

// A deterministic clock for export — frame n / fps, always playing. No wall clock, which is what makes a render
// reproducible.
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
