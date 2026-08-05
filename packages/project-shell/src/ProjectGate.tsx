// ProjectGate.tsx — resolve the repository this app was opened on into a folder on the
// engine's machine, cloning it if that machine has never seen it, then open the project and
// render the app. Neither l8 nor m9 picks anything here: st0 owns the repositories, and
// arriving with no target sends you back there. See docs/launch.md.

import { FolderGit2, Loader2, ServerCrash, ShieldAlert } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  configureFileApi,
  diagnoseFileService,
  type FileServiceFault,
} from "./fileApi.ts";
import { clearLaunch, launchTarget, projectsUrl } from "./launch.ts";
import { projectApi } from "./project.ts";

/** How often the clone is asked how far it has got. Fast: it is the only thing on screen. */
const POLL_MS = 400;

type Phase =
  | { k: "resolving" }
  | { k: "cloning"; workspace: string; phase: string; percent: number | null }
  | { k: "error"; message: string; fault?: FileServiceFault; lines?: string[] }
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
}

export function ProjectGate({
  engine,
  strings,
  children,
  onQuit,
}: {
  engine: GateEngine;
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
  const target = launchTarget();

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

  /** Leave: let the app go first, forget the target, and go back to where projects live. */
  const quit = useCallback(() => {
    onQuit?.();
    void projectApi.unloadEngine().catch(() => {
      /* engine/file service gone — leaving is still right */
    });
    clearLaunch();
    window.location.href = projectsUrl(window.location.href);
  }, [onQuit]);

  // No target at all: this tab was opened by hand or the session was cleared. st0 is where a
  // project is chosen, so go there rather than inventing a picker this app does not own.
  useEffect(() => {
    if (!target) window.location.replace(projectsUrl(window.location.href));
  }, [target]);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    const { repo, project } = target;
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
        await projectApi.open(project);
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
