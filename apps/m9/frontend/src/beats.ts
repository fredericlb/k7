// beats.ts — where a song's beat grid actually STARTS, and how far one deck has to move to
// put its beats on the other's. The tempo says how often a beat happens; this says when.
// No canvas and no React, so both answers are testable. See ../docs/bpm.md.

/** Where a song's beats fall, and whether the onsets actually said so. */
export interface BeatGrid {
  /** Where the first beat falls, in SOURCE seconds, always inside `[0, 60/bpm)`. */
  phase: number;
  /** 0 when the onsets say nothing about a grid, ~1 when they all land on one. */
  strength: number;
  /**
   * Is `phase` a MEASUREMENT or a shrug?
   *
   * `strength` alone cannot answer that, because what counts as high depends on how many
   * onsets there were: scattering `n` of them at random still leaves a resultant of about
   * `0.886/√n` — 0.04 for 400 onsets, 0.09 for 100 — so a bare threshold would call one
   * song confident and the other noise for no reason but its length.
   *
   * This is the RAYLEIGH test, which is that comparison done properly: `n·R²` against 4.6,
   * roughly p < 0.01 against "the onsets are spread evenly and there is no grid". Measured
   * on this machine's cache, it separates cleanly rather than marginally — 141 for a
   * four-on-the-floor house track, 17 for a pop song, 0.2 for one whose detected tempo is
   * simply wrong. Only the first two have a downbeat worth moving a record onto.
   */
  confident: boolean;
}

/** p ≈ 0.01 for the Rayleigh statistic `n·R²` — see `BeatGrid.confident`. */
export const RAYLEIGH_Z = 4.6;

/** Nothing to go on: a grid at zero, and saying so. */
export const NO_GRID: BeatGrid = { phase: 0, strength: 0, confident: false };

/**
 * Where the beat grid starts, from the onsets and the tempo.
 *
 * This is a CIRCULAR MEAN, not a first-onset guess. Fold every transient onto one beat
 * period — a time becomes an angle, `2π·t/P` — and average the unit vectors. Onsets that
 * fall on the beat point the same way and add up; everything else spreads around the circle
 * and cancels. The resulting angle is the phase, and the resulting LENGTH is how much the
 * onsets agreed, which is what `strength` reports.
 *
 * It replaces `transients[0]`, which the waveform used to anchor its beat lines on. One
 * onset is one measurement: a breath, a click, or a quiet intro hit half a beat early moved
 * the whole grid and every line drawn from it. Averaging 400 of them does not care.
 *
 * A tempo the analysis got wrong is still wrong here — this answers "where", never "how
 * often" — but it fails visibly: onsets scattered against the wrong period give a strength
 * near zero rather than a confident answer.
 */
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
  let phase = (((Math.atan2(y, x) / (2 * Math.PI)) * period + period) % period);
  // A grid that starts ON zero answers a hair either side of it, and a hair BELOW wraps to a
  // whole period — the same grid, described as maximally late. Snapping it back matters
  // because that number becomes a clip's `start`: a beat of silence at the top of a deck,
  // from a rounding error.
  if (period - phase < period * 1e-9) phase = 0;
  return {
    phase,
    strength,
    confident: transients.length * strength * strength > RAYLEIGH_Z,
  };
}

/**
 * The FIRST beat at or after `from`, given a grid — the anchor the waveform draws from.
 *
 * Kept here rather than in waveform.ts so the lines you see and the alignment you hear come
 * from one definition of where a beat is.
 */
export function firstBeatAfter(
  from: number,
  phase: number,
  period: number,
): number {
  if (!(period > 0)) return from;
  return phase + Math.ceil((from - phase) / period) * period;
}

/**
 * How far to delay the SLAVE so its beats land on the master's.
 *
 * Sync is two facts, and matching the tempos is only the first: two decks at 128 BPM whose
 * downbeats sit 200 ms apart are not synced, they are flamming. This is the second — the
 * offset that closes that gap.
 *
 * The arithmetic, in REAL seconds because that is the only clock the two share:
 *
 *   a source second `s` plays at `s · natural / target`, so a grid starting at `phase` in the
 *   file starts at `phase · natural / target` on the deck, and its beats then repeat every
 *   `60 / target`.
 *
 * Both decks are at the same `target` when this is asked (that is what sync did first), so
 * their beat PERIODS already match and only the offsets differ. The answer is their
 * difference, wrapped into one beat: never more than a beat of delay, and never negative,
 * which a clip start could not express anyway.
 *
 * Returned in TIMELINE beats, the unit `ClipDoc.start` is in — the document's own tempo, not
 * either song's.
 */
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
