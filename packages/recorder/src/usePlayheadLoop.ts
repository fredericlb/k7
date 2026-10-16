// usePlayheadLoop.ts — while an element plays, report its time every animation frame, so a playhead
// follows the audio smoothly rather than at the element's own few `timeupdate`s a second.

import { type RefObject, useEffect } from "react";

/** Call `onTime` with `audio`'s current time on each frame while `playing`; `onTime` should be stable. */
export function usePlayheadLoop(
  audio: RefObject<HTMLMediaElement | null>,
  playing: boolean,
  onTime: (sec: number) => void,
): void {
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      if (audio.current) onTime(audio.current.currentTime);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [audio, playing, onTime]);
}
