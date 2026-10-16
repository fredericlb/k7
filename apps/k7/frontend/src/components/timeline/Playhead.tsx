// Playhead.tsx — the arrangement's playhead, steered per animation frame rather than drawn from
// the engine's frames. See ../../../docs/playhead.md.

import { cn } from "@frediverse/ui/lib/utils";
import { useCallback, useRef } from "react";
import { usePlayheadFrames } from "../../hooks/usePlayheadFrames";
import { GROW } from "./grow";

export function Playhead({
  tempo,
  beatLo,
  beatHi,
  ppb,
  left0,
  height,
}: {
  tempo: number;
  beatLo: number;
  beatHi: number;
  ppb: number;
  left0: number; // the lane's left edge — the gutter's width
  height: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Written per animation frame instead of per engine frame: 50 ms is one move every three screen frames — see docs/playhead.md.
  usePlayheadFrames(
    useCallback(
      (seconds: number) => {
        const el = ref.current;
        if (!el) return;
        const beat = (seconds * tempo) / 60;
        // HIDDEN, not unmounted, outside the zoomed range: the callback needs a node to write to when it comes back.
        const inside = beat >= beatLo && beat <= beatHi;
        el.style.visibility = inside ? "visible" : "hidden";
        if (inside)
          el.style.transform = `translateX(${(beat - beatLo) * ppb}px)`;
      },
      [tempo, beatLo, beatHi, ppb],
    ),
  );
  return (
    // Parked at the lane's left edge and TRANSLATED from there: a position is layout and a transform is not.
    <div
      ref={ref}
      className={cn(
        "pointer-events-none absolute top-0 z-20 w-px bg-white/80",
        GROW,
      )}
      style={{
        left: left0,
        willChange: "transform",
        visibility: "hidden", // until the first frame says where it is
        height,
      }}
    />
  );
}
