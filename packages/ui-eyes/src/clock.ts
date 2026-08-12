// clock.ts — the playhead eyes draws against. It must NOT touch the audio engine (the
// whole reason it's a separate package), so it takes a Clock: something that can say what
// second the song is at and whether it's rolling. An EngineClock and a FrameClock both
// implement it, and the compositor can't tell which it has.

export interface Clock {
  nowSec(): number;
  isPlaying(): boolean;
}

/**
 * A Clock that can also announce a DISCONTINUITY — a seek, or a play/pause edge.
 *
 * The realtime driver needs this and the compositor does not: drawing a frame only asks what
 * second it is, while chasing one with a `<video>` has to know when the answer stopped being
 * continuous, so it can hard-seek instead of nudging a playbackRate towards a target that
 * moved. Stated as an interface because there are two implementations with nothing else in
 * common: one FOLLOWS an engine, one IS the transport.
 */
export interface SeekingClock extends Clock {
  onSeek?: (sec: number, playing: boolean) => void;
}

// Follow the engine's ~20 Hz frames with a wall clock between them: 50 ms of jitter is a visible stutter at 30 fps,
// so a frame sets an anchor and wall time carries it forward. Same interpolation patternClock does in the brain.
// This is the one place in eyes that reads Date.now().
export class EngineClock implements SeekingClock {
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

/**
 * The transport ITSELF, for a surface with no engine to follow.
 *
 * The other two clocks answer to something: EngineClock chases a playhead reported over a
 * socket, FrameClock is stepped by an exporter. This one is the authority — for a host with no
 * device whose sample position the picture must agree with, where inventing an engine to keep
 * time would be a whole process running to hold a number.
 *
 * Currently UNUSED in this repo: l8 hosts the renderer and l8 has an engine, so the picture
 * follows `EngineClock`. Kept because the seam is the point — the compositor cannot tell which
 * clock it has, and that is what let picture move hosts twice without the renderer changing.
 *
 * `Date.now()` and nothing else: the drift this cannot have is against an audio clock that
 * is not there. What it MUST still do is announce its own discontinuities, which is why
 * seeking and the play/pause edge both fire `onSeek` — the realtime driver hard-seeks every
 * `<video>` on those, and a seek that stayed quiet would leave the picture on the old frame.
 */
export class TransportClock implements SeekingClock {
  private playing = false;
  private anchorSec = 0; // the position at the last edge
  private anchorWallMs = 0; // Date.now() when it was set

  onSeek?: (sec: number, playing: boolean) => void;

  nowSec(): number {
    return this.playing
      ? this.anchorSec + (Date.now() - this.anchorWallMs) / 1000
      : this.anchorSec;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /** Re-anchor at the current position, then announce. Every mutator below funnels through it. */
  private set(sec: number, playing: boolean): void {
    this.anchorSec = Math.max(0, sec);
    this.anchorWallMs = Date.now();
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
