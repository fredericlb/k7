// trimGate.ts — where a take actually starts and stops sounding. Given an envelope and a gate in
// dBFS, the first and last moment the signal is above it: the count-in bleed at the head and the
// room tail at the foot are what this removes. Pure, and the whole of the decision `event trim` makes.

/** The default gate: −40 dBFS. Below a room's noise floor on any usable take, above true digital
 *  silence, so a take recorded with the preamp up does not trim to nothing. */
export const DEFAULT_TRIM_DB = -40;

/**
 * What a zero bucket reads as — the scale's floor, not a magic number.
 *
 * The SAME floor `peakPass.ts` declares as `PEAK_FLOOR_DB`, and deliberately not imported from
 * there: this file is browser-safe and st0's clip panel imports it, while `peakPass` reaches for
 * `node:child_process`. Sharing the constant would drag a process spawner into the browser to
 * save one number. The duplication is structural — see `docs/inventaire.md`.
 */
const MIN_DB = -100;

export interface TrimWindow {
  /** Seconds into the FILE where the sound starts and stops. `from` < `to` always. */
  from: number;
  to: number;
}

/** A linear 0..1 amplitude as dBFS. Zero is the floor rather than −Infinity, so comparisons are total. */
export const ampToDb = (amp: number): number =>
  amp > 0 ? 20 * Math.log10(amp) : MIN_DB;

/**
 * The span of `env` above `gateDb`, in seconds — head and tail silence removed.
 *
 * Bucket-accurate and no finer, which is the honest resolution: the envelope IS buckets, and
 * pretending to a sample would be inventing precision the picture never had. The window is widened
 * by one bucket at each end for exactly that reason — a gate is a decision about where sound
 * begins, and clipping the attack that crossed it would be audible where a few silent milliseconds
 * are not.
 *
 * `within` is the interval the clip already PLAYS — its current `from`/`to` — and the gate looks
 * only inside it: a re-trim refines the window and never reaches back into material an earlier
 * trim removed. The answer is clamped to it, widening included. Omitted, the whole file is the
 * interval, which is what a first trim is.
 *
 * Null when nothing in the interval is above the gate. That is not a trim to nothing: a take
 * entirely below the gate is either silence or a gate set too high, and both are things to say
 * rather than to apply. The caller refuses.
 */
export function trimWindow(
  env: readonly number[],
  seconds: number,
  gateDb: number,
  within?: TrimWindow | null,
): TrimWindow | null {
  if (!env.length || !(seconds > 0)) return null;
  const per = seconds / env.length;
  const lo = Math.max(0, Math.min(within?.from ?? 0, seconds));
  const hi = Math.max(lo, Math.min(within?.to ?? seconds, seconds));
  if (!(hi > lo)) return null;
  // The buckets the interval touches — a partly covered bucket counts, the honest reading of a
  // resolution coarser than the bound.
  const i0 = Math.max(0, Math.floor(lo / per));
  const i1 = Math.min(env.length - 1, Math.ceil(hi / per) - 1);
  let first = -1;
  let last = -1;
  for (let i = i0; i <= i1; i++)
    if (ampToDb(env[i]) > gateDb) {
      if (first < 0) first = i;
      last = i;
    }
  if (first < 0) return null;

  const from = Math.max(lo, (first - 1) * per);
  const to = Math.min(hi, (last + 2) * per);
  // A single bucket over the gate still has to be a window, not a point.
  return to > from ? { from, to } : null;
}
