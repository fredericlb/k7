// usePlayheadFrames.ts — the playhead, per ANIMATION FRAME and without a render. Subscribes to
// the engine store raw, steers a local clock with it (playheadClock.ts), and hands the caller a
// position ~60 times a second to write straight onto a DOM node. See docs/playhead.md.

import {
  advancePlayhead,
  feedPlayhead,
  newPlayheadClock,
  type PlayheadClock,
  playheadAt,
} from "@studio/engine-browser/playhead-clock";
import { useEngineStore } from "@studio/engine-browser/store";
import { useCallback, useEffect, useRef } from "react";
import { usePaneVisible } from "../paneVisible";

/** Call `onFrame(seconds)` per animation frame while the transport rolls — it never re-renders the caller, which is the point (docs/playhead.md). */
export function usePlayheadFrames(
  onFrame: (seconds: number, playing: boolean) => void,
): void {
  const store = useEngineStore();
  // A hidden pane subscribes to nothing and schedules no frame; showing it again re-reads the store and draws at once.
  const visible = usePaneVisible();
  const clock = useRef<PlayheadClock | null>(null);
  const cb = useRef(onFrame);
  cb.current = onFrame;

  // Stable, so both effects below share one — and so neither re-runs when the caller re-renders.
  const draw = useCallback(() => {
    const c = clock.current;
    if (!c) return;
    const now = performance.now();
    const next = advancePlayhead(c, now);
    clock.current = next;
    cb.current(playheadAt(next, now), next.playing);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const s0 = store.getSnapshot();
    clock.current = newPlayheadClock(
      s0.playhead,
      s0.playing,
      performance.now(),
    );
    let raf = 0;
    const loop = () => {
      draw();
      // The loop lives exactly as long as the transport does: a paused tab schedules nothing.
      raf = clock.current?.playing ? requestAnimationFrame(loop) : 0;
    };
    const start = () => {
      if (!raf && clock.current?.playing) raf = requestAnimationFrame(loop);
    };
    const onFrameIn = () => {
      const s = store.getSnapshot();
      clock.current = feedPlayhead(
        clock.current ?? newPlayheadClock(),
        s.playing,
        s.playhead,
        performance.now(),
      );
      // Rolling: the loop draws it. Stopped: nothing else will, so draw the scrub now.
      if (s.playing) start();
      else draw();
    };
    draw(); // put the line where it is before any frame arrives
    const unsubscribe = store.subscribe(onFrameIn);
    start();
    return () => {
      unsubscribe();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [store, draw, visible]);

  // Geometry moved under us — a zoom, a scroll, a resize: while rolling the next frame fixes it, while STOPPED nothing would.

  // biome-ignore lint/correctness/useExhaustiveDependencies: onFrame is a TRIGGER, not a value this body reads — it is called through cb.current, and dropping it here is exactly the stale-pixel-while-paused bug.
  useEffect(() => {
    draw();
  }, [onFrame, draw]);
}
