// BpmFader.tsx — one deck's tempo, as a vertical fader: up is faster, with a notch at the
// song's own tempo. (A Technics puts + at the BOTTOM; this is a fader on a screen, not a
// platter, so it follows the screen convention.) See ../../docs/bpm.md.

import { BPM_RANGE, PITCH_RANGE } from "../deck";

export function BpmFader({
  natural,
  target,
  driven,
  onChange,
  onCommit,
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
}) {
  const has = natural > 0;
  const [lo, hi] = BPM_RANGE;
  // The song's own tempo, as a fraction UP the track — the notch the handle returns to.
  const homeFromTop = hi > lo ? (1 - (natural - lo) / (hi - lo)) * 100 : 50;

  return (
    <div className="flex h-full w-14 shrink-0 flex-col items-center gap-1">
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
          aria-label="tempo de cette platine, en BPM"
          title={
            !has
              ? "le moteur n'a trouvé aucun tempo pour ce morceau"
              : driven
                ? "piloté par l'autre platine — le bouger annule le sync"
                : "tempo — double-clic pour revenir à celui du morceau"
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
