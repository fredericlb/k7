// playheadClock.ts — a DRAWN playhead. The transport's rate is KNOWN (one second per second:
// the protocol has play/stop/seek and no varispeed), so this predicts from local time and the
// only unknown it estimates is the OFFSET between the two clocks. A frame that disagrees is a
// measurement, not a drift — except past SEEK_EPS, where it is a jump and the estimate is rolled
// back. Pure: no React, no DOM, no clock of its own. See apps/st0/frontend/docs/playhead.md.

/** A frame contradicting the estimate by more than this is a SEEK, not latency. */
export const SEEK_EPS = 0.3; // seconds — the same figure ui-eyes' EngineClock uses

/** How far back the offset estimate looks, bounded because the audio and system clocks creep apart by tens of ppm. */
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

/** The window starts EMPTY: the estimate is built only from frames that actually arrived, never seeded from a snapshot. */
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

/** The best offset the window supports is the LARGEST sample: every one understates by its own transit time, so the max is the least delayed. */
const estimateOf = (window: Sample[]): number => {
  let best = -Infinity;
  for (const s of window) if (s.offset > best) best = s.offset;
  return best;
};

/** Take one engine frame; past `SEEK_EPS` the transport MOVED, so the window is thrown away rather than kept as stale evidence. */
export function feedPlayhead(
  c: PlayheadClock,
  playing: boolean,
  seconds: number,
  now: number,
): PlayheadClock {
  if (!playing)
    return { ...c, playing, window: [], anchorSec: seconds, drawnAt: now };
  const sample: Sample = { offset: seconds - now / 1000, at: now };
  // An empty window is a seed rather than a rollback, but it takes the same path: one sample, and the drawn offset set to it.
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

/** Where to draw at `now`: a straight line in local time, with even a re-estimate slewed in rather than stepped, so it stays monotonic. */
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
