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

  // Called on every state frame: replace the snapshot and poke subscribers, whose selectors decide
  // on re-rendering — unless the frame says exactly what the last one said, which is what an idle
  // engine sends 20 times a second. See docs/meters.md.
  set = (s: EngineState): void => {
    if (sameFrame(this.state, s)) return;
    this.state = s;
    for (const l of this.listeners) l();
  };
}

/**
 * Whether two frames say the same thing.
 *
 * The engine pushes one every 50 ms whether or not anything is happening, and every subscriber's
 * selector then runs to conclude nothing changed — N selector runs, 20 times a second, for a
 * stopped transport over silent tracks. One pass over the frame replaces all of them.
 *
 * Deliberately not deep on the envelopes: a waveform tap sends fresh arrays whenever it sends
 * anything at all, so comparing their contents would be work spent proving they differ.
 */
function sameFrame(a: EngineState, b: EngineState): boolean {
  if (a === b) return true;
  if (
    a.playing !== b.playing ||
    a.playhead !== b.playhead ||
    a.recordEnabled !== b.recordEnabled
  )
    return false;
  if (
    !arrayEq(a.levels, b.levels) ||
    !arrayEq(a.inputLevels, b.inputLevels) ||
    !arrayEq(a.armed, b.armed)
  )
    return false;
  const ka = Object.keys(a.waveform);
  const kb = Object.keys(b.waveform);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const va = a.waveform[k];
    const vb = b.waveform[k];
    // Same array, or both drained empty — anything else is new material.
    if (va !== vb && !(vb !== undefined && va.length === 0 && vb.length === 0))
      return false;
  }
  return true;
}

const EngineStoreContext = createContext<EngineStore | null>(null);
export const EngineStoreProvider = EngineStoreContext.Provider;

export function useEngineStore(): EngineStore {
  const s = useContext(EngineStoreContext);
  if (!s) throw new Error("useEngineStore used outside <EngineStoreProvider>");
  return s;
}

/** The host's store, or null when there is none — for a component that can PROVIDE one rather
 *  than demand it. See DomChains, which draws meters for hosts that have no engine at all. */
export function useEngineStoreOrNull(): EngineStore | null {
  return useContext(EngineStoreContext);
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

/**
 * Quantise a 0..1 meter position to 200 steps.
 *
 * These selectors return a FRACTION, and an unrounded one differs on essentially every frame,
 * so `Object.is` never stopped a re-render and a silent track cost exactly as much as a loud
 * one. 200 steps is finer than half a percent of the tallest bar any of these draw — the
 * number is unchanged on screen, and a steady signal now re-renders nothing. TimelineTab's
 * LaneMeter has rounded its dB for this reason all along; the graph's meters did not. Round
 * HERE and not in the component — this result is what Object.is compares. See docs/meters.md.
 */
const vuStep = (t: number): number => Math.round(t * 200) / 200;

// The `order.indexOf` in both hooks below is O(n) per subscriber per frame, and measured not to
// matter — including against the memoised position map, which LOSES under ~50 tracks. Don't
// re-flag it; the numbers are in docs/meters.md ("The O(n²) that isn't worth fixing").

// ONE track's live input level, or null when unarmed — a per-node subscription, so a moving input re-renders the
// bar rather than the graph. Returning a plain number|null keeps Object.is steady while it doesn't change.
export function useInputLevel(trackId: string, order: string[]): number | null {
  return useEngineState((s) => {
    if (!s.armed.includes(trackId)) return null;
    const i = order.indexOf(trackId);
    if (i < 0) return null;
    const db = s.inputLevels[i] ?? -Infinity;
    const t = (db - INPUT_VU_MIN_DB) / (INPUT_VU_MAX_DB - INPUT_VU_MIN_DB);
    return vuStep(t < 0 ? 0 : t > 1 ? 1 : t);
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
    return vuStep(t < 0 ? 0 : t > 1 ? 1 : t);
  });
}

/**
 * The ids above the silence floor, as a PURE function of a frame.
 *
 * Deliberately not a hook. Its one consumer is the chains renderer's cable canvas, which reads
 * it 20 times a second off a raw subscription and repaints — a hook would have made every
 * crossing of the floor a re-render of the whole graph, and on percussive material tracks cross
 * it several times a second. See ui-chains-react/docs/liveCables.md.
 */
export function activeTrackIds(
  s: EngineState,
  trackOrder: readonly string[],
): string[] {
  const ids: string[] = [];
  for (let i = 0; i < trackOrder.length; i++)
    if ((s.levels[i] ?? Number.NEGATIVE_INFINITY) > ACTIVE_FLOOR_DB)
      ids.push(trackOrder[i]);
  return ids;
}
