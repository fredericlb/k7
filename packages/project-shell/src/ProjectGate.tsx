// ProjectGate.tsx — resolve the repository this app was opened on into a folder on the
// engine's machine, cloning it if that machine has never seen it, then open the project and
// render the app. No app picks anything here: a project is chosen on k7's home page, and
// arriving with no target sends you back there. See docs/launch.md.

import {
  FolderGit2,
  FolderSearch,
  LibraryBig,
  Loader2,
  Moon,
  ServerCrash,
  ShieldAlert,
  UserRoundX,
} from "@frediverse/ui/icons";
import {
  isBench,
  isLocal,
  localTarget,
  type ProjectApp,
} from "@studio/web-protocol/projects";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  EngineLoadScreen,
  type EngineLoadStrings,
} from "./EngineLoadScreen.tsx";
import {
  configureFileApi,
  diagnoseFileService,
  type FileServiceFault,
} from "./fileApi.ts";
import { fileRoutes } from "./files.ts";
import {
  anotherTabActive,
  IDLE_TIMEOUT_MS,
  sleepMove,
  useIdleTimeout,
} from "./idle.ts";
import { parseLaunch, projectsUrl } from "./launch.ts";
import { accountLibraries } from "./repoLookup.ts";

/** How often the clone is asked how far it has got. Fast: it is the only thing on screen. */

type Phase =
  | { k: "resolving" }
  | { k: "cloning"; workspace: string; phase: string; percent: number | null }
  | { k: "error"; message: string; fault?: FileServiceFault; lines?: string[] }
  // The machine answered and has no such folder — its own screen, see docs/launch.md.
  | { k: "missing"; message: string }
  // The account has no library repository, so nothing resolves and nothing retries — docs/launch.md.
  | { k: "no-libraries" }
  // The workspace opened and holds no project at all — the host app's wizard, see docs/launch.md.
  | { k: "empty"; workspace: string }
  // Nobody has touched this tab for a long time; the one button reopens it — see docs/idle.md.
  /** `why` decides whether waking is automatic: a tab put behind another wakes itself. */
  | { k: "idle"; why: "timeout" | "hidden" }
  // Opened, and on its way to the engine — copied, applied, dry-run; see EngineLoadScreen.tsx.
  | { k: "loading"; workspace: string; project: string }
  | { k: "open"; workspace: string; project: string };

/** What the gate needs about its engine, structurally — see docs/launch.md. */
export interface GateEngine {
  fileBase: string | null | undefined;
  token: string | null | undefined;
  /** What the file service takes instead of `token`, when the server hosts the files — engine-browser's `fileTokenOf`. */
  fileToken?: string | null;
  /** The engine ITSELF, for its id, nested as `RankedEngine` already has it — docs/launch.md. */
  engine: { id: string };
  /** A new hub ticket when `fileToken` expires under an open session — the app's `freshTicket`; absent with no hub. */
  renewTicket?: () => Promise<string | null>;
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
  /** A workspace holding no project at all — a state a NEW workspace can be left in, docs/launch.md. */
  emptyWorkspace?: string;
  /** The idle screen. Optional like the bench's, and for the same reason — docs/launch.md. */
  idleTitle?: string;
  idleBody?: string;
  resume?: string;
  /** The wait for the engine after the project opened; English when an app passes none. */
  loading?: EngineLoadStrings;
}

/**
 * What a workspace with no project in it says. Not a fault and not a missing project: the
 * workspace opened, and there is nothing in it yet — the home page is where one is added.
 */
const EMPTY_WORKSPACE =
  "this workspace holds no project yet — add one from the projects page";

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
  renderEmpty,
  renderNoLibraries,
  idleTimeoutMs = 0,
  asleep = false,
  onIdle,
  onResume,
}: {
  engine: GateEngine;
  /** Which app this is — it decides the suffix that ends the project in the address. */
  app: ProjectApp;
  /** Where this app is mounted — vite's `import.meta.env.BASE_URL`, handed over, docs/launch.md. */
  base: string;
  /** Each app owns its own wording (k7 has paraglide, z0's editor is French in place). */
  strings: ProjectGateStrings;
  /** Rendered once the project is open — the app itself. */
  children: (ctx: {
    workspace: string;
    project: string;
    userEmail: string;
    quit: () => void;
  }) => ReactNode;
  /**
   * What to draw for a workspace holding NO project — k7 puts its first-project wizard here.
   * `onCreated` re-runs the whole resolve, so the gate opens whatever was just made rather than
   * being told about it. Without it, a sentence and the way back. See docs/launch.md.
   */
  renderEmpty?: (ctx: {
    workspace: string;
    onCreated: () => void;
  }) => ReactNode;
  /** What to draw when the account has NO library — k7 puts the card that adds one here; `onAdded` re-runs the resolve. */
  renderNoLibraries?: (ctx: { onAdded: () => void }) => ReactNode;
  /** Close the session after this long untouched; `0` — the default — is off. See docs/idle.md. */
  idleTimeoutMs?: number;
  /** The project is out of sight — a tab behind another. Same closing, and it reopens by itself. */
  asleep?: boolean;
  /** Whatever the APP holds and the gate cannot see — k7's engine lease. See docs/idle.md. */
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
              message:
                "@local opens a project in a workspace on this machine — `/@local/<workspace>/<projet>`.",
            });
          configure(userEmail, local.workspace);
          // No library is not a refusal here: a song started on this machine may extend nothing
          // shared, and the project's own "unresolved reference" is the better complaint.
          try {
            await fileRoutes.open(local.project);
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
            workspace: strings.benchWorkspace ?? "",
            phase: strings.benchFetching ?? "",
            percent: null,
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
              setPhase({ k: "missing", message: (e as Error).message });
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

        // Everything else is an address from BEFORE: `/<dépôt>/<projet>`, which read a short
        // name against pl8's register. There is no register — a project is a folder on the
        // machine that holds it — so this refuses rather than guessing which folder was meant.
        // See apps/k7/frontend/docs/projects.md.
        return setPhase({
          k: "missing",
          message:
            `« ${repoName} » is a repository name, and this studio no longer keeps a register ` +
            "of those: a project is a folder on this machine. Open it from the home page — " +
            "its address will be `/@local/<espace de travail>/<projet>`.",
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

  if (phase.k === "loading") {
    const { workspace, project } = phase;
    return (
      <EngineLoadScreen
        strings={strings.loading}
        onReady={() => setPhase({ k: "open", workspace, project })}
        onFail={(message) => setPhase({ k: "error", message })}
      />
    );
  }

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
          {/* The way to ADD one, right here: a refusal that sends you elsewhere to fix it is a dead end. */}
          {renderNoLibraries && (
            <div className="w-full text-left">
              {renderNoLibraries({ onAdded: resume })}
            </div>
          )}
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

  // Nothing in the workspace. The host app draws the wizard if it has one, since what a first
  // project IS — which archetype, which suffix — is the app's vocabulary and not the gate's.
  if (phase.k === "empty")
    return (
      <>
        {renderEmpty ? (
          renderEmpty({ workspace: phase.workspace, onCreated: resume })
        ) : (
          <div className="flex h-full items-center justify-center bg-background p-8 text-foreground">
            <div className="flex max-w-md flex-col items-center gap-4 text-center">
              <FolderSearch className="h-10 w-10 text-amber-500" />
              <p className="text-muted-foreground text-sm">
                {strings.emptyWorkspace ?? EMPTY_WORKSPACE}
              </p>
              <button
                type="button"
                className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground text-sm"
                onClick={quit}
              >
                {strings.back}
              </button>
            </div>
          </div>
        )}
      </>
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
              onClick={resume}
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
