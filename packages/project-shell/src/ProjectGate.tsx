// ProjectGate.tsx — resolve the repository this app was opened on into a folder on the
// engine's machine, cloning it if that machine has never seen it, then open the project and
// render the app. No app picks anything here: a project is chosen on st0's home page, and
// arriving with no target sends you back there. See docs/launch.md.

import {
  isBench,
  isLocal,
  localTarget,
  type ProjectApp,
} from "@studio/web-protocol/projects";
import {
  FolderGit2,
  FolderSearch,
  LibraryBig,
  Loader2,
  Moon,
  ServerCrash,
  ShieldAlert,
  UserRoundX,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  configureFileApi,
  diagnoseFileService,
  type FileServiceFault,
} from "./fileApi.ts";
import { useIdleTimeout } from "./idle.ts";
import { parseLaunch, projectsUrl } from "./launch.ts";
import { projectApi } from "./project.ts";
import { librariesRepo, repoByName } from "./repoLookup.ts";

/** How often the clone is asked how far it has got. Fast: it is the only thing on screen. */
const POLL_MS = 400;

type Phase =
  | { k: "resolving" }
  | { k: "cloning"; workspace: string; phase: string; percent: number | null }
  | { k: "error"; message: string; fault?: FileServiceFault; lines?: string[] }
  // The machine answered and has no such folder — its own screen, see docs/launch.md.
  | { k: "missing"; message: string }
  // The account has no library repository, so nothing resolves and nothing retries — docs/launch.md.
  | { k: "no-libraries" }
  // Nobody has touched this tab for a long time; the one button reopens it — see docs/idle.md.
  | { k: "idle" }
  | { k: "open"; workspace: string; project: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What the gate needs about its engine, structurally — see docs/launch.md. */
export interface GateEngine {
  fileBase: string | null | undefined;
  token: string | null | undefined;
  /** The engine ITSELF, for its id, nested as `RankedEngine` already has it — docs/launch.md. */
  engine: { id: string };
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
  /** No library repository on the account. Nothing is broken either; the account is unfinished. */
  librariesTitle: string;
  librariesBody: string;
  /** The bench's wait — a catalogue fetch, not a clone. Optional, see docs/launch.md. */
  benchWorkspace?: string;
  benchFetching?: string;
  /** The idle screen. Optional like the bench's, and for the same reason — docs/launch.md. */
  idleTitle?: string;
  idleBody?: string;
  resume?: string;
}

/** "Somebody else opened this project" — one screen, and no Retry. See docs/launch.md. */
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
  idleTimeoutMs = 0,
  onIdle,
  onResume,
}: {
  engine: GateEngine;
  /** Which app this is — it decides the suffix that ends the project in the address. */
  app: ProjectApp;
  /** Where this app is mounted — vite's `import.meta.env.BASE_URL`, handed over, docs/launch.md. */
  base: string;
  /** Each app owns its own wording (st0 has paraglide, z0's editor is French in place). */
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
  /** Close the session after this long untouched; `0` — the default — is off. See docs/idle.md. */
  idleTimeoutMs?: number;
  /** Whatever the APP holds and the gate cannot see — st0's engine lease. See docs/idle.md. */
  onIdle?: () => void;
  /** Taking it back. Called before the reopen starts, so the app can retake what it released. */
  onResume?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ k: "resolving" });
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
        engineToken: engine.token!,
        engineId: engine.engine.id,
        workspace,
      });
    },
    [engine.fileBase, engine.token, engine.engine.id],
  );

  /** Leave: let the app go first, then go back to where projects live. Nothing to forget. */
  const quit = useCallback(() => {
    onQuit?.();
    void projectApi.unloadEngine().catch(() => {
      /* engine/file service gone — leaving is still right */
    });
    window.location.href = projectsUrl(window.location.href);
  }, [onQuit]);

  /** Armed only while the project is OPEN — every other phase idles already. See docs/idle.md. */
  useIdleTimeout(phase.k === "open" ? idleTimeoutMs : 0, () => {
    setPhase({ k: "idle" });
  });

  // By ref, and load-bearing: an inline `onIdle` would re-fire the effect below every render.
  const idleCallback = useRef(onIdle);
  idleCallback.current = onIdle;
  /** In an EFFECT so the flush lands after `children` has unmounted — see docs/idle.md. */
  useEffect(() => {
    if (phase.k !== "idle") return;
    idleCallback.current?.();
    void projectApi.unloadEngine().catch(() => {
      /* engine or file service gone — the session is over here regardless */
    });
  }, [phase.k]);

  // No target at all: go to st0's home page rather than grow a second picker — docs/launch.md.
  useEffect(() => {
    if (!target) window.location.replace(projectsUrl(window.location.href));
  }, [target]);

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

        // `@local` names a folder already here: no lookup, no clone, no libraries — docs/launch.md.
        if (isLocal(repoName)) {
          const local = localTarget(project);
          if (!local)
            return setPhase({
              k: "missing",
              message:
                "@local opens a project in a workspace on this machine — `/@local/<workspace>/<projet>`.",
            });
          configure(userEmail, local.workspace);
          try {
            await projectApi.open(local.project);
          } catch (e) {
            if (cancelled) return;
            const status = (e as { status?: number }).status;
            // 404 is the workspace or the folder, and the service's sentence IS the explanation.
            if (status === 400 || status === 404)
              return setPhase({ k: "missing", message: (e as Error).message });
            throw e;
          }
          if (cancelled) return;
          return setPhase({
            k: "open",
            workspace: local.workspace,
            project: local.project,
          });
        }

        // The LIBRARIES, before anything about the project — including the bench, docs/launch.md.
        const libraries = await librariesRepo();
        if (cancelled) return;
        if (!libraries) return setPhase({ k: "no-libraries" });

        // The BENCH has no repository, and it is a `.st0` one — hence `app`, see docs/launch.md.
        if (app === "st0" && isBench(repoName)) {
          setPhase({
            k: "cloning",
            workspace: strings.benchWorkspace ?? "",
            phase: strings.benchFetching ?? "",
            percent: null,
          });
          // The project part goes with it: the same bench opens on the catalogue or on one chain.
          let bench: { workspace: string; project: string };
          try {
            bench = await projectApi.openBench(project, libraries.uri);
          } catch (e) {
            if (cancelled) return;
            // 409: a chain this machine has not got, or one colliding with the bench's furniture.
            if ((e as { status?: number }).status === 409) {
              setPhase({ k: "missing", message: (e as Error).message });
              return;
            }
            throw e;
          }
          if (cancelled) return;
          configure(userEmail, bench.workspace);
          await projectApi.open(bench.project, libraries.uri);
          if (cancelled) return;
          return setPhase({
            k: "open",
            workspace: bench.workspace,
            project: bench.project,
          });
        }

        // The address carries a NAME; git needs a URI, and pl8 is what holds the pairing.
        let repo: string;
        try {
          repo = (await repoByName(repoName)).uri;
        } catch (e) {
          if (cancelled) return;
          // pl8 answered "no such name" / "two of them" — a target problem, not a fault.
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
            // A clone failure is the USER'S to fix, and git's own words say which — show them.
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
          await projectApi.open(project, libraries.uri);
        } catch (e) {
          if (cancelled) return;
          // A refusal, not a fault: probing it would bury the answer under the CORS banner.
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
        // "NetworkError…" covers a refused origin and a dead service, whose fixes are opposite.
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

  // Repository fine, machine fine, project not in it: picking again is the only move, so no Retry.
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

  // No library repository: not an error, and re-asking gives the same answer until it is set.
  if (phase.k === "no-libraries")
    return (
      <div className="flex h-full items-center justify-center bg-background p-8 text-foreground">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <LibraryBig className="h-10 w-10 text-amber-500" />
          <h1 className="text-lg font-semibold">{strings.librariesTitle}</h1>
          <p className="text-sm text-muted-foreground">
            {strings.librariesBody}
          </p>
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

  // Resuming is the Retry road below, and it takes a hand on a button — see docs/idle.md.
  if (phase.k === "idle")
    return (
      <div className="flex h-full items-center justify-center bg-background p-8 text-foreground">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <Moon className="h-10 w-10 text-muted-foreground" />
          <h1 className="text-lg font-semibold">
            {strings.idleTitle ?? "Session suspended"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {strings.idleBody ??
              "Nothing happened here for a while, so the project was unloaded from the engine and this tab let go of it. Your files are untouched."}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              onClick={() => {
                onResume?.();
                setPhase({ k: "resolving" });
                setAttempt((n) => n + 1);
              }}
            >
              {strings.resume ?? "Resume"}
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
                : // The probe didn't run (a clone failed, not the service): the message says it.
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
