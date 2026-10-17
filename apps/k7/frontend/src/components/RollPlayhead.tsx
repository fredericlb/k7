// RollPlayhead.tsx — the transport line over the piano roll, and the only part of it that knows
// the transport: held apart and translated, so a per-frame subscription never re-lays out the roll.
// See ../../docs/playhead.md.

import { useCallback, useRef } from "react";
import { usePlayheadFrames } from "../hooks/usePlayheadFrames";

/** The transport line, and the only part of the roll that knows the transport — held apart, and translated rather than laid out. */
export function RollPlayhead({
  tempo,
  clipStart,
  placedEnd,
  span,
  windowFrom = 0,
  windowLength = 0,
  ppb,
  height,
}: {
  tempo: number;
  clipStart: number;
  /** The clip's extent on the timeline — where the transport stops being this clip's business. */
  placedEnd: number;
  /** Beats the canvas draws; a windowed clip's later passes FOLD back into it, so the transport is always somewhere in it. */
  span: number;
  /** The clip's window in the file's beats — a pass plays it from its start, so that is where the line starts and folds back to; 0 long with none. */
  windowFrom?: number;
  windowLength?: number;
  ppb: number;
  height: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Per animation frame, written onto the node (docs/playhead.md) — hidden rather than unmounted when the transport is outside.
  usePlayheadFrames(
    useCallback(
      (seconds: number) => {
        const el = ref.current;
        if (!el) return;
        const localBeat = (seconds * tempo) / 60 - clipStart;
        const inside = localBeat >= 0 && localBeat <= placedEnd;
        el.style.visibility = inside ? "visible" : "hidden";
        // The roll draws notes at their beat in the FILE, so a windowed clip's line is that beat, not the time since the clip began.
        const at =
          windowLength > 0
            ? windowFrom + (localBeat % windowLength)
            : span > 0
              ? localBeat % span
              : 0;
        if (inside) el.style.transform = `translateX(${at * ppb}px)`;
      },
      [tempo, clipStart, placedEnd, span, windowFrom, windowLength, ppb],
    ),
  );
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute top-0 left-0 z-10 w-px bg-playhead"
      style={{
        willChange: "transform",
        visibility: "hidden", // until the first frame says where it is
        height,
      }}
    />
  );
}
