// useHoldToStop.ts — stopping a take takes a deliberate hold, button or space bar, so no stray tap ends it.
// What reads wrong: the space bar is swallowed on every keydown while a stop is possible, but holds only on the first (../docs/recorder.md).

import { useEffect, useRef, useState } from "react";

const HOLD_MS = 2000;

export function useHoldToStop(opts: {
  canStop: () => boolean;
  onStop: () => void;
  /** Minimized, the stop control is off screen, so the space bar must not start the hold. */
  minimized: boolean;
}) {
  const [holdProgress, setHoldProgress] = useState(0); // 0→1 while holding to stop
  const holdStart = useRef<number | null>(null);
  const holdRaf = useRef<number | null>(null);
  // Read through a ref, so the once-mounted key listener never rebinds nor captures a stale status.
  const latest = useRef(opts);
  latest.current = opts;

  const cancelHold = () => {
    if (holdRaf.current) cancelAnimationFrame(holdRaf.current);
    holdRaf.current = null;
    holdStart.current = null;
    setHoldProgress(0);
  };

  const beginHold = () => {
    if (holdStart.current != null || !latest.current.canStop()) return;
    holdStart.current = performance.now();
    const tick = () => {
      if (holdStart.current == null) return;
      const p = Math.min(1, (performance.now() - holdStart.current) / HOLD_MS);
      setHoldProgress(p);
      if (p >= 1) {
        cancelHold();
        latest.current.onStop();
      } else {
        holdRaf.current = requestAnimationFrame(tick);
      }
    };
    holdRaf.current = requestAnimationFrame(tick);
  };

  const holdRef = useRef({ beginHold, cancelHold });
  holdRef.current = { beginHold, cancelHold };

  useEffect(() => {
    const isEditable = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return (
        !!el &&
        (el.isContentEditable ||
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT")
      );
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      // Never hijack space while typing a comment or a tag.
      if (
        isEditable(e.target) ||
        latest.current.minimized ||
        !latest.current.canStop()
      )
        return;
      e.preventDefault();
      if (!e.repeat) holdRef.current.beginHold();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") holdRef.current.cancelHold();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      // Stop any in-flight hold animation if the recorder unmounts mid-hold.
      if (holdRaf.current) cancelAnimationFrame(holdRaf.current);
    };
  }, []);

  return { holdProgress, beginHold, cancelHold };
}
