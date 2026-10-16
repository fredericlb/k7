// playhead.ts — where the transport puts the played clip and the line, in CSS, so moving it
// redraws no canvas. The played canvas is clipped from the RIGHT: what is left of the playhead
// shows through, which is the region a canvas clip used to repaint. See docs/layers.md.

/** The CSS for one playhead position `x` (px) on a box `width` px wide: the played canvas's clip and the line's offset. */
export function playheadPlacement(
  x: number,
  width: number,
): { clipPath: string; playedVisible: boolean; lineTransform: string } {
  const right = Math.max(0, Math.min(width, width - x));
  return {
    clipPath: `inset(0 ${right}px 0 0)`,
    playedVisible: x > 0,
    // The line is 2px wide and was stroked centred on x, so it starts a pixel before.
    lineTransform: `translateX(${x - 1}px)`,
  };
}
