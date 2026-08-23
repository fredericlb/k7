// MasterMeter — the mix as it leaves for the interface, in the header: one bar, and a red light
// that stays on if anything clipped during the last playback.
//
// A LEAF that subscribes to the engine store itself, which is what the store exists for: the frame
// arrives at 20 Hz, and a value read in App would re-render the whole tree twenty times a second
// to move a bar eight pixels. See engineStore.ts, and docs/masterMeter.md for the Fix button.

import { cn } from "@frediverse/ui/lib/utils";
import { useEngineState } from "@studio/engine-browser/store";
import { MASTER_MAX_DB } from "@studio/song-schema/yaml/projectSchema";
import {
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { TARGET_DB } from "../gainTrim";

/** The bottom of the scale, in dB. Below this the bar is empty rather than negative. */
export const FLOOR_DB = -60;
/** Where the bar turns from green to amber — the last few dB before there is no headroom left. */
const HOT_DB = -6;
/** The bottom of the FADER, which is not the bottom of the field: below -60 dB a fader spends its travel on inaudible (docs/masterMeter.md). */
const FADER_MIN_DB = -60;

/** dB → 0..1 across the drawn scale. Linear in dB, which is what a meter's markings are. */
export const meterFill = (db: number): number =>
  Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB));

/** The rising edge of `playing`: a NEW pass has begun — the one event that makes the light, the peak and the Fix offer stale. */
export const newPass = (playing: boolean, wasPlaying: boolean): boolean =>
  playing && !wasPlaying;

export const clipLatch = (
  lit: boolean,
  overload: boolean,
  playing: boolean,
  wasPlaying: boolean,
): boolean => overload || (lit && !newPass(playing, wasPlaying));

/** The loudest the master got during this pass — cleared on the same edge as the light, and RESTARTED from this frame's level. */
export const peakHold = (
  held: number,
  now: number,
  playing: boolean,
  wasPlaying: boolean,
): number => (newPass(playing, wasPlaying) ? now : Math.max(held, now));

/** What the Fix button knows and nothing else does — a handle, the peak being folded during render at 20 Hz; `take` marks the offer spent. */
export interface MasterMeterHandle {
  /** The pass's loudest, and whether there is anything to offer about it. */
  pass(): { peak: number; offered: boolean };
  take(): void;
}

export function MasterMeter({
  className,
  onFix,
  master,
  onMaster,
  ref,
}: {
  className?: string;
  /** Bring the OUTPUT down until the last pass's peak would have sat at -6 dB — a CALLBACK, this component being a leaf (gainTrim.ts). */
  onFix?: () => void;
  /** The song's output level in dB and how to write it: the PROJECT's value, so it survives a stop; absent draws no fader. */
  master?: number;
  onMaster?: (db: number) => void;
  ref?: Ref<MasterMeterHandle>;
}) {
  const db = useEngineState((s) => s.master);
  const overload = useEngineState((s) => s.masterClipped);
  const playing = useEngineState((s) => s.playing);

  /** The light, held for the whole of a playback and cleared on the RISING EDGE of `playing`, so it stays lit after you stop. */
  const [clipped, setClipped] = useState(false);
  /** Whether the offer has already been taken for this pass — set on the CLICK, an offer taken being one that should stop being made. */
  const [fixed, setFixed] = useState(false);
  const wasPlaying = useRef(playing);
  useEffect(() => {
    setClipped((lit) => clipLatch(lit, overload, playing, wasPlaying.current));
    // …and a new pass makes the offer fresh again, on the same edge that clears the light.
    if (newPass(playing, wasPlaying.current)) setFixed(false);
    wasPlaying.current = playing;
  }, [overload, playing]);

  /** …and the loudest it got, a REF written during render: it cannot be asked for at click time, when `master` reads silence. */
  const peak = useRef(FLOOR_DB);
  peak.current = peakHold(peak.current, db, playing, wasPlaying.current);

  // …and the same two facts the button is drawn from, for the command; the peak is a ref, so it is fresh whenever it is asked for.
  useImperativeHandle(
    ref,
    (): MasterMeterHandle => ({
      pass: () => ({ peak: peak.current, offered: clipped && !fixed }),
      take: () => setFixed(true),
    }),
    [clipped, fixed],
  );

  /** What the fader SHOWS while it is being dragged, before the file has answered — optimistic, like the mixer's knobs. */
  const [dragged, setDragged] = useState<number | null>(null);
  // A fresh document is the TRIGGER, not a value this body reads — the same shape `useGridCaret`'s `resetKey` has.

  // biome-ignore lint/correctness/useExhaustiveDependencies: `master` is the trigger, not a read.
  useEffect(() => setDragged(null), [master]);
  const level = dragged ?? master ?? 0;

  const w = meterFill(db);
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div
        className={cn("flex items-center gap-1.5")}
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
        {/* Always drawn, dark when nothing clipped: a light only there when it is on cannot be looked at to check. */}
        <span
          aria-label={clipped ? "a saturé" : "pas de saturation"}
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            clipped
              ? "bg-red-500 shadow-[0_0_4px_1px] shadow-red-500/60"
              : "bg-foreground/20",
          )}
        />
        {/* …and unlike the light this one comes and goes: it is an offer to act, not a reading to be checked (docs/masterMeter.md). */}
        {clipped && !fixed && onFix && (
          <button
            type="button"
            onClick={() => {
              setFixed(true);
              onFix();
            }}
            title={`baisser la sortie du morceau, pour un pic à ${TARGET_DB} dB`}
            className="shrink-0 rounded border border-red-500/40 px-1 py-px font-medium text-[10px] text-red-500 leading-none hover:bg-red-500/10"
          >
            fix
          </button>
        )}
      </div>
      {/* THE FADER — a native range input, `onChange` painting and the release committing, floored at -60 (docs/masterMeter.md). */}
      {master !== undefined && onMaster && (
        <div className="flex items-center gap-1.5">
          <input
            type="range"
            min={FADER_MIN_DB}
            max={MASTER_MAX_DB}
            step={0.5}
            value={level}
            aria-label="niveau de sortie du morceau"
            title={`niveau de sortie — ${level > 0 ? "+" : ""}${level.toFixed(1)} dB (0 = unité, +${MASTER_MAX_DB} le haut du fader)`}
            onChange={(e) => setDragged(Number(e.target.value))}
            onPointerUp={() => dragged !== null && onMaster(dragged)}
            onKeyUp={() => dragged !== null && onMaster(dragged)}
            // HALF the platform's thumb, through per-browser pseudo-elements since there is no standard one — both written, or Firefox draws none.
            className={cn(
              "h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-foreground/15",
              "[&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground/60",
              "[&::-moz-range-thumb]:h-2 [&::-moz-range-thumb]:w-2 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground/60",
            )}
          />
          {/* The number, tabular so the row does not shuffle as the digits change under a drag. */}
          <span className="w-8 shrink-0 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
            {level > 0 ? "+" : ""}
            {level.toFixed(1)}
          </span>
        </div>
      )}
    </div>
  );
}
