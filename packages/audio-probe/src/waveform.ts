// waveform.ts — slice a source file's precomputed ENVELOPE to the region a clip plays and
// derive the bar/beat grid from the project's tempo, so a waveform lines up with the
// arrangement. The heavy part (decode + downsample) belongs to the C++ engine, which
// writes a placement-independent `{source}.cache` sidecar; this only reads it.

import type { ClipDoc, ProjectDoc } from "@studio/engine-protocol/project";
import { beatAtSource, sourceAtBeat } from "@studio/song-schema/warpPoints";

// The whole-file envelope the engine computes and caches, placement-independent: it describes the FILE, and
// regionWaveform maps a clip's region onto it. A fixed-density downsample, 0..1.
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
  /**
   * The same envelope split into three bands, for COLOUR — the way a DJ player draws a track.
   *
   * Peaks per bucket, in the SAME bucket space as `peak`, so a consumer indexes all four the
   * same way. Split at 200 Hz and 4 kHz by complementary one-poles, so `low + mid + high` sums
   * back to the signal and a column's colour cannot invent energy it has not got.
   *
   * Optional because a sidecar written before v4 has none, and a surface that has them should
   * degrade to a plain envelope rather than to a blank one.
   */
  low?: number[];
  mid?: number[];
  high?: number[];
}

// A warp marker in DISPLAY seconds: `orig` where the source point is drawn, `target` where its beat lands — so
// the pair shows the stretch, and no displacement means no stretch there.
export interface WarpMark {
  orig: number; // display seconds — the source point, as the waveform draws it
  target: number; // display seconds — where that point's beat sits on the grid
  src: number; // the FILE second it pins — what `clip warp …` addresses
}

export interface RegionWaveform {
  peak: number[]; // per-bucket max |sample|, 0..1 (best for a filled/terminal waveform)
  rms: number[]; // per-bucket RMS, 0..1 (linear; feeds @studio/ui-waveform's dB Envelope)
  sampleRate: number;
  seconds: number; // duration of the region shown
  startBeat: number; // the clip's start in the arrangement (beats)
  clipBeats: number; // how many beats the region spans
  barBeats: number; // beats per bar
  tempo: number; // bpm
  warpMarks: WarpMark[]; // the clip's warp markers, in display seconds (empty == no warp)
  transients: number[]; // display seconds where transients are detected (grey bars)
  /**
   * A FILE second, as a position on the drawn region — the one mapping the marks above went
   * through, handed out rather than re-derived. Anything else the caller wants to put on this
   * picture (the material's own `from`/`to`, say) must land in the same space, and a second copy
   * of `(sec - inPoint) * stretch` somewhere else is how the two come to disagree.
   */
  toDisplay: (fileSec: number) => number;
  /**
   * …and the two numbers `toDisplay` IS, for a caller that has to go back the other way.
   *
   * `display = (file − inPoint) × stretch`, so `file = display / stretch + inPoint`. A function
   * cannot cross a wire, and the browser needs the inverse the moment a GESTURE on the picture
   * names a moment of the source — a double-click placing a stretch point does exactly that.
   * Sending the pair keeps the note above true across the wire: there is still one mapping, and
   * the far side applies it rather than reinventing it from `offset`, `sourceFrom` and a tempo.
   */
  sourceMap: { inPoint: number; stretch: number; zeroBeat: number };
}

/**
 * A simple transient detector: bucket indices where the peak envelope jumps above the threshold.
 *
 * THE REFERENCE IMPLEMENTATION, and mirrored byte-for-byte in `engine/moteur/engine/Waveform.cpp`, which is what
 * actually runs — the engine already has the decoded audio, so it detects while it is downsampling and writes the
 * result into the sidecar. Nothing in production calls this any more; it stays because it is the written spec,
 * and `waveform.test.ts` is the contract both sides are held to. The same arrangement `fileFingerprint` has.
 *
 * Changing it means changing both, and bumping the sidecar version so existing caches rebuild.
 */
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

/**
 * How many TIMELINE seconds one SOURCE second of this clip occupies — 1 when it is not warped.
 *
 * The engine's own formula, deliberately: `applyClipWarp` (EditBuilder.cpp) takes the first
 * marker to the last, prices the beat span at the project tempo, and divides by the source span.
 * Only that ratio reaches Tracktion — the interior markers become beat points inside it — so
 * matching it here is matching what is actually heard, not re-deriving a stretch of our own.
 *
 * A marker pair is `[timeline beat, source second]`: two different clocks in one tuple, which is
 * why the two spans are computed apart and only then divided.
 */
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

// Resample the file envelope to the region the clip plays. Placement and tempo live in the project, so they stay
// here; only the raw samples come from the engine-computed, disk-cached envelope.
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
  // Bars are in quarter-note beats here, so a bar is `numerator * 4/denominator` — 6/8 gives 3, 2/2 gives 4.
  // An odd-over-8 like 7/8 gives 3.5, which a whole-beat grid can only approximate: a pre-existing model limit.
  const den = project.timeSigDenominator || 4;
  const barBeats = Math.max(1, (project.timeSigNumerator || 4) * (4 / den));
  /**
   * Where in the SOURCE this clip starts playing, in seconds.
   *
   * TWO things add up, and only the second was ever read here: the clip file's own window
   * (`sourceFrom`, seconds — see AudioClipSchema) and the placement's `offset`. `placementToClip`
   * puts an audio clip's in-point in the FIRST of them and leaves `offset` at 0, so a drawing
   * that read only `offset` began every trimmed clip at the file's head — the picture showing one
   * part of the take while the engine played another. That is the offset this fixes; the engine's
   * own in-point is the same sum (`clipPositionFor` in EditBuilder.cpp).
   */
  const offsetSec = Math.max(0, clip.offset || 0);
  const inPointSec = Math.max(0, (clip.sourceFrom ?? 0) + offsetSec);
  // The display spans the clip's MUSICAL length, so a clip longer than its sample shows trailing silence.
  const seconds =
    clip.length > 0
      ? (clip.length * 60) / tempo
      : Math.max(0, fileSeconds - inPointSec);
  const clipBeats = clip.length > 0 ? clip.length : (seconds * tempo) / 60;
  // Timeline seconds per SOURCE second — 1 unless the clip is warped. A warped clip's picture is
  // not the file drawn at its own rate but at the rate it is PLAYED at, which is the whole of what
  // makes a waveform line up with what is heard.
  const stretch = warpStretch(clip.warp, tempo);
  /**
   * The map's own points, when there are enough of them to bend anything.
   *
   * PIECEWISE, because the engine is: `applyClipWarp` pins every interior marker as a beat point
   * so each segment stretches on its own. `stretch` is one ratio over the whole clip — the right
   * answer to "how long is this", which is what it is still used for below, and the wrong one to
   * "where is this moment". Drawn with the ratio alone, a point pinned in the middle moved the
   * sound and left the picture exactly where it was.
   */
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
  // What the region ASKS of the source, and what the file can actually give: the display span
  // priced back through the stretch, bounded by the clip's own `to` and by the end of the file.
  const endSec =
    clip.sourceTo && clip.sourceTo > inPointSec
      ? Math.min(clip.sourceTo, fileSeconds)
      : fileSeconds;
  // How many source frames the region asks for, at the map's OVERALL rate — a count, which is
  // what `stretch` answers well. Only the per-column spans below are piecewise.
  const wantFrames = Math.max(1, Math.round((seconds / stretch) * sr));
  const n = Math.max(1, Math.min(buckets, wantFrames));
  const peak = new Array<number>(n).fill(0);
  const rms = new Array<number>(n).fill(0);
  const dispPer = n > 0 ? seconds / n : 0;
  const framesPerEnv = envN > 0 ? totalFrames / envN : 1;
  // The last source frame this region may show — its own `to`, or the end of the file.
  const endFrame = Math.min(totalFrames, Math.floor(endSec * sr));
  for (let b = 0; b < n; b++) {
    /**
     * Which audio this column shows — ASKED of the mapping rather than stepped through.
     *
     * It used to advance by a constant `wantFrames / n`, which is a straight line and therefore
     * only correct while the map is one. Under a real map the segments run at different rates,
     * so a column near a pinned point covers more or less source than its neighbours — which is
     * the whole of what "the waveform reflects the warp" means.
     */
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
    }
    peak[b] = mx;
    rms[b] = cnt ? Math.sqrt(sq / cnt) : 0;
  }
  // Warp markers → display seconds: `orig` mirrors how the audio is drawn, `target` where its beat lands.
  /**
   * The map's points on the drawn region — and `orig === target` now, which is the POINT.
   *
   * The picture is warped, so a pinned moment is drawn exactly where it lands: there is no
   * displacement left to show, because it has been applied to the audio under it. The pair is
   * kept because a DRAG needs somewhere to put the target while the hand holds it, and the arrow
   * between the two is then the move being asked for rather than a state.
   *
   * Both are region-relative. `target` used to be the absolute beat priced in seconds, which
   * agreed with `orig` only while the clip was untrimmed — the two origins differed by the
   * in-point, silently, on exactly the clips a warp is usually for.
   */
  const warpMarks: WarpMark[] = (clip.warp?.markers ?? [])
    .map(([beat, srcSec]) => ({
      orig: toDisplay(srcSec),
      target: (beat - zeroBeat) * beatToDisp,
      // The FILE second it pins — what `clip warp` and `clip warp remove` address. Sent rather
      // than left to be inverted: the mapping is piecewise now, and a surface that rebuilt it to
      // name a point it can already see would be the second copy this file keeps warning about.
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

  // Transients are NOT detected here any more: they are computed once per FILE, by the engine, and cached in the
  // sidecar (see waveformCache.ts). This only maps them onto the shown region — the same shift `orig` gets above,
  // and the same linear file↔display mapping the envelope resampling uses, warp included.
  //
  // Detecting per region was subtly wrong as well as repeated: a short clip resamples the envelope UP, so the
  // detector ran on interpolated detail the file never had, and the same audio drawn at two sizes disagreed.
  const transients = env.transients
    .map(toDisplay)
    .filter((t) => t >= -1e-6 && t <= seconds + 1e-6);

  return {
    peak,
    rms,
    sampleRate: sr,
    seconds,
    startBeat: clip.start,
    clipBeats,
    barBeats,
    tempo,
    warpMarks,
    transients,
    toDisplay,
    // …and `zeroBeat` with them: the map's beats are counted from the FILE's start while the
    // region's zero is the clip's in-point, and every `target` above has had it subtracted. A
    // caller naming a beat must add it back, and on an untrimmed clip it is 0 — which is why its
    // absence was invisible until a trimmed one was warped.
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
