// listenHere.ts — where THIS browser wants the engine heard: here, through the engine's master
// broadcast, or on the engine's own machine. Per browser, since it is a property of the device you
// sit at; read by the engine link (it subscribes) and by the bar's radios. See ../docs/shell.md.

import { useSyncExternalStore } from "react";

const KEY = "k7.listenHere";
const listeners = new Set<() => void>();

const read = (): boolean => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

let current = read();

export function setListenHere(on: boolean): void {
  if (on === current) return;
  current = on;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // A browser refusing storage keeps the choice for this visit only.
  }
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Whether this browser listens here, live. */
export function useListenHere(): boolean {
  return useSyncExternalStore(subscribe, () => current);
}
