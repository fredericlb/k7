// useEngineChoice.ts — the account's engine choice, WITHOUT connecting to one. The header's
// picker needs the list and the current pick; opening a second socket to draw a menu would
// mean two connections to the same engine from one tab. PlaybackProvider holds the socket.

import type { RankedEngine } from "@studio/engine-browser/probe";
import { useRelook } from "@studio/engine-browser/relook";
import type { PublicEngine } from "@studio/web-protocol";
import type { EngineLatency } from "@studio/web-protocol/quality";
import { useCallback, useEffect, useRef, useState } from "react";
import { engines } from "../api";
import { patchPrefs } from "../prefs";

export interface EngineChoice {
  ranked: RankedEngine<PublicEngine>[];
  /** The remembered id, or undefined before the first load / when nothing is remembered. */
  chosenId: string | undefined;
  /** Both have come back at least once, which is NOT "nothing is chosen" (../../docs/engine.md). */
  loaded: boolean;
  /** The remembered engine, REACHABLE from this browser: a choice pointing at a dead machine is not one. */
  ready: boolean;
  /** The chosen engine's file service, behind which every per-MACHINE fact lives (../../docs/engine.md). */
  fileBase: string | null;
  /** The chosen engine's token, from its whoami — what the file service's header gate wants. */
  token: string | null;
  /** What the link MEASURED — the Q badge, off the probe this hook already ran (../../docs/engine.md). */
  latency: EngineLatency | null;
  choose: (id: string) => void;
  refresh: () => void;
}

export function useEngineChoice(): EngineChoice {
  const [ranked, setRanked] = useState<RankedEngine<PublicEngine>[]>([]);
  const [chosenId, setChosenId] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const relook = useRelook();
  // In a REF and not in the dependencies, so choosing does not re-measure (../../docs/engine.md).
  const chosen = useRef<string | undefined>(undefined);
  chosen.current = chosenId;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` and `relook` are triggers, not values read here — they say WHEN to run again.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // One call for the list, the preference and the measurement — see ../../docs/engine.md.
      const { ranked: r, rememberedId } = await engines.find(chosen.current);
      if (cancelled) return;
      setChosenId(rememberedId);
      setRanked(r);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
    // `relook` brings us back every fifteen seconds and on tab return: a probe is a snapshot.
  }, [attempt, relook]);

  const choose = useCallback((id: string) => {
    // Optimistic then persisted, and through `patchPrefs` never `savePrefs` (../../docs/engine.md).
    setChosenId(id);
    void patchPrefs({ engineId: id });
  }, []);

  return {
    ranked,
    chosenId,
    loaded,
    ready: ranked.some((r) => r.engine.id === chosenId && !!r.wsUrl),
    fileBase: ranked.find((r) => r.engine.id === chosenId)?.fileBase ?? null,
    token: ranked.find((r) => r.engine.id === chosenId)?.token ?? null,
    latency: ranked.find((r) => r.engine.id === chosenId)?.latency ?? null,
    choose,
    refresh: useCallback(() => setAttempt((n) => n + 1), []),
  };
}
