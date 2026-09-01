// RightPanel.tsx — the open/close movement of the column docked at the right. The panels PUSH
// the panes rather than cover them (../docs/shell.md), so what animates is the column's WIDTH;
// a slide-over would promise the panes had not moved, which is not what happens.
//
// ONE column, which is why this takes the open panel's content rather than being used once per
// panel: two wrappers mid-swap would be two columns for the length of an animation, and the
// panes would be squeezed and released for nothing.

import { type ReactNode, useEffect, useRef, useState } from "react";

/** The travel, in step with `duration-200` below. Long enough to read, short enough not to wait on. */
const MS = 200;

export function RightPanel({
  open,
  /** The open panel's own width — the column opens to exactly it, and travels between two. */
  width,
  children,
}: {
  open: boolean;
  width: string;
  children: ReactNode;
}) {
  // Mounted spans the whole movement; `wide` is the width itself, so both directions animate.
  const [mounted, setMounted] = useState(false);
  const [wide, setWide] = useState(false);
  // What to draw on the way OUT: the caller has already stopped choosing a panel by then.
  const last = useRef<ReactNode>(null);
  const lastWidth = useRef(width);
  if (open) {
    last.current = children;
    lastWidth.current = width;
  }

  useEffect(() => {
    if (open) {
      setMounted(true);
      // A frame later: mounting already wide is mounting with nothing to animate from.
      const f = requestAnimationFrame(() => setWide(true));
      return () => cancelAnimationFrame(f);
    }
    setWide(false);
    const t = setTimeout(() => setMounted(false), MS);
    return () => clearTimeout(t);
  }, [open]);

  if (!mounted) return null;
  return (
    <div
      className={`flex shrink-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none ${
        wide ? lastWidth.current : "w-0"
      }`}
    >
      {/* Its own width is kept while the column travels, so nothing inside reflows mid-animation. */}
      {open ? children : last.current}
    </div>
  );
}
