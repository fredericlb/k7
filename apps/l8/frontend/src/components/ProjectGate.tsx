// ProjectGate.tsx — resolve the repository this editor was opened on into a folder on the
// engine's machine, cloning it if this machine has never seen it, then open the project and
// mount the editor. Runs after EngineGate. l8 picks nothing here: st0 owns the repositories,
// and arriving with no target sends you back there. See ../launch.ts and ../docs/launch.md.

import { Button } from "@frediverse/ui/button";
import { FolderGit2, Loader2, ServerCrash, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import App from "../App";
import type { FileServiceFault } from "../api";
import {
  api,
  configureFileApi,
  diagnoseFileService,
  MEDIATEK_URL,
} from "../api";
import { clearLaunch, type Launch, launchTarget } from "../launch";
import { m } from "../paraglide/messages.js";
import type { CloneJob, RankedEngine } from "../types";

/** st0 answers the origin root, so its Projets section is the bare origin plus a path. */
const PROJECTS_URL = `${MEDIATEK_URL.replace(/\/+$/, "")}/projects`;

/** How often the clone is asked how far it has got. Fast: it is the only thing on screen. */
const POLL_MS = 400;

type Phase =
  | { k: "resolving" }
  | { k: "cloning"; job: CloneJob }
  | { k: "error"; message: string; fault?: FileServiceFault; lines?: string[] }
  | { k: "open"; workspace: string; project: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ProjectGate({
  engine,
  onChangeEngine,
}: {
  engine: RankedEngine;
  /** Passed straight through to the settings menu: the engine choice belongs to the gate
   *  ABOVE this one, and a project has nothing to say about it. */
  onChangeEngine: () => void;
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

  // Every failure here is one of the same two, so a failed retry explains itself exactly as a failed load does.
  const fail = useCallback(
    async (e: Error) => {
      const fault = await diagnoseFileService(engine.fileBase);
      setPhase({ k: "error", message: e.message, fault });
    },
    [engine.fileBase],
  );

  /** Leave: unload the engine, forget the target, and go back to where projects live. */
  const quit = useCallback(() => {
    void api.unloadEngine().catch(() => {
      /* engine/file service gone — leaving is still right */
    });
    clearLaunch();
    window.location.href = PROJECTS_URL;
  }, []);

  // No target at all: this tab was opened by hand or the session was cleared. st0 is where
  // a project is chosen, so go there rather than inventing a picker this app no longer owns.
  useEffect(() => {
    if (!target) window.location.replace(PROJECTS_URL);
  }, [target]);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    const { repo, project } = target as Launch;
    void (async () => {
      // Catch: an unhandled rejection here leaves `phase` on "resolving" FOREVER — a spinner with no explanation.
      try {
        const me = await api.getMe();
        const userEmail = me?.email || me?.sub || "unknown";
        if (cancelled) return;
        setEmail(userEmail);
        configure(userEmail, ""); // base set; the workspace is what we are about to find

        let workspace = (await api.workspaceByRepo(repo)).workspace;
        if (cancelled) return;

        if (!workspace) {
          // Never cloned on this machine. Start it and follow it — this is the visible wait.
          let job = await api.startClone(repo);
          setPhase({ k: "cloning", job });
          while (!job.done) {
            await sleep(POLL_MS);
            if (cancelled) return;
            job = await api.cloneStatus(job.id);
            setPhase({ k: "cloning", job });
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
        // "." means the repository itself is the project; the file service already reads it that way.
        await api.open(project);
        if (cancelled) return;
        setPhase({ k: "open", workspace, project });
      } catch (e) {
        if (cancelled) return;
        // "NetworkError…" covers both a refused origin and a dead service, and the two need opposite fixes — so ask.
        await fail(e as Error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configure, fail, target, attempt]);

  if (phase.k === "open")
    // key by workspace+project so moving between them remounts the editor cleanly.
    return (
      <App
        key={`${phase.workspace}/${phase.project}`}
        engineUrl={engine.wsUrl!}
        // What this link measured, for the status bar. Passed down rather than re-probed:
        // the gate already paid for the round trip, and a second one would report a
        // different number for the same connection.
        engineLatency={engine.latency}
        // The RAW email, not a slug: sessionFor does the slugging, so this half and the
        // file service cannot drift on how it is spelled. See engine-protocol/sessions.
        userEmail={email}
        onQuitWorkspace={quit}
        onChangeEngine={onChangeEngine}
      />
    );

  if (phase.k === "cloning") {
    const { job } = phase;
    return (
      <div className="flex h-full items-center justify-center bg-background p-8 text-foreground">
        <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
          <FolderGit2 className="h-10 w-10 text-muted-foreground" />
          <h1 className="text-lg font-semibold">
            {m["project.cloning"]({ workspace: job.workspace })}
          </h1>
          <p className="text-sm text-muted-foreground">{job.phase}</p>
          {/* A bar only when git can measure; a counter it cannot fill is worse than none. */}
          <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
            <div
              className={
                job.percent === null
                  ? "h-full w-1/3 animate-pulse bg-primary"
                  : "h-full bg-primary transition-all"
              }
              style={
                job.percent === null ? undefined : { width: `${job.percent}%` }
              }
            />
          </div>
        </div>
      </div>
    );
  }

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
              ? m["filesGate.blockedTitle"]()
              : m["filesGate.title"]()}
          </h1>
          <p className="text-sm text-muted-foreground">
            {phase.fault === "blocked"
              ? m["filesGate.blockedBody"]({ origin: window.location.origin })
              : phase.fault === "unreachable"
                ? m["filesGate.downBody"]({ base: engine.fileBase ?? "?" })
                : // The probe didn't run (a clone failed, not the service) — the message below is the whole story.
                  m["filesGate.body"]()}
          </p>
          <code className="max-w-full overflow-x-auto whitespace-pre-wrap text-left rounded bg-muted px-2 py-1 text-xs">
            {phase.lines?.length ? phase.lines.join("\n") : phase.message}
          </code>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setPhase({ k: "resolving" });
                setAttempt((n) => n + 1);
              }}
            >
              Retry
            </Button>
            <Button variant="ghost" onClick={quit}>
              {m["project.backToProjects"]()}
            </Button>
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
