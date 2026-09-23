// EngineGate.tsx — choose the engine before the editor mounts. There is no fixed localhost
// socket: engines register themselves, so this lists them, MEASURES each one's latency,
// and mounts <App/> with the chosen ws address. The pick belongs to the ACCOUNT — it comes
// back on any browser — and is reused whenever it is still reachable.

import { Loader2 } from "@frediverse/ui/icons";
import type { ClaimTakenReason } from "@studio/engine-browser/lease";
import { useRelook } from "@studio/engine-browser/relook";
import { ProjectTakenOver } from "@studio/project-shell/gate";
import {
  parseLaunch,
  projectClaimKey,
  projectsUrl,
} from "@studio/project-shell/launch";
import { useCallback, useEffect, useMemo, useState } from "react";
import { engines } from "../api";
import { m } from "../paraglide/messages.js";
import type { RankedEngine } from "../types";
import { EngineSelect } from "./EngineSelect";
import { ProjectGate } from "./ProjectGate";

type Phase =
  | { k: "loading" }
  | { k: "picking" }
  | { k: "chosen"; engine: RankedEngine }
  // Somebody else opened this project — a terminal state on purpose, and only reached when a PERSON took it (see ProjectTakenOver).
  | {
      k: "taken";
      heldBy: string;
      why: ClaimTakenReason;
      tookFor: string | null;
    };

export function EngineGate({
  /** The surface this tab was opened on, when the address named one — forwarded, not acted on: this gate's job is the engine. */
  external,
}: {
  external?: string | null;
} = {}) {
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const [ranked, setRanked] = useState<RankedEngine[]>([]);
  const [busy, setBusy] = useState(false);
  /** The session fell asleep, and this gate draws one consequence: DROP THE LEASE, since a tab with no socket would only squat the machine. */
  const [asleep, setAsleep] = useState(false);

  // Re-measure and redraw the picker, for the Refresh button and the way back from a switch.
  const refresh = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      setRanked((await engines.find()).ranked);
    } finally {
      setBusy(false);
    }
  }, []);

  /** The list re-measures itself AS LONG AS the picker is on screen — only while `picking`, and without touching `busy`. */
  const relook = useRelook();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `relook` is a trigger, not a value read here — it says WHEN to re-measure.
  useEffect(() => {
    if (phase.k !== "picking") return;
    let cancelled = false;
    void engines
      .find()
      .then((l) => {
        if (!cancelled) setRanked(l.ranked);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [relook, phase.k]);

  /** Which project this tab is claiming, read from the address exactly as the router's basename is; the null branch keeps a rule `main.tsx` enforces. */
  const claimProject = useMemo(() => {
    const target = parseLaunch(
      window.location.pathname,
      "st0",
      import.meta.env.BASE_URL,
    );
    return target ? projectClaimKey(target) : null;
  }, []);

  const pick = useCallback(async (r: RankedEngine): Promise<boolean> => {
    if (!r.wsUrl || !r.fileBase || r.token === null) return false;
    // Remembered on the ACCOUNT rather than in this tab, and fire-and-forget: failing the pick because a preference did not save would take the engine away.
    engines.patchPrefs({ engineId: r.engine.id }).catch(() => {});
    setPhase({ k: "chosen", engine: r });
    return true;
  }, []);

  // The claim is a LEASE this tab keeps alive ON THIS PROJECT (@studio/engine-browser/docs/lease.md); asleep, the cleanup releases it.

  // biome-ignore lint/correctness/useExhaustiveDependencies: `phase.engine` is read only while phase.k is "chosen", and depending on the whole object would re-hold on every phase change.
  useEffect(() => {
    if (phase.k !== "chosen" || asleep) return;
    const engine = phase.engine;
    return engines.hold(engine, {
      project: claimProject,
      onLost: (heldBy, why) =>
        setPhase({
          k: "taken",
          heldBy,
          why: why.reason,
          tookFor: why.tookFor,
        }),
    });
  }, [phase.k, claimProject, asleep]);

  useEffect(() => {
    // StrictMode runs this twice in dev; both probes are harmless, and a ref guard would strand us on the spinner.
    let cancelled = false;
    void (async () => {
      // List, preference, probe and policy in one call — the same four steps in the same order as pl8.
      const { ranked: r, chosen } = await engines.find();
      if (cancelled) return;
      setRanked(r);
      if (chosen && (await pick(chosen))) return;
      // Nothing remembered and reachable, or several to choose between: the picker is the honest answer, and the preference is left alone.
      if (!cancelled) setPhase({ k: "picking" });
    })();
    return () => {
      cancelled = true;
    };
  }, [pick]);

  if (phase.k === "chosen")
    // Hand the chosen engine to the project gate; key by wsUrl so switching engines remounts cleanly.
    return (
      <ProjectGate
        key={phase.engine.wsUrl!}
        engine={phase.engine}
        external={external}
        // Re-probe on the way back: the list behind the picker is minutes old, and a stale one would offer engines that have gone.
        onChangeEngine={() => {
          setPhase({ k: "picking" });
          void refresh();
        }}
        onIdle={() => setAsleep(true)}
        onResume={() => setAsleep(false)}
      />
    );

  if (phase.k === "taken")
    return (
      <ProjectTakenOver
        heldBy={phase.heldBy}
        title={
          phase.why === "engine"
            ? m["project.engineTakenTitle"]()
            : m["project.takenTitle"]()
        }
        // One wording per REASON: opening a DIFFERENT project on the same engine displaces this one, and the honest advice is the opposite.
        body={(heldBy) =>
          phase.why === "engine"
            ? m["project.engineTakenBody"]({
                project: phase.tookFor ?? m["project.anotherProject"](),
              })
            : heldBy
              ? m["project.takenBody"]({ heldBy })
              : m["project.takenBodyAnon"]()
        }
        back={m["project.backToProjects"]()}
        onBack={() => {
          window.location.href = projectsUrl(window.location.href);
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
