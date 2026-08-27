// PaneSplitter — the draggable seam between two panes. One component for both axes, because a
// vertical split and a horizontal one differ only in which coordinate moves.
//
// It resizes the pane BEFORE it, which is the order every split in the shell is written in. The
// size is read off the DOM at drag start rather than held here: until somebody drags, a pane is
// sized by a Tailwind fraction, and measuring is what lets the first drag continue from wherever
// that put it instead of jumping. See ../docs/shell.md.

import { cn } from "@frediverse/ui/lib/utils";
import type React from "react";
import type { RefObject } from "react";

/** How small a pane may be dragged, in px — below this it is gone rather than small. */
const MIN = 80;
/** …and how much has to be left for whatever is on the other side. */
const KEEP = 120;

export function PaneSplitter({
  pane,
  axis,
  onSize,
  label,
}: {
  /** The pane this seam resizes — the one before it. */
  pane: RefObject<HTMLDivElement | null>;
  /** `y` for a seam you drag up and down, `x` for one you drag left and right. */
  axis: "x" | "y";
  onSize: (px: number) => void;
  label: string;
}) {
  const down = (e: React.PointerEvent): void => {
    const el = pane.current;
    if (!el) return;
    e.preventDefault();
    const box = el.getBoundingClientRect();
    const vertical = axis === "y";
    const from = vertical ? e.clientY : e.clientX;
    const start = vertical ? box.height : box.width;
    // The room there is: the parent's, less what the panes beyond this seam need to stay usable.
    const room = el.parentElement?.getBoundingClientRect();
    const limit =
      (vertical
        ? (room?.height ?? window.innerHeight)
        : (room?.width ?? window.innerWidth)) - KEEP;
    const move = (ev: PointerEvent): void => {
      const at = vertical ? ev.clientY : ev.clientX;
      onSize(Math.max(MIN, Math.min(Math.max(MIN, limit), start + at - from)));
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
    // On the BODY for the whole drag: the pointer leaves the 4px seam immediately, and without
    // this the cursor flickers back and every pane under it takes a text selection.
    document.body.style.cursor = vertical ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    // A separator role rather than a bare div: it is the one control here with no visible affordance.
    <div
      role="separator"
      aria-label={label}
      aria-orientation={axis === "y" ? "horizontal" : "vertical"}
      onPointerDown={down}
      // Double-click gives the pane back to its Tailwind fraction — the way out of a bad drag.
      onDoubleClick={() => onSize(0)}
      className={cn(
        "shrink-0 bg-border transition-colors hover:bg-primary/60",
        axis === "y" ? "h-1 cursor-row-resize" : "w-1 cursor-col-resize",
      )}
    />
  );
}
