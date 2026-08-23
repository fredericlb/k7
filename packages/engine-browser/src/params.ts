// params.ts — live plugin parameter values as an EXTERNAL store, for the same reason as
// engineStore.ts beside it: while a surface watches a plugin the engine reports its full
// parameter set ~20×/s, and holding that in React state re-renders a whole tree just to
// move one knob. The writer never re-renders on a frame; only what draws the values does.

import { useCallback, useSyncExternalStore } from "react";

// id (`chain:module`) -> its live parameter values.
export type PluginParamsMap = Record<string, Record<string, number>>;

export class PluginParamsStore {
  private map: PluginParamsMap = {};
  private listeners = new Set<() => void>();
  private byId = new Map<string, Set<() => void>>();

  getSnapshot = (): PluginParamsMap => this.map;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  // Subscribe to ONE plugin. See docs/params.md for why this channel exists beside the whole-map one.
  subscribeTo = (id: string, cb: () => void): (() => void) => {
    let set = this.byId.get(id);
    if (!set) {
      set = new Set();
      this.byId.set(id, set);
    }
    set.add(cb);
    return () => {
      const s = this.byId.get(id);
      if (!s) return;
      s.delete(cb);
      if (!s.size) this.byId.delete(id);
    };
  };

  // Merge one plugin's values, replacing the map reference so useSyncExternalStore sees it, then poke subscribers.
  set = (id: string, params: Record<string, number>): void => {
    this.map = { ...this.map, [id]: params };
    for (const l of this.listeners) l();
    const s = this.byId.get(id);
    if (s) for (const l of s) l();
  };
}

// Subscribe to a store's whole param map: re-renders on any watched plugin — which is the graph, and only it.
export function usePluginParams(store: PluginParamsStore): PluginParamsMap {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}

/** One plugin param's live value as a PRIMITIVE, with null meaning "nothing to watch" so a caller can hold the hook unconditionally — docs/params.md. */
export function usePluginParamValue(
  store: PluginParamsStore,
  id: string | null,
  name: string | null,
): number | undefined {
  const subscribe = useCallback(
    (cb: () => void) => (id ? store.subscribeTo(id, cb) : () => {}),
    [store, id],
  );
  const read = useCallback(
    () => (id && name ? store.getSnapshot()[id]?.[name] : undefined),
    [store, id, name],
  );
  return useSyncExternalStore(subscribe, read, read);
}
