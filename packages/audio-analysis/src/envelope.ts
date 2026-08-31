// envelope.ts — the arithmetic of a `{file}.cache` sidecar, ported from engine/moteur's
// Waveform.cpp so a machine with ffmpeg and no engine produces the same thing. Every constant
// here is that file's; changing one alone makes two producers disagree about one sidecar.
// Onset detection is @studio/audio-probe's, which the C++ already mirrors. See docs/analysis.md.

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

/** Mirrors `kDefaultTransientSensitivity` in EngineHost.h. */
export const DEFAULT_TRANSIENT_SENSITIVITY = 2;

/**
 * Tempo by autocorrelation over a fixed-rate onset envelope, or 0 when nothing correlates.
 * 0 means "no tempo found" and never a guess: every grid derived from it trusts the number.
 */
export function detectBpm(onset: Float32Array, rate: number): number {
  if (onset.length < 16 || rate <= 0) return 0;

  // Mean-removed, or a loud passage simply correlates with itself.
  let mean = 0;
  for (const v of onset) mean += v;
  mean /= onset.length;
  const x = new Float64Array(onset.length);
  for (let i = 0; i < onset.length; i++) x[i] = onset[i] - mean;

  const minLag = Math.floor((rate * 60) / MAX_BPM);
  const maxLag = Math.ceil((rate * 60) / MIN_BPM);
  if (minLag < 1 || maxLag <= minLag || maxLag >= x.length) return 0;

  // Normalised by the overlap, or a short lag wins for having more terms to add up.
  const corr = (lag: number): number => {
    let sum = 0;
    const n = x.length - lag;
    for (let i = 0; i < n; i++) sum += x[i] * x[i + lag];
    return sum / n;
  };
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

/** The whole envelope, in one pass over the decoded mono signal. */
export function buildEnvelope(
  audio: DecodedAudio,
  fingerprint: string,
  sensitivity: number = DEFAULT_TRANSIENT_SENSITIVITY,
): FileEnvelope {
  const { sampleRate, channels, frames } = audio;
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
  const aLow = 1 - Math.exp((-TWO_PI * BAND_LOW_HZ) / sampleRate);
  const aHigh = 1 - Math.exp((-TWO_PI * BAND_HIGH_HZ) / sampleRate);
  let lpLow = 0;
  let lpHigh = 0;
  const framesPerBucket = frames > 0 ? frames / buckets : 1;

  // A SECOND envelope for tempo alone, at a fixed hop whatever the length.
  const tempoHops = frames > 0 ? Math.ceil(frames / FRAMES_PER_BUCKET) : 0;
  const tempoEnv = new Float32Array(Math.max(tempoHops, 0));
  const tempoRate = sampleRate / FRAMES_PER_BUCKET;

  let pos = 0;
  for (const block of audio.mono) {
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

  const peakArr = Array.from(peak);
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
    rms: Array.from(rms),
    transients,
    sensitivity,
    bpm: detectBpm(tempoEnv, tempoRate),
    low: Array.from(lowPk),
    mid: Array.from(midPk),
    high: Array.from(highPk),
  };
}
