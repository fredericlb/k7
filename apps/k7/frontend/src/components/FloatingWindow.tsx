// FloatingWindow.tsx — a window over the layout, moved by its title bar and sized by any edge or
// corner (react-rnd). Hidden rather than unmounted when closed: what it holds (the viewport's GL
// context and its <video> elements) is exactly the state that must survive being put away.
// See docs/picture.md.

import { X } from "@frediverse/ui/icons";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import {
  clampRect,
  defaultRect,
  type FloatRect,
  MIN_H,
  MIN_W,
} from "../floatingRect";

export interface FloatingWindowProps {
  title: string;
  open: boolean;
  onClose: () => void;
  /** The saved rect, or null for the first placement. */
  rect: FloatRect | null;
  /** Called once per gesture, at its end — not on every pointer move. */
  onRect: (r: FloatRect) => void;
  children: ReactNode;
}

const screen = () => ({ vw: window.innerWidth, vh: window.innerHeight });

export function FloatingWindow({
  title,
  open,
  onClose,
  rect,
  onRect,
  children,
}: FloatingWindowProps) {
  const [live, setLive] = useState<FloatRect>(() => {
    const { vw, vh } = screen();
    return rect ? clampRect(rect, vw, vh) : defaultRect(vw, vh);
  });
  // The latest rect for the resize listener, which would otherwise clamp a stale one.
  const liveRef = useRef(live);
  liveRef.current = live;

  // Rnd bounds a gesture, not the window shrinking under it: this pulls the title bar back in reach.
  useEffect(() => {
    const onResize = () => {
      const { vw, vh } = screen();
      setLive(clampRect(liveRef.current, vw, vh));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const settle = (next: FloatRect) => {
    const { vw, vh } = screen();
    const r = clampRect(next, vw, vh);
    setLive(r);
    onRect(r);
  };

  return (
    <Rnd
      position={{ x: live.x, y: live.y }}
      size={{ width: live.w, height: live.h }}
      minWidth={MIN_W}
      minHeight={MIN_H}
      bounds="parent"
      dragHandleClassName="floating-window-handle"
      cancel=".floating-window-cancel"
      onDragStop={(_e, d) => settle({ ...liveRef.current, x: d.x, y: d.y })}
      onResizeStop={(_e, _dir, el, _delta, pos) =>
        settle({ x: pos.x, y: pos.y, w: el.offsetWidth, h: el.offsetHeight })
      }
      // An inline display, since Rnd's own inline `inline-block` would beat a `hidden` class.
      style={{ display: open ? "flex" : "none" }}
      className="z-40 flex-col overflow-hidden rounded-md border bg-background shadow-xl"
    >
      <div
        role="dialog"
        aria-label={title}
        className="flex h-full min-h-0 w-full flex-col"
      >
        {/* The title bar is the handle: no text selection, and `touch-none` so a finger drags rather than scrolls. */}
        <div className="floating-window-handle flex h-7 shrink-0 cursor-grab touch-none select-none items-center gap-2 border-b bg-muted/60 px-2 text-xs text-muted-foreground active:cursor-grabbing">
          <span className="flex-1 truncate">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="floating-window-cancel rounded p-0.5 hover:bg-accent hover:text-foreground"
            aria-label={`Hide ${title.toLowerCase()}`}
            title={`Hide ${title.toLowerCase()}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
      </div>
    </Rnd>
  );
}
