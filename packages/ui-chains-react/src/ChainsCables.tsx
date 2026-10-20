// ChainsCables.tsx — the SVG layer between the canvas and the cards: a cable's label, arrow and
// hit path. The cables themselves are painted on the canvas — docs/liveCables.md.

import type { WebSignal } from "@studio/graph-model";
import { AUTO_ALPHA, FOREIGN_ALPHA } from "@studio/ui-chains/cableCanvas";
import {
  type AutoTarget,
  type CableGeom,
  midByArc,
  smoothPath,
} from "@studio/ui-chains/cables";
import type { EdgeInsert } from "@studio/ui-chains/graph";
import { memo } from "react";
import { onEnter } from "./keyActivate";

export interface EdgeGeom extends CableGeom {
  id: string;
  source: string;
  target: string;
  label?: string;
  signal?: WebSignal; // what the cable carries — picks its colour (see cableColor)
  /** This cable merely CROSSES an open frame rather than belonging to it — drawn at half. */
  faded?: boolean;
  insert: EdgeInsert | null;
}

// --- controls ----------------------------------------------------------------

// The SVG layer OVER the cable canvas: the labels and the hit paths, everything that does not move.
function CablesInner({
  signal,
  auto,
  showLabels,
  hovered,
  setHovered,
  onInsert,
}: {
  signal: EdgeGeom[];
  auto: AutoTarget[];
  showLabels: boolean;
  hovered: string | null;
  setHovered: (id: string | null) => void;
  // The pointer position travels with it: the `+` opens a picker, which must land where you clicked.
  onInsert?: (
    info: EdgeInsert,
    x: number,
    y: number,
    // WORLD coords of the cable's midpoint — where the picked module will be BORN.
    at: { x: number; y: number },
  ) => void;
}) {
  return (
    <>
      {/* A signal cable's NAME, kept in SVG while the cable is on the canvas; see docs/liveCables.md. */}
      {signal.map((g) => {
        const pts = g.base;
        if (!showLabels || !g.label || pts.length < 2) return null;
        const mid = pts[Math.floor(pts.length / 2)];
        return (
          <text
            key={g.id}
            className="dgx-clab"
            x={mid.x}
            y={mid.y - 6}
            textAnchor="middle"
            // A label at full strength over a half-strength cable reads as a different cable.
            opacity={g.faded ? FOREIGN_ALPHA : undefined}
          >
            {g.label}
          </text>
        );
      })}

      {/* Only the param LABEL stays here, at the chord midpoint so the hang sags clear below it. */}
      {showLabels &&
        auto.map((s) => {
          const lab = s.onWidget
            ? {
                x: (s.from.x + s.to.x) / 2,
                y: (s.from.y + s.to.y) / 2 - 6,
                anchor: "middle" as const,
              }
            : { x: s.to.x - 4, y: s.to.y - 12, anchor: "end" as const };
          return (
            <text
              key={s.id}
              className="dgx-alab"
              x={lab.x}
              y={lab.y}
              textAnchor={lab.anchor}
              // As faint as its cable: a label at full strength would read as a cable of its own.
              opacity={AUTO_ALPHA}
            >
              {s.param}
            </text>
          );
        })}

      {/* insert affordance — a transparent hit path per eligible arrow, and a `+` shown on hover or keyboard focus. */}
      {signal.map((g) => {
        // No host to answer it, no `+`: an affordance that does nothing reads as a click that was missed.
        if (!g.insert || !onInsert) return null;
        const ins = g.insert;
        const d = smoothPath(g.base);
        const on = hovered === g.id;
        const mid = midByArc(g);
        const label = `Add a module between ${ins.before} and ${ins.after}`;
        return (
          <g key={`ins:${g.id}`}>
            <path
              className="dgx-hit"
              d={d}
              onMouseEnter={() => setHovered(g.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={(e) => {
                e.stopPropagation();
                onInsert(ins, e.clientX, e.clientY, mid);
              }}
            />
            {on && <path className="dgx-ins-line" d={d} />}
            {/* biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be an HTML <button>; the role is what it can carry */}
            <g
              className={`dgx-ins-btn dgx-cable-ins${on ? " on" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={label}
              onMouseEnter={() => setHovered(g.id)}
              onClick={(e) => {
                e.stopPropagation();
                onInsert(ins, e.clientX, e.clientY, mid);
              }}
              onKeyDown={onEnter((e) => {
                const r = (e.currentTarget as Element).getBoundingClientRect();
                onInsert(ins, r.left + r.width / 2, r.top + r.height / 2, mid);
              })}
            >
              <title>{label}</title>
              <circle cx={mid.x} cy={mid.y} r={9} />
              <path
                d={`M ${mid.x - 4} ${mid.y} H ${mid.x + 4} M ${mid.x} ${mid.y - 4} V ${mid.y + 4}`}
              />
            </g>
          </g>
        );
      })}
    </>
  );
}
// Memoised: a pan changes the camera, not the cables, and the wobble already bypasses React.
export const Cables = memo(CablesInner);
