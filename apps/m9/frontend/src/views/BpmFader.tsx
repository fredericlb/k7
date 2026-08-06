// BpmFader.tsx — one deck's tempo, as a vertical fader: up is faster, with a notch at the
// song's own tempo. (A Technics puts + at the BOTTOM; this is a fader on a screen, not a
// platter, so it follows the screen convention.) See ../../docs/bpm.md.

import { faderRange, PITCH_RANGE } from "../deck";

export function BpmFader({
  natural,
  target,
  disabled,
  onChange,
  onCommit,
}: {
  /** The song's own tempo, 0 when the engine found none. */
  natural: number;
  /** What it is playing at. */
  target: number;
  /** Driven by the other deck: the handle still moves, the hand cannot. */
  disabled: boolean;
  /** Every step of the drag — for the number, which must keep up with the finger. */
  onChange: (bpm: number) => void;
  /** Let go. Re-warping is a DOCUMENT change, so it lands here and not on every pixel. */
  onCommit: () => void;
}) {
  const has = natural > 0;
  const [lo, hi] = faderRange(natural, target);
  // The song's own tempo, as a fraction UP the track — the notch the handle returns to.
  const homeFromTop = hi > lo ? (1 - (natural - lo) / (hi - lo)) * 100 : 50;

  return (
    <div className="flex h-full w-14 shrink-0 flex-col items-center gap-1">
      <span
        className={`font-mono text-[11px] tabular-nums ${
          disabled ? "text-muted-foreground" : ""
        }`}
      >
        {has ? target.toFixed(1) : "—"}
      </span>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {/* The track, and the notch at the song's own tempo. Without it the fader says how
            fast, never how far from the record — which is the thing you actually want. */}
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
          disabled={disabled || !has}
          // `writingMode: vertical-lr` + `direction: rtl` is the portable way to stand a
          // range input up: `appearance: slider-vertical` is gone from Chrome and never
          // existed in Safari. rtl is what puts the LOW end at the bottom.
          style={{ writingMode: "vertical-lr", direction: "rtl" }}
          className={`h-full cursor-pointer accent-foreground ${
            disabled ? "opacity-40" : ""
          }`}
          onChange={(e) => onChange(Number(e.target.value))}
          // Wrapped, NOT passed straight through: React hands a handler the event, and a
          // caller whose `onCommit` takes an optional argument would receive a PointerEvent
          // where it expected its own default. Typechecks, breaks at runtime.
          onPointerUp={() => onCommit()}
          onKeyUp={() => onCommit()}
          // Double-click returns the record to its own tempo — the one position worth a
          // shortcut, and the one a drag never lands on exactly.
          onDoubleClick={() => {
            if (!disabled && has) {
              onChange(natural);
              onCommit();
            }
          }}
          aria-label="tempo de cette platine, en BPM"
          title={
            !has
              ? "le moteur n'a trouvé aucun tempo pour ce morceau"
              : disabled
                ? "piloté par l'autre platine (sync)"
                : "tempo — double-clic pour revenir à celui du morceau"
          }
        />
      </div>

      {/* How far from the record, which is what a DJ reads mid-set — and AMBER once past the
          fader's own ±16 %, which only a sync can do. Syncing a 90 bpm track to a 123 bpm one
          is a +37 % stretch: legitimate, audible as artefacts, and worth seeing rather than
          discovering through the speakers. */}
      <span
        className={`font-mono text-[10px] tabular-nums ${
          has && Math.abs(target - natural) > natural * PITCH_RANGE
            ? "text-amber-500"
            : "text-muted-foreground"
        }`}
        title={
          has && Math.abs(target - natural) > natural * PITCH_RANGE
            ? "au-delà de la plage d'une platine — l'étirement s'entend"
            : undefined
        }
      >
        {has && natural > 0
          ? `${target >= natural ? "+" : ""}${(((target - natural) / natural) * 100).toFixed(1)}%`
          : "BPM"}
      </span>
    </div>
  );
}
