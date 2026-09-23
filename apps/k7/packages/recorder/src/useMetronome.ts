import { useCallback, useEffect, useRef, useState } from "react";
import type { Metronome } from "./types";

const BEATS_PER_BAR = 4;
const LOOKAHEAD_MS = 25; // how often the scheduler wakes up to queue clicks
const SCHEDULE_AHEAD_SEC = 0.1; // how far ahead of "now" clicks get queued

/** A click on the Web Audio clock, not setInterval: each wake-up queues the next window. */
export function useMetronome(
  /** Called as each click SOUNDS (not when it is queued), `downbeat` on the first of a bar. */
  onBeat?: (downbeat: boolean) => void,
) {
  const [metronome, setMetronome] = useState<Metronome | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const nextBeatTime = useRef(0);
  const beatIndex = useRef(0);
  // The latest callback, so a new closure every render never restarts the click.
  const onBeatRef = useRef(onBeat);
  onBeatRef.current = onBeat;
  // Beats queued but not sounded yet: a stop must not let them fire after it.
  const beatTimers = useRef(new Set<number>());

  const stop = useCallback(() => {
    if (timerRef.current != null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    for (const id of beatTimers.current) clearTimeout(id);
    beatTimers.current.clear();
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    setMetronome(null);
  }, []);

  const start = useCallback(
    (bpm: number, startSec: number) => {
      stop();
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const interval = 60 / bpm;
      beatIndex.current = 0;
      nextBeatTime.current = ctx.currentTime + 0.05;

      const scheduleClick = (time: number, accent: boolean) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = accent ? 1600 : 1000;
        gain.gain.setValueAtTime(accent ? 0.5 : 0.22, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(time);
        osc.stop(time + 0.06);
        if (!onBeatRef.current) return;
        const id = window.setTimeout(
          () => {
            beatTimers.current.delete(id);
            onBeatRef.current?.(accent);
          },
          Math.max(0, (time - ctx.currentTime) * 1000),
        );
        beatTimers.current.add(id);
      };

      const tick = () => {
        while (nextBeatTime.current < ctx.currentTime + SCHEDULE_AHEAD_SEC) {
          scheduleClick(
            nextBeatTime.current,
            beatIndex.current % BEATS_PER_BAR === 0,
          );
          nextBeatTime.current += interval;
          beatIndex.current += 1;
        }
      };

      tick();
      timerRef.current = window.setInterval(tick, LOOKAHEAD_MS);
      setMetronome({ bpm, startSec });
    },
    [stop],
  );

  // Stop the click track (and close its AudioContext) on unmount.
  useEffect(() => stop, [stop]);

  return { metronome, start, stop };
}
