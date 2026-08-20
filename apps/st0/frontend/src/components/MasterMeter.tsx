// MasterMeter — the mix as it leaves for the interface, in the header: one bar, and a red light
// that stays on if anything clipped during the last playback.
//
// A LEAF that subscribes to the engine store itself, which is what the store exists for: the frame
// arrives at 20 Hz, and a value read in App would re-render the whole tree twenty times a second
// to move a bar eight pixels. See engineStore.ts, and docs/masterMeter.md for the Fix button.

import { cn } from "@frediverse/ui/lib/utils";
import { useEngineState } from "@studio/engine-browser/store";
import { useEffect, useRef, useState } from "react";
import { TARGET_DB } from "../gainTrim";

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
/**
 * The rising edge of `playing`: a NEW pass has begun.
 *
 * The one event that makes everything the meter holds stale — the light, the peak, and whether
 * the Fix button's offer has already been taken. Written once and read by all three, so "they
 * clear on the same edge" is the code rather than a promise made in three comments.
 */
export const newPass = (playing: boolean, wasPlaying: boolean): boolean =>
  playing && !wasPlaying;

export const clipLatch = (
  lit: boolean,
  overload: boolean,
  playing: boolean,
  wasPlaying: boolean,
): boolean => overload || (lit && !newPass(playing, wasPlaying));

/**
 * The loudest the master got during this pass — the measurement the Fix button spends.
 *
 * The same shape as `clipLatch` and cleared on the same edge, deliberately: the light and the
 * number answer one question ("what did the last pass do") and a peak that outlived the light
 * would offer a trim computed from a pass nobody is looking at any more.
 *
 * The rising edge RESTARTS from this frame's level rather than from the floor. Starting at
 * -Infinity would be a truer empty, and it would also mean the first frame of a pass is the only
 * one that can seed it — so a client that missed that frame would hold a peak from nowhere.
 */
export const peakHold = (
  held: number,
  now: number,
  playing: boolean,
  wasPlaying: boolean,
): number => (newPass(playing, wasPlaying) ? now : Math.max(held, now));

export function MasterMeter({
  className,
  onFix,
}: {
  className?: string;
  /**
   * Bring the mix down until the last pass's peak would have sat at -6 dB.
   *
   * A CALLBACK and not the act itself: this component is a leaf that subscribes to the engine
   * store twenty times a second and knows nothing of the project. Which faders exist and how a
   * level is written is App's (`gainTrim.ts` is the arithmetic between them). Absent — a host
   * with nothing to lower — and the button is not drawn at all.
   */
  onFix?: (peakDb: number) => void;
}) {
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
  /**
   * Whether the offer has already been taken for this pass — what makes the button go away.
   *
   * Separate from the light, and the two answer different questions. The light is a READING: this
   * pass clipped, and it still did after you fixed it, so it stays lit until a pass replaces it.
   * The button is an OFFER, and an offer taken is one that should stop being made — leaving it
   * there would invite a second click that takes another 6 dB off a mix already brought down.
   *
   * Set on the CLICK rather than when the writes land: the click is the decision, and a button
   * that lingers through a round trip is exactly the one that gets pressed twice.
   */
  const [fixed, setFixed] = useState(false);
  const wasPlaying = useRef(playing);
  useEffect(() => {
    setClipped((lit) => clipLatch(lit, overload, playing, wasPlaying.current));
    // …and a new pass makes the offer fresh again, on the same edge that clears the light.
    if (newPass(playing, wasPlaying.current)) setFixed(false);
    wasPlaying.current = playing;
  }, [overload, playing]);

  /**
   * …and the loudest it got while doing it, which is what the Fix button spends.
   *
   * A REF, written during render, for the reason this whole component is a leaf: a level arrives
   * twenty times a second and this one re-renders for it anyway (the bar moves), so folding the
   * maximum in here is free — where a `useState` would schedule a second render per frame to
   * store a number nobody looks at until the transport has stopped.
   *
   * It cannot be asked for at click time either: by then playback has ended and `master` reads
   * silence. The pass's peak only exists where somebody kept it.
   *
   * `wasPlaying` is still the PREVIOUS frame's value here — its effect has not run yet — which is
   * exactly the edge `peakHold` needs, and re-running this line (StrictMode renders twice) gives
   * the same answer from the same inputs.
   */
  const peak = useRef(FLOOR_DB);
  peak.current = peakHold(peak.current, db, playing, wasPlaying.current);

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
      {/* …and unlike the light, this one DOES come and go, for the opposite reason: it is not a
          reading to be checked but an offer to act, and an offer that is permanently on screen
          greyed out is a button you learn to stop seeing. It appears when there is something to
          fix, and leaves both ways it can stop being worth offering: taken, or made stale by a
          new pass. The light stays through the first of those — it says what HAPPENED, and
          fixing the mix does not change what the last pass did.

          It reads the ref rather than a piece of state, which is safe here because a click is not
          a render: whatever the last frame put there is the pass's peak. */}
      {clipped && !fixed && onFix && (
        <button
          type="button"
          onClick={() => {
            setFixed(true);
            onFix(peak.current);
          }}
          title={`baisser toutes les tranches d'un même gain, pour un pic à ${TARGET_DB} dB`}
          className="shrink-0 rounded border border-red-500/40 px-1 py-px font-medium text-[10px] text-red-500 leading-none hover:bg-red-500/10"
        >
          fix
        </button>
      )}
    </div>
  );
}
