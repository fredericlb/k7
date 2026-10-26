// homeEngine.ts — the engine the home bar's selector shows, for the other home screens that play:
// the médiathèque's "The engine" destination goes to it (MediaHost.tsx). Held outside React since
// the selector sits in the bar and the player in a page. See ../docs/shell.md.

import { useSyncExternalStore } from "react";

let current: string | null = null;
const listeners = new Set<() => void>();

export function setHomeEngineId(id: string | null): void {
  if (id === current) return;
  current = id;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The engine id the home bar shows, live; null until it has looked. */
export function useHomeEngineId(): string | null {
  return useSyncExternalStore(subscribe, () => current);
}
