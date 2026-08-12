// CueButtons.tsx — a deck's eight hot cues. A short press JUMPS to one, a long press SETS it
// at the moment the finger landed. See ../../docs/cues.md.

import { useEffect, useRef, useState } from "react";
import { CUE_COLOURS } from "../deck";

/** How long a press has to last to mean "record this" rather than "go there". */
export const HOLD_MS = 1000;

/**
 * One cue button.
 *
 * The press is timed from `pointerdown`, and the moment it RECORDS is that instant — not the
 * instant the second elapses. A DJ presses when they hear the thing they want to mark; making
 * them hold still for a second afterwards would put the cue a second late, every time, which
 * is a cue you have to correct rather than one you can use.
 *
 * So the position is captured on the way down and only USED if the press lasts. The timer
 * decides which of the two gestures happened; it never decides where.
 */
function Cue({
  slot,
  at,
  onJump,
  onSet,
  now,
  disabled,
}: {
  slot: number;
  /** Where this cue is, in SOURCE seconds, or null for an empty button. */
  at: number | null;
  onJump: () => void;
  /** The press outlasted `HOLD_MS` — record the position it was given, from when it began. */
  onSet: (transportSeconds: number) => void;
  /** Where the transport is, RIGHT NOW. Called on the way down, never after. */
  now: () => number;
  /** No song on this deck. Drawn anyway — see `CueButtons`. */
  disabled: boolean;
}) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  // Captured on `pointerdown` and read a second later, so the cue lands where the finger did.
  const began = useRef(0);
  const [holding, setHolding] = useState(false);
  const colour = CUE_COLOURS[slot % CUE_COLOURS.length];

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  useEffect(() => clear, []);

  const down = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    fired.current = false;
    began.current = now();
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      fired.current = true; // the release must NOT also jump
      setHolding(false);
      onSet(began.current);
    }, HOLD_MS);
  };
  const up = () => {
    const wasHold = fired.current;
    clear();
    // A short press on an EMPTY button does nothing rather than jumping to nowhere — and
    // saying so is the tooltip's job, not a jump to zero.
    if (!wasHold && at !== null) onJump();
  };

  return (
    <button
      type="button"
      disabled={disabled}
      className={`h-7 flex-1 rounded border font-mono text-[10px] tabular-nums transition-transform ${
        holding ? "scale-95" : ""
      } ${disabled ? "opacity-40" : ""}`}
      style={
        at === null
          ? { background: "#ffffff", color: "#111827", borderColor: "#d1d5db" }
          : { background: colour, color: "#ffffff", borderColor: colour }
      }
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={clear}
      onLostPointerCapture={clear}
      // A cue is a gesture, not a menu item: the browser's own long-press menu on touch would
      // land in the middle of setting one.
      onContextMenu={(e) => e.preventDefault()}
      title={
        disabled
          ? `repère ${slot + 1} — il faut un morceau sur cette platine`
          : at === null
            ? `repère ${slot + 1} — appui long pour le poser ici`
            : `repère ${slot + 1} à ${mmss(at)} — appui court pour y aller, long pour le redéfinir`
      }
    >
      {slot + 1}
    </button>
  );
}

/** `m:ss`, the way a deck reads a position. */
function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A deck's eight cues, in one row under its waveform.
 *
 * White until something is on them, then the button's own colour — a colour per BUTTON and not
 * per cue, so slot 3 looks like slot 3 on both decks and on every song. That is what lets a
 * hand find one without reading.
 *
 * Drawn on an EMPTY deck too, greyed. A desk whose controls appeared and vanished with what is
 * loaded is a desk that moves under your hands: the row would push the title up and the strip
 * down the moment a song landed, and the eight positions a hand is learning would not be there
 * to learn. Greyed says "not yet"; absent says "look for it".
 */
export function CueButtons({
  markers,
  onJump,
  onSet,
  now,
  disabled,
}: {
  /** Eight slots, positional. `null` — or a missing tail — is an empty button. */
  markers: readonly (number | null)[];
  onJump: (slot: number) => void;
  onSet: (slot: number, transportSeconds: number) => void;
  /** Where the transport is, right now — see `Cue`. */
  now: () => number;
  /** No song on this deck: the row is drawn, and refuses both gestures. */
  disabled: boolean;
}) {
  return (
    <div className="flex w-full gap-1">
      {CUE_COLOURS.map((_, i) => (
        <Cue
          // biome-ignore lint/suspicious/noArrayIndexKey: the slot IS the identity here — a cue
          // button is a fixed position on a desk, not a row in a list that can reorder.
          key={i}
          slot={i}
          at={markers[i] ?? null}
          onJump={() => onJump(i)}
          onSet={(seconds) => onSet(i, seconds)}
          now={now}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
