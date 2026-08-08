// transport.ts — v1's playhead. One TransportClock owns the position; React reads it on a rAF
// so the ruler and the playhead line follow it without the clock knowing React exists.
//
// The clock is a REF, not state: it is the authority, and putting the position in state would
// make React the authority and the clock a mirror of it. What state carries is the last SAMPLE
// of it, which is a different thing and is allowed to lag a frame.

import { TransportClock } from "@studio/ui-eyes/clock";
import { useEffect, useMemo, useRef, useState } from "react";

export interface Transport {
  /** Handed straight to the renderer, which drives itself from it. */
  clock: TransportClock;
  /** The position as of the last animation frame, in seconds — what the UI draws. */
  playhead: number;
  playing: boolean;
  toggle: () => void;
  seek: (sec: number) => void;
}

export function useTransport(duration: number): Transport {
  const clock = useMemo(() => new TransportClock(), []);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  // The end, read inside the rAF loop without restarting it: the loop's identity must not
  // depend on a number that changes whenever a clip is trimmed.
  const endRef = useRef(duration);
  endRef.current = duration;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const sec = clock.nowSec();
      // Stop AT the end rather than running on into nothing. Not a loop: a cut that restarted
      // itself would make "did it finish" unanswerable while you are watching the last shot.
      if (clock.isPlaying() && endRef.current > 0 && sec >= endRef.current) {
        clock.seek(endRef.current);
        clock.pause();
      }
      setPlayhead(clock.nowSec());
      setPlaying(clock.isPlaying());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clock]);

  return useMemo(
    () => ({
      clock,
      playhead,
      playing,
      toggle: () => clock.toggle(),
      // Playing past the end already parks at it, so a seek beyond is clamped the same way
      // rather than leaving the playhead somewhere the timeline does not draw.
      seek: (sec: number) =>
        clock.seek(
          Math.max(0, endRef.current > 0 ? Math.min(sec, endRef.current) : sec),
        ),
    }),
    [clock, playhead, playing],
  );
}
