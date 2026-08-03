// WorkspaceGate.tsx — choose the workspace before the editor mounts. Runs after EngineGate:
// points the file API at the chosen engine's file service, lists this user's workspaces,
// lets them pick or create one, then mounts the editor for it. Several tabs may open the
// same workspace — there is no single-tab lease.

import { Button } from "@frediverse/ui/button";
import { Loader2, ServerCrash, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import App from "../App";
import type { FileServiceFault } from "../api";
import { api, configureFileApi, diagnoseFileService } from "../api";
import { m } from "../paraglide/messages.js";
import type { RankedEngine } from "../types";
import { SshKeyPage } from "./SshKeyPage";
import { WorkspaceSelect } from "./WorkspaceSelect";

function storageKey(engineId: string): string {
  return `pistes.workspace.${engineId}`;
}
function remembered(engineId: string): string | null {
  try {
    return sessionStorage.getItem(storageKey(engineId));
  } catch {
    return null;
  }
}

type Phase =
  | { k: "loading" }
  | { k: "picking" }
  | { k: "error"; message: string; fault?: FileServiceFault }
  | { k: "chosen"; workspace: string };

export function WorkspaceGate({
  engine,
  onChangeEngine,
}: {
  engine: RankedEngine;
  /** Passed straight through to the settings menu: the engine choice belongs to the gate
   *  ABOVE this one, and a workspace has nothing to say about it. */
  onChangeEngine: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const [workspaces, setWorkspaces] = useState<
    Awaited<ReturnType<typeof api.listWorkspaces>>["workspaces"]
  >([]);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  // Bumped by Retry to re-run the setup effect below.
  const [attempt, setAttempt] = useState(0);
  // The SSH-key page is a sibling view of the picker (no router — gate state).
  const [showSshKey, setShowSshKey] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);

  // Configure the file API for this engine (workspace filled in on pick).
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

  // Every failure here is one of the same two, so a failed Refresh explains itself exactly as a failed load does.
  const fail = useCallback(
    async (e: Error) => {
      const fault = await diagnoseFileService(engine.fileBase);
      setPhase({ k: "error", message: e.message, fault });
    },
    [engine.fileBase],
  );

  const refresh = useCallback(async (): Promise<string[]> => {
    setBusy(true);
    try {
      const { workspaces: list } = await api.listWorkspaces();
      setWorkspaces(list);
      return list.map((w) => w.name);
    } finally {
      setBusy(false);
    }
  }, []);

  const choose = useCallback(
    (userEmail: string, name: string) => {
      configure(userEmail, name);
      try {
        sessionStorage.setItem(storageKey(engine.engine.id), name);
      } catch {
        /* private mode — won't survive a reload */
      }
      setPhase({ k: "chosen", workspace: name });
    },
    [configure, engine.engine.id],
  );

  // Quit the workspace: unload the engine, forget the pick, and show the picker again.
  const quit = useCallback(() => {
    void api.unloadEngine().catch(() => {
      /* engine/file service gone — quitting locally is still right */
    });
    try {
      sessionStorage.removeItem(storageKey(engine.engine.id));
    } catch {
      /* private mode */
    }
    setPhase({ k: "picking" });
    refresh().catch((e: Error) => void fail(e));
  }, [engine.engine.id, refresh, fail]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Catch: an unhandled rejection here leaves `phase` on "loading" FOREVER — a spinner with no explanation.
      try {
        const me = await api.getMe();
        const userEmail = me?.email || me?.sub || "unknown";
        if (cancelled) return;
        setEmail(userEmail);
        configure(userEmail, ""); // base set; workspace chosen below
        const names = await refresh();
        if (cancelled) return;
        const prev = remembered(engine.engine.id);
        if (prev && names.includes(prev)) {
          choose(userEmail, prev);
          return;
        }
        setPhase({ k: "picking" });
      } catch (e) {
        if (cancelled) return;
        // "NetworkError…" covers both a refused origin and a dead service, and the two need opposite fixes — so ask.
        await fail(e as Error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configure, refresh, choose, fail, engine.engine.id, attempt]);

  if (phase.k === "chosen")
    // key by workspace so switching remounts the editor cleanly.
    return (
      <App
        key={phase.workspace}
        engineUrl={engine.wsUrl!}
        // The RAW email, not a slug: sessionFor does the slugging, so this half and the
        // file service cannot drift on how it is spelled. See engine-protocol/sessions.
        userEmail={email}
        onQuitWorkspace={quit}
        onChangeEngine={onChangeEngine}
      />
    );

  if (phase.k === "loading")
    return (
      <div className="flex h-full items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
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
              ? m["filesGate.blockedTitle"]()
              : m["filesGate.title"]()}
          </h1>
          <p className="text-sm text-muted-foreground">
            {phase.fault === "blocked"
              ? m["filesGate.blockedBody"]({ origin: window.location.origin })
              : phase.fault === "unreachable"
                ? m["filesGate.downBody"]({ base: engine.fileBase ?? "?" })
                : // The probe itself didn't run (no base configured yet) — fall back
                  // to the old both-causes wording rather than guessing wrong.
                  m["filesGate.body"]()}
          </p>
          <code className="max-w-full overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
            {phase.message}
          </code>
          <Button
            variant="secondary"
            onClick={() => {
              setPhase({ k: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </Button>
        </div>
      </div>
    );

  if (showSshKey) return <SshKeyPage onBack={() => setShowSshKey(false)} />;

  return (
    <WorkspaceSelect
      workspaces={workspaces}
      loading={busy}
      cloning={cloning}
      cloneError={cloneError}
      onShowSshKey={() => setShowSshKey(true)}
      // refresh() rejects on the same failures, so it needs the same catch or the button silently does nothing.
      onRefresh={() => {
        refresh().catch((e: Error) => void fail(e));
      }}
      onPick={(name) => choose(email, name)}
      onCreate={(name) => {
        void (async () => {
          try {
            await api.createWorkspace(name);
          } catch {
            /* already exists / invalid — refresh shows the truth */
          }
          await refresh();
          choose(email, name);
        })().catch((e: Error) => void fail(e));
      }}
      onClone={(name, uri) => {
        void (async () => {
          setCloning(true);
          setCloneError(null);
          try {
            await api.cloneWorkspace(name, uri);
            await refresh();
            choose(email, name);
          } catch (e) {
            // A clone failure is the USER'S to fix, and git's stderr says which — show it inline, don't diagnose the service.
            setCloneError((e as Error).message);
          } finally {
            setCloning(false);
          }
        })();
      }}
    />
  );
}
