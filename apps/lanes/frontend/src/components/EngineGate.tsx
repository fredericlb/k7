// EngineGate.tsx — choose the engine before the editor mounts. It is no longer a fixed
// localhost socket: engines register themselves, so this lists them, probes each to a tier,
// and mounts <App/> with the chosen ws address. The pick belongs to the ACCOUNT — it comes
// back on any browser — and is reused whenever it is still reachable.

import { probeEngines } from "@studio/engine-browser/probe";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { ENGINE_ASSIGN_RENEW_MS, type RankedEngine } from "../types";
import { EngineSelect } from "./EngineSelect";
import { WorkspaceGate } from "./WorkspaceGate";

type Phase =
  | { k: "loading" }
  | { k: "picking" }
  | { k: "chosen"; engine: RankedEngine };

export function EngineGate() {
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const [ranked, setRanked] = useState<RankedEngine[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<RankedEngine[]> => {
    setBusy(true);
    try {
      const r = await probeEngines(await api.engines());
      setRanked(r);
      return r;
    } finally {
      setBusy(false);
    }
  }, []);

  const pick = useCallback(async (r: RankedEngine): Promise<boolean> => {
    if (!r.wsUrl || !r.fileBase || r.token === null) return false;
    try {
      await api.selectEngine(r.engine.id, r.token, r.tier); // token verified server-side
    } catch {
      return false; // engine vanished — stay on the picker
    }
    // Remembered on the ACCOUNT, not in this tab. sessionStorage meant a second tab was
    // back at the picker and a second browser had never chosen anything — while the whole
    // premise is that an engine belongs to a person, changeable in settings.
    // Fire-and-forget: failing the pick because a preference did not save would take the
    // engine away too, and the user is trying to open their song.
    api.saveAccountPrefs({ engineId: r.engine.id }).catch(() => {});
    setPhase({ k: "chosen", engine: r });
    return true;
  }, []);

  // The assignment is a LEASE this tab keeps alive: re-select on an interval, and beacon a goodbye on pagehide.
  useEffect(() => {
    if (phase.k !== "chosen") return;
    const { engine } = phase;
    const renew = () => {
      // A miss is fine: the TTL grants grace, and a genuinely gone engine will show up on the socket anyway.
      api
        .selectEngine(engine.engine.id, engine.token!, engine.tier)
        .catch(() => {});
    };
    renew(); // immediately, so a StrictMode remount (whose cleanup released) re-claims
    const timer = setInterval(renew, ENGINE_ASSIGN_RENEW_MS);
    const bye = () => void api.releaseEngine(engine.engine.id);
    window.addEventListener("pagehide", bye);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", bye);
      bye(); // unmounting without pagehide == switching away — release now
    };
  }, [phase]);

  useEffect(() => {
    // StrictMode runs this twice in dev; both probes are harmless, and a ref guard would strand us on the spinner.
    let cancelled = false;
    void (async () => {
      // Both at once: the preference is a hint that still has to be PROBED, so waiting for
      // one before starting the other would add a round trip to every load.
      const [r, prefs] = await Promise.all([
        refresh(),
        api.accountPrefs().catch(() => ({}) as { engineId?: string }),
      ]);
      if (cancelled) return;
      const id = prefs.engineId;
      const prev = id
        ? r.find((x) => x.engine.id === id && x.wsUrl)
        : undefined;
      if (prev && (await pick(prev))) return;
      // The remembered engine is off, or on a network we cannot reach from here. The picker
      // is the honest answer; the preference is left alone, so coming back on the right
      // network still works without choosing again.
      if (!cancelled) setPhase({ k: "picking" });
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, pick]);

  if (phase.k === "chosen")
    // Hand the chosen engine to the workspace picker; key by wsUrl so switching engines remounts cleanly.
    return (
      <WorkspaceGate
        key={phase.engine.wsUrl!}
        engine={phase.engine}
        // Re-probe on the way back: the list behind the picker is minutes old by now, and
        // showing a stale one would offer engines that have since gone.
        onChangeEngine={() => {
          setPhase({ k: "picking" });
          void refresh();
        }}
      />
    );

  if (phase.k === "loading")
    return (
      <div className="flex h-full items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );

  return (
    <EngineSelect
      ranked={ranked}
      loading={busy}
      onRefresh={() => void refresh()}
      onPick={(r) => void pick(r)}
    />
  );
}
