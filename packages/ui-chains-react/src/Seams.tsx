// Seams.tsx — a glued row's buttons, drawn OVER the cards in world coordinates: on each seam a `+`,
// and below it a BRANCH that stacks a new node under the left card, both shown while the pointer is on
// the seam; and one `+` past the last card, always.
// The one thing a reader would get wrong: where the seams are is @studio/ui-chains's rowSeams.ts;
// this only draws them and reports a click the way a cable's `+` does.

import { GitBranch } from "@frediverse/ui/icons";
import type { EdgeInsert } from "@studio/ui-chains/graph";
import { type RowSeam, SEAM_BRANCH_AT } from "@studio/ui-chains/rowSeams";
import { memo } from "react";
import { useChainsLabels } from "./labels";

/** Half the width of a seam's hover band, px: wide enough to find, narrow enough to leave a card's edge controls alone. */
const SEAM_HIT = 7;
/** The buttons' circle radius, px — a cable's own `+`. */
const SEAM_R = 9;
/** The branch glyph drawn inside its circle, px. */
const BRANCH_ICON = 11;

const same = (name: string) => name;

type OnInsert = (
  info: EdgeInsert,
  x: number,
  y: number,
  at: { x: number; y: number },
) => void;

function SeamsInner({
  seams,
  width,
  height,
  onInsert,
  nameOf = same,
}: {
  seams: readonly RowSeam[];
  width: number;
  height: number;
  onInsert: OnInsert;
  /** What a node is called aloud — its card's name, never an unnamed node's uuid (@studio/ui-chains's shownName.ts). */
  nameOf?: (name: string) => string;
}) {
  const l = useChainsLabels();
  return (
    <svg className="dgx-seams" width={width} height={height}>
      <title>{l.seamsTitle}</title>
      {seams.map((s) => {
        const mid = { x: s.x, y: s.y + s.h / 2 };
        const low = { x: s.x, y: s.y + s.h * SEAM_BRANCH_AT };
        const click = (e: React.MouseEvent) => {
          e.stopPropagation();
          onInsert(s.insert, e.clientX, e.clientY, mid);
        };
        const label = s.end
          ? l.addModuleEnd
          : l.addModuleBetween(nameOf(s.insert.before), nameOf(s.insert.after));
        const branch = s.branch;
        return (
          // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be an HTML <button>; the role is what it can carry
          <g
            key={`${s.insert.before}>${s.insert.after}`}
            className={`dgx-seam${s.end ? " end" : ""}`}
            role="button"
            aria-label={label}
            onClick={click}
          >
            <title>{label}</title>
            {s.end ? (
              <rect
                className="dgx-seam-hit"
                x={mid.x - SEAM_R * 2}
                y={mid.y - SEAM_R * 2}
                width={SEAM_R * 4}
                height={SEAM_R * 4}
              />
            ) : (
              <>
                <rect
                  className="dgx-seam-hit"
                  x={s.x - SEAM_HIT}
                  y={s.y}
                  width={SEAM_HIT * 2}
                  height={s.h}
                />
                <path
                  className="dgx-seam-line"
                  d={`M ${s.x} ${s.y} V ${s.y + s.h}`}
                />
              </>
            )}
            <g className="dgx-ins-btn">
              <circle cx={mid.x} cy={mid.y} r={SEAM_R} />
              <path
                d={`M ${mid.x - 4} ${mid.y} H ${mid.x + 4} M ${mid.x} ${mid.y - 4} V ${mid.y + 4}`}
              />
            </g>
            {/* The second button, lower down: a new node stacked under the left card, the two in one subchain. */}
            {branch && (
              // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be an HTML <button>; the role is what it can carry
              <g
                className="dgx-ins-btn dgx-branch-btn"
                role="button"
                aria-label={l.branchUnder(nameOf(branch.before))}
                onClick={(e) => {
                  e.stopPropagation();
                  onInsert(branch, e.clientX, e.clientY, low);
                }}
              >
                <title>{`Branch: stack a module under ${nameOf(branch.before)}, the two in one subchain`}</title>
                <circle cx={low.x} cy={low.y} r={SEAM_R} />
                <GitBranch
                  x={low.x - BRANCH_ICON / 2}
                  y={low.y - BRANCH_ICON / 2}
                  width={BRANCH_ICON}
                  height={BRANCH_ICON}
                />
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
// Memoised: a pan moves the world, not the seams.
export const Seams = memo(SeamsInner);
