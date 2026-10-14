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

/** dB → 0..1 across the drawn scale. Linear in dB, which is what a meter's markings are. */
export const meterFill = (db: number): number =>
  Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB));

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
