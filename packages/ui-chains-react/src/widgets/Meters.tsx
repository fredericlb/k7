// Meters.tsx — the level bars a card draws: a lane's input meter and a fader's own meter, each
// subscribed to the one level it shows — docs/nodeCard.md.

import { useInputLevel, useTrackLevel } from "@studio/engine-browser/store";
import { CTRL } from "../chainsCss";

// The armed-track input meter: its own store subscription, so a moving input re-renders 4px, not the graph.
export function InputMeterBar({
  trackId,
  order,
}: {
  trackId: string;
  order: string[];
}) {
  const level = useInputLevel(trackId, order);
  if (level === null) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 4,
        overflow: "hidden",
        pointerEvents: "none",
        background: "rgba(239,68,68,0.22)", // red-500 @ 22%
      }}
    >
      {/* Scaled, not resized: a width would reflow this every frame the engine speaks (docs/meters.md). */}
      <div
        style={{
          height: "100%",
          width: "100%",
          transform: `scaleX(${level})`,
          transformOrigin: "left",
          background: CTRL["@arm"], // red-500, matching the arm control
        }}
      />
    </div>
  );
}

/** The fader's VU — the same strip as the Mix panel's, with its own subscription, docs/nodeCard.md. */
export function FaderMeter({
  trackId,
  order,
}: {
  trackId: string;
  order: string[];
}) {
  const t = useTrackLevel(trackId, order);
  if (t === null) return null;
  return (
    <div className="dgx-fmeter">
      {/* The SHADE, not the fill: it covers the ramp down to the level, scaled rather than resized. */}
      <i style={{ transform: `scaleY(${1 - t})` }} />
    </div>
  );
}
