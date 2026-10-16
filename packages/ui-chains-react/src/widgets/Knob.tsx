// Knob.tsx — a knob dial as an SVG arc, its reading in the middle and a curve's span inside the
// value's ring — docs/widgets.md.

import { MAUVE, SAND } from "../chainsCss";

// A knob dial as an SVG arc, 0..1, with `text` read in its middle — docs/widgets.md.
export function Knob({
  t,
  known,
  size,
  text,
  span,
}: {
  t: number;
  known: boolean;
  size: number;
  text?: string;
  /** The stretch of the travel a curve sweeps, drawn in mauve inside the value's ring. */
  span?: [number, number];
}) {
  const START = Math.PI * 0.75,
    SWEEP = Math.PI * 1.5;
  const c = size / 2;
  const R = c - 2.5;
  const pt = (a: number) => [c + Math.cos(a) * R, c + Math.sin(a) * R];
  const arc = (a0: number, a1: number, r = R) => {
    const [x0, y0] = [c + Math.cos(a0) * r, c + Math.sin(a0) * r];
    const [x1, y1] = [c + Math.cos(a1) * r, c + Math.sin(a1) * r];
    return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
  };
  // The depth gauge rides just inside the value's ring, so both read at once.
  const depthR = R - 3;
  const a = START + SWEEP * Math.max(0, Math.min(1, t));
  const [ix, iy] = pt(a);
  // The pointer starts here rather than at the centre, leaving the middle to the reading.
  const tickR = R * 0.72;
  const [tx, ty] = [c + Math.cos(a) * tickR, c + Math.sin(a) * tickR];
  const font = Math.max(6, Math.round(size * 0.2));
  // Monospace advance is ~0.6em; the -1 keeps a hair between the last glyph and the pointer.
  const readable = !!text && text.length * 0.6 * font <= 2 * (tickR - 1);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={c} cy={c} r={c - 1} fill="#0e0e12" stroke="#26262d" />
      <path
        d={arc(START, START + SWEEP)}
        fill="none"
        stroke="#2f2f36"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      {span && span[1] > span[0] && (
        <path
          d={arc(START + SWEEP * span[0], START + SWEEP * span[1], depthR)}
          fill="none"
          stroke={MAUVE}
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
      {known && (
        <>
          <path
            d={arc(START, a)}
            fill="none"
            stroke={SAND}
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <line
            x1={tx}
            y1={ty}
            x2={ix}
            y2={iy}
            stroke="#e7e6ea"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      )}
      {readable && (
        <text
          x={c}
          y={c}
          textAnchor="middle"
          dominantBaseline="central"
          fill={known ? "#e7e6ea" : "var(--faint)"}
          fontSize={font}
          fontFamily="ui-monospace, monospace"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {text}
        </text>
      )}
    </svg>
  );
}
