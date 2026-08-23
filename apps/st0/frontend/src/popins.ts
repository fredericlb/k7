// popins.ts — the stack of overlays currently up, so Escape closes exactly ONE of them.
// An overlay registers while it is open and hands in its way out; the shell asks for the
// topmost. Without this, an overlay that closes itself and the shell's own Esc binding both
// answer the same keypress, and the graph slot behind it goes too. See docs/shell.md.

import { useEffect, useRef, useSyncExternalStore } from "react";

type Entry = { close: () => void };

// A stack, not a set: "the current popin" is the last one opened, whatever opened it.
const stack: Entry[] = [];
const listeners = new Set<() => void>();

const emit = () => {
  for (const l of listeners) l();
};

/** Register an open overlay. Returns the deregister, for an effect's cleanup. */
export function registerPopin(close: () => void): () => void {
  const entry: Entry = { close };
  stack.push(entry);
  emit();
  return () => {
    const i = stack.indexOf(entry);
    if (i !== -1) stack.splice(i, 1);
    emit();
  };
}

/** Close the topmost overlay, and answer whether there was one — it does not POP: a refused closer must leave the stack as it found it. */
export function closeTopPopin(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Whether anything is up — the shell's `popin` key condition. */
export function useAnyPopin(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => stack.length > 0,
    () => false,
  );
}

/** Declare this component an overlay while `open` — the closer is read through a ref, or a fresh callback would reorder the stack. */
export function usePopin(open: boolean, close: () => void): void {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => {
    if (!open) return;
    return registerPopin(() => ref.current());
  }, [open]);
}
