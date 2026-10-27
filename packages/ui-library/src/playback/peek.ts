// peek.ts — the arithmetic of the bar's waveform: which second a pointer is over, and where a
// key moves the playhead. Pure, so the strip's gestures are testable without a DOM. See
// ../../docs/miniPlayer.md, "The waveform in the bar".

/** Seconds a small key step moves; a page key moves PAGE_STEP. */
export const KEY_STEP = 5;
export const PAGE_STEP = 30;

/** The second under `x` pixels into a strip `width` wide that shows `duration` seconds, clamped to it. */
export function timeAtX(x: number, width: number, duration: number): number {
  if (!(width > 0) || !(duration > 0)) return 0;
  const f = Math.max(0, Math.min(1, x / width));
  return f * duration;
}

/** Where `key` takes a playhead at `t`, or null for a key the strip does not answer. */
export function stepKey(
  key: string,
  t: number,
  duration: number,
): number | null {
  if (!(duration > 0)) return null;
  const to = (v: number) => Math.max(0, Math.min(duration, v));
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return to(t - KEY_STEP);
    case "ArrowRight":
    case "ArrowUp":
      return to(t + KEY_STEP);
    case "PageDown":
      return to(t - PAGE_STEP);
    case "PageUp":
      return to(t + PAGE_STEP);
    case "Home":
      return 0;
    case "End":
      return duration;
    default:
      return null;
  }
}

/** How far the peek's time bubble is shifted left, as a fraction of its width, so it never leaves the strip. */
export function bubbleShift(t: number, duration: number): number {
  if (!(duration > 0)) return 0.5;
  return Math.max(0, Math.min(1, t / duration));
}
