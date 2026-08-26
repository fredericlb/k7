// LoopRow.tsx — a deck's loop section: beat jump, manual in/out, three lengths, halve/double and
// the roll. One row under the cues. See ../../docs/loop.md.

import { LOOP_BEATS } from "../loop";

/** How a length reads on a button: `16`, and `1/2` rather than `0.5` once ÷2 has been past one. */
export function lengthLabel(beats: number): string {
  if (beats >= 1) return String(beats);
  const over = Math.round(1 / beats);
  return `1/${over}`;
}

/** One button. Small, flat and monospaced — the row is read as a strip, not as ten widgets. */
function Key({
  label,
  title,
  on,
  disabled,
  onClick,
  onHold,
}: {
  label: string;
  title: string;
  on?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  /** Held rather than clicked — the roll, which is a gesture and not a state. */
  onHold?: (down: boolean) => void;
}) {
  const held = onHold
    ? {
        onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onHold(true);
        },
        onPointerUp: () => onHold(false),
        onPointerCancel: () => onHold(false),
        onLostPointerCapture: () => onHold(false),
      }
    : { onClick };
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      className={`h-6 min-w-0 flex-1 rounded border font-mono text-[10px] tabular-nums transition-colors ${
        disabled ? "opacity-40" : ""
      } ${
        on
          ? "border-amber-500 bg-amber-500 text-white"
          : "border-border bg-background text-foreground"
      }`}
      // A roll is a gesture: the browser's long-press menu would land in the middle of one.
      onContextMenu={(e) => e.preventDefault()}
      {...held}
    >
      {label}
    </button>
  );
}

/** A deck's loop row, drawn on an empty deck too — greyed says "not yet", as the cues do. */
export function LoopRow({
  beats,
  rolling,
  pending,
  step,
  disabled,
  onJump,
  onIn,
  onOut,
  onLength,
  onResize,
  onRoll,
}: {
  /** The running loop's length, or null when nothing loops. */
  beats: number | null;
  /** …and whether it is a ROLL, which the length buttons must not claim as theirs. */
  rolling: boolean;
  /** A manual IN with no OUT yet. */
  pending: boolean;
  /** What ◀ ▶ and the roll move by — the last length anybody asked for. */
  step: number;
  /** No record, or no measured tempo: a loop is a length in BEATS and there are none. */
  disabled: boolean;
  onJump: (beats: number) => void;
  onIn: () => void;
  onOut: () => void;
  onLength: (beats: number) => void;
  onResize: (factor: number) => void;
  onRoll: (down: boolean) => void;
}) {
  const jump = lengthLabel(step);
  return (
    <div className="flex w-full gap-1">
      <Key
        label="◀"
        title={`reculer de ${jump} temps`}
        disabled={disabled}
        onClick={() => onJump(-step)}
      />
      <Key
        label="▶"
        title={`avancer de ${jump} temps`}
        disabled={disabled}
        onClick={() => onJump(step)}
      />
      <Key
        label="IN"
        title="poser le début de la boucle ici"
        on={pending}
        disabled={disabled}
        onClick={onIn}
      />
      <Key
        label="OUT"
        title={pending ? "fermer la boucle ici" : "il faut poser un IN d'abord"}
        disabled={disabled || !pending}
        onClick={onOut}
      />
      {LOOP_BEATS.map((n) => (
        <Key
          key={n}
          label={String(n)}
          title={`boucler ${n} temps — le même bouton la referme`}
          // A ROLL lights nothing here: it is held, and its button is the one that says so.
          on={!rolling && beats === n}
          disabled={disabled}
          onClick={() => onLength(n)}
        />
      ))}
      <Key
        label="÷2"
        title="moitié moins longue"
        disabled={disabled || beats === null}
        onClick={() => onResize(0.5)}
      />
      {/* Between the two that change it, as a mixer reads: ÷2 can leave a length no button lights. */}
      <span
        title={
          beats === null
            ? `prochaine longueur : ${jump} temps`
            : `boucle de ${lengthLabel(beats)} temps`
        }
        className={`flex h-6 min-w-0 flex-1 items-center justify-center rounded font-mono text-[10px] tabular-nums ${
          beats === null
            ? "text-muted-foreground/50"
            : "bg-amber-500/15 text-amber-600"
        }`}
      >
        {lengthLabel(beats ?? step)}
      </span>
      <Key
        label="×2"
        title="deux fois plus longue"
        disabled={disabled || beats === null}
        onClick={() => onResize(2)}
      />
      <Key
        label="⟲"
        title={`roulement de ${jump} temps — maintenir ; le disque reprend où il en serait`}
        on={rolling}
        disabled={disabled}
        onHold={onRoll}
      />
    </div>
  );
}
