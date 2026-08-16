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

/**
 * Call `onFrame(seconds)` per animation frame while the transport rolls, and once whenever
 * anything else moves the playhead or `onFrame` itself changes.
 *
 * **It never re-renders the caller**, and that is the point rather than a nicety. The
 * subscription is the store's raw one, not `useEngineState`: a selector hook here would put a
 * render on the component at the meter rate, and going from 20 Hz to 60 would then be three
 * times the renders rather than a smoother line. `useTurntableDeck` reads the same store the
 * same way, for the same reason.
 *
 * So the caller renders its element ONCE and writes to it from the callback:
 *
 * ```tsx
 * const ref = useRef<HTMLDivElement | null>(null);
 * usePlayheadFrames(useCallback((sec) => {
 *   if (ref.current) ref.current.style.transform = `translateX(${x(sec)}px)`;
 * }, [x]));
 * ```
 *
 * Wrap the callback in `useCallback`: its identity is what says "my geometry changed, put the
 * line where it belongs now" — which matters while STOPPED, when no frame is coming to do it.
 */
export function usePlayheadFrames(onFrame: (seconds: number) => void): void {
  const store = useEngineStore();
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
    cb.current(playheadAt(next, now));
  }, []);

  useEffect(() => {
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
  }, [store, draw]);

  // Geometry moved under us — a zoom, a scroll, a resize. While rolling the next frame would
  // fix it within 16 ms; while STOPPED nothing would, and the line would sit at the old pixel.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onFrame is a TRIGGER, not a value this body reads — it is called through cb.current, and dropping it here is exactly the stale-pixel-while-paused bug.
  useEffect(() => {
    draw();
  }, [onFrame, draw]);
}
