// relook.ts — when to measure the engines again. A probe is a SNAPSHOT, and it used to be taken
// once per tab: one unlucky race marked the engine unreachable until the page was reloaded.
// See docs/access.md.

import { useEffect, useState } from "react";

/**
 * Between two measurements.
 *
 * Pinned to `REGISTRY_TTL_MS` (15 s): longer would gain nothing — an engine that stopped beating
 * has already left the list, and the list is what will say so — and shorter would probe faster
 * than the information can change.
 */
export const RELOOK_MS = 15_000;

/**
 * A counter that advances when re-measuring is worth it. Put it in the dependencies of the effect
 * that calls `find()`.
 *
 * Two triggers, and the second matters as much as the first:
 *
 * 1. **The interval**, which turns a sticky failure into a passing one. That is the heart of the
 *    problem: `probeEngines` does not return slow latency for a slow engine, it returns
 *    `unreachable`, a state of its own — so one missed measurement never fixed itself.
 * 2. **The tab coming back to the foreground.** A hidden tab does not probe: opening WebSockets
 *    to every candidate address for a screen nobody watches costs without learning anything. But
 *    coming back is exactly when "unreachable" is read, and that is when the fresh answer is
 *    wanted — not fifteen seconds later.
 */
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
