// MasterMeter — the mix as it leaves for the interface, in the header: ONE lane holding the
// meter, the output fader's handle and the unity mark, plus a red light that stays on if
// anything clipped during the last playback.
//
// A LEAF that subscribes to the engine store itself, which is what the store exists for: the frame
// arrives at 20 Hz, and a value read in App would re-render the whole tree twenty times a second
// to move a bar eight pixels. See engineStore.ts, and docs/masterMeter.md for the Fix button.

import { cn } from "@frediverse/ui/lib/utils";
// The arithmetic is SHARED: the DJ desk draws the same meter off the same frames — docs/masterMeter.md.
import {
  clipLatch,
  FLOOR_DB,
  HOT_DB,
  meterFill,
  newPass,
  peakHold,
} from "@studio/engine-browser/meter";
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
import { m } from "../paraglide/messages.js";

/** The bottom of the FADER, which is not the bottom of the field: below -60 dB a fader spends its travel on inaudible (docs/masterMeter.md). */
const FADER_MIN_DB = -60;
/** The handle's width in pixels, which the unity mark has to know: a range insets its thumb by half of it at each end. */
const THUMB_PX = 4;
/** Where 0 dB sits on the travel, as the CENTRE of a thumb at that value rather than as a plain fraction of the track. */
const UNITY_LEFT = (() => {
  const f = (0 - FADER_MIN_DB) / (MASTER_MAX_DB - FADER_MIN_DB);
  return `calc(${(f * 100).toFixed(3)}% + ${((0.5 - f) * THUMB_PX).toFixed(2)}px)`;
})();

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
  /** Whether there is a fader at all: a share has no project to write to, and then the lane is a meter alone. */
  const fader = master !== undefined && onMaster !== undefined;
  // The number, for anyone who wants it exactly — a bar answers "how loud", never "how much".
  const reading =
    `sortie ${db <= FLOOR_DB ? "silence" : `${db.toFixed(1)} dB`}` +
    (clipped ? m["meter.clipped"]() : "");

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {/* ONE lane: the meter is the fader's track, and the handle rides on the reading it sets (docs/masterMeter.md). */}
      <div className="relative h-1.5 w-24" title={reading}>
        <div className="absolute inset-0 overflow-hidden rounded-full bg-foreground/15">
          {/* SCALED from the left, not resized: a width is layout at the meter's rate, a transform is not (docs/masterMeter.md). */}
          <div
            className={cn(
              "absolute inset-0 origin-left transition-transform duration-75",
              db >= HOT_DB ? "bg-amber-400" : "bg-emerald-400",
            )}
            style={{ transform: `scaleX(${w})` }}
          />
        </div>
        {/* UNITY — the one point of the travel worth finding without reading the number, and the handle covers it when it is there. */}
        {fader && (
          <span
            aria-hidden="true"
            className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 h-2.5 w-px bg-foreground/40"
            style={{ left: UNITY_LEFT }}
          />
        )}
        {/* THE FADER — a native range over the bar, transparent track, `onChange` painting and the release committing (docs/masterMeter.md). */}
        {fader && (
          <input
            type="range"
            min={FADER_MIN_DB}
            max={MASTER_MAX_DB}
            step={0.5}
            value={level}
            aria-label={m["meter.outputLabel"]()}
            title={m["meter.hint"]({
              reading,
              level: `${level > 0 ? "+" : ""}${level.toFixed(1)}`,
              max: MASTER_MAX_DB,
            })}
            onChange={(e) => setDragged(Number(e.target.value))}
            onPointerUp={() => dragged !== null && onMaster?.(dragged)}
            onKeyUp={() => dragged !== null && onMaster?.(dragged)}
            // A HANDLE and no track of its own, through per-browser pseudo-elements since there is no standard one — both written, or Firefox draws none.
            className={cn(
              "absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full bg-transparent",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "[&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-1 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-[1px] [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow-[0_0_0_1px] [&::-webkit-slider-thumb]:shadow-background",
              "[&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:w-1 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-[1px] [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground [&::-moz-range-thumb]:shadow-[0_0_0_1px] [&::-moz-range-thumb]:shadow-background",
            )}
          />
        )}
      </div>
      {/* Always drawn, dark when nothing clipped: a light only there when it is on cannot be looked at to check. */}
      <span
        aria-label={clipped ? m["meter.didClip"]() : m["meter.noClip"]()}
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
          title={m["meter.fixHint"]({ target: TARGET_DB })}
          className="shrink-0 rounded border border-red-500/40 px-1 py-px font-medium text-[10px] text-red-500 leading-none hover:bg-red-500/10"
        >
          fix
        </button>
      )}
      {/* The number, tabular so the row does not shuffle as the digits change under a drag. */}
      {fader && (
        <span className="w-8 shrink-0 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
          {level > 0 ? "+" : ""}
          {level.toFixed(1)}
        </span>
      )}
    </div>
  );
}
