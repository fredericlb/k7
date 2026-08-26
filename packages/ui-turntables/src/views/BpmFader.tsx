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
  keylock,
  onKeylock,
  corrected,
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
  /** Does THIS SET correct the analysis for the record on this deck? — ../../docs/grid.md. */
  corrected: boolean;
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

      {/* The octave error, which is the correction a detector actually gets wrong — ../../docs/grid.md.
          Greyed with no tempo to halve: there is nothing to be right or wrong about yet. */}
      <div className="flex w-full shrink-0 gap-1">
        {(
          [
            ["÷2", onHalve, "moitié : le tempo détecté est le double du vrai"],
            ["×2", onDouble, "double : le tempo détecté est la moitié du vrai"],
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
            title={act ? why : "aucun tempo mesuré sur cette platine"}
          >
            {label}
          </button>
        ))}
      </div>
      {/* Only when this set HAS corrected something: a badge that is always there says nothing. */}
      {corrected ? (
        <span
          className="shrink-0 font-mono text-[8px] text-primary leading-none"
          title="ce set corrige la grille de ce morceau — écrit dans mix.yaml, à côté des repères"
        >
          GRILLE ✎
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
        title={
          keylock
            ? "hauteur tenue : le morceau garde sa tonalité, mais les stems ne se somment plus proprement"
            : "hauteur libre : le morceau monte avec le tempo, comme un vinyle"
        }
      >
        KEY
      </button>
    </div>
  );
}
