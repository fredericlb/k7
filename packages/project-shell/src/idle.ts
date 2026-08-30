// idle.ts — when a session is IDLE: a timestamp the person's gestures reset, read back on a
// coarse interval. A date rather than a restarted `setTimeout`, because a machine that went to
// sleep has to tell the truth when it wakes. See docs/idle.md.

import { useEffect, useRef } from "react";

/** Twenty minutes. The only number on this page, written once. */
export const IDLE_TIMEOUT_MS = 20 * 60 * 1000;

/** A quarter-minute, no finer: browsers throttle a background tab's timers to a minute anyway. */
const CHECK_MS = 15_000;

/** `pointermove` is in here on purpose: hovering a waveform while listening is activity. */
const EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
] as const;

/** One tab is one session, so the clock is the MODULE's — see markActive for the other writer. */
let lastActive = Date.now();

/** "Something is happening" — for what no input event reports, such as a track playing. */
export function markActive(): void {
  lastActive = Date.now();
}

/** How long nothing has happened. Exported for tests and the status bar. */
export const idleForMs = (): number => Date.now() - lastActive;

/** Why a session went to sleep — a tab put behind another, or the timer above. */
export type SleepReason = "timeout" | "hidden";

/** What a change in sight means for a gate's phase; `null` is "stay where you are". */
export type SleepMove = "sleep" | "wake" | null;

/** The rule tabs and the timer share; only `hidden` wakes on its own — see docs/idle.md. */
export function sleepMove(
  outOfSight: boolean,
  phase: { k: string; why?: SleepReason },
): SleepMove {
  if (outOfSight && phase.k === "open") return "sleep";
  if (!outOfSight && phase.k === "idle" && phase.why === "hidden")
    return "wake";
  return null;
}

/** Call `onIdle` once after `timeoutMs` of nothing; `<= 0` disables it, listeners included. */
export function useIdleTimeout(timeoutMs: number, onIdle: () => void): void {
  // By ref: `onIdle` is rebuilt each render, and depending on it would resubscribe every frame.
  const fire = useRef(onIdle);
  fire.current = onIdle;

  useEffect(() => {
    if (timeoutMs <= 0) return;
    markActive(); // mounting IS the start of the session
    let done = false;
    const stamp = () => markActive();
    for (const e of EVENTS)
      window.addEventListener(e, stamp, { capture: true, passive: true });
    const t = setInterval(() => {
      if (done || idleForMs() < timeoutMs) return;
      done = true;
      fire.current();
    }, CHECK_MS);
    return () => {
      clearInterval(t);
      for (const e of EVENTS)
        window.removeEventListener(e, stamp, { capture: true });
    };
  }, [timeoutMs]);
}
