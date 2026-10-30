// Home.tsx — what k7 draws when its address names NO project: the account's workspaces and the
// projects in them, the libraries, the shares. It holds the async — identity, the file
// service, and the two polls — for the presentational body beside it. The list is the SERVER's
// files and needs no engine. See ../../docs/projects.md.

import { Toaster } from "@studio/project-shell/toast";
import type {
  AccountLibrary,
  AccountWorkspace,
  ShareSummary,
} from "@studio/web-protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AskHostK7 } from "../AskHostK7";
import { m } from "../paraglide/messages.js";
import {
  homeAccountFiles,
  prefetchHome,
  takePrefetchedWorkspaces,
} from "../settings/accountFiles";
import { pollWhileVisible } from "../visiblePoll";
import { AccountBar } from "./AccountBar";
import { accountFiles, shares as sharesApi } from "./api";
import { useHomeCommandsChanged } from "./HomeCommandBar";
import { HomeShell } from "./HomeFrame";
import { WS_PARAM } from "./homeCommands";
import { PluginScanBar } from "./PluginScanBar";
import { ProjectsPane } from "./ProjectsPane";
import type { AccountFiles } from "./workspaceOps";

/** The médiathèque's own: brisk enough that a change from another replica shows, slow enough to cost nothing on a ten-row list. */
const POLL_MS = 3000;

// As this chunk arrives, which appMain starts beside the sign-in check: the list is then asked once the hello answers, not once the page mounts.
prefetchHome();

export function Home() {
  const [params, setParams] = useSearchParams();
  const openWs = params.get(WS_PARAM);

  const [workspaces, setWorkspaces] = useState<AccountWorkspace[]>([]);
  const [shares, setShares] = useState<ShareSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The account's file service, or null; `undefined` until asked — "none" is a refusal we draw, "looking" is not.
  const [fileService, setFileService] = useState<
    AccountFiles | null | undefined
  >(undefined);

  /** The account's files on the server, engine or none — and no `hold()`: a claim is a lease ON A PROJECT, which this page has none of. */
  useEffect(() => {
    let live = true;
    void homeAccountFiles().then((f) => live && setFileService(f));
    return () => {
      live = false;
    };
  }, []);

  // The libraries, read here for the notice and the workspace buttons; they are edited on their own page.
  const [libraries, setLibraries] = useState<AccountLibrary[] | undefined>(
    undefined,
  );
  useEffect(() => {
    if (fileService === undefined) return;
    if (fileService === null) return setLibraries([]);
    void accountFiles
      .libraries(fileService)
      .then((r) => setLibraries(r.libraries))
      .catch(() => setLibraries([]));
  }, [fileService]);

  // What was loaded last pass, per service. A token says "current", not "in hand" — hence it is set only after the list is.
  const seen = useRef<{ shares: string }>({ shares: "" });

  const loadShares = useCallback(async (rev: string) => {
    try {
      const r = await sharesApi.list();
      seen.current.shares = rev;
      setShares(r.shares);
    } catch {
      /* the card keeps what it held, and says so itself */
    }
  }, []);

  /** Reload everything next tick without waiting for a revision: a write from here already knows. */
  const changed = useCallback(() => {
    seen.current = { shares: "" };
  }, []);

  /** The project list is the file service's answer, over the account's workspaces on the server. */
  // What the last poll answered, as text: an unchanged list keeps its identity, so no row re-renders.
  const lastWorkspaces = useRef("");
  const loadWorkspaces = useCallback(async (m: AccountFiles) => {
    try {
      const next = await (takePrefetchedWorkspaces(m) ??
        accountFiles.workspaces(m));
      const text = JSON.stringify(next);
      if (text !== lastWorkspaces.current) {
        lastWorkspaces.current = text;
        setWorkspaces(next);
      }
      setError(null);
    } catch (e) {
      // The list IS the screen's subject: say it failed rather than draw an empty one.
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (fileService === undefined) return; // still probing: neither a list nor a refusal
    if (fileService === null) {
      setWorkspaces([]);
      setBusy(false);
      return;
    }
    let stop = false;
    const tick = async () => {
      if (!stop) await loadWorkspaces(fileService);
    };
    void tick();
    const stopPoll = pollWhileVisible(tick, POLL_MS);
    return () => {
      stop = true;
      stopPoll();
    };
  }, [fileService, loadWorkspaces]);

  /** What pl8 holds: the shares, which are its own bytes. A workspace is the file service's and is asked of it. */
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const { revision } = await sharesApi.revision();
        if (!stop && seen.current.shares !== revision)
          await loadShares(revision);
      } catch {
        /* idem */
      }
    };
    void tick();
    const stopPoll = pollWhileVisible(tick, POLL_MS);
    return () => {
      stop = true;
      stopPoll();
    };
  }, [loadShares]);

  /** Reload NOW after a write from here, or a just-created project would take three seconds to appear. */
  const reread = useCallback(() => {
    changed();
    if (fileService) void loadWorkspaces(fileService);
  }, [changed, fileService, loadWorkspaces]);

  // A command from the bar wrote to the workspaces: the list is read at once, not at the next poll.
  useHomeCommandsChanged(reread);

  /** Unfold a workspace, or go back to the list — `replace`, browsing three of them not being worth three back-button entries. */
  const open = useCallback(
    (name: string | null) => {
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          if (name) next.set(WS_PARAM, name);
          else next.delete(WS_PARAM);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return (
    <HomeShell>
      {/* Without this, `askConfirm` answers NO with no host to draw on and every destructive
          button on this page silently does nothing — see @studio/project-shell/ask. */}
      <AskHostK7 />
      {/* Where the page's passing notices are drawn. */}
      <Toaster dismissLabel={m["common.dismiss"]()} />

      {/* The desktop and Android apps' account, at the top of the page rather than in a title or native bar (projects/AccountBar.tsx). */}
      <AccountBar />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        {error && (
          <code className="mx-6 mt-3 overflow-x-auto rounded bg-muted px-2 py-1 text-xs text-red-400">
            {error}
          </code>
        )}

        <ProjectsPane
          workspaces={workspaces}
          shares={shares}
          busy={busy}
          openWs={openWs}
          fileService={fileService ?? null}
          onOpen={open}
          onChanged={changed}
          libraries={libraries}
        />
      </div>

      {/* The account's engine scanning its plugins, at the foot of the page and gone when it is done (PluginScanBar.tsx). */}
      <div className="shrink-0 border-t border-border bg-popover empty:hidden">
        <PluginScanBar />
      </div>
    </HomeShell>
  );
}
