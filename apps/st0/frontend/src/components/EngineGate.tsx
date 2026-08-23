// EngineGate.tsx — choose the engine before the editor mounts. It is no longer a fixed
// localhost socket: engines register themselves, so this lists them, MEASURES each one's latency,
// and mounts <App/> with the chosen ws address. The pick belongs to the ACCOUNT — it comes
// back on any browser — and is reused whenever it is still reachable.

import type { ClaimTakenReason } from "@studio/engine-browser/lease";
import { useRelook } from "@studio/engine-browser/relook";
import { ProjectTakenOver } from "@studio/project-shell/gate";
import {
  parseLaunch,
  projectClaimKey,
  projectsUrl,
} from "@studio/project-shell/launch";
import { Loader2 } from "lucide-react";
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
  // Somebody else opened this project. A terminal state on purpose: see ProjectTakenOver.
  // Only reached when a PERSON took it — a claim that merely lapsed is re-opened by the hold
  // loop and never lands here, so there is no screen for it.
  | {
      k: "taken";
      heldBy: string;
      why: ClaimTakenReason;
      tookFor: string | null;
    };

export function EngineGate({
  /**
   * The surface this tab was opened on, when the address named one — see
   * `@studio/web-protocol/projects`. Forwarded, not acted on: this gate's job is the engine,
   * and an external surface needs exactly the same one for exactly the same reasons.
   */
  external,
}: {
  external?: string | null;
} = {}) {
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const [ranked, setRanked] = useState<RankedEngine[]>([]);
  const [busy, setBusy] = useState(false);
  /**
   * The session fell asleep, and this gate draws one consequence from it: DROP THE LEASE.
   *
   * It is not a phase. The chosen engine does not change, and `ProjectGate` stays mounted — it
   * draws the resume screen and knows how to reopen. Here, going idle does one thing, the only
   * one this level owns: stop renewing the claim every five seconds. A tab with no socket, no
   * loaded project, that would still keep the machine to itself is not disconnected; it squats.
   */
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

  /**
   * The list re-measures itself AS LONG AS the picker is on screen.
   *
   * A probe is a snapshot, and `unreachable` is not slow latency but a state of its own: one
   * missed race froze "out of reach" until the page was reloaded. Looking at this list is
   * exactly how one waits for it to change its mind.
   *
   * Only while `picking`: once the engine is chosen, re-measuring could pull the screen backwards
   * under the fingers of somebody working. And without touching `busy` — the Refresh button owns
   * that, and seeing it blink on its own would say a click had landed.
   */
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

  /**
   * Which project this tab is claiming, read from the address exactly as the router's basename is.
   *
   * Never null in practice any more: `main.tsx` only mounts this gate when `parseLaunch` found a
   * project, and draws the home page otherwise. The null branch stays because the rule behind it
   * does — a screen with no project must NOT claim, or it would fight the real tabs for an
   * engine — and it is now enforced one level up, where the home page probes without holding.
   */
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
    // No `select` here any more. `holdEngine` renews immediately on mount, so this was a second
    // claim in the same tick (docs/audit-moteur.md, C3) — and now that a claim mints a secret,
    // an extra one would hand out a secret nobody keeps and then be taken over by our own hold.
    // Remembered on the ACCOUNT, not in this tab. sessionStorage meant a second tab was
    // back at the picker and a second browser had never chosen anything — while the whole
    // premise is that an engine belongs to a person, changeable in settings.
    // Fire-and-forget: failing the pick because a preference did not save would take the
    // engine away too, and the user is trying to open their song.
    // `patchPrefs` even though st0's document holds only this field today — see m9's Gate.
    engines.patchPrefs({ engineId: r.engine.id }).catch(() => {});
    setPhase({ k: "chosen", engine: r });
    return true;
  }, []);

  // The claim is a LEASE this tab keeps alive, ON THIS PROJECT. The loop is shared — see
  // @studio/engine-browser/docs/lease.md — and nothing here but when to start it and what to do
  // when it is lost. Losing it is not an error to retry: somebody opened the project, and this
  // tab stops driving. `phase.k` rather than `phase` in the deps, or the state we set inside
  // would restart the very hold that reported the loss.
  // Asleep, the loop stops: the effect's cleanup releases, and the machine is free in the pickers
  // again. Waking restarts it, which is a deliberate reopening — a proper resume, refused by
  // `onLost` if somebody moved in meanwhile.
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
      // List, preference, probe and policy in one call — the same four steps in the same
      // order as pl8 and m9, from @studio/engine-browser/access rather than three copies.
      const { ranked: r, chosen } = await engines.find();
      if (cancelled) return;
      setRanked(r);
      if (chosen && (await pick(chosen))) return;
      // Nothing remembered and reachable, or several to choose between. The picker is the honest
      // answer; the preference is left alone, so coming back on the right network still works
      // without choosing again.
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
        // Re-probe on the way back: the list behind the picker is minutes old by now, and
        // showing a stale one would offer engines that have since gone.
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
        // One wording per REASON, and within the first, one per whether there is a name. Saying
        // "this project was opened elsewhere" for both was false once: opening a DIFFERENT
        // project on the same engine displaces this one, and the honest advice is the opposite.
        body={(heldBy) =>
          phase.why === "engine"
            ? m["project.engineTakenBody"]({
                project: phase.tookFor ?? "un autre projet",
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
