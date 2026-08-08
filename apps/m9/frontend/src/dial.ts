// dial.ts — the arithmetic behind the record's progress: where a moment sits on the dial, and
// the wedge that fills as the song plays. No SVG and no React, so the part that decides what
// you SEE is testable. See ../docs/vinyl.md.

/** The record's centre, in the viewBox `Vinyl` draws in. */
export const CENTRE = 50;

/**
 * Where a fraction of the song sits on the dial, as a point.
 *
 * Clockwise from TWELVE O'CLOCK, because that is where every clock and every DJ player puts
 * the start — a dial that began at three would be read wrong by everyone once, and by nobody
 * twice, which is worse than being read wrong always.
 */
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

/**
 * The wedge covering the part of the song already played — empty at 0, the whole disc at 1.
 *
 * Two shapes rather than one, and the seam is why. An SVG arc whose start and end coincide
 * draws NOTHING: at exactly 1 the sweep would vanish, so a record that had just finished
 * would look like one that had not started. The full circle is therefore its own path.
 *
 * `largeArcFlag` is the other half of the same trap — past the halfway mark an arc takes the
 * short way round unless it is told, so a track over 50 % would draw its own complement.
 */
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

/**
 * How far through the song a deck is, 0..1.
 *
 * `at` and `length` are both in the FILE's own clock, so this is right whatever the tempo
 * fader is doing — a stretched deck is not further through its record than an unstretched one
 * at the same bar. Clamped, because the transport can sit past the end of a clip.
 */
export function progressOf(at: number, length: number): number {
  if (!(length > 0)) return 0;
  return Math.min(1, Math.max(0, at / length));
}
