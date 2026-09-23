// performance.ts — how capable an engine's MACHINE is, as ONE integer. Where quality.ts rates
// the link (milliseconds, measured by the browser), this rates the box at the other end:
// measured once by the supervisor, carried on the heartbeat, drawn beside the latency badge.
// Browser-safe and dependency-free, like quality.ts, so every surface reads the same number.
// See docs/performance.md.

/** What the supervisor measures. `null` is "could not measure", never "slow" — see docs/performance.md. */
export interface EnginePerformanceMetrics {
  /** Logical cores the OS offers this process. */
  cores: number;
  /** One core's throughput on the reference DSP loop, in millions of samples per second. */
  singleThread: number;
  /** Sustained write to the state dir's disk, fsync included, MB/s. */
  diskWriteMBps: number | null;
  /** Small durable writes per second — what a take being recorded in blocks feels like. */
  fsyncPerSec: number | null;
  /** Physical memory, GiB. */
  memoryGB: number;
}

export interface EnginePerformance extends EnginePerformanceMetrics {
  /** The rating: 1000 is the reference machine, higher is faster; see performanceScore. */
  score: number;
}

/** The machine that scores exactly 1000: a mid-range 8-core laptop on an SSD. */
export const PERFORMANCE_REFERENCE: EnginePerformanceMetrics = {
  cores: 8,
  singleThread: 60,
  diskWriteMBps: 500,
  fsyncPerSec: 200,
  memoryGB: 16,
};

/** How much each metric counts. They sum to 1; one core leads because the audio callback runs on one. */
export const PERFORMANCE_WEIGHTS: Record<
  keyof EnginePerformanceMetrics,
  number
> = {
  singleThread: 0.35,
  cores: 0.25,
  diskWriteMBps: 0.15,
  fsyncPerSec: 0.1,
  memoryGB: 0.15,
};

/**
 * 1000 × the weighted GEOMETRIC mean of each metric over the reference's. Geometric, so the
 * score rises with every metric and doubling any one of them multiplies it by the same factor
 * wherever the others sit; a metric that could not be measured is left out and the remaining
 * weights renormalised, rather than counted as zero, which would sink the whole product.
 */
export function performanceScore(m: EnginePerformanceMetrics): number {
  let logSum = 0;
  let weight = 0;
  for (const key of Object.keys(PERFORMANCE_WEIGHTS) as Array<
    keyof EnginePerformanceMetrics
  >) {
    const value = m[key];
    const ref = PERFORMANCE_REFERENCE[key];
    if (value === null || ref === null || !(value > 0) || !(ref > 0)) continue;
    logSum += PERFORMANCE_WEIGHTS[key] * Math.log(value / ref);
    weight += PERFORMANCE_WEIGHTS[key];
  }
  if (weight === 0) return 0;
  return Math.max(1, Math.round(1000 * Math.exp(logSum / weight)));
}

/** The metrics with their score attached. */
export function enginePerformance(
  m: EnginePerformanceMetrics,
): EnginePerformance {
  return { ...m, score: performanceScore(m) };
}

/** "P 1240" — the one-line form a picker row shows beside the latency. */
export function formatPerformance(p: EnginePerformance): string {
  return `P ${p.score}`;
}

/** The breakdown behind the score, for a tooltip. */
export function describePerformance(p: EnginePerformance): string {
  const parts = [
    `${p.cores} cores`,
    `${Math.round(p.singleThread)} Msamples/s per core`,
    `${Math.round(p.memoryGB)} GB`,
  ];
  if (p.diskWriteMBps !== null)
    parts.push(`disk ${Math.round(p.diskWriteMBps)} MB/s`);
  if (p.fsyncPerSec !== null)
    parts.push(`${Math.round(p.fsyncPerSec)} fsync/s`);
  return parts.join(" · ");
}
