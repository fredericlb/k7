// ProjectGate.tsx — resolve the repository this app was opened on into a folder on the
// engine's machine, cloning it if that machine has never seen it, then open the project and
// render the app. Neither l8 nor m9 picks anything here: st0 owns the repositories, and
// arriving with no target sends you back there. See docs/launch.md.

import type { ProjectApp } from "@studio/web-protocol/projects";
import {
  FolderGit2,
  FolderSearch,
  Loader2,
  ServerCrash,
  ShieldAlert,
  UserRoundX,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  configureFileApi,
  diagnoseFileService,
  type FileServiceFault,
} from "./fileApi.ts";
import { parseLaunch, projectsUrl } from "./launch.ts";
import { projectApi } from "./project.ts";
import { repoByName } from "./repoLookup.ts";

/** How often the clone is asked how far it has got. Fast: it is the only thing on screen. */
const POLL_MS = 400;

type Phase =
  | { k: "resolving" }
  | { k: "cloning"; workspace: string; phase: string; percent: number | null }
  | { k: "error"; message: string; fault?: FileServiceFault; lines?: string[] }
  // The project itself is the problem — the machine answered, and said it has no such folder.
  // Its own screen, because the only useful action is to go and pick again. See docs/launch.md.
  | { k: "missing"; message: string }
  | { k: "open"; workspace: string; project: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Everything the gate needs about the engine it resolved against, and nothing more — so it
 *  does not care how each app models one. */
export interface GateEngine {
  fileBase: string | null | undefined;
  token: string | null | undefined;
}

export interface ProjectGateStrings {
  cloning: (workspace: string) => string;
  back: string;
  unreachableTitle: string;
  unreachableBody: (base: string) => string;
  blockedTitle: string;
  blockedBody: (origin: string) => string;
  bothBody: string;
  retry: string;
  /** The project named is not in the workspace — a wording apart, because nothing is broken. */
  missingTitle: string;
  missingBody: string;
}

/**
 * "Somebody else opened this project" — the end of the road for a tab that lost its claim.
 *
 * Here, and not three times in three engine gates, because the claim is enforced in ONE place
 * (`@studio/engine-registry`) and a screen that explained it differently per app would be three
 * accounts of one rule. It is pure presentation: this package deliberately does not depend on
 * `@studio/engine-browser` (see docs/launch.md), and a `heldBy` string and a callback keep it
 * that way. The wording stays the caller's, as everything else here does.
 *
 * No Retry. Retrying is precisely what must not happen: the claim was handed over on purpose,
 * and a tab that took it back on a timer is how one project ends up flickering between two
 * people. The only move is to go and pick again — or to reopen the project deliberately, which
 * is a fresh open and therefore a fresh takeover.
 */
export function ProjectTakenOver({
  heldBy,
  title,
  body,
  back,
  onBack,
}: {
  /** Who has it now — empty when the registry could not say, in which case body carries it. */
  heldBy: string;
  title: string;
  body: (heldBy: string) => string;
  back: string;
  onBack: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center bg-background p-8 text-foreground">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <UserRoundX className="h-10 w-10 text-amber-500" />
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{body(heldBy)}</p>
        <button
          type="button"
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
          onClick={onBack}
        >
          {back}
        </button>
      </div>
    </div>
  );
}

export function ProjectGate({
  engine,
  app,
  base,
  strings,
  children,
  onQuit,
}: {
  engine: GateEngine;
  /** Which app this is — it decides the suffix that ends the project in the address. */
  app: ProjectApp;
  /** Where this app is mounted, as vite's `import.meta.env.BASE_URL` gives it (`/l8/`). The
   *  package cannot read another package's build constant, so the app hands it over. */
  base: string;
  /** Each app owns its own wording (l8 has paraglide, m9 is French in place). */
  strings: ProjectGateStrings;
  /** Rendered once the project is open — the app itself. */
  children: (ctx: {
    workspace: string;
    project: string;
    userEmail: string;
    quit: () => void;
  }) => ReactNode;
  /** Called before leaving, for an app that must let go of something first. */
  onQuit?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ k: "resolving" });
  const [email, setEmail] = useState("");
  // Bumped by Retry to re-run the setup effect below.
  const [attempt, setAttempt] = useState(0);
  // From `window.location`, not `useLocation()`: the router's basename is this very prefix, so
  // what the hook reports has the repo and project already stripped off it.
  //
  // Once per mount, and that matters twice: it is a fresh object every call, which as an
  // effect dependency below would re-resolve the workspace forever; and the prefix cannot
  // change without a navigation that remounts this anyway.
  const target = useMemo(
    () => parseLaunch(window.location.pathname, app, base),
    [app, base],
  );

  const configure = useCallback(
    (userEmail: string, workspace: string) => {
      configureFileApi({
        base: engine.fileBase!,
        userEmail,
        engineToken: engine.token!,
        workspace,
      });
    },
    [engine.fileBase, engine.token],
  );

  /** Leave: let the app go first, then go back to where projects live. Nothing to forget —
   *  the target was the address, and we are about to leave it. */
  const quit = useCallback(() => {
    onQuit?.();
    void projectApi.unloadEngine().catch(() => {
      /* engine/file service gone — leaving is still right */
    });
    window.location.href = projectsUrl(window.location.href);
  }, [onQuit]);

  // No target at all: `/l8/` on its own, or a hand-typed address. st0 is where a project is
  // chosen, so go there rather than inventing a picker this app does not own.
  useEffect(() => {
    if (!target) window.location.replace(projectsUrl(window.location.href));
  }, [target]);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    const { repo: repoName, project } = target;
    void (async () => {
      // Catch: an unhandled rejection here leaves `phase` on "resolving" FOREVER — a spinner
      // with no explanation.
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

        // The address carries a NAME; git needs a URI, and st0 is what holds the pairing.
        // First, because everything below is about a repository we cannot yet name to git.
        let repo: string;
        try {
          repo = (await repoByName(repoName)).uri;
        } catch (e) {
          if (cancelled) return;
          // st0 answered "no such name" / "two of them" — a target problem, not a fault, and
          // the same screen as a project that is not in the repository.
          const status = (e as { status?: number }).status;
          if (status === 404 || status === 409) {
            setPhase({ k: "missing", message: (e as Error).message });
            return;
          }
          throw e;
        }
        if (cancelled) return;

        let workspace = (await projectApi.workspaceByRepo(repo)).workspace;
        if (cancelled) return;

        if (!workspace) {
          // Never cloned on this machine. Start it and follow it — this is the visible wait.
          let job = await projectApi.startClone(repo);
          setPhase({
            k: "cloning",
            workspace: job.workspace,
            phase: job.phase,
            percent: job.percent,
          });
          while (!job.done) {
            await sleep(POLL_MS);
            if (cancelled) return;
            job = await projectApi.cloneStatus(job.id);
            setPhase({
              k: "cloning",
              workspace: job.workspace,
              phase: job.phase,
              percent: job.percent,
            });
          }
          if (job.failed) {
            // A clone failure is the USER'S to fix, and git's own words say which — show them
            // rather than diagnosing a file service that answered perfectly well.
            setPhase({
              k: "error",
              message: job.error ?? "the clone failed",
              lines: job.lines,
            });
            return;
          }
          workspace = job.workspace;
        }

        configure(userEmail, workspace);
        try {
          await projectApi.open(project);
        } catch (e) {
          if (cancelled) return;
          // A refusal, not a fault: the service answered, and what it said is the whole story.
          // Probing it would ask whether it is reachable — it plainly is — and then show the
          // answer under the CORS banner, which is what made this look like l8's fault.
          const status = (e as { status?: number }).status;
          if (status === 400 || status === 404) {
            setPhase({ k: "missing", message: (e as Error).message });
            return;
          }
          throw e; // anything else (a transport failure, a 500) is diagnosed below
        }
        if (cancelled) return;
        setPhase({ k: "open", workspace, project });
      } catch (e) {
        if (cancelled) return;
        // "NetworkError…" covers both a refused origin and a dead service, and the two need
        // opposite fixes — so ask.
        const fault = await diagnoseFileService(engine.fileBase);
        if (!cancelled)
          setPhase({ k: "error", message: (e as Error).message, fault });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configure, engine.fileBase, target, attempt]);

  if (phase.k === "open")
    return (
      <>
        {children({
          workspace: phase.workspace,
          project: phase.project,
          userEmail: email,
          quit,
        })}
      </>
    );

  if (phase.k === "cloning")
    return (
      <div className="flex h-full items-center justify-center bg-background p-8 text-foreground">
        <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
          <FolderGit2 className="h-10 w-10 text-muted-foreground" />
          <h1 className="text-lg font-semibold">
            {strings.cloning(phase.workspace)}
          </h1>
          <p className="text-sm text-muted-foreground">{phase.phase}</p>
          {/* A bar only when git can measure; a counter it cannot fill is worse than none. */}
          <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
            <div
              className={
                phase.percent === null
                  ? "h-full w-1/3 animate-pulse bg-primary"
                  : "h-full bg-primary transition-all"
              }
              style={
                phase.percent === null
                  ? undefined
                  : { width: `${phase.percent}%` }
              }
            />
          </div>
        </div>
      </div>
    );

  // The repository is fine and the machine is fine; this project is not in it. Going back to
  // pick again is the only move, so it is the primary button — and Retry is not offered at
  // all, since re-running the same target can only fail the same way.
  if (phase.k === "missing")
    return (
      <div className="flex h-full items-center justify-center bg-background p-8 text-foreground">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <FolderSearch className="h-10 w-10 text-amber-500" />
          <h1 className="text-lg font-semibold">{strings.missingTitle}</h1>
          <p className="text-sm text-muted-foreground">{strings.missingBody}</p>
          <code className="max-w-full overflow-x-auto whitespace-pre-wrap rounded bg-muted px-2 py-1 text-left text-xs">
            {phase.message}
          </code>
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
            onClick={quit}
          >
            {strings.back}
          </button>
        </div>
      </div>
    );

  if (phase.k === "error")
    return (
      <div className="flex h-full items-center justify-center bg-background p-8 text-foreground">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          {phase.fault === "blocked" ? (
            <ShieldAlert className="h-10 w-10 text-amber-500" />
          ) : (
            <ServerCrash className="h-10 w-10 text-amber-500" />
          )}
          <h1 className="text-lg font-semibold">
            {phase.fault === "blocked"
              ? strings.blockedTitle
              : strings.unreachableTitle}
          </h1>
          <p className="text-sm text-muted-foreground">
            {phase.fault === "blocked"
              ? strings.blockedBody(window.location.origin)
              : phase.fault === "unreachable"
                ? strings.unreachableBody(engine.fileBase ?? "?")
                : // The probe didn't run (a clone failed, not the service) — the message below
                  // is the whole story.
                  strings.bothBody}
          </p>
          <code className="max-w-full overflow-x-auto whitespace-pre-wrap rounded bg-muted px-2 py-1 text-left text-xs">
            {phase.lines?.length ? phase.lines.join("\n") : phase.message}
          </code>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md bg-secondary px-3 py-1.5 text-sm"
              onClick={() => {
                setPhase({ k: "resolving" });
                setAttempt((n) => n + 1);
              }}
            >
              {strings.retry}
            </button>
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground"
              onClick={quit}
            >
              {strings.back}
            </button>
          </div>
        </div>
      </div>
    );

  return (
    <div className="flex h-full items-center justify-center bg-background text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}
