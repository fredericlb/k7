// quality.ts — how good a link to an engine is, as ONE number and a band. The number is
// milliseconds from a gesture to a sound: the network round trip plus what the audio
// interface adds. Browser-safe and dependency-free, because the browsers measure it, the
// surfaces draw it, and the backends will constrain on it.

/** The bands. Q1 is playable, Q2 is workable, Q3 is for listening rather than performing. */
export type EngineQuality = "Q1" | "Q2" | "Q3";

/** Where the bands break, in milliseconds. Q1 < 20 ≤ Q2 < 50 ≤ Q3. */
export const QUALITY_THRESHOLDS_MS = { q1: 20, q2: 50 } as const;

/** The band a latency falls in. */
export function qualityOf(latencyMs: number): EngineQuality {
  if (latencyMs < QUALITY_THRESHOLDS_MS.q1) return "Q1";
  if (latencyMs < QUALITY_THRESHOLDS_MS.q2) return "Q2";
  return "Q3";
}

/**
 * What the audio interface adds, in ms: a buffer in and a buffer out.
 *
 * TWICE the buffer period, because the figure that matters is the one a player feels — a
 * note goes in, gets a block late, comes back a block later. One period would describe
 * playback alone and quietly halve the number that decides whether you can perform on this
 * engine at all. It is still a floor, not the truth: converters and drivers add their own,
 * and the engine reports the only part it knows.
 *
 * Zero when the device has not opened yet (or reported nothing) — an unknown is not a fast
 * one, so callers treat it as "not measured" rather than adding 0 to the round trip.
 */
export function audioLatencyMs(
  bufferFrames: number,
  sampleRate: number,
): number {
  if (!(bufferFrames > 0) || !(sampleRate > 0)) return 0;
  return (2 * bufferFrames * 1000) / sampleRate;
}

/** One engine's link, as measured. `audioMs` is 0 when the engine reported no open device. */
export interface EngineLatency {
  /** The whoami round trip, ms — a ping, in the sense every musician means. */
  networkMs: number;
  /** What the interface adds, ms. See audioLatencyMs. */
  audioMs: number;
  /** Their sum, which is what the band is read off. */
  totalMs: number;
  quality: EngineQuality;
}

export function engineLatency(
  networkMs: number,
  bufferFrames: number,
  sampleRate: number,
): EngineLatency {
  const audioMs = audioLatencyMs(bufferFrames, sampleRate);
  const totalMs = networkMs + audioMs;
  return { networkMs, audioMs, totalMs, quality: qualityOf(totalMs) };
}

/** "Q1 · 12 ms" — the one-line form every status bar and picker row shows. */
export function formatLatency(l: EngineLatency): string {
  return `${l.quality} · ${Math.round(l.totalMs)} ms`;
}
