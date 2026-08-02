// params.ts — live plugin parameter values as an EXTERNAL store, for the same reason as
// engineStore.ts beside it: while a surface watches a plugin the engine reports its full
// parameter set ~20×/s, and holding that in React state re-renders a whole tree just to
// move one knob. The writer never re-renders on a frame; only what draws the values does.

import { useSyncExternalStore } from "react";

// id (`chain:module`) -> its live parameter values.
export type PluginParamsMap = Record<string, Record<string, number>>;

export class PluginParamsStore {
  private map: PluginParamsMap = {};
  private listeners = new Set<() => void>();

  getSnapshot = (): PluginParamsMap => this.map;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  // Merge one plugin's values, replacing the map reference so useSyncExternalStore sees it, then poke subscribers.
  set = (id: string, params: Record<string, number>): void => {
    this.map = { ...this.map, [id]: params };
    for (const l of this.listeners) l();
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
