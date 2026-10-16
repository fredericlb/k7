// useGatePhase.ts — the gate's state machine: resolve the launch address into a project, open
// it, and move between the waits, the refusals, sleep and open. ProjectGate.tsx draws the phase.
// See docs/launch.md and docs/idle.md.

import {
  isBench,
  isLocal,
  localTarget,
  type ProjectApp,
} from "@studio/web-protocol/projects";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { configureFileApi, diagnoseFileService } from "./fileApi.ts";
import { fileRoutes } from "./files.ts";
import type { GateEngine, GatePhase, ProjectGateStrings } from "./gateTypes.ts";
import {
  anotherTabActive,
  IDLE_TIMEOUT_MS,
  sleepMove,
  useIdleTimeout,
} from "./idle.ts";
import { parseLaunch, projectsUrl } from "./launch.ts";
import { accountLibraries } from "./repoLookup.ts";
import { waitForSync } from "./syncWait.tsx";

/** What a bare `@local` and a retired address say when the host passes no wording of its own. */
const LOCAL_USAGE =
  "This address names no project. A project on this machine opens at /@local/<workspace>/<project> — open it from the projects page.";
const RETIRED_ADDRESS = (name: string) =>
  `“${name}” is an older kind of address that no longer opens anything. Open the project from the projects page instead.`;

export function useGatePhase({
  engine,
  app,
  base,
  strings,
  idleTimeoutMs,
  asleep,
  onIdle,
  onResume,
}: {
  engine: GateEngine;
  app: ProjectApp;
  base: string;
  strings: ProjectGateStrings;
  idleTimeoutMs: number;
  asleep: boolean;
  onIdle?: () => void;
  onResume?: () => void;
}) {
  const [phase, setPhase] = useState<GatePhase>({ k: "resolving" });
  const [email, setEmail] = useState("");
  // Bumped by Retry to re-run the setup effect below.
  const [attempt, setAttempt] = useState(0);
  // From `window.location` rather than `useLocation()`, and once per mount — see docs/launch.md.
  const target = useMemo(
    () => parseLaunch(window.location.pathname, app, base),
    [app, base],
  );

  const configure = useCallback(
    (userEmail: string, workspace: string) => {
      configureFileApi({
        base: engine.fileBase!,
        userEmail,
        engineToken: (engine.fileToken ?? engine.token)!,
        engineId: engine.engine.id,
        workspace,
        // Only a hub ticket ages; an engine's own token does not.
        ...(engine.fileToken && engine.renewTicket
          ? { renewTicket: engine.renewTicket }
          : {}),
      });
    },
    [
      engine.fileBase,
      engine.token,
      engine.fileToken,
      engine.engine.id,
      engine.renewTicket,
    ],
  );

  /** Leave: go back to where projects live. Nothing to forget. */
  const quit = useCallback(() => {
    // Not from under another tab of this account still using the session.
    if (!anotherTabActive(IDLE_TIMEOUT_MS))
      void fileRoutes.unloadEngine().catch(() => {
        /* engine/file service gone — leaving is still right */
      });
    window.location.href = projectsUrl(window.location.href);
  }, []);

  /** Armed only while the project is OPEN — every other phase idles already. See docs/idle.md. */
  useIdleTimeout(phase.k === "open" ? idleTimeoutMs : 0, () => {
    setPhase({ k: "idle", why: "timeout" });
  });

  /** Taking the session back: the Retry road, from the button or from a tab coming forward. */
  const resume = useCallback(() => {
    onResume?.();
    setPhase({ k: "resolving" });
    setAttempt((n) => n + 1);
  }, [onResume]);

  /** A tab behind another sleeps, and only `hidden` wakes on its own — see docs/idle.md. */
  useEffect(() => {
    const move = sleepMove(asleep, phase);
    if (move === "sleep") setPhase({ k: "idle", why: "hidden" });
    if (move === "wake") resume();
  }, [asleep, phase, resume]);

  // By ref, and load-bearing: an inline `onIdle` would re-fire the effect below every render.
  const idleCallback = useRef(onIdle);
  idleCallback.current = onIdle;
  // The wording by ref too: a host's inline `strings` object would otherwise re-run the resolve every render.
  const wording = useRef(strings);
  wording.current = strings;
  /** In an EFFECT so the flush lands after `children` has unmounted — see docs/idle.md. */
  useEffect(() => {
    if (phase.k !== "idle") return;
    idleCallback.current?.();
    // The session is shared by this account's tabs: another one in use keeps it, and only this tab sleeps.
    if (anotherTabActive(IDLE_TIMEOUT_MS)) return;
    void fileRoutes.unloadEngine().catch(() => {
      /* engine or file service gone — the session is over here regardless */
    });
  }, [phase.k]);

  // No target at all: go to k7's home page rather than grow a second picker — docs/launch.md.
  useEffect(() => {
    if (!target) window.location.replace(projectsUrl(window.location.href));
  }, [target]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the Retry trigger; `app` and the bench wording are fixed for a mount.
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    const { repo: repoName, project } = target;
    void (async () => {
      // Catch: an unhandled rejection leaves `phase` on "resolving" forever, a spinner with no why.
      try {
        const me = await fetch("/auth/me").then((r) =>
          r.ok
            ? (r.json() as Promise<{ user?: { email?: string; sub?: string } }>)
            : null,
        );
        const userEmail = me?.user?.email || me?.user?.sub || "unknown";
        if (cancelled) return;
        setEmail(userEmail);
        configure(userEmail, ""); // base set; the workspace is what we are about to find

        // `@local` names a folder already here: no lookup and no clone. The account's libraries
        // are the machine's business — `/open` brings them up to date (docs/launch.md).
        if (isLocal(repoName)) {
          const local = localTarget(project);
          if (!local)
            return setPhase({
              k: "missing",
              hint: wording.current.localUsage ?? LOCAL_USAGE,
            });
          configure(userEmail, local.workspace);
          // No library is not a refusal here: a song started on this machine may extend nothing
          // shared, and the project's own "unresolved reference" is the better complaint.
          for (;;) {
            // The relay first: half a project compiles to "file missing" (syncWait.tsx).
            const synced = await waitForSync(
              local.project,
              (sync) =>
                setPhase({ k: "syncing", workspace: local.workspace, sync }),
              () => cancelled,
            );
            if (!synced) return;
            try {
              await fileRoutes.open(local.project);
              break;
            } catch (e) {
              if (cancelled) return;
              const status = (e as { status?: number }).status;
              // 409: it fell behind between the two questions — wait again.
              if (status === 409) continue;
              // 404 is the workspace or the folder, and the service's sentence IS the explanation.
              if (status === 400 || status === 404)
                return setPhase({
                  k: "missing",
                  detail: (e as Error).message,
                });
              throw e;
            }
          }
          if (cancelled) return;
          return setPhase({
            k: "loading",
            workspace: local.workspace,
            project: local.project,
          });
        }

        // The LIBRARIES, before anything about the project — including the bench, docs/launch.md.
        const libraries = await accountLibraries();
        if (cancelled) return;
        if (!libraries.length) return setPhase({ k: "no-libraries" });

        // The BENCH has no repository, and it is a `.k7` one — hence `app`, see docs/launch.md.
        if (app === "k7" && isBench(repoName)) {
          setPhase({
            k: "cloning",
            workspace: wording.current.benchWorkspace ?? "",
            phase: wording.current.benchFetching ?? "",
          });
          // The project part goes with it: the machine is the side that says which address it answers.
          let bench: { workspace: string; project: string };
          try {
            bench = await fileRoutes.openBench(project);
          } catch (e) {
            if (cancelled) return;
            // 404 is an address under `@banc` that names nothing; 409 a library that will not mount.
            const status = (e as { status?: number }).status;
            if (status === 404 || status === 409) {
              setPhase({ k: "missing", detail: (e as Error).message });
              return;
            }
            throw e;
          }
          if (cancelled) return;
          configure(userEmail, bench.workspace);
          await fileRoutes.open(bench.project);
          if (cancelled) return;
          return setPhase({
            k: "loading",
            workspace: bench.workspace,
            project: bench.project,
          });
        }

        // A bare repository name names no folder, so this refuses rather than guesses — apps/k7/frontend/docs/projects.md.
        return setPhase({
          k: "missing",
          hint: (wording.current.retiredAddress ?? RETIRED_ADDRESS)(repoName),
        });
      } catch (e) {
        if (cancelled) return;
        // "NetworkError…" covers a refused origin and a dead service, whose fixes are opposite; an HTTP status is neither — the service answered.
        const answered = typeof (e as { status?: unknown }).status === "number";
        const fault = answered
          ? undefined
          : await diagnoseFileService(engine.fileBase);
        if (!cancelled)
          setPhase({ k: "error", message: (e as Error).message, fault });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configure, engine.fileBase, target, attempt]);

  /** Retry from an error: the resolve again, from the top. */
  const retry = useCallback(() => {
    setPhase({ k: "resolving" });
    setAttempt((n) => n + 1);
  }, []);

  return { phase, setPhase, email, quit, resume, retry };
}
