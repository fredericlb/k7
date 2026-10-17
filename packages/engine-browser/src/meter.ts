// meter.ts — the arithmetic behind a level meter: dB to a bar's fill, and the two things a bar
// has to REMEMBER across a pass (whether it clipped, and how loud it got).
//
// Here rather than in a component because two apps draw the same meter off the same frames — k7's
// header and the DJ desk's channel strips — and a second copy of `clipLatch` is a second answer to
// "is the light still on". Pure functions: the subscription is `useEngineState`'s job, not this file's.
// See docs/meters.md.

/** The bottom of the scale, in dB. Below this the bar is empty rather than negative. */
export const FLOOR_DB = -60;

/** Where the bar turns from green to amber — the last few dB before there is no headroom left. */
export const HOT_DB = -6;

/** Where it turns red: full scale, the level past which a sample is clipped. */
export const CLIP_DB = 0;

/** The scale's corners, dB → place on the bar: the top 20 dB, where a mix is judged, get 60% of it (docs/meters.md). */
const SCALE: readonly (readonly [number, number])[] = [
  [FLOOR_DB, 0],
  [-40, 0.15],
  [-20, 0.4],
  [HOT_DB, 0.8],
  [CLIP_DB, 1],
];

/** dB → 0..1 along the bar, linear in dB between the scale's corners and clamped at both ends. */
export const meterFill = (db: number): number => {
  if (!(db > FLOOR_DB)) return 0;
  for (let i = 1; i < SCALE.length; i++) {
    const [d1, p1] = SCALE[i];
    if (db <= d1) {
      const [d0, p0] = SCALE[i - 1];
      return p0 + ((db - d0) / (d1 - d0)) * (p1 - p0);
    }
  }
  return 1;
};

/** Which of the three colours the bar wears at this level. */
export type MeterZone = "ok" | "hot" | "clip";
export const meterZone = (db: number): MeterZone =>
  db >= CLIP_DB ? "clip" : db >= HOT_DB ? "hot" : "ok";

/** How long the peak mark stays where the loudest moment put it, before it starts to fall. */
export const PEAK_HOLD_MS = 1500;

/** How fast it falls once released, in dB per second — the IEC peak meter's return, near enough. */
export const PEAK_RELEASE_DB_PER_S = 20;

/** The peak mark's memory: the level it was raised to and when. What it SHOWS is derived, so a release never compounds frame to frame. */
export interface PeakMark {
  db: number;
  at: number;
}

/** Where the mark stands at `now`: held, then falling at the release rate, never below the floor. */
export const peakMarkLevel = (mark: PeakMark, now: number): number => {
  const late = now - mark.at - PEAK_HOLD_MS;
  if (late <= 0) return mark.db;
  return Math.max(FLOOR_DB, mark.db - (late / 1000) * PEAK_RELEASE_DB_PER_S);
};

/** The mark after this frame: raised (and its hold restarted) by anything at or above where it stands, or by a new pass. */
export const nextPeakMark = (
  mark: PeakMark,
  db: number,
  now: number,
  passStarted: boolean,
): PeakMark =>
  passStarted || db >= peakMarkLevel(mark, now) ? { db, at: now } : mark;

/** The rising edge of `playing`: a NEW pass has begun — the one event that makes the light and the peak stale. */
export const newPass = (playing: boolean, wasPlaying: boolean): boolean =>
  playing && !wasPlaying;

/** Whether the clip light is lit after this frame — it survives the stop, and only a new pass clears it. */
export const clipLatch = (
  lit: boolean,
  overload: boolean,
  playing: boolean,
  wasPlaying: boolean,
): boolean => overload || (lit && !newPass(playing, wasPlaying));

/** The loudest it got during this pass — cleared on the same edge as the light, and RESTARTED from this frame. */
export const peakHold = (
  held: number,
  now: number,
  playing: boolean,
  wasPlaying: boolean,
): number => (newPass(playing, wasPlaying) ? now : Math.max(held, now));
