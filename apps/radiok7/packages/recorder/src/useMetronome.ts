import { useCallback, useEffect, useRef, useState } from "react";
import type { Metronome } from "./types";

const BEATS_PER_BAR = 4;
const LOOKAHEAD_MS = 25; // how often the scheduler wakes up to queue clicks
const SCHEDULE_AHEAD_SEC = 0.1; // how far ahead of "now" clicks get queued

/**
 * A click track driven by the Web Audio clock (not setInterval) so beats
 * don't drift: each wake-up queues every click due in the next
 * SCHEDULE_AHEAD_SEC window at its exact AudioContext time.
 */
export function useMetronome() {
  const [metronome, setMetronome] = useState<Metronome | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const nextBeatTime = useRef(0);
  const beatIndex = useRef(0);

  const stop = useCallback(() => {
    if (timerRef.current != null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
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
