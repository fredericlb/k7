// Playhead.tsx — the arrangement's playhead: checked per animation frame against the local clock, moved by a compositor animation.
// See ../../../docs/playhead.md.

import { cn } from "@frediverse/ui/lib/utils";
import { useCallback, useRef } from "react";
import { usePlayheadFrames } from "../../hooks/usePlayheadFrames";
import { GROW } from "./grow";
import { type Glide, NO_GLIDE, steerGlide } from "./playheadGlide";

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
  const glide = useRef<Glide>(NO_GLIDE);
  const shown = useRef(false);
  // Checked per animation frame, but the line is moved by a compositor animation that is restarted only on disagreement — see docs/playhead.md.
  usePlayheadFrames(
    useCallback(
      (seconds: number, playing: boolean) => {
        const el = ref.current;
        if (!el) return;
        const beat = (seconds * tempo) / 60;
        // HIDDEN, not unmounted, outside the zoomed range: the callback needs a node to write to when it comes back.
        const inside = beat >= beatLo && beat <= beatHi;
        if (inside !== shown.current) {
          shown.current = inside;
          el.style.visibility = inside ? "visible" : "hidden";
        }
        if (!inside) {
          glide.current.anim?.cancel();
          glide.current = NO_GLIDE;
          return;
        }
        glide.current = steerGlide(
          el,
          glide.current,
          (beat - beatLo) * ppb,
          (beatHi - beatLo) * ppb,
          (tempo / 60 / 1000) * ppb,
          playing,
          performance.now(),
        );
      },
      [tempo, beatLo, beatHi, ppb],
    ),
  );
  return (
    // Parked at the lane's left edge and TRANSLATED from there: a position is layout and a transform is not.
    <div
      ref={ref}
      className={cn(
        "pointer-events-none absolute top-0 z-20 w-px bg-playhead",
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
