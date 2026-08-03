// useEngineChoice.ts — the account's engine choice, WITHOUT connecting to one. The header's
// picker needs the list and the current pick; opening a second socket to draw a menu would
// mean two connections to the same engine from one tab. useModuleEngine holds the socket.

import { probeEngines, type RankedEngine } from "@studio/engine-browser/probe";
import type { PublicEngine } from "@studio/web-protocol";
import { useCallback, useEffect, useState } from "react";
import { engines } from "../api";

export interface EngineChoice {
  ranked: RankedEngine<PublicEngine>[];
  /** The remembered id, or undefined before the first load / when nothing is remembered. */
  chosenId: string | undefined;
  choose: (id: string) => void;
  refresh: () => void;
}

export function useEngineChoice(): EngineChoice {
  const [ranked, setRanked] = useState<RankedEngine<PublicEngine>[]>([]);
  const [chosenId, setChosenId] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [list, prefs] = await Promise.all([
        engines.list().catch(() => [] as PublicEngine[]),
        engines.prefs().catch(() => ({}) as { engineId?: string }),
      ]);
      if (cancelled) return;
      setChosenId(prefs.engineId);
      const r = await probeEngines(list);
      if (!cancelled) setRanked(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const choose = useCallback((id: string) => {
    // Optimistic, then persisted: the tick moves under the cursor rather than after a round
    // trip. A failed save is not surfaced — see packages/user-prefs/docs/store.md for why
    // that failure is deliberately quiet — but the choice still holds for this session.
    setChosenId(id);
    void engines.savePrefs({ engineId: id }).catch(() => {});
  }, []);

  return {
    ranked,
    chosenId,
    choose,
    refresh: useCallback(() => setAttempt((n) => n + 1), []),
  };
}
