// envelope.ts — the arithmetic of a `{file}.cache` sidecar: peak/RMS, three colour bands, the
// tempo. This is the ONLY producer of one, whichever decoder fed it, so a constant changed here
// changes every sidecar — bump CACHE_VERSION with it, or old ones read as fresh for ever.
// Onset detection is @studio/audio-probe's. See docs/analysis.md.

import {
  detectTransients,
  type FileEnvelope,
} from "@studio/audio-probe/waveform";
import type { DecodedAudio } from "./decode.ts";

/** One bucket per 256 frames, capped so a long file coarsens while a one-shot keeps near-full detail. */
const FRAMES_PER_BUCKET = 256;
const MAX_BUCKETS = 8192;

// The two corners that split the envelope into three complementary bands, for COLOUR not for sound.
const BAND_LOW_HZ = 200;
const BAND_HIGH_HZ = 4000;
const TWO_PI = 6.283185307179586;

/** The musical range a detected tempo may land in, and the prior that keeps it there. */
const MIN_BPM = 60;
const MAX_BPM = 200;
const PRIOR_CENTRE_BPM = 120;
const PRIOR_OCTAVES = 1; // sigma, in octaves

/** Standard deviations above the mean jump; what a source nobody tuned is analysed with. */
export const DEFAULT_TRANSIENT_SENSITIVITY = 2;

/**
 * Tempo by autocorrelation over a fixed-rate onset envelope, or 0 when nothing correlates.
 * 0 means "no tempo found" and never a guess: every grid derived from it trusts the number.
 */
export function detectBpm(
  onset: Float32Array,
  rate: number,
  correlations: Correlations = jsCorrelations,
): number {
  if (onset.length < 16 || rate <= 0) return 0;
  const minLag = Math.floor((rate * 60) / MAX_BPM);
  const maxLag = Math.ceil((rate * 60) / MIN_BPM);
  if (minLag < 1 || maxLag <= minLag || maxLag >= onset.length) return 0;
  const table = correlations(onset, minLag, maxLag);
  const corr = (lag: number): number => table[lag - minLag];
  // Ellis's Gaussian weighting in log2-tempo — a PRIOR, not a fold.
  const prior = (lag: number): number => {
    const bpm = (60 * rate) / lag;
    const oct = Math.log2(bpm / PRIOR_CENTRE_BPM) / PRIOR_OCTAVES;
    return Math.exp(-0.5 * oct * oct);
  };

  let best = 0;
  let bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const score = corr(lag) * prior(lag);
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  if (bestLag <= 0 || best <= 0) return 0;

  // Parabolic interpolation: a whole-sample lag is ~1 bpm at 120, and 119 for 120 drifts every grid.
  let lagF = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const ym1 = corr(bestLag - 1) * prior(bestLag - 1);
    const yp1 = corr(bestLag + 1) * prior(bestLag + 1);
    const denom = ym1 - 2 * best + yp1;
    if (Math.abs(denom) > 1e-12) {
      const shift = (0.5 * (ym1 - yp1)) / denom;
      if (Math.abs(shift) <= 1) lagF += shift;
    }
  }

  const bpm = (60 * rate) / lagF;
  if (bpm < MIN_BPM || bpm > MAX_BPM) return 0;
  return Math.round(bpm * 100) / 100;
}

/** detectBpm's correlation at every lag of [minLag, maxLag]: in JS here, or by the Rust build (native.ts). */
export type Correlations = (
  onset: Float32Array,
  minLag: number,
  maxLag: number,
) => Float64Array;

/** The correlations of the mean-removed onset envelope, normalised by the overlap. */
export function jsCorrelations(
  onset: Float32Array,
  minLag: number,
  maxLag: number,
): Float64Array {
  // Mean-removed, or a loud passage simply correlates with itself.
  let mean = 0;
  for (const v of onset) mean += v;
  mean /= onset.length;
  const x = new Float64Array(onset.length);
  for (let i = 0; i < onset.length; i++) x[i] = onset[i] - mean;
  const out = new Float64Array(maxLag - minLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    // Normalised by the overlap, or a short lag wins for having more terms to add up.
    let sum = 0;
    const n = x.length - lag;
    for (let i = 0; i < n; i++) sum += x[i] * x[i + lag];
    out[lag - minLag] = sum / n;
  }
  return out;
}

/** What the pass over every sample yields, as Float32Arrays: in JS here, or by the Rust build. */
export interface Measured {
  peak: Float32Array;
  rms: Float32Array;
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
  tempo: Float32Array;
}

/** The two one-pole followers' coefficients, computed here so both builds use V8's Math.exp. */
export function followers(sampleRate: number): { aLow: number; aHigh: number } {
  return {
    aLow: 1 - Math.exp((-TWO_PI * BAND_LOW_HZ) / sampleRate),
    aHigh: 1 - Math.exp((-TWO_PI * BAND_HIGH_HZ) / sampleRate),
  };
}

/** The whole envelope, in one pass over the decoded mono signal. */
export function buildEnvelope(
  audio: DecodedAudio,
  fingerprint: string,
  sensitivity: number = DEFAULT_TRANSIENT_SENSITIVITY,
): FileEnvelope {
  return envelopeFrom(
    measureMono(audio.mono, audio.frames, audio.sampleRate),
    audio,
    fingerprint,
    sensitivity,
  );
}

/** The pass over every sample, in JS: what rust/src/measure.rs does operation for operation. */
export function measureMono(
  mono: readonly Float32Array[],
  frames: number,
  sampleRate: number,
): Measured {
  const buckets =
    frames <= 0
      ? 1
      : Math.min(
          MAX_BUCKETS,
          Math.max(1, Math.ceil(frames / FRAMES_PER_BUCKET)),
        );
  const peak = new Float32Array(buckets);
  const sumSq = new Float64Array(buckets);
  const count = new Float64Array(buckets);
  // Peaks and not RMS per band: a kick is an attack, and averaging one over a bucket loses it.
  const lowPk = new Float32Array(buckets);
  const midPk = new Float32Array(buckets);
  const highPk = new Float32Array(buckets);

  // Two one-pole followers whose differences are the three bands; their state crosses chunks.
  const { aLow, aHigh } = followers(sampleRate);
  let lpLow = 0;
  let lpHigh = 0;
  const framesPerBucket = frames > 0 ? frames / buckets : 1;

  // A SECOND envelope for tempo alone, at a fixed hop whatever the length.
  const tempoHops = frames > 0 ? Math.ceil(frames / FRAMES_PER_BUCKET) : 0;
  const tempoEnv = new Float32Array(Math.max(tempoHops, 0));

  let pos = 0;
  for (const block of mono) {
    for (let i = 0; i < block.length; i++) {
      const v = block[i];
      let b = Math.floor(pos / framesPerBucket);
      if (b >= buckets) b = buckets - 1;
      const a = Math.abs(v);
      if (a > peak[b]) peak[b] = a;

      // `lpLow` is everything under 200 Hz and `lpHigh` under 4 k, so mid and high are subtractions.
      lpLow += aLow * (v - lpLow);
      lpHigh += aHigh * (v - lpHigh);
      const lo = Math.abs(lpLow);
      const md = Math.abs(lpHigh - lpLow);
      const hi = Math.abs(v - lpHigh);
      if (lo > lowPk[b]) lowPk[b] = lo;
      if (md > midPk[b]) midPk[b] = md;
      if (hi > highPk[b]) highPk[b] = hi;
      sumSq[b] += v * v;
      count[b]++;

      const h = Math.floor(pos / FRAMES_PER_BUCKET);
      if (h >= 0 && h < tempoEnv.length && a > tempoEnv[h]) tempoEnv[h] = a;
      pos++;
    }
  }

  // Half-wave-rectified first difference: a beat is where energy RISES, and a sustained note
  // correlates with itself. Backwards, so each step still reads its untouched predecessor.
  for (let i = tempoEnv.length; i-- > 1; )
    tempoEnv[i] = Math.max(0, tempoEnv[i] - tempoEnv[i - 1]);
  if (tempoEnv.length) tempoEnv[0] = 0;

  const rms = new Float32Array(buckets);
  for (let b = 0; b < buckets; b++)
    rms[b] = count[b] > 0 ? Math.sqrt(sumSq[b] / count[b]) : 0;
  return { peak, rms, low: lowPk, mid: midPk, high: highPk, tempo: tempoEnv };
}

/** The sidecar's envelope from a measure, whichever build made it: onsets and the tempo are picked here. */
export function envelopeFrom(
  m: Measured,
  facts: { sampleRate: number; channels: number; frames: number },
  fingerprint: string,
  sensitivity: number = DEFAULT_TRANSIENT_SENSITIVITY,
  correlations: Correlations = jsCorrelations,
): FileEnvelope {
  const { sampleRate, channels, frames } = facts;
  const peakArr = Array.from(m.peak);
  const seconds = sampleRate > 0 ? frames / sampleRate : 0;
  // Onsets in FILE seconds, since seconds survive a change of bucket density that indices would not.
  const transients = detectTransients(peakArr, sensitivity).map((i) =>
    peakArr.length ? (i / peakArr.length) * seconds : 0,
  );

  return {
    fingerprint,
    sampleRate,
    channels,
    frames,
    seconds,
    peak: peakArr,
    rms: Array.from(m.rms),
    transients,
    sensitivity,
    bpm: detectBpm(m.tempo, sampleRate / FRAMES_PER_BUCKET, correlations),
    low: Array.from(m.low),
    mid: Array.from(m.mid),
    high: Array.from(m.high),
  };
}
