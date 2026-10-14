// StepPlayhead.tsx — the transport line over the step sequencer's grid, held apart so a
// per-frame subscription never redraws a table of buttons. See ../../docs/playhead.md.

import { useCallback, useRef } from "react";
import { usePlayheadFrames } from "../hooks/usePlayheadFrames";

/** The transport line over the grid, held apart so a 20 Hz subscription does not redraw a table of buttons; positioned by TIME fraction. */
export function StepPlayhead({
  tempo,
  clipStart,
  placedEnd,
  span,
}: {
  tempo: number;
  clipStart: number;
  placedEnd: number;
  span: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Per animation frame, and translated rather than `left`-ed (docs/playhead.md): the box spans the panel, a percentage translate being of its own width.
  usePlayheadFrames(
    useCallback(
      (seconds: number) => {
        const el = ref.current;
        if (!el) return;
        const localBeat = (seconds * tempo) / 60 - clipStart;
        const inside =
          span > 0 && localBeat >= 0 && localBeat <= Math.max(placedEnd, span);
        el.style.visibility = inside ? "visible" : "hidden";
        if (inside)
          el.style.transform = `translateX(${((localBeat % span) / span) * 100}%)`;
      },
      [tempo, clipStart, placedEnd, span],
    ),
  );
  return (
    // The outer box does not move and CLIPS: without it the translated inner one would grow a phantom horizontal scrollbar.
    <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-full overflow-hidden">
      <div
        ref={ref}
        className="absolute inset-y-0 left-0 w-full border-white/80 border-l"
        style={{ willChange: "transform", visibility: "hidden" }}
      />
    </div>
  );
}
