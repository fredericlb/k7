// BottomSplit.tsx — a column cut in two by a divider: the page's content on top, a pane under it whose
// height is a share of the column, dragged by the divider or moved by its arrow keys, kept per browser.
// The one thing a reader would get wrong: the share is clamped so neither half falls under MIN_PX (../docs/songPlayer.md).

import { type ReactNode, useRef, useState } from "react";

const MIN_PX = 120;
const STEP = 0.05;

const readShare = (key: string, fallback: number): number => {
  try {
    const v = Number(localStorage.getItem(key));
    return v > 0 && v < 1 ? v : fallback;
  } catch {
    return fallback;
  }
};

export function BottomSplit({
  top,
  bottom,
  label,
  storageKey,
  initial = 0.5,
}: {
  top: ReactNode;
  bottom: ReactNode;
  /** What the divider is called to a screen reader: the pane it sizes. */
  label: string;
  /** Where the share is kept, so the pane keeps its height from one song to the next. */
  storageKey: string;
  /** The bottom pane's share of the column before anyone moved it. */
  initial?: number;
}) {
  const column = useRef<HTMLDivElement>(null);
  const [share, setShareState] = useState(() => readShare(storageKey, initial));

  const setShare = (next: number) => {
    const height = column.current?.clientHeight ?? 0;
    // Neither half under MIN_PX, whatever the column's height; a column too short for both keeps the middle.
    const lo = height > 2 * MIN_PX ? MIN_PX / height : 0.5;
    const clamped = Math.min(1 - lo, Math.max(lo, next));
    setShareState(clamped);
    try {
      localStorage.setItem(storageKey, String(clamped));
    } catch {
      // A browser that keeps nothing starts at the default next time, which is all it costs.
    }
  };

  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = column.current?.getBoundingClientRect();
    if (!box) return;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) =>
      setShare((box.bottom - ev.clientY) / box.height);
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  const key = (e: React.KeyboardEvent) => {
    // Up grows the bottom pane, as dragging the divider up does.
    if (e.key === "ArrowUp") setShare(share + STEP);
    else if (e.key === "ArrowDown") setShare(share - STEP);
    else return;
    e.preventDefault();
  };

  return (
    <div ref={column} className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">{top}</div>
      {/* biome-ignore lint/a11y/useSemanticElements: an <hr> takes no focus and no keys; a focusable separator is ARIA's splitter */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={label}
        aria-valuenow={Math.round(share * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        onPointerDown={drag}
        onKeyDown={key}
        className="h-1.5 shrink-0 cursor-row-resize touch-none border-t bg-border/40 hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none"
      />
      <div
        className="min-h-0 shrink-0 overflow-hidden"
        style={{ height: `${share * 100}%` }}
      >
        {bottom}
      </div>
    </div>
  );
}
