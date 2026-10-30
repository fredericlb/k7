// useRollHover.ts — the piano roll cell under the pointer, for the light row and column bands that say
// which key and which step a click lands on. A mark, not state anyone acts on: it is never the caret.
// The one thing a reader would get wrong: it lives in a tiny store, not in the roll's state, so a
// new cell re-renders the bands and two gutter keys and never the notes (../../docs/clipEditors.md).

import type React from "react";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";

export interface RollCell {
  row: number;
  col: number;
}

/** The hovered cell, read by whoever draws it; `set` notifies only when the CELL changes. */
export interface RollHoverStore {
  get: () => RollCell | null;
  set: (c: RollCell | null) => void;
  subscribe: (fn: () => void) => () => void;
}

export function createRollHoverStore(): RollHoverStore {
  let cur: RollCell | null = null;
  const subs = new Set<() => void>();
  return {
    get: () => cur,
    set: (c) => {
      if (c === cur || (c && cur && c.row === cur.row && c.col === cur.col))
        return;
      cur = c;
      for (const fn of subs) fn();
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

/** The store, and the two handlers the grid's element takes; `cellAt` is the roll's own pointer-to-cell rule. */
export function useRollHover(cellAt: (e: React.PointerEvent) => RollCell): {
  store: RollHoverStore;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerLeave: () => void;
} {
  const [store] = useState(createRollHoverStore);
  const rule = useRef(cellAt);
  rule.current = cellAt;
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => store.set(rule.current(e)),
    [store],
  );
  const onPointerLeave = useCallback(() => store.set(null), [store]);
  return { store, onPointerMove, onPointerLeave };
}

/** The hovered cell, for the leaf that draws the bands. */
export function useHoverCell(store: RollHoverStore): RollCell | null {
  return useSyncExternalStore(store.subscribe, store.get);
}

/** Whether `row` is the hovered one — a boolean, so only the two keys that change re-render. */
export function useHoverRowIs(
  store: RollHoverStore | undefined,
  row: number,
): boolean {
  return useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    () => store?.get()?.row === row,
  );
}

const noSubscribe = () => () => {};
