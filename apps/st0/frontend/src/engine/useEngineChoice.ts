// useEngineChoice.ts — the account's engine choice, WITHOUT connecting to one. The header's
// picker needs the list and the current pick; opening a second socket to draw a menu would
// mean two connections to the same engine from one tab. PlaybackProvider holds the socket.

import type { RankedEngine } from "@studio/engine-browser/probe";
import type { PublicEngine } from "@studio/web-protocol";
import type { EngineLatency } from "@studio/web-protocol/quality";
import { useCallback, useEffect, useState } from "react";
import { engines } from "../api";
import { patchPrefs } from "../prefs";

export interface EngineChoice {
  ranked: RankedEngine<PublicEngine>[];
  /** The remembered id, or undefined before the first load / when nothing is remembered. */
  chosenId: string | undefined;
  /** The list and the remembered choice have both come back at least once. Distinct from
   *  "nothing is chosen", which before this was indistinguishable from "we have not looked
   *  yet" — and a gate that cannot tell the two apart flashes in everybody's face on load. */
  loaded: boolean;
  /** The remembered engine, reachable from THIS browser. What anything needing an engine to
   *  work asks for: a choice pointing at a machine that is off is not one. */
  ready: boolean;
  /** The chosen engine's file service — `http://<host>:<filePort>` — or null when there is no
   *  reachable choice. The engine machine's per-MACHINE facts live behind it: what it has
   *  scanned, what it can render. Null for an engine that answered no probe. */
  fileBase: string | null;
  /** The chosen engine's token, from its whoami — what the file service's header gate wants. */
  token: string | null;
  /** What the link to it MEASURED — the status bar's Q badge. It comes from the probe this
   *  hook already ran, so the bar costs no socket and no lease of its own: the whole reason
   *  this hook exists is that a second connection from one tab is one too many. */
  latency: EngineLatency | null;
  choose: (id: string) => void;
  refresh: () => void;
}

export function useEngineChoice(): EngineChoice {
  const [ranked, setRanked] = useState<RankedEngine<PublicEngine>[]>([]);
  const [chosenId, setChosenId] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // The list, the preference and the measurement in one call. The POLICY it also applies
      // is ignored here on purpose: this hook draws a picker, so it shows what the account
      // remembered even when that engine did not answer — `ready` below is what says whether
      // it can be driven.
      const { ranked: r, rememberedId } = await engines.find();
      if (cancelled) return;
      setChosenId(rememberedId);
      setRanked(r);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const choose = useCallback((id: string) => {
    // Optimistic, then persisted: the tick moves under the cursor rather than after a round
    // trip. A failed save is not surfaced — see packages/user-prefs/docs/store.md for why
    // that failure is deliberately quiet — but the choice still holds for this session.
    //
    // Through `patchPrefs` and never `savePrefs`: the route REPLACES the document, so a PUT
    // of `{engineId}` alone would clear the playback destination beside it.
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
