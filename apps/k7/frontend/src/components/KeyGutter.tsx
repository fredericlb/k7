// KeyGutter.tsx — the piano roll's keyboard column: one row per MIDI key, high to low, a click
// auditioning it and a double-click selecting its row. A rack that names its keys puts the names
// here instead of the notes. Each key is memoised and reads the hover store itself, so a new hovered
// row re-renders two keys, not 128. See ../../docs/clipEditors.md.

import { memo, useMemo, useRef } from "react";
import { type RollHoverStore, useHoverRowIs } from "../hooks/useRollHover";
import { isBlack, noteName, pc } from "../noteNames";

/** Every possible MIDI note (0..127). */
export const N_NOTES = 128;
/** The keys top to bottom: high → low. */
export const KEYS = Array.from({ length: N_NOTES }, (_, i) => 127 - i);

interface KeyActions {
  audition?: (key: number) => void;
  select: (key: number) => void;
}

export function KeyGutter({
  width,
  rowH,
  showLabels,
  keyNames,
  onAudition,
  onSelectKey,
  hover,
}: {
  width: number;
  rowH: number;
  /** A row too short for 9px text is labelled nowhere. */
  showLabels: boolean;
  /** The names a rack gives its keys, which replace the notes' own. */
  keyNames?: ReadonlyMap<number, string>;
  onAudition?: (key: number) => void;
  onSelectKey: (key: number) => void;
  /** The grid's hover: the key the pointer is over is lit, and named whatever octave it is in. */
  hover?: RollHoverStore;
}) {
  const named = keyNames != null && keyNames.size > 0;
  // The latest handlers behind stable ones, so a parent render does not re-render every key.
  const latest = useRef({ onAudition, onSelectKey });
  latest.current = { onAudition, onSelectKey };
  const canAudition = !!onAudition;
  const actions = useMemo<KeyActions>(
    () => ({
      audition: canAudition ? (k) => latest.current.onAudition?.(k) : undefined,
      select: (k) => latest.current.onSelectKey(k),
    }),
    [canAudition],
  );
  return (
    <div
      className="sticky left-0 z-10 shrink-0 border-r border-border bg-background"
      style={{ width }}
    >
      {KEYS.map((k) => (
        <KeyRow
          key={k}
          k={k}
          rowH={rowH}
          showLabels={showLabels}
          name={keyNames?.get(k)}
          named={named}
          actions={actions}
          hover={hover}
        />
      ))}
    </div>
  );
}

const KeyRow = memo(function KeyRow({
  k,
  rowH,
  showLabels,
  name,
  named,
  actions,
  hover,
}: {
  k: number;
  rowH: number;
  showLabels: boolean;
  name: string | undefined;
  named: boolean;
  actions: KeyActions;
  hover: RollHoverStore | undefined;
}) {
  const lit = useHoverRowIs(hover, 127 - k);
  return (
    <button
      type="button"
      onClick={() => actions.audition?.(k)}
      onDoubleClick={() => actions.select(k)}
      title={
        name !== undefined
          ? `${name} · ${noteName(k)}`
          : actions.audition
            ? noteName(k)
            : undefined
      }
      className={`flex w-full items-center justify-end pr-1 text-[9px] text-muted-foreground cursor-pointer hover:bg-accent ${lit ? "bg-accent/70 text-foreground" : isBlack(k) ? "bg-muted/50" : ""}`}
      style={{ height: rowH, lineHeight: `${rowH}px` }}
    >
      {!showLabels ? (
        ""
      ) : name !== undefined ? (
        <span className="min-w-0 truncate text-foreground">{name}</span>
      ) : named || lit ? (
        noteName(k)
      ) : pc(k) === 0 ? (
        <>
          {noteName(k)} <span className="opacity-50">{k}</span>
        </>
      ) : (
        ""
      )}
    </button>
  );
});
