// relook.ts — when to measure the engines again. A probe is a SNAPSHOT, and it used to be taken
// once per tab: one unlucky race marked the engine unreachable until the page was reloaded.
// See docs/access.md.

import { useEffect, useState } from "react";

/** Between two measurements, pinned to `REGISTRY_TTL_MS`: longer gains nothing, shorter probes faster than the information can change. */
export const RELOOK_MS = 15_000;

/** A counter that advances when re-measuring is worth it — on the interval AND on the tab coming back. See docs/access.md. */
export function useRelook(everyMs: number = RELOOK_MS): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const visible = () => document.visibilityState === "visible";
    const bump = () => {
      if (visible()) setTick((n) => n + 1);
    };
    const timer = setInterval(bump, everyMs);
    document.addEventListener("visibilitychange", bump);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", bump);
    };
  }, [everyMs]);
  return tick;
}
