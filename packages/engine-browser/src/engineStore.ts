// engineStore.ts — the engine's live state (playhead, meters, transport, armed) as an
// EXTERNAL store rather than React state, because a ~20 Hz frame held on App re-rendered
// the WHOLE tree even when nothing changed. Components subscribe to just the SLICE they
// draw via useEngineState(selector), so the editor never re-renders on a frame at all.

import type { EngineState } from "@studio/engine-protocol";
import { createContext, useContext, useRef, useSyncExternalStore } from "react";

const INITIAL: EngineState = {
  playing: false,
  playhead: 0,
  levels: [],
  inputLevels: [],
  armed: [],
  recordEnabled: false,
  waveform: {},
};

export class EngineStore {
  private state: EngineState = INITIAL;
  private listeners = new Set<() => void>();

  getSnapshot = (): EngineState => this.state;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  // Called on every state frame: replace the snapshot and poke subscribers, whose selectors decide on re-rendering.
  set = (s: EngineState): void => {
    this.state = s;
    for (const l of this.listeners) l();
  };
}

const EngineStoreContext = createContext<EngineStore | null>(null);
export const EngineStoreProvider = EngineStoreContext.Provider;

export function useEngineStore(): EngineStore {
  const s = useContext(EngineStoreContext);
  if (!s) throw new Error("useEngineStore used outside <EngineStoreProvider>");
  return s;
}

// Subscribe to a SLICE: re-renders only when the selector's result changes under `isEqual` (pass `arrayEq` for
// the armed/levels arrays, which arrive fresh each frame). The selection is cached so the reference stays stable.
export function useStoreState<T>(
  store: EngineStore,
  selector: (s: EngineState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const cache = useRef<{ v: T } | null>(null);
  const getSelection = (): T => {
    const next = selector(store.getSnapshot());
    if (cache.current && isEqual(cache.current.v, next)) return cache.current.v;
    cache.current = { v: next };
    return next;
  };
  return useSyncExternalStore(store.subscribe, getSelection, getSelection);
}

// Same, but for components BELOW the provider — the store comes from context.
export function useEngineState<T>(
  selector: (s: EngineState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  return useStoreState(useEngineStore(), selector, isEqual);
}

// Element-wise equality for the levels/armed arrays: they are new arrays each frame, so identity always differs.
export const arrayEq = (
  a: readonly unknown[],
  b: readonly unknown[],
): boolean =>
  a === b || (a.length === b.length && a.every((x, i) => x === b[i]));

// The signal floor below which a track reads as silent (mirrors App's old ACTIVE_FLOOR_DB).
const ACTIVE_FLOOR_DB = -60;

// Input-meter dB range, kept in step with TimelineTab's, so the timeline and graph bars read a signal alike.
export const INPUT_VU_MIN_DB = -60;
export const INPUT_VU_MAX_DB = 6;

// ONE track's live input level, or null when unarmed — a per-node subscription, so a moving input re-renders the
// bar rather than the graph. Returning a plain number|null keeps Object.is steady while it doesn't change.
export function useInputLevel(trackId: string, order: string[]): number | null {
  return useEngineState((s) => {
    if (!s.armed.includes(trackId)) return null;
    const i = order.indexOf(trackId);
    if (i < 0) return null;
    const db = s.inputLevels[i] ?? -Infinity;
    const t = (db - INPUT_VU_MIN_DB) / (INPUT_VU_MAX_DB - INPUT_VU_MIN_DB);
    return t < 0 ? 0 : t > 1 ? 1 : t;
  });
}

// ONE track's live OUTPUT level as 0..1, or null when the track isn't in the order — the signal a channel strip
// meters, so a fader widget and the Mix panel read the same number over the same range. Same per-node
// subscription as useInputLevel, and for the same reason: this arrives every frame, and it must move a 12px bar
// rather than the whole graph.
export function useTrackLevel(trackId: string, order: string[]): number | null {
  return useEngineState((s) => {
    const i = order.indexOf(trackId);
    if (i < 0) return null;
    const db = s.levels[i] ?? Number.NEGATIVE_INFINITY;
    if (!Number.isFinite(db)) return 0;
    const t = (db - INPUT_VU_MIN_DB) / (INPUT_VU_MAX_DB - INPUT_VU_MIN_DB);
    return t < 0 ? 0 : t > 1 ? 1 : t;
  });
}

// The ids above the silence floor, with membership equality — so it re-renders when a track crosses, not per tick.
export function useActiveTracks(trackOrder: string[]): string[] {
  return useEngineState((s) => {
    const ids: string[] = [];
    for (let i = 0; i < trackOrder.length; i++)
      if ((s.levels[i] ?? -Infinity) > ACTIVE_FLOOR_DB) ids.push(trackOrder[i]);
    return ids;
  }, arrayEq);
}
