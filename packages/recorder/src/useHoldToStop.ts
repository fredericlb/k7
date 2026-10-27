// useHoldToStop.ts — stopping a take takes a deliberate two-second hold on the Stop button, so no stray tap ends it.
// No key does it: the pages stay usable during a take, and a key held anywhere would end it (../docs/recorder.md).

import { useEffect, useRef, useState } from "react";

const HOLD_MS = 2000;

export function useHoldToStop(opts: {
  canStop: () => boolean;
  onStop: () => void;
}) {
  const [holdProgress, setHoldProgress] = useState(0); // 0→1 while holding to stop
  const holdStart = useRef<number | null>(null);
  const holdRaf = useRef<number | null>(null);
  // Read through a ref, so a hold that began before a render never captures a stale status.
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

  // Stop any in-flight hold animation if the recorder unmounts mid-hold.
  useEffect(
    () => () => {
      if (holdRaf.current) cancelAnimationFrame(holdRaf.current);
    },
    [],
  );

  return { holdProgress, beginHold, cancelHold };
}
