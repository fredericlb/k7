// LaneMeter.tsx — one lane's meters in its header: the output level, and the input when armed.
// See packages/engine-browser/docs/meters.md.

import { useEngineState } from "@studio/engine-browser/store";
import { usePaneVisible } from "../../paneVisible";

const VU_MIN_DB = -60; // name-header VU meter: dB mapped to an empty header fill
const VU_MAX_DB = 6; // dB mapped to a full-width header fill

// dB → how much of the header the bar fills.
const vuFill = (db: number | undefined) =>
  Math.max(
    0,
    Math.min(1, ((db ?? -Infinity) - VU_MIN_DB) / (VU_MAX_DB - VU_MIN_DB)),
  ) * 100;

/** One lane's meters — the output level across the header, the input level when armed; the dB is rounded first, so a bar nobody can see costs no re-render. */
export function LaneMeter({ index, armed }: { index: number; armed: boolean }) {
  // Hidden, the selectors answer a constant, so the meter-rate frames render nothing behind another pane.
  const visible = usePaneVisible();
  const out = useEngineState((s) =>
    visible ? Math.round(s.levels[index] ?? -Infinity) : -Infinity,
  );
  const input = useEngineState((s) =>
    visible && armed
      ? Math.round(s.inputLevels[index] ?? -Infinity)
      : -Infinity,
  );
  return (
    <>
      {/* live VU: a faint green fill behind the label, SCALED from the left rather than resized so it never reflows (@studio/engine-browser docs/meters.md). */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-full origin-left bg-meter-ok/20"
        style={{ transform: `scaleX(${vuFill(out) / 100})` }}
      />
      {/* armed input meter, pinned to the bottom edge; the faint track shows at silence, so a quiet armed input still reads as armed. */}
      {armed && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-arm/20">
          <div
            className="h-full w-full origin-left bg-arm"
            style={{ transform: `scaleX(${vuFill(input) / 100})` }}
          />
        </div>
      )}
    </>
  );
}
