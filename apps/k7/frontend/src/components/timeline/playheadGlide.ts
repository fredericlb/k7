// playheadGlide.ts — the timeline's line as ONE linear compositor animation, restarted only when the clock disagrees with it.
// A transform written per frame costs the whole page a re-layerize per frame; an animation costs nothing between restarts (docs/playhead.md).

/** How far the animation may stray from the clock before it is restarted from where the clock says. */
export const GLIDE_TOLERANCE_PX = 0.5;

export interface Glide {
  anim: Animation | null;
  x0: number;
  t0: number;
  xEnd: number;
  pxPerMs: number;
}

export const NO_GLIDE: Glide = {
  anim: null,
  x0: 0,
  t0: 0,
  xEnd: 0,
  pxPerMs: 0,
};

/** Where a running glide has the line at `now`, or null when nothing glides. */
export function glidePosition(g: Glide, now: number): number | null {
  if (!g.anim) return null;
  return Math.min(g.x0 + (now - g.t0) * g.pxPerMs, g.xEnd);
}

/** True when the glide can keep running: same course, and within tolerance of where the clock puts the line. */
export function glideHolds(
  g: Glide,
  x: number,
  xEnd: number,
  pxPerMs: number,
  now: number,
): boolean {
  const at = glidePosition(g, now);
  return (
    at !== null &&
    g.xEnd === xEnd &&
    g.pxPerMs === pxPerMs &&
    Math.abs(at - x) <= GLIDE_TOLERANCE_PX
  );
}

/** Put the line at `x`: parked when stopped, else gliding to `xEnd` at `pxPerMs`, keeping the running animation whenever it still holds. */
export function steerGlide(
  el: HTMLElement,
  g: Glide,
  x: number,
  xEnd: number,
  pxPerMs: number,
  playing: boolean,
  now: number,
): Glide {
  if (playing && glideHolds(g, x, xEnd, pxPerMs, now)) return g;
  g.anim?.cancel();
  el.style.transform = `translateX(${x}px)`;
  if (!playing || pxPerMs <= 0 || xEnd <= x) return NO_GLIDE;
  const anim = el.animate(
    [
      { transform: `translateX(${x}px)` },
      { transform: `translateX(${xEnd}px)` },
    ],
    { duration: (xEnd - x) / pxPerMs, easing: "linear", fill: "forwards" },
  );
  return { anim, x0: x, t0: now, xEnd, pxPerMs };
}
