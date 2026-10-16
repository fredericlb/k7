// needleClock.ts — a deck's needle as DRAWN: the platter's raw 20 Hz position, steered by the
// transport's playhead clock with the deck's KNOWN rate, so the band and the wedge move evenly.
// The one thing a reader would get wrong: this is never the position a cue is WRITTEN at — that
// stays the raw needle. Pure, read on demand from animation frames. See ../../docs/turntables/needleClock.md.

import {
  advancePlayhead,
  feedPlayhead,
  newPlayheadClock,
  type PlayheadClock,
  playheadAt,
  retimePlayhead,
  shiftPlayhead,
} from "@studio/engine-browser/playhead-clock";

/** A needle that has not moved for this long is not turning, whatever its rate says. */
export const STALL_MS = 160;

/** A frame further than this from the estimate is a jump — tighter than the transport's, a deck's beat jumps are short. */
export const NEEDLE_SEEK_EPS = 0.12;

/** The running loop, in seconds of the record. */
export interface Span {
  start: number;
  end: number;
}

export interface NeedleClock {
  clock: PlayheadClock;
  /** The last raw needle seen, and when it last CHANGED. */
  raw: number;
  changedAt: number;
  /** The loop the clock's axis is unwrapped against, as a key. */
  loopKey: string;
  loop: Span | null;
}

export const newNeedleClock = (raw = 0, now = 0): NeedleClock => ({
  clock: newPlayheadClock(raw, false, now),
  raw,
  changedAt: now,
  loopKey: "",
  loop: null,
});

/** What one read knows: the engine's last word, the rate the deck was TOLD (0 when stopped or under a hand), and its loop. */
export interface NeedleInput {
  raw: number;
  rate: number;
  loop: Span | null;
}

const lengthOf = (l: Span | null): number =>
  l && l.end > l.start ? l.end - l.start : 0;

/** A position past a loop's end, brought back inside it. */
export function foldIntoLoop(p: number, loop: Span | null): number {
  const len = lengthOf(loop);
  if (!loop || !(len > 0) || p < loop.end) return p;
  return loop.start + ((p - loop.start) % len);
}

/** A raw needle inside a loop, moved by whole turns to the one nearest the prediction — a wrap is not a seek. */
export function unwrapNear(
  raw: number,
  predicted: number,
  loop: Span | null,
): number {
  const len = lengthOf(loop);
  if (!loop || !(len > 0) || raw < loop.start || raw > loop.end) return raw;
  return raw + Math.max(0, Math.round((predicted - raw) / len)) * len;
}

/** Take one read at `now` and answer where to DRAW the needle, in seconds of the record. */
export function readNeedle(
  s: NeedleClock,
  input: NeedleInput,
  now: number,
): { state: NeedleClock; at: number } {
  let { clock } = s;
  // A loop that changed changes the axis: re-fold so what is drawn now stays put.
  const loopKey = input.loop ? `${input.loop.start}|${input.loop.end}` : "";
  if (loopKey !== s.loopKey) {
    const p = playheadAt(clock, now);
    clock = shiftPlayhead(clock, foldIntoLoop(p, s.loop) - p);
  }
  const moved = input.raw !== s.raw;
  const changedAt = moved ? now : s.changedAt;
  const turning = input.rate !== 0 && now - changedAt <= STALL_MS;
  if (!turning) {
    if (clock.playing || moved)
      clock = feedPlayhead(clock, false, input.raw, now);
  } else {
    clock = retimePlayhead(clock, input.rate, now);
    if (moved) {
      const near = clock.playing ? playheadAt(clock, now) : input.raw;
      const seconds = unwrapNear(input.raw, near, input.loop);
      clock = feedPlayhead(clock, true, seconds, now, NEEDLE_SEEK_EPS);
    }
  }
  clock = advancePlayhead(clock, now);
  const state = { clock, raw: input.raw, changedAt, loopKey, loop: input.loop };
  return { state, at: foldIntoLoop(playheadAt(clock, now), input.loop) };
}
