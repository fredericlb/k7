// A button that fires only after being HELD for `seconds`, filling as it goes — a guard against a stray tap.
// Touch and mouse both drive it, and leaving the button or lifting the finger early cancels the hold.

import { Button, type ButtonProps } from "@frediverse/ui/button";
import { cn } from "@frediverse/ui/lib/utils";
import { type ReactNode, useEffect, useRef, useState } from "react";

export function HoldButton({
  seconds,
  onComplete,
  canStart = () => true,
  label,
  fillClassName,
  className,
  ...buttonProps
}: Omit<ButtonProps, "children" | "onClick"> & {
  seconds: number;
  onComplete: () => void;
  canStart?: () => boolean;
  label: (holding: boolean, progress: number) => ReactNode;
  fillClassName?: string;
}) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const holdingRef = useRef(false);
  const frame = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function start() {
    if (!canStart()) return;
    holdingRef.current = true;
    setHolding(true);
    setProgress(0);
    const t0 = performance.now();
    const animate = () => {
      const p = Math.min((performance.now() - t0) / 1000 / seconds, 1);
      setProgress(p);
      if (p >= 1) {
        holdingRef.current = false;
        setHolding(false);
        setProgress(0);
        onComplete();
        return;
      }
      if (holdingRef.current) frame.current = requestAnimationFrame(animate);
    };
    frame.current = requestAnimationFrame(animate);
  }

  function end() {
    holdingRef.current = false;
    setHolding(false);
    setProgress(0);
    cancelAnimationFrame(frame.current);
  }

  return (
    <Button
      {...buttonProps}
      className={cn("relative overflow-hidden touch-manipulation", className)}
      onTouchStart={(e) => {
        e.preventDefault();
        start();
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        end();
      }}
      onTouchCancel={(e) => {
        e.preventDefault();
        end();
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        start();
      }}
      onMouseUp={(e) => {
        e.preventDefault();
        end();
      }}
      onMouseLeave={() => end()}
    >
      <span className="relative z-10">{label(holding, progress)}</span>
      {holding && (
        <span
          aria-hidden
          className={cn("absolute inset-y-0 left-0", fillClassName)}
          style={{ width: `${progress * 100}%` }}
        />
      )}
    </Button>
  );
}
