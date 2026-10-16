// liveValue.ts — a value that moves many times a second, read by the few leaves that draw it.
// What reads wrong: setting it renders nothing but those leaves, which is the point (../docs/recorder.md).

import { useSyncExternalStore } from "react";

export interface LiveValue<T> {
  get(): T;
  set(value: T): void;
  subscribe(listener: () => void): () => void;
}

export function createLiveValue<T>(initial: T): LiveValue<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Re-render the calling component, and it alone, when `live` (or what `select` keeps of it) changes. */
export function useLiveValue<T, S = T>(
  live: LiveValue<T>,
  select?: (value: T) => S,
): S {
  const read = () =>
    select ? select(live.get()) : (live.get() as unknown as S);
  return useSyncExternalStore(live.subscribe, read, read);
}
