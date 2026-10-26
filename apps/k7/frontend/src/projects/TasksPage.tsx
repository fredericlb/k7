// TasksPage.tsx — `/tasks`, a page of the home: every workspace's TODOS.md in one list, grouped by
// workspace, each task linking to the project its anchor names. READ-ONLY on purpose: a task is
// ticked inside its workspace, where the `task` commands run. See ../../docs/tasks.md.

import { Button } from "@frediverse/ui/button";
import {
  ArrowRight,
  ListChecks,
  Loader2,
  RefreshCw,
} from "@frediverse/ui/icons";
import { useCallback, useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";
import { findAccountFiles } from "../settings/accountFiles";
import { accountFiles, projectHref, workspaceHref } from "./api";
import { EmptyState } from "./EmptyState";
import { HomeShell } from "./HomeFrame";
import { PageFrame } from "./PageFrame";
import type { AccountFiles } from "./workspaceOps";
import {
  anchorProject,
  readAllTasks,
  type WorkspaceTasks,
} from "./workspaceTasks";

export function TasksPage() {
  // `undefined` while asked: "none answers" is drawn only once that is the answer.
  const [fileService, setFileService] = useState<
    AccountFiles | null | undefined
  >(undefined);
  useEffect(() => {
    let live = true;
    void findAccountFiles(false).then((f) => live && setFileService(f));
    return () => {
      live = false;
    };
  }, []);

  const [lists, setLists] = useState<WorkspaceTasks[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  // Read on arrival and on Refresh, not polled: N workspaces is N reads, and the list is visited rather than watched.
  const load = useCallback(async (f: AccountFiles) => {
    setLists(null);
    try {
      setLists(await readAllTasks(f, await accountFiles.workspaces(f)));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setLists([]);
    }
  }, []);
  useEffect(() => {
    if (fileService) void load(fileService);
  }, [fileService, load]);

  const open = (lists ?? []).reduce(
    (n, l) => n + l.tasks.filter((t) => !t.done).length,
    0,
  );
  // A workspace with nothing to show under the current filter is left out rather than drawn empty.
  const shown = (lists ?? [])
    .map((l) => ({
      ...l,
      tasks: showDone ? l.tasks : l.tasks.filter((t) => !t.done),
    }))
    .filter((l) => l.tasks.length > 0 || l.error);

  return (
    <HomeShell>
      <PageFrame
        title={m["home.tasks"]()}
        summary={
          fileService && lists !== null
            ? m["tasks.openCount"]({ n: open })
            : undefined
        }
        // The page's own controls sit with its heading, as on Projects, not in the sidebar's foot.
        actions={
          fileService ? (
            <>
              <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground text-xs">
                <input
                  type="checkbox"
                  checked={showDone}
                  onChange={(e) => setShowDone(e.target.checked)}
                />
                {m["tasks.showDone"]()}
              </label>
              <Button
                size="sm"
                variant="secondary"
                disabled={lists === null}
                onClick={() => void load(fileService)}
                title={m["tasks.refresh"]()}
                aria-label={m["tasks.refresh"]()}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : undefined
        }
        narrow
      >
        {fileService === null ? (
          <p className="text-xs text-muted-foreground">
            {m["repos.noFilesTitle"]()}
          </p>
        ) : fileService === undefined || lists === null ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {m["tasks.reading"]()}
          </div>
        ) : (
          <>
            {error && (
              <code className="block overflow-x-auto rounded bg-muted px-2 py-1 text-destructive text-xs">
                {error}
              </code>
            )}
            {shown.length === 0 && !error && (
              // No act on the spot: a task is written inside its workspace, where the `task` commands run.
              <EmptyState icon={ListChecks}>{m["tasks.none"]()}</EmptyState>
            )}
            {shown.map(({ workspace: ws, tasks, error: wsError }) => (
              <section key={ws.name}>
                <h2 className="mb-1.5 flex items-center justify-between gap-2 text-sm font-medium">
                  <span className="truncate">{ws.name}</span>
                  {/* An ANCHOR, not a router link: a project is the router's basename, so opening one is a whole-page navigation. */}
                  <a
                    href={workspaceHref(ws)}
                    className="flex shrink-0 items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground"
                  >
                    {m["tasks.openWorkspace"]()}
                    <ArrowRight className="h-3 w-3" />
                  </a>
                </h2>
                {wsError && (
                  <code className="block overflow-x-auto rounded bg-muted px-2 py-1 text-xs text-red-400">
                    {wsError}
                  </code>
                )}
                {tasks.length > 0 && (
                  <ul className="divide-y divide-border rounded border border-border">
                    {tasks.map((t) => {
                      const p = anchorProject(ws, t.at);
                      return (
                        <li
                          key={t.line}
                          className="flex items-start gap-2 px-3 py-1.5 text-sm"
                        >
                          <span
                            className={
                              t.done
                                ? "min-w-0 flex-1 text-muted-foreground line-through"
                                : "min-w-0 flex-1"
                            }
                          >
                            {t.text}
                          </span>
                          {t.at &&
                            (p ? (
                              <a
                                href={projectHref(ws, p)}
                                className="shrink-0 font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                                title={m["tasks.openProject"]({
                                  path: p.path,
                                })}
                              >
                                {t.at.project} @ {t.at.timecode}
                              </a>
                            ) : (
                              // The anchor names a project the workspace no longer holds: said, not linked.
                              <span className="shrink-0 font-mono text-xs text-faint">
                                {t.at.project} @ {t.at.timecode}
                              </span>
                            ))}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ))}
          </>
        )}
      </PageFrame>
    </HomeShell>
  );
}
