// trimGate.ts — where a take actually starts and stops sounding. Given an envelope and a gate in
// dBFS, the first and last moment the signal is above it: the count-in bleed at the head and the
// room tail at the foot are what this removes. Pure, and the whole of the decision `event trim` makes.

/** The default gate: −40 dBFS — below a room's noise floor, above true digital silence. */
export const DEFAULT_TRIM_DB = -40;

/** What a zero bucket reads as — `PEAK_FLOOR_DB`'s twin, not imported so this file stays browser-safe. */
const MIN_DB = -100;

export interface TrimWindow {
  /** Seconds into the FILE where the sound starts and stops. `from` < `to` always. */
  from: number;
  to: number;
}

/** A linear 0..1 amplitude as dBFS. Zero is the floor rather than −Infinity, so comparisons are total. */
export const ampToDb = (amp: number): number =>
  amp > 0 ? 20 * Math.log10(amp) : MIN_DB;

/** The span of `env` above `gateDb` in seconds, bucket-accurate and clamped to `within` — docs/trimGate.md. */
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
  // The buckets the interval touches: a partly covered one counts — docs/trimGate.md.
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
