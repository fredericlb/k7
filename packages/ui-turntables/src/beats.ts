// beats.ts — where a song's beat grid actually STARTS, and how far one deck has to move to
// put its beats on the other's. The tempo says how often a beat happens; this says when.
// No canvas and no React, so both answers are testable. See ../docs/bpm.md.

/** Where a song's beats fall, and whether the onsets actually said so. */
export interface BeatGrid {
  /** Where the first beat falls, in SOURCE seconds, always inside `[0, 60/bpm)`. */
  phase: number;
  /** 0 when the onsets say nothing about a grid, ~1 when they all land on one. */
  strength: number;
  /** Is `phase` a MEASUREMENT or a shrug? The RAYLEIGH test decides — see ../docs/bpm.md. */
  confident: boolean;
}

/** p ≈ 0.01 for the Rayleigh statistic `n·R²` — see `BeatGrid.confident`. */
export const RAYLEIGH_Z = 4.6;

/** Nothing to go on: a grid at zero, and saying so. */
export const NO_GRID: BeatGrid = { phase: 0, strength: 0, confident: false };

/** Where the beat grid starts — a CIRCULAR MEAN of every onset, not `transients[0]`. See ../docs/bpm.md. */
export function beatPhase(
  transients: readonly number[],
  bpm: number,
): BeatGrid {
  if (!(bpm > 0) || transients.length === 0) return NO_GRID;
  const period = 60 / bpm;
  if (!(period > 0) || !Number.isFinite(period)) return NO_GRID;
  let x = 0;
  let y = 0;
  for (const t of transients) {
    const angle = (2 * Math.PI * t) / period;
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  const strength = Math.hypot(x, y) / transients.length;
  // atan2 gives (-π, π]; the grid is a position in [0, period), so bring it round.
  let phase = ((Math.atan2(y, x) / (2 * Math.PI)) * period + period) % period;
  // A hair BELOW zero wraps to a whole period, and that number becomes a clip's `start`.
  if (period - phase < period * 1e-9) phase = 0;
  return {
    phase,
    strength,
    confident: transients.length * strength * strength > RAYLEIGH_Z,
  };
}

/** The FIRST beat at or after `from` — here rather than in waveform.ts, so lines and alignment agree. */
export function firstBeatAfter(
  from: number,
  phase: number,
  period: number,
): number {
  if (!(period > 0)) return from;
  return phase + Math.ceil((from - phase) / period) * period;
}

/** The metre everything here ASSUMES and nowhere measures — one number, so no two can drift apart. */
export const BEATS_PER_BAR = 4;

/** How far to delay the SLAVE so its beats land on the master's, in TIMELINE beats — ../docs/bpm.md. */
export function alignDelay(
  master: { natural: number; target: number; phase?: number },
  slave: { natural: number; target: number; phase?: number },
  docTempo: number,
): number {
  const beatOf = (d: { natural: number; target: number; phase?: number }) =>
    d.target > 0 ? ((d.phase ?? 0) * d.natural) / d.target : 0;
  const period = slave.target > 0 ? 60 / slave.target : 0;
  if (!(period > 0) || !(docTempo > 0)) return 0;
  const gap = beatOf(master) - beatOf(slave);
  const seconds = ((gap % period) + period) % period;
  return (seconds * docTempo) / 60;
}
