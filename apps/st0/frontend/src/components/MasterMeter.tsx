// MasterMeter — the mix as it leaves for the interface, in the header: one bar, and a red light
// that stays on if anything clipped during the last playback.
//
// A LEAF that subscribes to the engine store itself, which is what the store exists for: the frame
// arrives at 20 Hz, and a value read in App would re-render the whole tree twenty times a second
// to move a bar eight pixels. See engineStore.ts.

import { cn } from "@frediverse/ui/lib/utils";
import { useEngineState } from "@studio/engine-browser/store";
import { useEffect, useRef, useState } from "react";

/** The bottom of the scale, in dB. Below this the bar is empty rather than negative. */
export const FLOOR_DB = -60;
/** Where the bar turns from green to amber — the last few dB before there is no headroom left. */
const HOT_DB = -6;

/** dB → 0..1 across the drawn scale. Linear in dB, which is what a meter's markings are. */
export const meterFill = (db: number): number =>
  Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB));

/**
 * Whether the clip light is lit after this frame — the whole rule, as one expression.
 *
 * ONE function rather than two effects, and that is not tidiness: an effect keyed on `overload`
 * fires when the flag CHANGES, so an overload that was already true when a new pass began would
 * not re-fire, and the pass's own clear would wipe a clip the engine had just reported. Written
 * this way the set cannot lose to the clear, because there is no order — `overload` wins outright.
 *
 * Cleared on the RISING EDGE of `playing` and nothing else: a new pass is the only thing that
 * makes the last one's verdict stale, which is why the light survives the stop you look at it after.
 */
export const clipLatch = (
  lit: boolean,
  overload: boolean,
  playing: boolean,
  wasPlaying: boolean,
): boolean => overload || (lit && !(playing && !wasPlaying));

export function MasterMeter({ className }: { className?: string }) {
  const db = useEngineState((s) => s.master);
  const overload = useEngineState((s) => s.masterClipped);
  const playing = useEngineState((s) => s.playing);

  /**
   * The light, held for the whole of a playback rather than for the frame it happened on.
   *
   * "It clipped during the last playback" is a fact about a PASS, and the engine reports it about
   * a frame — `masterClipped` is true for the one 50 ms window the overload fell in and false
   * again immediately. Latched here, and cleared on the RISING EDGE of `playing`: a new pass is
   * the only thing that makes the last one's verdict stale. So it stays lit after you stop, which
   * is when you are looking at it.
   */
  const [clipped, setClipped] = useState(false);
  const wasPlaying = useRef(playing);
  useEffect(() => {
    setClipped((lit) => clipLatch(lit, overload, playing, wasPlaying.current));
    wasPlaying.current = playing;
  }, [overload, playing]);

  const w = meterFill(db);
  return (
    <div
      className={cn("flex items-center gap-1.5", className)}
      // The number, for anyone who wants it exactly — a bar answers "how loud", never "how much".
      title={
        `sortie ${db <= FLOOR_DB ? "silence" : `${db.toFixed(1)} dB`}` +
        (clipped ? " — a saturé pendant la dernière lecture" : "")
      }
    >
      <div className="relative h-1.5 w-24 overflow-hidden rounded-full bg-foreground/15">
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-[width] duration-75",
            db >= HOT_DB ? "bg-amber-400" : "bg-emerald-400",
          )}
          style={{ width: `${w * 100}%` }}
        />
      </div>
      {/* Always drawn, never appearing and disappearing: a light that is only there when it is on
          cannot be looked at to check, and checking is what it is for. Dark when nothing clipped. */}
      <span
        aria-label={clipped ? "a saturé" : "pas de saturation"}
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          clipped
            ? "bg-red-500 shadow-[0_0_4px_1px] shadow-red-500/60"
            : "bg-foreground/20",
        )}
      />
    </div>
  );
}
