// waveform.ts — the arithmetic behind a playhead-centric waveform: which slice of a song is
// on screen, where a second lands in pixels, and where the beats are. No canvas, no React, so
// the parts that decide what you SEE are testable. See docs/waveform.md.

import type { FileEnvelope } from "@studio/audio-probe/waveform";
import { BEATS_PER_BAR, beatPhase, firstBeatAfter } from "./beats";

/** What the file service hands back for one cached song, less the cache's own fingerprint. */
export type Envelope = Omit<FileEnvelope, "fingerprint">;

/** How many seconds are visible at once — far enough to see the next phrase, tight enough to see a beat. */
export const WINDOW_SECONDS = 8;

/** The seconds visible at `at`, playhead in the MIDDLE — never clamped, see docs/waveform.md. */
export function window(at: number, span = WINDOW_SECONDS): [number, number] {
  return [at - span / 2, at + span / 2];
}

/** Where a moment in the song falls, 0..1 across the view. Outside means off-screen. */
export function xOf(
  seconds: number,
  at: number,
  span = WINDOW_SECONDS,
): number {
  return (seconds - (at - span / 2)) / span;
}

/** The peak bucket covering `seconds`, or null — a bucket's WIDTH depends on the song's length. */
export function bucketAt(env: Envelope, seconds: number): number | null {
  if (!(env.seconds > 0) || !env.peak.length) return null;
  if (seconds < 0 || seconds >= env.seconds) return null;
  const i = Math.floor((seconds / env.seconds) * env.peak.length);
  return i >= 0 && i < env.peak.length ? i : null;
}

/** The beats of a song in file seconds — an ESTIMATE, anchored on `beatPhase`. See docs/waveform.md. */
export function beatsIn(
  env: Envelope,
  from: number,
  to: number,
  /** Hard ceiling, so a bad tempo on a long window cannot ask for a million lines. */
  max = 512,
): number[] {
  return gridIn(env, from, to, 1, max);
}

/** The BAR lines — every fourth beat, because 4/4 is ASSUMED and not detected (docs/waveform.md). */
export function barsIn(
  env: Envelope,
  from: number,
  to: number,
  max = 128,
): number[] {
  return gridIn(env, from, to, BEATS_PER_BAR, max);
}

/** Every `every`-th beat inside the window, from the deck's own grid. */
function gridIn(
  env: Envelope,
  from: number,
  to: number,
  every: number,
  max: number,
): number[] {
  if (!(env.bpm > 0) || !(to > from)) return [];
  const period = (60 / env.bpm) * every;
  if (!(period > 0) || !Number.isFinite(period)) return [];
  // The grid the DECK aligns on, not this view's own guess — so what you see is what you hear.
  const anchor = beatPhase(env.transients, env.bpm).phase;
  const out: number[] = [];
  for (
    let t = firstBeatAfter(from, anchor, period);
    out.length < max;
    t += period
  ) {
    if (t > to) break;
    if (t >= 0) out.push(t);
  }
  return out;
}

/** Seconds as `m:ss`, and `-m:ss` for what is left — what makes the playhead's MOVEMENT visible. */
export function mmss(seconds: number): string {
  const sign = seconds < 0 ? "-" : "";
  const whole = Math.floor(Math.abs(seconds));
  const m = Math.floor(whole / 60);
  return `${sign}${m}:${String(whole % 60).padStart(2, "0")}`;
}

/** The transients inside `[from, to]` — a plain filter, they are already sorted and in file seconds. */
export function transientsIn(
  env: Envelope,
  from: number,
  to: number,
): number[] {
  return env.transients.filter((t) => t >= from && t <= to);
}
