// waveform.ts — slice a source file's precomputed ENVELOPE to the region a clip plays and
// derive the bar/beat grid from the project's tempo, so a waveform lines up with the
// arrangement. The heavy part (decode + downsample) belongs to the C++ engine, which
// writes a placement-independent `{source}.cache` sidecar; this only reads it.

import type { ClipDoc, ProjectDoc } from "@studio/engine-protocol/project";
import { beatAtSource, sourceAtBeat } from "@studio/song-schema/warpPoints";

// The whole-file envelope the engine computes and caches — placement-independent, docs/waveform.md.
export interface FileEnvelope {
  fingerprint: string; // cheap content fingerprint (see waveformCache.ts) for invalidation
  sampleRate: number;
  channels: number;
  frames: number; // total source frames (per channel)
  seconds: number; // frames / sampleRate
  peak: number[]; // per-bucket max |sample|, 0..1
  rms: number[]; // per-bucket RMS, 0..1 (linear)
  transients: number[]; // onsets in FILE seconds, detected by the engine at this file's own resolution
  sensitivity: number; // the threshold those onsets were found with — per source, and sticky (docs/waveformCache.md)
  bpm: number; // the engine's tempo estimate, or 0 for "none found". A starting point, not an authority.
  /** The same envelope split into three bands for COLOUR, in the same bucket space — docs/waveform.md. */
  low?: number[];
  mid?: number[];
  high?: number[];
}

// A warp marker in DISPLAY seconds: `orig` where the source point is drawn, `target` where its beat lands.
export interface WarpMark {
  orig: number; // display seconds — the source point, as the waveform draws it
  target: number; // display seconds — where that point's beat sits on the grid
  src: number; // the FILE second it pins — what `clip warp …` addresses
}

export interface RegionWaveform {
  peak: number[]; // per-bucket max |sample|, 0..1 (best for a filled/terminal waveform)
  rms: number[]; // per-bucket RMS, 0..1 (linear; feeds @studio/ui-waveform's dB Envelope)
  /** The file's three band peaks resampled like `peak`, absent when the sidecar has none — docs/waveform.md. */
  low?: number[];
  mid?: number[];
  high?: number[];
  sampleRate: number;
  seconds: number; // duration of the region shown
  startBeat: number; // the clip's start in the arrangement (beats)
  clipBeats: number; // how many beats the region spans
  barBeats: number; // beats per bar
  tempo: number; // bpm
  warpMarks: WarpMark[]; // the clip's warp markers, in display seconds (empty == no warp)
  transients: number[]; // display seconds where transients are detected (grey bars)
  /** A FILE second as a position on the drawn region — the ONE mapping, handed out, docs/waveform.md. */
  toDisplay: (fileSec: number) => number;
  /** …and the numbers `toDisplay` IS, for a caller going back the other way across a wire. */
  sourceMap: { inPoint: number; stretch: number; zeroBeat: number };
}

/** A simple transient detector, and THE REFERENCE IMPLEMENTATION rather than the code that runs — docs/waveform.md. */
export function detectTransients(peak: number[], sensitivity = 2): number[] {
  if (peak.length < 3) return [];
  const diffs: number[] = [];
  for (let i = 1; i < peak.length; i++) diffs.push(peak[i] - peak[i - 1]);
  if (!diffs.length) return [];
  // Mean and stddev of the first-derivative envelope
  let sum = 0;
  for (let i = 0; i < diffs.length; i++) sum += diffs[i];
  const mean = sum / diffs.length;
  let ssq = 0;
  for (let i = 0; i < diffs.length; i++) {
    const d = diffs[i] - mean;
    ssq += d * d;
  }
  const std = Math.sqrt(ssq / diffs.length);
  const threshold = mean + sensitivity * std;
  // A positive jump above the threshold, skipping detections within 3 buckets to avoid double-hits on one attack.
  const result: number[] = [];
  const MIN_GAP = 3;
  let lastIdx = -MIN_GAP;
  for (let i = 0; i < diffs.length; i++) {
    if (diffs[i] > threshold && i - lastIdx >= MIN_GAP) {
      result.push(i + 1); // +1: the bucket AFTER the jump is the transient onset
      lastIdx = i + 1;
    }
  }
  return result;
}

/** How many TIMELINE seconds one SOURCE second occupies, 1 unwarped — the engine's own formula, docs/waveform.md. */
export function warpStretch(
  warp: ClipDoc["warp"] | undefined,
  tempo: number,
): number {
  const m = warp?.markers;
  if (!m || m.length < 2 || tempo <= 0) return 1;
  const beatSpan = m[m.length - 1][0] - m[0][0];
  const srcSpan = m[m.length - 1][1] - m[0][1];
  // A degenerate map says nothing about the rate; drawing the file at its own is the honest answer.
  if (!(srcSpan > 0) || !(beatSpan > 0)) return 1;
  return (beatSpan * 60) / tempo / srcSpan;
}

// Resample the file envelope to the region the clip plays — only the raw samples come from the sidecar.
export function regionWaveform(
  env: FileEnvelope,
  clip: ClipDoc,
  project: ProjectDoc,
  buckets: number,
): RegionWaveform {
  const sr = env.sampleRate || 48000;
  const totalFrames = Math.max(0, env.frames | 0);
  const fileSeconds = env.seconds || totalFrames / sr;
  const tempo = project.tempo || 120;
  // Bars are in quarter-note beats, so a bar is `numerator * 4/denominator` — docs/waveform.md.
  const den = project.timeSigDenominator || 4;
  const barBeats = Math.max(1, (project.timeSigNumerator || 4) * (4 / den));
  // Where in the SOURCE this clip starts: `sourceFrom` AND `offset` add up — docs/waveform.md.
  const offsetSec = Math.max(0, clip.offset || 0);
  const inPointSec = Math.max(0, (clip.sourceFrom ?? 0) + offsetSec);
  // The display spans the clip's MUSICAL length, so a clip longer than its sample shows trailing silence.
  const seconds =
    clip.length > 0
      ? (clip.length * 60) / tempo
      : Math.max(0, fileSeconds - inPointSec);
  const clipBeats = clip.length > 0 ? clip.length : (seconds * tempo) / 60;
  // Timeline seconds per SOURCE second — a warped clip is drawn at the rate it is PLAYED at.
  const stretch = warpStretch(clip.warp, tempo);
  // The map's own points, used PIECEWISE because the engine pins each of them — docs/waveform.md.
  const markers = clip.warp?.markers;
  const warped = Array.isArray(markers) && markers.length >= 2;
  const beatToDisp = 60 / tempo;
  // Where the clip's in-point lands, so display 0 stays the clip's start whatever the map says.
  const zeroBeat = warped ? beatAtSource(markers, inPointSec) : 0;
  /** A source position, as a position on the drawn region. The one mapping everything below uses. */
  const toDisplay = (srcSec: number): number =>
    warped
      ? (beatAtSource(markers, srcSec) - zeroBeat) * beatToDisp
      : (srcSec - inPointSec) * stretch;
  /** …and back, which is what resamples the envelope: a display bucket asks which audio it shows. */
  const toSource = (dispSec: number): number =>
    warped
      ? sourceAtBeat(markers, zeroBeat + dispSec / beatToDisp)
      : dispSec / (stretch || 1) + inPointSec;

  const envN = env.peak.length;
  const startFrame = Math.min(totalFrames, Math.floor(inPointSec * sr));
  // What the file can give: bounded by the clip's own `to` and by the end of the file.
  const endSec =
    clip.sourceTo && clip.sourceTo > inPointSec
      ? Math.min(clip.sourceTo, fileSeconds)
      : fileSeconds;
  // How many source frames the region asks for, at the map's OVERALL rate — a count, not a position.
  const wantFrames = Math.max(1, Math.round((seconds / stretch) * sr));
  const n = Math.max(1, Math.min(buckets, wantFrames));
  const peak = new Array<number>(n).fill(0);
  const rms = new Array<number>(n).fill(0);
  // The bands ride only when all three cover the same buckets as `peak`, the space they are indexed in.
  const src = [env.low, env.mid, env.high];
  const hasBands = src.every((b) => b?.length === envN);
  const bands = hasBands ? src.map(() => new Array<number>(n).fill(0)) : null;
  const dispPer = n > 0 ? seconds / n : 0;
  const framesPerEnv = envN > 0 ? totalFrames / envN : 1;
  // The last source frame this region may show — its own `to`, or the end of the file.
  const endFrame = Math.min(totalFrames, Math.floor(endSec * sr));
  for (let b = 0; b < n; b++) {
    // Which audio this column shows — ASKED of the mapping rather than stepped through.
    const f0 = Math.max(startFrame, Math.floor(toSource(b * dispPer) * sr));
    const f1 = Math.min(endFrame, Math.floor(toSource((b + 1) * dispPer) * sr));
    if (f1 <= f0 || envN === 0) continue; // past the audio: the column stays silent
    const e0 = Math.floor(f0 / framesPerEnv);
    const e1 = Math.max(e0 + 1, Math.min(envN, Math.ceil(f1 / framesPerEnv)));
    let mx = 0;
    let sq = 0;
    let cnt = 0;
    for (let e = e0; e < e1 && e < envN; e++) {
      if (env.peak[e] > mx) mx = env.peak[e];
      sq += env.rms[e] * env.rms[e];
      cnt++;
      if (bands)
        for (let k = 0; k < 3; k++) {
          const v = (src[k] as number[])[e];
          if (v > bands[k][b]) bands[k][b] = v;
        }
    }
    peak[b] = mx;
    rms[b] = cnt ? Math.sqrt(sq / cnt) : 0;
  }
  // The map's points on the drawn region, region-relative and `orig === target` — docs/waveform.md.
  const warpMarks: WarpMark[] = (clip.warp?.markers ?? [])
    .map(([beat, srcSec]) => ({
      orig: toDisplay(srcSec),
      target: (beat - zeroBeat) * beatToDisp,
      // The FILE second it pins, sent rather than left to be inverted from a piecewise map.
      src: srcSec,
    }))
    .filter(
      (mk) =>
        Number.isFinite(mk.orig) &&
        Number.isFinite(mk.target) &&
        // keep a marker whose original OR target falls inside the shown region
        ((mk.orig >= -1e-6 && mk.orig <= seconds + 1e-6) ||
          (mk.target >= -1e-6 && mk.target <= seconds + 1e-6)),
    );

  // Transients are detected once per FILE by the engine; this only maps them on — docs/waveform.md.
  const transients = env.transients
    .map(toDisplay)
    .filter((t) => t >= -1e-6 && t <= seconds + 1e-6);

  return {
    peak,
    rms,
    ...(bands ? { low: bands[0], mid: bands[1], high: bands[2] } : {}),
    sampleRate: sr,
    seconds,
    startBeat: clip.start,
    clipBeats,
    barBeats,
    tempo,
    warpMarks,
    transients,
    toDisplay,
    // …and `zeroBeat` with them, which a caller naming a beat must add back — docs/waveform.md.
    sourceMap: { inPoint: inPointSec, stretch, zeroBeat },
  };
}

export interface GridLine {
  t: number; // seconds from the region start
  bar: boolean; // a bar boundary (vs. a plain beat)
  label?: string; // bar number, on bar boundaries
}

// Bar/beat gridlines for a region, aligned to the arrangement and positioned in seconds.
export function beatGrid(w: RegionWaveform): GridLine[] {
  const lines: GridLine[] = [];
  const last = w.startBeat + w.clipBeats;
  for (let B = Math.ceil(w.startBeat - 1e-9); B <= last + 1e-9; B++) {
    const t = ((B - w.startBeat) * 60) / w.tempo;
    const bar = ((B % w.barBeats) + w.barBeats) % w.barBeats === 0;
    lines.push({
      t,
      bar,
      label: bar ? String(Math.floor(B / w.barBeats) + 1) : undefined,
    });
  }
  return lines;
}
