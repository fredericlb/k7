// RecordingClip.tsx — the take being recorded, drawn on its lane as it grows. See ../../../docs/playhead.md.

import { useCallback, useRef } from "react";
import { usePlayheadFrames } from "../../hooks/usePlayheadFrames";
import { m } from "../../paraglide/messages.js";
import { recordingFrom } from "../../takeCounter";

/** The take being recorded, drawn on its lane as it grows — its OWN subscription, so a frame rewrites one absolutely positioned div (docs/playhead.md). */
export function RecordingClip({
  tempo,
  startBeat,
  countInBeats,
  beatLo,
  beatHi,
  ppb,
}: {
  tempo: number;
  startBeat: number;
  /** The pre-roll, in beats — nothing is recorded during it, so nothing is drawn. */
  countInBeats: number;
  beatLo: number;
  beatHi: number;
  ppb: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // The take's material starts after the COUNT-IN, not where the transport rolled.
  const from0 = recordingFrom(startBeat, countInBeats);
  // WIDTH per animation frame, not a transform: unlike the playhead this element genuinely changes size — see docs/playhead.md.
  usePlayheadFrames(
    useCallback(
      (seconds: number) => {
        const el = ref.current;
        if (!el) return;
        const now = (seconds * tempo) / 60;
        const from = Math.max(from0, beatLo);
        const to = Math.min(now, beatHi);
        const shown = now > from0 && to > from;
        el.style.visibility = shown ? "visible" : "hidden";
        if (shown) {
          el.style.left = `${(from - beatLo) * ppb}px`;
          el.style.width = `${(to - from) * ppb}px`;
        }
      },
      [tempo, from0, beatLo, beatHi, ppb],
    ),
  );
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-y-1 z-10 rounded border border-red-400/70 bg-red-500/25"
      style={{ visibility: "hidden" }}
      title={m["clip.takeRolling"]()}
    />
  );
}
