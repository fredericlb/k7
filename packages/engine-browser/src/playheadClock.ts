// playheadClock.ts — a DRAWN playhead that runs on wall time between the engine's 20 Hz frames
// and is steered by them rather than snapped to them. Pure: no React, no DOM, no clock of its
// own — every function takes `now`. It trades accuracy for continuity, so it is for things that
// are LOOKED at; anything that timestamps wants the raw anchor instead. See docs/playhead.md.

/** A frame contradicting the drawn position by more than this is a SEEK, not drift. */
export const SEEK_EPS = 0.3; // seconds — the same figure ui-eyes' EngineClock uses

/** Seconds over which a full-span correction is absorbed. */
export const RATE_TAU = 0.5;

/** The most the drawn clock may run off real time, either way. ±10% is not visible; a snap is. */
export const RATE_SPAN = 0.1;

export interface PlayheadClock {
  /** What the last frame said, and the `now` at which it reached us. */
  anchorSec: number;
  anchorAt: number;
  playing: boolean;
  /** What was last drawn, and when. This is the clock that actually moves the line. */
  drawnSec: number;
  drawnAt: number;
}

export const newPlayheadClock = (
  seconds = 0,
  playing = false,
  now = 0,
): PlayheadClock => ({
  anchorSec: seconds,
  anchorAt: now,
  playing,
  drawnSec: seconds,
  drawnAt: now,
});

/**
 * Take one engine frame.
 *
 * A play/pause EDGE re-seats the drawn clock outright: the value it held is from before the
 * gap, and easing across that gap would walk the line over material nobody played. Drift is
 * left to `advancePlayhead`, which is where the steering happens.
 */
export function feedPlayhead(
  c: PlayheadClock,
  playing: boolean,
  seconds: number,
  now: number,
): PlayheadClock {
  const edge = playing !== c.playing;
  return {
    anchorSec: seconds,
    anchorAt: now,
    playing,
    drawnSec: edge ? seconds : c.drawnSec,
    drawnAt: edge ? now : c.drawnAt,
  };
}

/**
 * Advance the drawn clock to `now`.
 *
 * The frames are not a position to copy, they are a MEASUREMENT of one. Re-anchoring on each
 * would put the timer's and the socket's jitter straight back into the line, which is the
 * stutter this exists to remove — 60 fps of it instead of 20. So local time runs, and the
 * error against the engine only bends its RATE, by at most ±10%.
 *
 * Two consequences worth stating. The line is monotonic while rolling: the rate stays positive,
 * so a frame arriving late can never drag it backwards. And a real discontinuity — a seek, a
 * loop wrap — is past `SEEK_EPS` and snaps, because easing 8 bars at 1.1× would take a minute.
 */
export function advancePlayhead(c: PlayheadClock, now: number): PlayheadClock {
  if (!c.playing) return { ...c, drawnSec: c.anchorSec, drawnAt: now }; // stopped: the frame IS the answer
  const target = c.anchorSec + (now - c.anchorAt) / 1000;
  const dt = Math.max(0, now - c.drawnAt) / 1000;
  const predicted = c.drawnSec + dt;
  const err = target - predicted;
  if (Math.abs(err) > SEEK_EPS) return { ...c, drawnSec: target, drawnAt: now };
  const rate = Math.min(
    1 + RATE_SPAN,
    Math.max(1 - RATE_SPAN, 1 + err / RATE_TAU),
  );
  return { ...c, drawnSec: c.drawnSec + dt * rate, drawnAt: now };
}
