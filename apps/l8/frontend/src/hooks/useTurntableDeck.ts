// useTurntableDeck.ts — l8's engine link, seen as the desk's `Deck`. The one thing
// @studio/ui-turntables asks of a host, and the one place hosts ever differed: m9 obtained an
// engine of its own (its registry, its session, its lease), while l8 already has one by the
// time a surface can exist. l8 is the only host now, and the seam stays anyway — it is what
// let the desk change hosts at all. See packages/ui-turntables/docs/hosting.md.

import type { EngineClient } from "@studio/engine-browser";
import type { PluginParamsStore } from "@studio/engine-browser/params";
import { type EngineStore, useStoreState } from "@studio/engine-browser/store";
import type { Deck, Playhead } from "@studio/ui-turntables/engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { EngineLink } from "./useEngineLink";

/**
 * The pieces of l8's engine link the desk needs — named one by one rather than taken as a whole
 * `EngineLink`, because `App` destructures that hook and there is no object to pass. Asking for
 * the fields is also what says how little of l8's link a desk actually touches.
 */
export function useTurntableDeck({
  store,
  engineRef,
  engineReady,
  watchPluginParams,
  pluginParamsStore,
  engineUrl,
}: {
  /** Passed, not taken from context: `App` CALLS this hook and RENDERS `<EngineStoreProvider>`,
   *  so the provider is below the call and `useEngineState` found no store and threw. */
  store: EngineStore;
  engineRef: EngineLink["engineRef"];
  engineReady: boolean;
  watchPluginParams: EngineLink["watchPluginParams"];
  /** The store the shell already feeds — the desk and l8's graph must read the SAME one, or
   *  two pictures of one plugin keep their own copy and disagree. */
  pluginParamsStore: PluginParamsStore;
  /** Only ever an id in `phase` — the desk shows which engine, it does not connect to one. */
  engineUrl: string | { toString(): string };
}): Deck {
  // Transport changes a few times a set, so the shell may re-render on it.
  const playing = useStoreState(store, (s) => s.playing);

  /**
   * The transport as a REF, which is what the desk wants.
   *
   * The vinyls and the waveforms redraw per animation frame and extrapolate between the
   * engine's ~20 Hz pushes; rendering from state would re-render the shell at the meter rate to
   * turn a record. l8 holds the same value in its external store for exactly that reason, so
   * this mirrors it into the shape the desk reads rather than introducing a second feed.
   *
   * Hence the raw `subscribe` rather than a selector hook: this is the one reader that wants
   * every frame and NO render. Subscribing through `useStoreState` would have put the ~20 Hz
   * playhead back on `App`, which is the whole thing the external store exists to avoid.
   *
   * `at` is stamped whenever the value CHANGES, not on every frame: it is the clock the
   * extrapolation runs from, and restamping it on an idle repeat would keep resetting that
   * clock to now and make the playhead crawl.
   */
  const playhead = useRef<Playhead>({ seconds: 0, at: 0 });
  useEffect(() => {
    const read = () => {
      const seconds = store.getSnapshot().playhead;
      if (seconds !== playhead.current.seconds)
        playhead.current = { seconds, at: performance.now() };
    };
    read();
    return store.subscribe(read);
  }, [store]);

  /**
   * Watch exactly these plugins — l8 toggles them one at a time, the desk names a set.
   *
   * The diff is here rather than in the package because it is l8's route that is per-id. Kept
   * against the last set so re-running with the same ids is free: the desk calls this from an
   * effect whose dependency is the compiled graph, which is re-fetched on every revision poll.
   */
  const watched = useRef<readonly string[]>([]);
  const watchParams = useCallback(
    (ids: readonly string[]) => {
      const next = new Set(ids);
      for (const id of watched.current)
        if (!next.has(id)) watchPluginParams(id, false);
      for (const id of next)
        if (!watched.current.includes(id)) watchPluginParams(id, true);
      watched.current = [...next];
    },
    [watchPluginParams],
  );

  /**
   * What each `offline` module is set to, by module name.
   *
   * The desk's own value, lent to whatever else draws it — a tempo compiles to no plugin, so
   * the engine has nothing to report and no address to report it under. In m9 this lives on the
   * engine hook because Mix is unmounted whenever the graph is on screen; in l8 the surface is
   * unmounted the same way, so it lives here for the same reason.
   */
  const [moduleParams, setModuleParams] = useState<
    Record<string, Record<string, number>>
  >({});
  const setModuleParam = useCallback(
    (module: string, name: string, value: number) =>
      setModuleParams((m) => ({
        ...m,
        [module]: { ...m[module], [name]: value },
      })),
    [],
  );

  return useMemo<Deck>(
    () => ({
      // Two states, not m9's four. `absent` and `taken` describe PICKING an engine from a
      // registry, which l8's gate has already done — a surface cannot be on screen without one.
      // Collapsing them here rather than in the package is the point of the seam.
      phase: engineReady
        ? { k: "ready", id: String(engineUrl) }
        : { k: "looking" },
      playing,
      playhead,
      engine: (engineRef.current ?? null) as EngineClient | null,
      /**
       * Through the FILE SERVICE, which is the only thing that writes documents to l8's engine.
       *
       * l8's service loads the project into the engine itself, so a desk sending on this app's
       * socket made two writers and the last one won — a save during a set dropped the decks,
       * a deck gesture undid a save. Handing it over leaves one socket and one ordering rule,
       * both in `engineLink.ts`.
       *
       * Fire-and-forget: the document is a picture of what the decks now are, and the next
       * gesture sends a fresher one. Awaiting it would put a round trip inside a crossfade.
       */
      sendProject: (doc) => {
        void api.sendEngineProject(doc).catch(() => {
          // The service is unreachable — which the shell is already saying, loudly, in the
          // places that watch it. A second card over the desk would repeat it.
        });
      },
      params: pluginParamsStore,
      watchParams,
      moduleParams,
      setModuleParam,
      // No `listening`: l8 has no stream player, so the desk draws no headphone button rather
      // than one that cannot be honoured. No `retry`: reconnecting is the shell's, not a
      // surface's. Both are optional for exactly these cases.
    }),
    [
      engineReady,
      engineUrl,
      playing,
      engineRef,
      pluginParamsStore,
      watchParams,
      moduleParams,
      setModuleParam,
    ],
  );
}
