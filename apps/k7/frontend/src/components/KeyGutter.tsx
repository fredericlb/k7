// KeyGutter.tsx — the piano roll's keyboard column: one row per MIDI key, high to low, a click
// auditioning it and a double-click selecting its row. A rack that names its keys puts the names
// here instead of the notes. See ../../docs/clipEditors.md.

import { isBlack, noteName, pc } from "../noteNames";

/** Every possible MIDI note (0..127). */
export const N_NOTES = 128;
/** The keys top to bottom: high → low. */
export const KEYS = Array.from({ length: N_NOTES }, (_, i) => 127 - i);

export function KeyGutter({
  width,
  rowH,
  showLabels,
  keyNames,
  onAudition,
  onSelectKey,
  hoverKey = null,
}: {
  width: number;
  rowH: number;
  /** A row too short for 9px text is labelled nowhere. */
  showLabels: boolean;
  /** The names a rack gives its keys, which replace the notes' own. */
  keyNames?: ReadonlyMap<number, string>;
  onAudition?: (key: number) => void;
  onSelectKey: (key: number) => void;
  /** The key the pointer is over in the grid: lit, and named whatever octave it is in. */
  hoverKey?: number | null;
}) {
  const named = keyNames != null && keyNames.size > 0;
  return (
    <div
      className="sticky left-0 z-10 shrink-0 border-r border-border bg-background"
      style={{ width }}
    >
      {KEYS.map((k) => (
        <button
          type="button"
          key={k}
          onClick={() => onAudition?.(k)}
          onDoubleClick={() => onSelectKey(k)}
          title={
            keyNames?.has(k)
              ? `${keyNames.get(k)} · ${noteName(k)}`
              : onAudition
                ? noteName(k)
                : undefined
          }
          className={`flex w-full items-center justify-end pr-1 text-[9px] text-muted-foreground cursor-pointer hover:bg-accent ${k === hoverKey ? "bg-accent/70 text-foreground" : isBlack(k) ? "bg-muted/50" : ""}`}
          style={{ height: rowH, lineHeight: `${rowH}px` }}
        >
          {!showLabels ? (
            ""
          ) : keyNames?.has(k) ? (
            <span className="min-w-0 truncate text-foreground">
              {keyNames.get(k)}
            </span>
          ) : named || k === hoverKey ? (
            noteName(k)
          ) : pc(k) === 0 ? (
            <>
              {noteName(k)} <span className="opacity-50">{k}</span>
            </>
          ) : (
            ""
          )}
        </button>
      ))}
    </div>
  );
}
