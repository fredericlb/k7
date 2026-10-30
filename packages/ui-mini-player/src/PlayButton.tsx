// PlayButton.tsx — the bar's play/pause, and the host's menu behind it: a right-click, the
// keyboard's menu key or a finger held still opens it, a plain press only plays or pauses.
// The menu is anchored on a span over the button, not on the button: a trigger would open on every press.
// See ../docs/miniPlayer.md, "The play button's menu".

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { Pause, Play } from "@frediverse/ui/icons";
import { type ReactNode, useEffect, useRef, useState } from "react";

const LONG_PRESS_MS = 500;
// A finger drifting further than this is a slide, not a press.
const SLOP_PX = 10;

export function PlayButton({
  playing,
  onToggle,
  playLabel,
  pauseLabel,
  menu,
  plain = false,
}: {
  playing: boolean;
  onToggle: () => void;
  playLabel: string;
  pauseLabel: string;
  /** The menu's items; absent, the button has none and a long press does nothing. */
  menu?: ReactNode;
  /** No background of its own, for a bar whose row is a picture. */
  plain?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  // The click that ends a press which opened the menu must not also play.
  const fired = useRef(false);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const button = (
    <Button
      size="icon"
      variant={plain ? "ghost" : "secondary"}
      // No text selection or iOS callout under a held finger.
      className="shrink-0 select-none [-webkit-touch-callout:none]"
      onClick={(e) => {
        if (fired.current) {
          fired.current = false;
          e.preventDefault();
          return;
        }
        onToggle();
      }}
      aria-label={playing ? pauseLabel : playLabel}
      aria-haspopup={menu ? "menu" : undefined}
      onContextMenu={
        menu
          ? (e) => {
              e.preventDefault();
              setOpen(true);
            }
          : undefined
      }
      onPointerDown={
        menu
          ? (e) => {
              fired.current = false;
              if (e.pointerType === "mouse" || e.button !== 0) return;
              cancel();
              start.current = { x: e.clientX, y: e.clientY };
              timer.current = setTimeout(() => {
                timer.current = null;
                fired.current = true;
                setOpen(true);
              }, LONG_PRESS_MS);
            }
          : undefined
      }
      onPointerMove={(e) => {
        const s = start.current;
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > SLOP_PX)
          cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
    >
      {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
    </Button>
  );
  if (!menu) return button;

  return (
    <span className="relative shrink-0">
      {button}
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden="true"
            tabIndex={-1}
            className="pointer-events-none absolute inset-0"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-64">
          {menu}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
