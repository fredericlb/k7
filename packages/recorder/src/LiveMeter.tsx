// LiveMeter.tsx — the input meter, the one part of the recorder that moves every frame.
// It subscribes to the level alone, so a frame re-renders this bar and nothing around it.

import type { LiveValue } from "./liveValue";
import { useLiveValue } from "./liveValue";

export function LiveMeter({
  level,
  gain,
}: {
  level: LiveValue<number>;
  gain: number;
}) {
  const pct = Math.min(100, useLiveValue(level) * gain * 100);
  return (
    <div className="meter">
      <div
        className="meter-fill"
        style={{
          width: `${pct}%`,
          background: pct > 92 ? "var(--red)" : "var(--accent)",
        }}
      />
    </div>
  );
}
