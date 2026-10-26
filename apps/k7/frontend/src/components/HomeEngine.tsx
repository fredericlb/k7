// HomeEngine.tsx — the engine selector of the home pages, in their bar's engine slot: the engine
// remembered on the account (else the policy's pick) with the probe's figures, and the list to pick
// another. There is no session here, so a pick is what the NEXT project opens on. See ../../docs/shell.md.

import { Badge } from "@frediverse/ui/badge";
import { formatPerformance } from "@studio/web-protocol/performance";
import { formatLatency } from "@studio/web-protocol/quality";
import { useCallback, useEffect, useState } from "react";
import { engines } from "../api";
import { m } from "../paraglide/messages.js";
import { usePopin } from "../popins";
import type { RankedEngine } from "../types";
import { useIsMobile } from "../useIsMobile";
import { BarEngine } from "./BarEngine";
import { EngineSelect } from "./EngineSelect";

// One probe shared by every home page for a little while: the sidebar remounts on each route, and a probe reaches every engine.
const PROBE_TTL_MS = 30_000;
let probe: {
  at: number;
  found: ReturnType<typeof engines.find>;
} | null = null;
const find = (fresh = false) => {
  if (fresh || !probe || Date.now() - probe.at > PROBE_TTL_MS)
    probe = { at: Date.now(), found: engines.find() };
  return probe.found;
};

/** The home pages' engine slot: the account's remembered engine, its probed figures, and the list to choose another. */
export function HomeEngine() {
  const isMobile = useIsMobile();
  const [ranked, setRanked] = useState<RankedEngine[]>([]);
  const [current, setCurrent] = useState<RankedEngine | null>(null);
  const [searching, setSearching] = useState(true);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  usePopin(picking, () => setPicking(false));

  // The remembered engine when it answered, else what the policy would take — what the next project opens on.
  const load = useCallback(async (fresh = false, prefer?: string) => {
    const { ranked: r, chosen, rememberedId } = await find(fresh);
    setRanked(r);
    const want = prefer ?? rememberedId;
    setCurrent(r.find((x) => x.engine.id === want) ?? chosen ?? null);
  }, []);

  useEffect(() => {
    void load()
      .catch(() => {})
      .finally(() => setSearching(false));
  }, [load]);

  const refresh = async (prefer?: string) => {
    setBusy(true);
    try {
      await load(true, prefer);
    } catch {
      // A probe that failed leaves the list as it was.
    } finally {
      setBusy(false);
    }
  };

  const stats = current ? (
    <>
      {current.latency ? (
        <Badge variant="default" title={current.latency.quality}>
          {formatLatency(current.latency)}
        </Badge>
      ) : (
        <Badge variant="amber">{m["engines.unreachable"]()}</Badge>
      )}
      {current.engine.performance && (
        <Badge variant="default">
          {formatPerformance(current.engine.performance)}
        </Badge>
      )}
    </>
  ) : null;

  return (
    <>
      <BarEngine
        current={current}
        searching={searching}
        stats={stats}
        compact={isMobile}
        toolSize={isMobile ? "icon" : "icon-xs"}
        onChange={() => {
          setPicking(true);
          void refresh();
        }}
      />
      {picking && (
        <div className="fixed inset-0 z-50 bg-background">
          <EngineSelect
            ranked={ranked}
            loading={busy}
            onRefresh={() => void refresh()}
            onPick={(r) => {
              // Remembered on the ACCOUNT: the next project opened, here or on another device, starts on it.
              engines.patchPrefs({ engineId: r.engine.id }).catch(() => {});
              probe = null;
              setCurrent(r);
              setPicking(false);
            }}
            onPaired={(id) => void refresh(id)}
            onBack={() => setPicking(false)}
            backLabel={m["common.close"]()}
          />
        </div>
      )}
    </>
  );
}
