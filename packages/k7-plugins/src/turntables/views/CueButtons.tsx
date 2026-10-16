// CueButtons.tsx — a deck's eight hot cues. A short press JUMPS to one, a long press SETS it
// at the moment the finger landed. See ../../docs/cues.md.

import { formatClock } from "@studio/ui-timeline/ticks";
import { useEffect, useRef, useState } from "react";
import { CUE_COLOURS } from "../deckVocabulary";

/** How long a press has to last to mean "record this" rather than "go there". */
const HOLD_MS = 1000;

/** One cue button — the timer decides WHICH gesture happened, never where. See ../../docs/cues.md. */
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
  onSet: (sourceSeconds: number) => void;
  /** Where this deck's NEEDLE is, in seconds of its record. Called on the way down, never after. */
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
    // A short press on an EMPTY button does nothing, rather than jumping to zero.
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
      // A cue is a gesture: the browser's long-press menu would land in the middle of setting one.
      onContextMenu={(e) => e.preventDefault()}
      title={
        disabled
          ? `cue ${slot + 1} — this deck needs a song`
          : at === null
            ? `cue ${slot + 1} — press and hold to put it here`
            : `cue ${slot + 1} at ${formatClock(Math.max(0, at))} — tap to go there, hold to set it again`
      }
    >
      {slot + 1}
    </button>
  );
}

/** A deck's eight cues, drawn on an EMPTY deck too — greyed says "not yet". See ../../docs/cues.md. */
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
          // biome-ignore lint/suspicious/noArrayIndexKey: the slot IS the identity — a cue button is a fixed position on a desk, never a row that reorders.
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
