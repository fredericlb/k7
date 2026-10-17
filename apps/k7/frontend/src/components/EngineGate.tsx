// EngineGate.tsx — open the project at once and find its engine BESIDE it. The files are the
// server's hub's, reached with no engine bound; the engine is looked for meanwhile — registered,
// MEASURED, and chosen for you (`bestEngine`: compatibility with the project, then latency class,
// then performance, among TRUSTED engines only). The editor's link waits for that choice, and a
// project with no engine at all stays open and silent, the header saying so. See ../../docs/shell.md.

import type { HostedFiles } from "@studio/engine-browser/access";
import { bestEngine } from "@studio/engine-browser/choose";
import type { ClaimTakenReason } from "@studio/engine-browser/lease";
import { useRelook } from "@studio/engine-browser/relook";
import type { GateEngine } from "@studio/project-shell/gate";
import { ProjectTakenOver } from "@studio/project-shell/gate";
import {
  parseLaunch,
  projectClaimKey,
  projectsUrl,
} from "@studio/project-shell/launch";
import { GateWait } from "@studio/project-shell/progress";
import { claimSlot } from "@studio/web-protocol/projects";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { engines } from "../api";
import { compatByEngine } from "../engineCompat";
import { accountEngine } from "../engineSession";
import { m } from "../paraglide/messages.js";
import type { RankedEngine } from "../types";
import { EngineSelect } from "./EngineSelect";
import { ProjectGate } from "./ProjectGate";

/** Somebody else opened this project — a terminal state on purpose, and only reached when a PERSON took it (see ProjectTakenOver). */
interface Taken {
  heldBy: string;
  why: ClaimTakenReason;
  tookFor: string | null;
}

export function EngineGate({
  /** The surface this tab was opened on, when the address named one — forwarded, not acted on: this gate's job is the engine. */
  external,
}: {
  external?: string | null;
} = {}) {
  // The server's file hub, undefined while asked, null when this server hosts no files (then the engine's own are needed).
  const [hosted, setHosted] = useState<HostedFiles | null | undefined>(
    undefined,
  );
  const [chosen, setChosen] = useState<RankedEngine | null>(null);
  // The first look for an engine is still running.
  const [searching, setSearching] = useState(true);
  // The full list, drawn over the project when asked for — or alone, when there are no files to open without an engine.
  const [picking, setPicking] = useState(false);
  const [taken, setTaken] = useState<Taken | null>(null);
  const [ranked, setRanked] = useState<RankedEngine[]>([]);
  const [busy, setBusy] = useState(false);
  // Bumped by a pick made AFTER the project is open: the editor is remounted on it, as a switch always was.
  const [generation, setGeneration] = useState(0);
  /** The session fell asleep, and this gate draws one consequence: DROP THE LEASE, since a tab with no socket would only squat the machine. */
  const [asleep, setAsleep] = useState(false);

  // The choice as the editor's link reads it, and whoever is waiting for the first one.
  const chosenRef = useRef<RankedEngine | null>(null);
  const waiters = useRef<((r: RankedEngine | null) => void)[]>([]);
  const settled = useRef(false);

  useEffect(() => {
    let live = true;
    void engines
      .hostedFiles()
      .catch(() => null)
      .then((h) => live && setHosted(h));
    return () => {
      live = false;
    };
  }, []);

  // Re-measure and redraw the picker, for the Refresh button and the way back from a switch.
  const refresh = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      setRanked((await engines.find()).ranked);
    } finally {
      setBusy(false);
    }
  }, []);

  /** The list re-measures itself AS LONG AS the picker is on screen — and without touching `busy`. */
  const relook = useRelook();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `relook` is a trigger, not a value read here — it says WHEN to re-measure.
  useEffect(() => {
    if (!picking) return;
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
  }, [relook, picking]);

  /** Which project this tab is claiming, read from the address exactly as the router's basename is; the null branch keeps a rule `main.tsx` enforces. */
  const claimProject = useMemo(() => {
    const target = parseLaunch(
      window.location.pathname,
      "k7",
      import.meta.env.BASE_URL,
    );
    return target ? projectClaimKey(target) : null;
  }, []);

  /** Take `r`; `later` says the project is already open on another (or none), so the editor is remounted onto it. */
  const pick = useCallback(
    async (
      r: RankedEngine,
      remember = true,
      later = false,
    ): Promise<boolean> => {
      if (!r.wsUrl || !r.fileBase || r.token === null) return false;
      // Remembered on the ACCOUNT rather than in this tab, and fire-and-forget: failing the pick because a preference did not save would take the engine away.
      if (remember)
        engines.patchPrefs({ engineId: r.engine.id }).catch(() => {});
      chosenRef.current = r;
      for (const w of waiters.current.splice(0)) w(r);
      setChosen(r);
      setPicking(false);
      if (later) setGeneration((g) => g + 1);
      return true;
    },
    [],
  );

  // Paired just now: probe again with the new key, and go straight to that engine when it answers as usable.
  const afterPairing = useCallback(
    async (engineId: string): Promise<void> => {
      setBusy(true);
      try {
        const { ranked: r } = await engines.find(engineId);
        setRanked(r);
        const paired = r.find((x) => x.engine.id === engineId);
        if (paired && !paired.engine.assigned) await pick(paired, true, true);
      } finally {
        setBusy(false);
      }
    },
    [pick],
  );

  // The claim is a LEASE this tab keeps alive ON THIS PROJECT (@studio/engine-browser/docs/lease.md); asleep, the cleanup releases it.
  const heldId = chosen?.engine.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `chosen` is read only through `heldId`, which is what says it changed.
  useEffect(() => {
    if (!chosen || asleep) return;
    return engines.hold(chosen, {
      project: claimProject,
      onLost: (heldBy, why) =>
        setTaken({ heldBy, why: why.reason, tookFor: why.tookFor }),
    });
  }, [heldId, claimProject, asleep]);

  useEffect(() => {
    // StrictMode runs this twice in dev; both probes are harmless, and a ref guard would strand the search.
    let cancelled = false;
    (async () => {
      // List, preference, probe and policy in one call — the same four steps in the same order as pl8 — beside what the project needs.
      const { ranked: r, chosen: policy, rememberedId } = await engines.find();
      if (cancelled) return;
      setRanked(r);
      // Compatibility, then latency class, then performance — compatibility left out where it could not be told.
      const compat = await compatByEngine(r);
      if (cancelled) return;
      // The BENCH plays beside the account's song, on its engine: the account's files drive one at a time.
      if (claimProject && claimSlot(claimProject) === "bench") {
        const me = await fetch("/auth/me", {
          signal: AbortSignal.timeout(5000),
        })
          .then((res) =>
            res.ok
              ? (res.json() as Promise<{
                  user?: { email?: string; sub?: string };
                }>)
              : null,
          )
          .catch(() => null);
        const who = me?.user?.email || me?.user?.sub || "";
        const mine = who ? accountEngine(r, who) : undefined;
        if (cancelled) return;
        if (mine && (await pick(mine, false))) return;
      }
      // Only a trusted engine is taken unasked — remembered, reached directly, or the server's (engine-browser docs/access.md).
      const best = bestEngine(r, {
        compat: compat.size ? (id) => compat.get(id)?.score ?? null : undefined,
        remembered: rememberedId,
      });
      if (best && (await pick(best, false))) return;
      // No candidate qualified (all in use, say): the policy's own answer, if it has one.
      if (policy && (await pick(policy))) return;
    })()
      // A step that threw is the same answer as none qualifying: the project stays open and silent, the header offering the list.
      .catch(() => {})
      .finally(() => {
        if (cancelled) return;
        settled.current = true;
        // A link still waiting hears "none" now rather than at its deadline.
        for (const w of waiters.current.splice(0)) w(chosenRef.current);
        setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pick, claimProject]);

  // Asked on every dial: the choice once there is one, else a wait for it — which the link's own deadline bounds.
  const linkUrls = useRef(
    new Map<string, () => string | Promise<string | null>>(),
  );
  const engineUrl = useCallback(async (): Promise<string | null> => {
    const r =
      chosenRef.current ??
      (settled.current
        ? null
        : await new Promise<RankedEngine | null>((resolve) =>
            waiters.current.push(resolve),
          ));
    if (!r) return null;
    let url = linkUrls.current.get(r.engine.id);
    if (!url) {
      url = engines.linkUrl(r);
      linkUrls.current.set(r.engine.id, url);
    }
    return url();
  }, []);

  // The files are the chosen engine's way in when it has one, else the hub's own with no engine bound.
  const gateEngine = useMemo<GateEngine | null>(() => {
    // A session open past its twelve-hour ticket asks for a new one rather than failing every read — packages/project-shell/docs/fileApi.md.
    const renewTicket = () => engines.freshTicket();
    if (chosen?.fileBase)
      return chosen.filesHosted ? { ...chosen, renewTicket } : chosen;
    if (!hosted) return null;
    return {
      fileBase: hosted.fileBase,
      token: null,
      fileToken: hosted.fileToken,
      engine: { id: "" },
      renewTicket,
    };
  }, [chosen, hosted]);

  const toProjects = () => {
    window.location.href = projectsUrl(window.location.href);
  };

  if (taken)
    return (
      <ProjectTakenOver
        heldBy={taken.heldBy}
        title={
          taken.why === "engine"
            ? m["project.engineTakenTitle"]()
            : taken.why === "refused"
              ? m["project.notYoursTitle"]()
              : m["project.takenTitle"]()
        }
        // One wording per REASON: opening a DIFFERENT project on the same engine displaces this one, and the honest advice is the opposite.
        body={(heldBy) =>
          taken.why === "engine"
            ? m["project.engineTakenBody"]({
                project: taken.tookFor ?? m["project.anotherProject"](),
              })
            : taken.why === "refused"
              ? m["project.notYoursBody"]()
              : heldBy
                ? m["project.takenBody"]({ heldBy })
                : m["project.takenBodyAnon"]()
        }
        back={m["project.backToProjects"]()}
        onBack={toProjects}
      />
    );

  const select = (overlay: boolean) => (
    <EngineSelect
      ranked={ranked}
      loading={busy}
      onRefresh={() => void refresh()}
      onPick={(r) => void pick(r, true, overlay)}
      onPaired={(id) => void afterPairing(id)}
      onBack={overlay ? () => setPicking(false) : toProjects}
      backLabel={overlay ? m["common.close"]() : undefined}
    />
  );

  // Nothing to open the files with yet: the hub still being asked, or no hub and no engine found.
  if (!gateEngine) {
    if (hosted === undefined || searching)
      return (
        <GateWait
          label={
            hosted === undefined
              ? m["startup.files"]()
              : m["startup.searching"]()
          }
        />
      );
    return select(false);
  }

  return (
    <>
      <ProjectGate
        key={generation}
        engine={chosen}
        gateEngine={gateEngine}
        engineUrl={engineUrl}
        engineSearching={searching && !chosen}
        external={external}
        // Re-probe on the way: the list behind the picker is minutes old, and a stale one would offer engines that have gone.
        onChangeEngine={() => {
          setPicking(true);
          void refresh();
        }}
        // From the header's engine menu: straight to that engine, no picker in between.
        onSwitchEngine={(r) => void pick(r, true, true)}
        onIdle={() => setAsleep(true)}
        onResume={() => setAsleep(false)}
      />
      {picking && (
        <div className="fixed inset-0 z-50 bg-background">{select(true)}</div>
      )}
    </>
  );
}
