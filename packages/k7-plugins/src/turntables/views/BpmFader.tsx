// BpmFader.tsx — one deck's tempo, as a vertical fader: up is faster, with a notch at the
// song's own tempo. (A Technics puts + at the BOTTOM; this is a fader on a screen, not a
// platter, so it follows the screen convention.) See ../../docs/bpm.md.

import { Pencil } from "@frediverse/ui/icons";
import { camelot, PITCH_CLASSES } from "@studio/audio-probe/key";
import { m } from "../../paraglide/messages.js";
import { BPM_RANGE, PITCH_RANGE } from "../deckVocabulary";

/** PL8 stores `C# minor`; the wheel wants `12A`. Parsed here rather than stored, so the mode's
 *  name survives — and an unparseable string comes back as itself rather than as nothing. */
function camelotOf(key: string): string {
  const m = /^([A-G]#?)\s+(major|minor)$/.exec(key.trim());
  if (!m) return key;
  const tonic = PITCH_CLASSES.indexOf(m[1] as (typeof PITCH_CLASSES)[number]);
  if (tonic < 0) return key;
  return camelot({
    tonic,
    mode: m[2] as "major" | "minor",
    // A typed key is not a guess, so the margin the detector reports has no meaning here.
    margin: 1,
  });
}

export function BpmFader({
  natural,
  target,
  driven,
  onChange,
  onCommit,
  keylock,
  onKeylock,
  corrected,
  songKey,
  onHalve,
  onDouble,
}: {
  /** The song's own tempo, 0 when the engine found none. */
  natural: number;
  /** What it is playing at. */
  target: number;
  /** Driven by the other deck — greyed and still GRABBABLE, which is how a DJ leaves sync (../../docs/bpm.md). */
  driven: boolean;
  /** Every step of the drag — for the number, which must keep up with the finger. */
  onChange: (bpm: number) => void;
  /** Let go. Re-warping is a DOCUMENT change, so it lands here and not on every pixel. */
  onCommit: () => void;
  /** Is the pitch held while the tempo moves? Off is a platter's behaviour and the default. */
  keylock: boolean;
  onKeylock: () => void;
  /** Does PL8 hold a corrected tempo for this record? — ../../docs/grid.md. */
  corrected: boolean;
  /** Its KEY as pl8 holds it, `C# minor`, or "" when nobody has typed one. */
  songKey: string;
  /** Halve or double what the record IS. Absent with nothing loaded, or no tempo to halve. */
  onHalve?: () => void;
  onDouble?: () => void;
}) {
  const has = natural > 0;
  const [lo, hi] = BPM_RANGE;
  // The song's own tempo, as a fraction UP the track — the notch the handle returns to.
  const homeFromTop = hi > lo ? (1 - (natural - lo) / (hi - lo)) * 100 : 50;

  return (
    // Not `h-full`: the column that holds this owns the height, and puts the deck's PLAY under KEY.
    <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1">
      <span
        className={`font-mono text-[11px] tabular-nums ${
          driven ? "text-muted-foreground" : ""
        }`}
      >
        {has ? target.toFixed(1) : "—"}
      </span>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {/* The track and the notch at the song's own tempo: without it the fader never says how far. */}
        <div className="pointer-events-none absolute inset-y-0 w-1 rounded bg-muted" />
        {has ? (
          <div
            className="pointer-events-none absolute h-px w-6 bg-foreground/40"
            style={{ top: `${homeFromTop}%` }}
          />
        ) : null}

        <input
          type="range"
          min={lo}
          max={hi}
          step={0.1}
          value={has ? target : 0}
          disabled={!has}
          // The portable way to stand a range input up — `slider-vertical` is gone; rtl puts LOW at the bottom.
          style={{ writingMode: "vertical-lr", direction: "rtl" }}
          className={`h-full cursor-pointer accent-foreground ${
            driven ? "opacity-60" : ""
          }`}
          onChange={(e) => onChange(Number(e.target.value))}
          // Wrapped, NOT passed through: an `onCommit` with an optional argument would get a PointerEvent.
          onPointerUp={() => onCommit()}
          onKeyUp={() => onCommit()}
          // Double-click returns the record to its own tempo, the one position a drag never lands on.
          onDoubleClick={() => {
            if (has) {
              onChange(natural);
              onCommit();
            }
          }}
          aria-label={m["bpm.aria"]()}
          title={
            !has
              ? m["bpm.none"]()
              : driven
                ? m["bpm.driven"]()
                : m["bpm.fader"]()
          }
        />
      </div>

      {/* How far from the record, AMBER past a real deck's ±16 % — ../../docs/bpm.md. */}
      <span
        className={`font-mono text-[10px] tabular-nums ${
          has && Math.abs(target - natural) > natural * PITCH_RANGE
            ? "text-amber-500"
            : "text-muted-foreground"
        }`}
        title={
          has && Math.abs(target - natural) > natural * PITCH_RANGE
            ? m["bpm.pastRange"]()
            : undefined
        }
      >
        {has && natural > 0
          ? `${target >= natural ? "+" : ""}${(((target - natural) / natural) * 100).toFixed(1)}%`
          : "BPM"}
      </span>

      {/* The octave error, which is the correction a detector actually gets wrong — ../../docs/grid.md.
          Greyed with no tempo to halve: there is nothing to be right or wrong about yet. */}
      <div className="flex w-full shrink-0 gap-1">
        {(
          [
            ["÷2", onHalve, m["bpm.halve"]()],
            ["×2", onDouble, m["bpm.double"]()],
          ] as const
        ).map(([label, act, why]) => (
          <button
            key={label}
            type="button"
            disabled={!act}
            onClick={act}
            className={`h-5 flex-1 rounded font-mono text-[9px] leading-none ${
              act
                ? "bg-muted text-muted-foreground hover:bg-accent"
                : "bg-muted/40 text-muted-foreground/40"
            }`}
            title={act ? why : m["bpm.noTempo"]()}
          >
            {label}
          </button>
        ))}
      </div>
      {/* Only when pl8 HOLDS a correction: a badge that is always there says nothing. */}
      {corrected ? (
        <span
          className="shrink-0 font-mono text-[8px] text-primary-text leading-none"
          title={m["bpm.corrected"]()}
        >
          BPM <Pencil className="size-2" />
        </span>
      ) : null}

      {/* The KEY, and its Camelot code — typed in the médiathèque, never detected (docs/grid.md). */}
      {songKey ? (
        <span
          className="shrink-0 font-mono text-[9px] text-muted-foreground leading-none"
          title={m["bpm.key"]({ key: songKey })}
        >
          {camelotOf(songKey)}
        </span>
      ) : null}

      {/* Pioneer's MASTER TEMPO, under the fader it changes the meaning of — ../../docs/bpm.md. */}
      <button
        type="button"
        onClick={onKeylock}
        // As tall as the PLAY under it: two blocks a hand finds without looking down.
        className={`h-12 w-full shrink-0 rounded px-1 font-mono text-[10px] leading-none ${
          keylock
            ? "bg-primary/80 text-primary-foreground"
            : "bg-muted text-muted-foreground hover:bg-accent"
        }`}
        title={keylock ? m["bpm.keylockOn"]() : m["bpm.keylockOff"]()}
      >
        KEY
      </button>
    </div>
  );
}
