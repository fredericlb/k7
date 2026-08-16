// playheadClock.ts — a DRAWN playhead. The transport's rate is KNOWN (one second per second:
// the protocol has play/stop/seek and no varispeed), so this predicts from local time and the
// only unknown it estimates is the OFFSET between the two clocks. A frame that disagrees is a
// measurement, not a drift — except past SEEK_EPS, where it is a jump and the estimate is rolled
// back. Pure: no React, no DOM, no clock of its own. See apps/l8/frontend/docs/playhead.md.

/** A frame contradicting the estimate by more than this is a SEEK, not latency. */
export const SEEK_EPS = 0.3; // seconds — the same figure ui-eyes' EngineClock uses

/**
 * How far back the offset estimate looks, in ms.
 *
 * Bounded for one reason: the engine's playhead advances on the AUDIO clock (the interface's
 * crystal) and `performance.now()` is the system one. They differ by tens of ppm, so the true
 * offset creeps. Ageing samples out is what absorbs that — at 100 ppm, four seconds of creep is
 * 0.4 ms, which is nothing, whereas an unbounded window would hold a stale best sample for the
 * length of a set.
 */
export const WINDOW_MS = 4000;

/** The most the drawn offset may creep per second of real time while chasing the estimate. */
export const SLEW = 0.02;

/** One frame, as evidence about the offset rather than as a position. */
interface Sample {
  /** `playhead − arrival`: what the local clock's zero maps to in transport seconds. */
  offset: number;
  at: number;
}

export interface PlayheadClock {
  playing: boolean;
  /** The frames still in the window, oldest first. Empty while stopped. */
  window: Sample[];
  /** The best offset the window supports — see `estimateOf`. */
  offset: number;
  /** The offset actually being DRAWN from, which chases `offset` under SLEW. */
  drawnOffset: number;
  /** Where the last frame said we were. The answer outright while stopped. */
  anchorSec: number;
  drawnAt: number;
}

/**
 * The window starts EMPTY: the estimate is built only from frames that actually arrived.
 *
 * Seeding it from the caller's snapshot is tempting and is not a measurement — the snapshot is
 * whatever the store last received, so its transit time is unknown and already spent. In
 * practice such a sample UNDERSTATES the offset, which a max filter discards the moment a real
 * frame lands, so seeding is harmless rather than wrong. It is left out because it was not
 * harmless in a BENCH: constructed with a perfect value it made the clock measure 2.5 ms more
 * accurate than it is, which is the sort of thing that gets quoted later.
 */
export const newPlayheadClock = (
  seconds = 0,
  playing = false,
  now = 0,
): PlayheadClock => ({
  playing,
  window: [],
  offset: seconds - now / 1000,
  drawnOffset: seconds - now / 1000,
  anchorSec: seconds,
  drawnAt: now,
});

/**
 * The best offset the window supports: the LARGEST sample.
 *
 * A frame is sampled by the engine and then reaches us — serialised, sent, parsed — so its
 * arrival is always later than the moment it describes. Every sample therefore UNDERSTATES the
 * true offset, by exactly its own transit time, and the largest one is the frame that got here
 * fastest. Taking the max is taking the least-delayed measurement and discarding the rest; it is
 * the same reasoning NTP applies to round trips, and it is only available because the rate is
 * known — with an unknown rate these samples would have to be regressed, noise and all.
 */
const estimateOf = (window: Sample[]): number => {
  let best = -Infinity;
  for (const s of window) if (s.offset > best) best = s.offset;
  return best;
};

/**
 * Take one engine frame.
 *
 * ROLLBACK is the interesting half. A frame further from the estimate than `SEEK_EPS` is not a
 * late packet, it is the transport having moved — a seek, a loop wrap, a play from elsewhere —
 * and every sample in the window is now evidence about a position that no longer exists.
 * Keeping them would hold the drawn line at the old offset for a whole window; worse, the max
 * filter would prefer them, because a backwards seek makes every new sample smaller. So the
 * window is thrown away and re-seeded from this frame alone, and the drawn offset goes with it.
 *
 * A play/pause edge is the same event by another name.
 */
export function feedPlayhead(
  c: PlayheadClock,
  playing: boolean,
  seconds: number,
  now: number,
): PlayheadClock {
  if (!playing)
    return { ...c, playing, window: [], anchorSec: seconds, drawnAt: now };
  const sample: Sample = { offset: seconds - now / 1000, at: now };
  // An empty window is a seed, not a rollback — but it takes the same path: one sample, and the
  // drawn offset set to it rather than eased towards it.
  const edge = !c.playing || c.window.length === 0;
  const jumped =
    c.window.length > 0 && Math.abs(sample.offset - c.offset) > SEEK_EPS;
  if (edge || jumped)
    return {
      playing: true,
      window: [sample],
      offset: sample.offset,
      drawnOffset: sample.offset, // the rollback: draw the authority, not the old prediction
      anchorSec: seconds,
      drawnAt: now,
    };
  const window = [...c.window, sample].filter((s) => now - s.at <= WINDOW_MS);
  return {
    ...c,
    playing: true,
    window,
    offset: estimateOf(window),
    anchorSec: seconds,
  };
}

/**
 * Where to draw, at `now`.
 *
 * `drawnOffset + now` and nothing else — a straight line in local time, which is what makes it
 * smooth: there is no per-frame correction to see, because the frames only ever move the
 * OFFSET, and the offset barely moves. What movement it has is slewed, so even a re-estimate is
 * absorbed at 2% of real time rather than stepped.
 *
 * Monotonic while rolling: local time only increases and the slew cannot outrun it.
 */
export function advancePlayhead(c: PlayheadClock, now: number): PlayheadClock {
  if (!c.playing) return { ...c, drawnAt: now };
  const dt = Math.max(0, now - c.drawnAt) / 1000;
  const err = c.offset - c.drawnOffset;
  const step = Math.min(Math.abs(err), dt * SLEW) * Math.sign(err);
  return { ...c, drawnOffset: c.drawnOffset + step, drawnAt: now };
}

/** The position to draw at `now`, in transport seconds. */
export const playheadAt = (c: PlayheadClock, now: number): number =>
  c.playing ? c.drawnOffset + now / 1000 : c.anchorSec;
