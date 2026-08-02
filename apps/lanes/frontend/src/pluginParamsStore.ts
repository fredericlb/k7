// pluginParamsStore.ts — live plugin parameter values as an EXTERNAL store, for the same
// reason as engineStore.ts: while the graph watches a plugin the engine reports its full
// parameter set ~20×/s, and holding that on App re-rendered the whole tree just to move one
// knob. Only the graph subscribes; App writes and never re-renders on a frame.

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
