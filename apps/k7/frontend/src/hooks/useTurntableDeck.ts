// useTurntableDeck.ts — k7's engine link, seen as the desk's `Deck`. The one thing
// the turntables plugin (@studio/k7-plugins) asks of a host, and the one place a host's own arrangements show:
// obtaining an engine is the app's business, and k7 already has one by the time a surface can
// exist. See packages/k7-plugins/docs/turntables/hosting.md.

import type { EngineClient } from "@studio/engine-browser";
import type { PluginParamsStore } from "@studio/engine-browser/params";
import {
  advancePlayhead,
  feedPlayhead,
  newPlayheadClock,
  playheadAt,
} from "@studio/engine-browser/playhead-clock";
import { type EngineStore, useStoreState } from "@studio/engine-browser/store";
import type { Deck, Playhead } from "@studio/k7-plugins/turntables/engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { EngineLink } from "./useEngineLink";

/** The pieces of k7's engine link the desk needs, named one by one — which is also what says how little of that link a desk touches. */
export function useTurntableDeck({
  store,
  engineRef,
  engineReady,
  watchPluginParams,
  pluginParamsStore,
  engineUrl,
}: {
  /** Passed, not taken from context: `App` calls this hook and RENDERS the provider, so the provider is below the call. */
  store: EngineStore;
  engineRef: EngineLink["engineRef"];
  engineReady: boolean;
  watchPluginParams: EngineLink["watchPluginParams"];
  /** The store the shell already feeds — the desk and k7's graph must read the SAME one, or two pictures of a plugin disagree. */
  pluginParamsStore: PluginParamsStore;
  /** Only ever an id in `phase` — the desk shows which engine, it does not connect to one. */
  engineUrl: string | { toString(): string };
}): Deck {
  // Transport changes a few times a set, so the shell may re-render on it.
  const playing = useStoreState(store, (s) => s.playing);

  /** The transport as a REF, which is what the desk wants: every frame and NO render, with `at` stamped only when the value CHANGES. */
  const playhead = useRef<Playhead>({ seconds: 0, at: 0 });
  /** The platters' own needles, likewise a ref: a deck off keylock has no other clock (docs/turntable.md). */
  const platters = useRef<Record<string, number>>({});
  /** The same frames again, STEERED — the wedge wants a number that moves evenly where a cue drop wants the raw estimate (docs/playhead.md). */
  const clock = useRef(newPlayheadClock());
  useEffect(() => {
    const read = () => {
      const s = store.getSnapshot();
      const seconds = s.playhead;
      // `at` is stamped whenever the value CHANGES, not on every frame; the steered clock is fed every frame regardless.
      if (seconds !== playhead.current.seconds)
        playhead.current = { seconds, at: performance.now() };
      // Written straight through: a platter's needle is already its own clock and needs no steering.
      platters.current = s.platters ?? {};
      clock.current = feedPlayhead(
        clock.current,
        s.playing,
        seconds,
        performance.now(),
      );
    };
    read();
    return store.subscribe(read);
  }, [store]);
  // Advancing on READ is exactly right here: the callers are animation frames, and two in one frame advance by a zero delta.
  const drawNow = useCallback(() => {
    const now = performance.now();
    clock.current = advancePlayhead(clock.current, now);
    return playheadAt(clock.current, now);
  }, []);

  /** Watch exactly these plugins — the diff is here because k7's route is per-id, and re-running with the same ids is free. */
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

  /** What each `offline` module is set to, by module name — here rather than in the surface, whose SCREEN is unmounted when closed. */
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
      // Two states, not the four `Deck` allows: `absent` and `taken` describe PICKING an engine, which k7's gate has already done.
      phase: engineReady
        ? { k: "ready", id: String(engineUrl) }
        : { k: "looking" },
      playing,
      playhead,
      drawNow,
      platters,
      engine: (engineRef.current ?? null) as EngineClient | null,
      /** Through the FILE SERVICE, the only thing that writes documents to k7's engine — fire-and-forget, a round trip belonging outside a crossfade. */
      sendProject: (doc) => {
        void api.sendEngineProject(doc).catch(() => {
          // The service is unreachable — which the shell is already saying, loudly, in the places that watch it.
        });
      },
      params: pluginParamsStore,
      watchParams,
      moduleParams,
      setModuleParam,
      // No `listening`: k7 has no stream player. No `retry`: reconnecting is the shell's, not a surface's. Both are optional.
    }),
    [
      engineReady,
      engineUrl,
      playing,
      drawNow,
      engineRef,
      pluginParamsStore,
      watchParams,
      moduleParams,
      setModuleParam,
    ],
  );
}
