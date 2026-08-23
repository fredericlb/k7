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
  // The project itself is the problem — the machine answered, and said it has no such folder.
  // Its own screen, because the only useful action is to go and pick again. See docs/launch.md.
  | { k: "missing"; message: string }
  // The ACCOUNT is not set up: no library repository, so no project can resolve a shared
  // module. Nothing is broken and there is nothing to retry — the one move is to go and set it.
  | { k: "no-libraries" }
  // Nobody has touched this tab for a long time. The app is unmounted — which is what closes the
  // engine socket — and the project is flushed out of the engine. Retryable, and only that: the
  // one button reopens it. See docs/idle.md.
  | { k: "idle" }
  | { k: "open"; workspace: string; project: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Everything the gate needs about the engine it resolved against, and nothing more — so it
 *  does not care how each app models one. */
export interface GateEngine {
  fileBase: string | null | undefined;
  token: string | null | undefined;
  /**
   * The engine ITSELF, for its id — a call to another service has to name which machine it is
   * borrowing (see `FileCfg.engineId`), and pl8's `/api/stems` is the first that does.
   *
   * Nested rather than flattened to `id`, which is the shape `RankedEngine` already has: both
   * hosts pass one of those straight through, so asking for the field where it actually lives
   * costs neither of them an edit. That is the same rule the two fields above follow — the gate
   * declares what it needs, structurally, and does not care how each app models an engine.
   */
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
  /**
   * The bench's wait, which is a catalogue fetch and not a clone — see the gate's bench branch.
   *
   * OPTIONAL, and that is the honest shape: the bench is a `.st0` project, so m9 can never
   * be opened on one and have nothing to say about it. Required here, they would each be made to
   * translate a screen neither can reach.
   */
  benchWorkspace?: string;
  benchFetching?: string;
  /**
   * The idle screen. OPTIONAL, like the bench's: an app that passes no `idleTimeoutMs` can never
   * reach this phase, and requiring the three strings would make it translate a screen it does
   * not have. The gate falls back to plain English rather than to an empty card.
   */
  idleTitle?: string;
  idleBody?: string;
  resume?: string;
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
  idleTimeoutMs = 0,
  onIdle,
  onResume,
}: {
  engine: GateEngine;
  /** Which app this is — it decides the suffix that ends the project in the address. */
  app: ProjectApp;
  /** Where this app is mounted, as vite's `import.meta.env.BASE_URL` gives it (`/`). The
   *  package cannot read another package's build constant, so the app hands it over. */
  base: string;
  /** Each app owns its own wording (st0 has paraglide, m9 is French in place). */
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
  /**
   * After this long with nobody touching the tab, close the session. `0` — the default — is off,
   * so an app opts in rather than inheriting a behaviour it never asked for.
   * `@studio/project-shell/idle` holds the number and the reasoning.
   */
  idleTimeoutMs?: number;
  /**
   * The session just went idle. The gate has already stopped rendering the app and is about to
   * flush the project; this is for whatever the APP holds that the gate cannot see — st0 lets go
   * of its engine lease here.
   *
   * A callback and not an import, for the reason `ProjectTakenOver` states above: this package
   * deliberately does not depend on `@studio/engine-browser`.
   */
  onIdle?: () => void;
  /** Taking it back. Called before the reopen starts, so the app can retake what it released. */
  onResume?: () => void;
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
        engineId: engine.engine.id,
        workspace,
      });
    },
    [engine.fileBase, engine.token, engine.engine.id],
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

  /**
   * Twenty minutes with nobody there: stop being a client of this engine.
   *
   * Armed only while the project is OPEN. Every other phase is already a screen with nothing
   * running behind it — a clone in progress, an error, the picker — and timing those out would
   * replace one card with another for no gain.
   */
  useIdleTimeout(phase.k === "open" ? idleTimeoutMs : 0, () => {
    setPhase({ k: "idle" });
  });

  /**
   * The disconnection itself, in an EFFECT and not in the callback above — and the order is the
   * whole point.
   *
   * Setting the phase unmounts `children`, which is the app: its engine hook's cleanup runs
   * `EngineClient.dispose()`, and the WebSocket closes. An effect runs after that commit, so by
   * the time `unloadEngine` reaches the file service there is nothing left to push a document
   * back in behind it. Called from the timer instead, the flush would race a socket still open.
   *
   * `unloadEngine` is the same call `quit()` makes: stop the transport, flush, forget the served
   * project, and `drop-session` to the engine. A failure is ignored on purpose — the machine
   * being gone is one of the reasons a tab sits untouched for twenty minutes, and the screen
   * that offers to reopen is right either way.
   */
  // By ref, and this one is load-bearing: an app passing an inline closure would give a new
  // `onIdle` every render, and with it in the deps the effect below would re-fire — releasing the
  // lease and flushing the engine again on every frame of the idle screen.
  const idleCallback = useRef(onIdle);
  idleCallback.current = onIdle;
  useEffect(() => {
    if (phase.k !== "idle") return;
    idleCallback.current?.();
    void projectApi.unloadEngine().catch(() => {
      /* engine or file service gone — the session is over here regardless */
    });
  }, [phase.k]);

  // No target at all — a hand-typed address, or an app mounted with nothing after its prefix.
  // `projectsUrl` is st0's home page, the one screen where a project is chosen, so go there
  // rather than inventing a second picker this app would then have to keep in step.
  //
  // st0 itself no longer reaches this: its `main.tsx` draws that home page instead of mounting
  // the gate. This is the road for every OTHER app that mounts one — z0's editor today.
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

        /**
         * A project that belongs to NO repository takes the shortest road of the three, and
         * takes it first — before the libraries, and before pl8 is asked anything at all.
         *
         * `/@local/<workspace>/<projet>` names a folder that is already on this machine. There
         * is no short name to resolve, no URI to hand git, and nothing to clone; the two calls
         * below are the whole of it.
         *
         * **And no library repository is required**, which is the one place this road disagrees
         * with the two under it. The refusal below exists because an unresolved `@st0/…` ref
         * makes a song read as broken rather than as an account nobody finished setting up — but
         * a workspace with no repository mounts no submodule and is what a NEW account has:
         * `Examples`, seeded with the demos. Insisting on a library there would put the demos
         * behind the one piece of setup they exist to precede. A ref that does not resolve still
         * says so, on its own node.
         */
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
            // 404 is the workspace or the folder: a machine that answered perfectly well about
            // something it has not got. Its sentence IS the explanation, as everywhere else here.
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

        /**
         * The LIBRARIES, before anything about the project — including the bench.
         *
         * A workspace mounts this account's library repository as a submodule, and every
         * `@st0/…` ref in every chain resolves inside it. Without one, a song opens with every
         * shared module missing: it compiles, it draws, and it is wrong — which reads as a
         * broken song rather than as an account nobody finished setting up. Better to say so
         * before the clone than to let the machine spend thirty seconds first.
         */
        const libraries = await librariesRepo();
        if (cancelled) return;
        if (!libraries) return setPhase({ k: "no-libraries" });

        /**
         * The BENCH takes a road of its own, and takes it first.
         *
         * It has no repository — it is generated from the médiathèque's catalogue and
         * regenerated on every open — so every step below it is about something that does not
         * exist: a name pl8 could not resolve, a URI git could not clone, a workspace nothing
         * would have made. One call replaces all three.
         *
         * Reported as `cloning`, because from here it is the same thing: a visible wait while a
         * machine fetches a catalogue. The first one is the slow one.
         */
        // `app` as well as the name: the bench is a `.st0` project, so `/m9/@banc/…` names
        // nothing and must fall through to the ordinary road, where pl8 answers "no such
        // repository" — which is exactly what it is.
        if (app === "st0" && isBench(repoName)) {
          setPhase({
            k: "cloning",
            workspace: strings.benchWorkspace ?? "",
            phase: strings.benchFetching ?? "",
            percent: null,
          });
          // The project part goes with it: the SAME bench opens on the catalogue or on one
          // médiathèque chain, and the address is what says which.
          let bench: { workspace: string; project: string };
          try {
            bench = await projectApi.openBench(project, libraries.uri);
          } catch (e) {
            if (cancelled) return;
            // 409: a chain this machine has not got, or one whose own names collide with the
            // bench's furniture. The service's sentence IS the explanation — the same treatment
            // a project the repository does not hold gets, for the same reason.
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
        // First, because everything below is about a repository we cannot yet name to git.
        let repo: string;
        try {
          repo = (await repoByName(repoName)).uri;
        } catch (e) {
          if (cancelled) return;
          // pl8 answered "no such name" / "two of them" — a target problem, not a fault, and
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
          await projectApi.open(project, libraries.uri);
        } catch (e) {
          if (cancelled) return;
          // A refusal, not a fault: the service answered, and what it said is the whole story.
          // Probing it would ask whether it is reachable — it plainly is — and then show the
          // answer under the CORS banner, which is what made this look like st0's fault.
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

  // The account has no library repository. Not an error and not retryable: the answer was
  // clear, and re-asking it can only give the same one until somebody goes and sets it.
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

  /**
   * Inactive. Nothing is broken, nothing was lost, and the one move is to say you are back.
   *
   * "Reprendre" is exactly the Retry road below: `resolving` plus a bumped `attempt` re-runs the
   * whole setup — resolve, clone if the machine has since forgotten the workspace, `POST /open`.
   * Which is the reason this screen can be so plain: reopening a project is a road the gate
   * already had, and being idle only means taking it again.
   *
   * No automatic resume on the first click either. The point was to stop being a client of that
   * engine, and a tab that reconnected the moment a cat walked over the keyboard would have
   * spent twenty minutes achieving nothing.
   */
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
