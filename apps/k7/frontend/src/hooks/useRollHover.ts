// useRollHover.ts — the piano roll cell under the pointer, for the light row and column bands that say
// which key and which step a click lands on. A mark, not state anyone acts on: it is never the caret.
// The one thing a reader would get wrong: it changes only when the CELL does, not on every move (../../docs/clipEditors.md).

import type React from "react";
import { useCallback, useState } from "react";

export interface RollCell {
  row: number;
  col: number;
}

/** The hovered cell, and the two handlers the grid's element takes; `cellAt` is the roll's own pointer-to-cell rule. */
export function useRollHover(cellAt: (e: React.PointerEvent) => RollCell): {
  hover: RollCell | null;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerLeave: () => void;
} {
  const [hover, setHover] = useState<RollCell | null>(null);
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const at = cellAt(e);
      setHover((h) => (h && h.row === at.row && h.col === at.col ? h : at));
    },
    [cellAt],
  );
  const onPointerLeave = useCallback(() => setHover(null), []);
  return { hover, onPointerMove, onPointerLeave };
}
