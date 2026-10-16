// params.ts — live plugin parameter values as an EXTERNAL store, for the same reason as
// engineStore.ts beside it: while a surface watches a plugin the engine reports its full
// parameter set ~20×/s, and holding that in React state re-renders a whole tree just to
// move one knob. The writer never re-renders on a frame; only what draws the values does.

import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

// id (`chain:module`) -> its live parameter values.
export type PluginParamsMap = Record<string, Record<string, number>>;

/** Do two value sets say the same thing — the same names, each with the same number? */
export function sameParams(
  a: Readonly<Record<string, number>> | undefined,
  b: Readonly<Record<string, number>>,
): boolean {
  if (!a) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}

/** One plugin param a reader watches. */
export interface ParamKey {
  id: string;
  name: string;
}

/** The map cut down to `keys` — `prev` itself when every one of them reads the same, so identity is the change signal. */
export function pickParams(
  map: PluginParamsMap,
  keys: readonly ParamKey[],
  prev?: PluginParamsMap,
): PluginParamsMap {
  const out: PluginParamsMap = {};
  let count = 0;
  let same = prev !== undefined;
  for (const { id, name } of keys) {
    const v = map[id]?.[name];
    if (v === undefined) continue;
    const row = out[id] ?? {};
    out[id] = row;
    if (!(name in row)) count++;
    row[name] = v;
    if (same && !Object.is(prev?.[id]?.[name], v)) same = false;
  }
  if (same && prev) {
    let had = 0;
    for (const row of Object.values(prev)) had += Object.keys(row).length;
    if (had === count) return prev;
  }
  return out;
}

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
    // A frame repeating what is held is no news: no new map, nobody woken — docs/params.md.
    if (sameParams(this.map[id], params)) return;
    this.map = { ...this.map, [id]: params };
    for (const l of this.listeners) l();
    const s = this.byId.get(id);
    if (s) for (const l of s) l();
  };

  // Forget every value — another project is open, and a same-named `chain:module` there is another plugin.
  clear = (): void => {
    if (!Object.keys(this.map).length) return;
    this.map = {};
    for (const l of this.listeners) l();
    for (const s of this.byId.values()) for (const l of s) l();
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

/** Only these params, as a map shaped like the whole one: re-renders when one of THEM moves — docs/params.md. */
export function usePluginParamsOf(
  store: PluginParamsStore,
  keys: readonly ParamKey[],
): PluginParamsMap {
  const ids = [...new Set(keys.map((k) => k.id))].sort().join("\n");
  const subscribe = useCallback(
    (cb: () => void) => {
      const offs = ids
        ? ids.split("\n").map((id) => store.subscribeTo(id, cb))
        : [];
      return () => {
        for (const off of offs) off();
      };
    },
    [store, ids],
  );
  const held = useRef<PluginParamsMap | undefined>(undefined);
  const read = useMemo(
    () => () => {
      held.current = pickParams(store.getSnapshot(), keys, held.current);
      return held.current;
    },
    [store, keys],
  );
  return useSyncExternalStore(subscribe, read, read);
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
