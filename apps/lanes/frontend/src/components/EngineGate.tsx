// EngineGate.tsx — choose the engine before the editor mounts. It is no longer a fixed
// localhost socket: engines register themselves, so this lists them, probes each to a tier,
// and mounts <App/> with the chosen ws address. A reload reuses the last pick when it is
// still reachable, otherwise shows the picker again.

import { probeEngines } from "@studio/engine-browser/probe";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { ENGINE_ASSIGN_RENEW_MS, type RankedEngine } from "../types";
import { EngineSelect } from "./EngineSelect";
import { WorkspaceGate } from "./WorkspaceGate";

// sessionStorage: the pick belongs to this tab. A stored id is only a hint, re-validated by probing.
const STORAGE_KEY = "lanes.engine";

function storedId(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

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
    try {
      sessionStorage.setItem(STORAGE_KEY, r.engine.id);
    } catch {
      /* private mode — the pick just won't survive a reload */
    }
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
      const r = await refresh();
      if (cancelled) return;
      const id = storedId();
      const prev = id
        ? r.find((x) => x.engine.id === id && x.wsUrl)
        : undefined;
      if (prev && (await pick(prev))) return;
      if (!cancelled) setPhase({ k: "picking" });
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, pick]);

  if (phase.k === "chosen")
    // Hand the chosen engine to the workspace picker; key by wsUrl so switching engines remounts cleanly.
    return <WorkspaceGate key={phase.engine.wsUrl!} engine={phase.engine} />;

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
