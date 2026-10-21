// playheadClock.ts — a DRAWN playhead. The rate is KNOWN (one second per second for the
// transport, the platter's own `Rate` for a deck), so this predicts from local time and the
// only unknown it estimates is the OFFSET between the two clocks. A frame that disagrees is a
// measurement, not a drift — except past the seek threshold, where it is a jump and the estimate
// is rolled back. Pure: no React, no DOM, no clock of its own. See apps/k7/frontend/docs/playhead.md.

/** A frame contradicting the estimate by more than this is a SEEK, not latency. */
export const SEEK_EPS = 0.3; // seconds — the same figure ui-eyes' EngineClock uses

/** How far back the offset estimate looks, bounded because the audio and system clocks creep apart by tens of ppm. */
export const WINDOW_MS = 4000;

/** The most the drawn offset may creep per second of real time while chasing the estimate. */
export const SLEW = 0.02;

/** How long a stop pressed HERE holds the line against frames still saying "playing" — the ones already in flight. */
export const HALT_HOLD_MS = 500;

/** One frame, as evidence about the offset rather than as a position. */
interface Sample {
  /** `playhead − rate·arrival`: what the local clock's zero maps to in transport seconds. */
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
  /** Seconds of position per second of local time — 1 for the transport, signed for a platter. */
  rate: number;
  /** When a stop pressed here froze the line, until the engine's own stopped frame confirms it. */
  haltedAt?: number;
}

/** The window starts EMPTY: the estimate is built only from frames that actually arrived, never seeded from a snapshot. */
export const newPlayheadClock = (
  seconds = 0,
  playing = false,
  now = 0,
  rate = 1,
): PlayheadClock => ({
  playing,
  window: [],
  offset: seconds - (rate * now) / 1000,
  drawnOffset: seconds - (rate * now) / 1000,
  anchorSec: seconds,
  drawnAt: now,
  rate,
});

/** The best offset is the least delayed sample: the LARGEST going forward, since every frame understates by its transit, and the smallest going back. */
const estimateOf = (window: Sample[], rate: number): number => {
  const sign = rate < 0 ? -1 : 1;
  let best = -Infinity;
  for (const s of window) if (sign * s.offset > best) best = sign * s.offset;
  return sign * best;
};

/** Take one engine frame; past `SEEK_EPS` the transport MOVED, so the window is thrown away rather than kept as stale evidence. */
export function feedPlayhead(
  c: PlayheadClock,
  playing: boolean,
  seconds: number,
  now: number,
  seekEps = SEEK_EPS,
): PlayheadClock {
  if (!playing)
    return {
      ...c,
      playing,
      window: [],
      anchorSec: seconds,
      drawnAt: now,
      haltedAt: undefined,
    };
  // Sampled before the engine heard the stop: drawing it would roll the line on past where it stopped.
  if (c.haltedAt !== undefined && now - c.haltedAt < HALT_HOLD_MS) return c;
  const sample: Sample = { offset: seconds - (c.rate * now) / 1000, at: now };
  // An empty window is a seed rather than a rollback, but it takes the same path: one sample, and the drawn offset set to it.
  const edge = !c.playing || c.window.length === 0;
  const jumped =
    c.window.length > 0 && Math.abs(sample.offset - c.offset) > seekEps;
  if (edge || jumped)
    return {
      ...c,
      playing: true,
      window: [sample],
      offset: sample.offset,
      drawnOffset: sample.offset, // the rollback: draw the authority, not the old prediction
      anchorSec: seconds,
      drawnAt: now,
      haltedAt: undefined,
    };
  const window = [...c.window, sample].filter((s) => now - s.at <= WINDOW_MS);
  return {
    ...c,
    playing: true,
    window,
    offset: estimateOf(window, c.rate),
    anchorSec: seconds,
  };
}

/** A stop pressed HERE at `at`: the line freezes where it is drawn, rather than rolling on until the engine's frame says so (docs/playhead.md). */
export function haltPlayhead(c: PlayheadClock, at: number): PlayheadClock {
  if (!c.playing) return c;
  return {
    ...c,
    playing: false,
    window: [],
    anchorSec: playheadAt(c, at),
    drawnAt: at,
    haltedAt: at,
  };
}

/** A play pressed here: the hold is lifted, so the frames of the new roll are drawn as soon as they arrive. */
export const unhaltPlayhead = (c: PlayheadClock): PlayheadClock =>
  c.haltedAt === undefined ? c : { ...c, haltedAt: undefined };

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
  c.playing ? c.drawnOffset + (c.rate * now) / 1000 : c.anchorSec;

/** Move every offset by `delta` seconds — a change of axis that keeps the window's evidence. */
const shifted = (c: PlayheadClock, delta: number): PlayheadClock => ({
  ...c,
  window: c.window.map((s) => ({ ...s, offset: s.offset + delta })),
  offset: c.offset + delta,
  drawnOffset: c.drawnOffset + delta,
  anchorSec: c.anchorSec + delta,
});

/** A new KNOWN rate from `now` on, rebased so the drawn position stays continuous; a reversal empties the window, whose evidence pointed the other way. */
export function retimePlayhead(
  c: PlayheadClock,
  rate: number,
  now: number,
): PlayheadClock {
  if (rate === c.rate) return c;
  const moved = shifted(c, ((c.rate - rate) * now) / 1000);
  const anchorSec = c.anchorSec;
  const reversed = Math.sign(rate) !== Math.sign(c.rate);
  return { ...moved, rate, anchorSec, window: reversed ? [] : moved.window };
}

/** Slide the whole clock by `delta` seconds of position — a loop folded or unfolded under it, with nothing drawn moving. */
export const shiftPlayhead = (
  c: PlayheadClock,
  delta: number,
): PlayheadClock => (delta === 0 ? c : shifted(c, delta));
