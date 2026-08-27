// engineStore.ts — the engine's live state (playhead, meters, transport, armed) as an
// EXTERNAL store rather than React state, because a ~20 Hz frame held on App re-rendered
// the WHOLE tree even when nothing changed. Components subscribe to just the SLICE they
// draw via useEngineState(selector), so the editor never re-renders on a frame at all.

import type { EngineState, RecorderState } from "@studio/engine-protocol";
import { createContext, useContext, useRef, useSyncExternalStore } from "react";
import { EMPTY_TAKE, foldTake, type TakeView } from "./takeEnvelope";

const INITIAL: EngineState = {
  playing: false,
  playhead: 0,
  levels: [],
  inputLevels: [],
  armed: [],
  recordEnabled: false,
  master: -100,
  masterClipped: false,
  waveform: {},
  platters: {},
  recorders: {},
};

export class EngineStore {
  private state: EngineState = INITIAL;
  private listeners = new Set<() => void>();
  // Each recorder's picture so far, accumulated HERE because the engine resends it whole in one
  // frame when the socket connects — a second before any card exists. See takeEnvelope.ts.
  private takes: Record<string, TakeView> = {};

  getSnapshot = (): EngineState => this.state;

  /** One recorder node's accumulated take, or undefined for a node that has made none. */
  takeOf = (node: string): TakeView | undefined => this.takes[node];

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  // Called on every state frame, except one saying exactly what the last one said — which is what an idle engine sends 20 times a second.
  set = (s: EngineState): void => {
    if (sameFrame(this.state, s)) return;
    this.state = s;
    this.takes = foldedTakes(this.takes, s.recorders);
    for (const l of this.listeners) l();
  };
}

/** Whether two frames say the same thing — one pass here replacing every subscriber's, and not deep on the envelopes. See docs/meters.md. */
function sameFrame(a: EngineState, b: EngineState): boolean {
  if (a === b) return true;
  if (
    a.playing !== b.playing ||
    a.playhead !== b.playhead ||
    a.recordEnabled !== b.recordEnabled
  )
    return false;
  // A PLATTER's needle moves while the transport does not, so `playhead` cannot speak for it.
  if (!plattersEq(a.platters, b.platters)) return false;
  // …and a RECORDER runs while everything else is still: a rig captures with the transport
  // stopped, so nothing above this line would notice the take growing (docs/recorder.md).
  if (!recordersEq(a.recorders, b.recorders)) return false;
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

/** Do two frames put every platter's needle in the same place? Absent on both sides counts as equal. */
function plattersEq(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined,
): boolean {
  if (a === b) return true;
  const ka = Object.keys(a ?? {});
  if (ka.length !== Object.keys(b ?? {}).length) return false;
  for (const k of ka) if (a?.[k] !== b?.[k]) return false;
  return true;
}

/** Do two frames say the same about every recorder? A new envelope point is a difference. */
function recordersEq(
  a: Record<string, RecorderState> | undefined,
  b: Record<string, RecorderState> | undefined,
): boolean {
  if (a === b) return true;
  const ka = Object.keys(a ?? {});
  if (ka.length !== Object.keys(b ?? {}).length) return false;
  for (const k of ka) {
    const x = a?.[k];
    const y = b?.[k];
    if (x === undefined || y === undefined) return false;
    if (x.recording !== y.recording || x.seconds !== y.seconds) return false;
    if (x.takes.length !== y.takes.length) return false;
    // Where the points START is news on its own: a frame that only rewinds it is the engine
    // resending a picture, and one that only drops it is a take cleared away.
    if (x.from !== y.from) return false;
    // Points arrive to be APPENDED, so any at all make this frame new — but two drained-empty
    // frames are the same frame, which is what an idle recorder sends 20 times a second.
    if (x.envelope !== y.envelope && y.envelope.length > 0) return false;
  }
  return true;
}

/** Every node's picture grown by one frame — the SAME map when no node moved, so a reader may
 *  compare by identity. A node the frame stops mentioning is dropped: its take left with it. */
function foldedTakes(
  prev: Record<string, TakeView>,
  frames: Record<string, RecorderState> | undefined,
): Record<string, TakeView> {
  if (!frames) return Object.keys(prev).length ? {} : prev;
  const next: Record<string, TakeView> = {};
  let moved = Object.keys(prev).length !== Object.keys(frames).length;
  for (const id in frames) {
    const was = prev[id] ?? EMPTY_TAKE;
    const now = foldTake(was, frames[id]);
    if (now !== was) moved = true;
    next[id] = now;
  }
  return moved ? next : prev;
}

const EngineStoreContext = createContext<EngineStore | null>(null);
export const EngineStoreProvider = EngineStoreContext.Provider;

export function useEngineStore(): EngineStore {
  const s = useContext(EngineStoreContext);
  if (!s) throw new Error("useEngineStore used outside <EngineStoreProvider>");
  return s;
}

/** The host's store, or null when there is none — for a component that can PROVIDE one rather than demand it. */
export function useEngineStoreOrNull(): EngineStore | null {
  return useContext(EngineStoreContext);
}

// Subscribe to a SLICE, re-rendering only when the selector's result changes under `isEqual` — pass `arrayEq` for the per-frame arrays.
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

// The signal floor below which a track reads as silent, the same one every host's activity light uses.
const ACTIVE_FLOOR_DB = -60;

// Input-meter dB range, kept in step with TimelineTab's, so the timeline and graph bars read a signal alike.
export const INPUT_VU_MIN_DB = -60;
export const INPUT_VU_MAX_DB = 6;

/** Quantise a 0..1 meter position to 200 steps, HERE in the selector rather than in the component — see docs/meters.md. */
const vuStep = (t: number): number => Math.round(t * 200) / 200;

// The `order.indexOf` in both hooks below is O(n) per subscriber per frame and measured not to matter — don't re-flag it, see docs/meters.md.

// ONE track's live input level, or null when unarmed: a per-node subscription, so a moving input re-renders the bar rather than the graph.
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

// ONE track's live OUTPUT level as 0..1, or null when it isn't in the order — the signal a strip meters, on the same per-node subscription.
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

/** The ids above the silence floor, as a PURE function of a frame and deliberately not a hook — see ui-chains-react/docs/liveCables.md. */
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
