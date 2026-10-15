// dial.ts — the arithmetic behind the record's progress: where a moment sits on the dial, and
// the wedge that fills as the song plays. No SVG and no React, so the part that decides what
// you SEE is testable. See ../docs/vinyl.md.

/** The record's centre, in the viewBox `Vinyl` draws in. */
export const CENTRE = 50;

/** Where a fraction of the song sits on the dial — clockwise from TWELVE O'CLOCK, like every player. */
export function pointOnDial(
  fraction: number,
  radius: number,
): { x: number; y: number } {
  const angle = 2 * Math.PI * fraction - Math.PI / 2;
  return {
    x: CENTRE + radius * Math.cos(angle),
    y: CENTRE + radius * Math.sin(angle),
  };
}

/** The wedge over what has played — TWO shapes, because an arc whose ends coincide draws nothing. */
export function wedgePath(fraction: number, radius: number): string {
  if (!(fraction > 0) || !(radius > 0)) return "";
  if (fraction >= 1)
    return (
      `M ${CENTRE} ${CENTRE - radius} ` +
      `A ${radius} ${radius} 0 1 1 ${CENTRE - 0.001} ${CENTRE - radius} Z`
    );
  const { x, y } = pointOnDial(fraction, radius);
  const large = fraction > 0.5 ? 1 : 0;
  return (
    `M ${CENTRE} ${CENTRE} L ${CENTRE} ${CENTRE - radius} ` +
    `A ${radius} ${radius} 0 ${large} 1 ${x} ${y} Z`
  );
}

/** How far through the song, 0..1 — both numbers in the FILE's clock, and clamped past a clip's end. */
export function progressOf(at: number, length: number): number {
  if (!(length > 0)) return 0;
  return Math.min(1, Math.max(0, at / length));
}
