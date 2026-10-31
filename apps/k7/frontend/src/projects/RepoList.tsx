// RepoList.tsx — the account's workspaces, each with its projects indented: make a new one, or
// open a project straight into this tab. The page's heading and its two creates sit above them.
// Presentational — the section holds the async and this file draws. See ../../docs/projects.md.

import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Loader2,
  ServerOff,
} from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import type {
  AccountWorkspace,
  RepoProject,
  ShareSummary,
  WorkspaceSyncStatus,
} from "@studio/web-protocol";
import { EXAMPLES_WORKSPACE } from "@studio/web-protocol/projects";
import { type DragEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLocale } from "../i18n";
import { parts } from "../i18nParts";
import { m } from "../paraglide/messages.js";
import { SETTINGS_ROUTE } from "./api";
import { EmptyState } from "./EmptyState";
import { NewProject } from "./NewProject";
import { NewWorkspace } from "./NewWorkspace";
import { PAGE_COLUMN, PageHeader } from "./PageFrame";
import { ProjectRow } from "./ProjectRow";
import { ServerOnlyList } from "./ServerOnlyList";
import { WorkspaceMenu } from "./WorkspaceMenu";
import {
  syncEntryOf,
  syncStateOf,
  WorkspaceSyncIcon,
} from "./WorkspaceSyncIcon";

/** The bundled demos' workspace: listed last, folded, and taking no new project. See ../../docs/projects.md. */
const isExamples = (w: AccountWorkspace): boolean =>
  w.name === EXAMPLES_WORKSPACE;

/** The account's workspaces in the order the page lists them: as they come, Examples last. */
const examplesLast = (all: AccountWorkspace[]): AccountWorkspace[] =>
  [...all].sort((a, b) => Number(isExamples(a)) - Number(isExamples(b)));

/**
 * Where a copy of a project may land: every workspace but its own, minus the ones that ARE a
 * single project — those list nothing under them, so a copy in one would exist and never show.
 */
const targetsFor = (
  all: AccountWorkspace[],
  from: AccountWorkspace,
): AccountWorkspace[] =>
  all.filter(
    (w) => w.name !== from.name && !w.isSingleProject && !isExamples(w),
  );

/** "1 project" / "4 projects", the one place the count's plural is chosen. */
const projectsCount = (n: number): string =>
  (n === 1 ? m["repos.projects.one"] : m["repos.projects.other"])({ n });

/** …and the same for workspaces, in the heading's summary. */
const workspacesCount = (n: number): string =>
  (n === 1 ? m["repos.workspaces.one"] : m["repos.workspaces.other"])({ n });

/** A clock for "edited … ago", ticking once a minute: the list re-renders only when it changes otherwise. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * Is this drag carrying files at all? A dragover knows each item's KIND and its MIME type, never
 * its name — and a `.dawproject` has no MIME type — so every file drag lights the row up and the
 * DROP is where it is judged. What it does with something it cannot take is `onDropProject`'s.
 */
function carriesFiles(e: DragEvent): boolean {
  const items = Array.from(e.dataTransfer.items ?? []);
  return items.length
    ? items.some((i) => i.kind === "file")
    : e.dataTransfer.files.length > 0;
}

export function RepoList({
  workspaces,
  busy,
  error,
  notice = null,
  hasFileService,
  onCreateWorkspace,
  onOpen,
  blocked,
  blockedWorkspace,
  onDropProject,
  onCreate,
  onDelete,
  onRemoveWorkspace,
  onCopy,
  onRename,
  projectHref,
  workspaceHref,
  shares,
  onChanged,
  sync = null,
  onDownload,
}: {
  workspaces: AccountWorkspace[];
  busy: boolean;
  error: string | null;
  /** A warning in plain words, drawn amber rather than as an error. */
  notice?: string | null;
  hasFileService: boolean;
  /** A workspace of one's own, made on the server with nothing in it. */
  onCreateWorkspace: (
    workspace: string,
    onStep: (s: string) => void,
  ) => Promise<void>;
  onOpen: (ws: AccountWorkspace) => void;
  /** Why create and delete are impossible, or "" — both go through the file service, which is also what READS this list (../../docs/projects.md). */
  blocked: string;
  /** What stops a workspace being MADE, on top of `blocked` — the account's library, which everything in one resolves through. */
  blockedWorkspace: string;
  /** Files dropped ON a row: everything dropped, since which one is importable — and what to say
   *  when none is — belongs with the state that can report it (packages/translator/docs/import.md). */
  onDropProject: (ws: AccountWorkspace, files: File[]) => void;
  onCreate: (
    ws: AccountWorkspace,
    folder: string,
    onStep: (s: string) => void,
    /** `arrangement`, `mix` or `video`. See NewProject. */
    shape: ProjectShape,
  ) => Promise<void>;
  onDelete: (
    ws: AccountWorkspace,
    project: RepoProject,
    onStep: (s: string) => void,
  ) => Promise<void>;
  /** Rename a project's folder in place. */
  onRename: (
    ws: AccountWorkspace,
    project: RepoProject,
    folder: string,
    onStep: (s: string) => void,
  ) => Promise<void>;
  /** Copy a project into ANOTHER workspace. */
  onCopy: (
    ws: AccountWorkspace,
    project: RepoProject,
    to: AccountWorkspace,
    folder: string,
    onStep: (s: string) => void,
  ) => Promise<void>;
  /** A project's address in ITS app — an address and not an action: the row is a link, opening in a new tab. */
  projectHref: (ws: AccountWorkspace, project: RepoProject) => string;
  /** …and where the WORKSPACE opens, for a row that has no project to link to yet. */
  workspaceHref: (ws: AccountWorkspace) => string;
  /** Delete a whole workspace — the folder and everything in it. */
  onRemoveWorkspace: (ws: AccountWorkspace) => Promise<void>;
  /** Every share of the account, cut per row here (`sharesOf`) — pl8 returns the whole list, which saves a request per project. */
  shares: ShareSummary[];
  /** After a revocation, so the page re-reads without waiting for the poll. */
  onChanged: () => void;
  /** Where each workspace lives, on a machine with an active server; null draws no icon. */
  sync?: WorkspaceSyncStatus | null;
  /** Bring a workspace that is only on the active server down here. */
  onDownload?: (name: string) => Promise<void>;
}) {
  // Which row the pointer is over, so exactly one lights up — a boolean would light them all.
  const [over, setOver] = useState<string | null>(null);
  const now = useMinuteClock();
  const { locale } = useLocale();
  const projectTotal = workspaces.reduce((n, w) => n + w.projects.length, 0);
  const ordered = examplesLast(workspaces);
  // Folded unless it is all there is: a new account's page would otherwise open on nothing.
  const [examplesOpen, setExamplesOpen] = useState(false);
  const foldable = workspaces.length > 1;
  // Where the page's New project may land: not a workspace that IS one project, nor the demos'.
  const eligible = ordered.filter((w) => !w.isSingleProject && !isExamples(w));
  const createIn = (
    name: string,
    folder: string,
    onStep: (s: string) => void,
    shape: ProjectShape,
  ) => {
    const w = workspaces.find((x) => x.name === name);
    if (!w) return Promise.reject(new Error(name));
    return onCreate(w, folder, onStep, shape);
  };
  return (
    <div className={PAGE_COLUMN}>
      {/* The page names itself, and its one call to action is the act people come for: a project. */}
      <PageHeader
        title={m["home.projects"]()}
        summary={
          workspaces.length > 0
            ? `${projectsCount(projectTotal)} · ${workspacesCount(workspaces.length)}`
            : undefined
        }
        actions={
          <>
            <NewWorkspace
              blocked={blockedWorkspace}
              onCreate={onCreateWorkspace}
            />
            <NewProject
              primary
              blocked={blocked || blockedWorkspace}
              workspaces={eligible.map((w) => w.name)}
              onCreate={createIn}
            />
          </>
        }
      />

      {error && (
        <code className="max-w-full overflow-x-auto rounded bg-muted px-2 py-1 text-destructive text-xs">
          {error}
        </code>
      )}
      {notice && (
        <p className="rounded border border-amber-500/40 px-2 py-1 text-amber-500 text-xs">
          {notice}
        </p>
      )}

      {!hasFileService ? (
        // With no file service there is no list, and an empty one would read as a new account.
        <div className="flex flex-col items-center gap-2 rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
          <ServerOff className="h-5 w-5 text-amber-500" />
          <span>{m["repos.noFilesTitle"]()}</span>
          <span className="text-xs">
            {parts((h) => m["repos.noFilesAside"](h), {
              settings: (
                <Link to={SETTINGS_ROUTE} className="underline">
                  {m["repos.settingsWord"]()}
                </Link>
              ),
            })}
          </span>
        </div>
      ) : workspaces.length === 0 && busy ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> {m["common.loading"]()}
        </div>
      ) : workspaces.length === 0 ? (
        // The act itself, on the spot: the header has the same button, but an empty page is read from its middle.
        <EmptyState
          icon={Folder}
          actions={
            <NewWorkspace
              primary
              blocked={blockedWorkspace}
              onCreate={onCreateWorkspace}
            />
          }
        >
          {m["repos.empty"]()}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {ordered.map((w) => (
            <li
              key={w.name}
              className={cn(
                // A surface by its fill, not an outline (docs/shell.md); a ring only while a drop is over it.
                "flex flex-col rounded-lg bg-card p-3",
                // The row lights up only for something it can actually take — see `DROPPABLE`.
                over === w.name && "bg-primary/10 ring-1 ring-primary",
              )}
              onDragOver={(e) => {
                if (isExamples(w) || !carriesFiles(e)) return;
                // Both, or the browser opens the file instead — the default for a dropped file is navigation.
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                setOver(w.name);
              }}
              onDragLeave={(e) => {
                // Leaving for a CHILD is not leaving: the row's own dragover would set it straight back, flickering.
                if (e.currentTarget.contains(e.relatedTarget as Node | null))
                  return;
                setOver((o) => (o === w.name ? null : o));
              }}
              onDrop={(e) => {
                if (isExamples(w) || !carriesFiles(e)) return;
                e.preventDefault();
                setOver(null);
                onDropProject(w, Array.from(e.dataTransfer.files));
              }}
            >
              <div className="flex items-center justify-between gap-3">
                {isExamples(w) && foldable && (
                  <FoldToggle
                    open={examplesOpen}
                    onToggle={() => setExamplesOpen((o) => !o)}
                  />
                )}
                <button
                  type="button"
                  className="-mx-1.5 group flex min-w-0 flex-1 items-center gap-3 rounded-md px-1.5 py-1 text-left hover:bg-accent/60"
                  onClick={() => onOpen(w)}
                >
                  <Folder className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold">{w.name}</span>
                      <WorkspaceSyncIcon
                        state={syncStateOf(sync, w.name)}
                        server={
                          syncEntryOf(sync, w.name)?.server ??
                          sync?.server ??
                          null
                        }
                      />
                      {/* A count is read, not acted on: plain muted text, the violet being kept for what is selected. */}
                      <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                        {projectsCount(w.projects.length)}
                      </span>
                    </span>
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  {/* Inside the workspace's block, beside its contents: creating a project acts ON it, not on the list. */}
                  {!isExamples(w) && (
                    <NewProject
                      blocked={blocked}
                      workspaces={[w.name]}
                      onCreate={createIn}
                    />
                  )}
                  {/* The rare acts on the whole workspace, behind one ⋮ as on a project's row. */}
                  <WorkspaceMenu
                    workspace={w.name}
                    projectCount={w.projects.length}
                    blocked={blocked}
                    onRemove={() => onRemoveWorkspace(w)}
                  />
                </div>
              </div>

              {/* Nothing in it yet. The link opens the WORKSPACE, and the editor asks for the
                  first project there — see FirstProject.tsx. It is the only way in: with no
                  project there is no project row to click. */}
              {w.projects.length === 0 && !isExamples(w) && (
                <a
                  className="mt-2 ml-2 flex w-fit items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent/50"
                  href={workspaceHref(w)}
                  title={m["repos.openAndCreate"]({ name: w.name })}
                >
                  <FolderPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{m["repos.createFirst"]()}</span>
                </a>
              )}

              {/* The projects, indented under their workspace: a click goes straight into the app
                  that opens one, in THIS tab — the editor's back arrow returns here
                  (../../docs/projects.md). */}
              {w.projects.length > 0 &&
                !(isExamples(w) && foldable && !examplesOpen) && (
                  <ul className="mt-2 ml-2 flex flex-col border-l border-border pl-2">
                    {w.projects.map((p) => (
                      <ProjectRow
                        key={p.path}
                        workspace={w}
                        project={p}
                        href={projectHref(w, p)}
                        targets={targetsFor(ordered, w)}
                        blocked={blocked}
                        shares={shares}
                        onChanged={onChanged}
                        now={now}
                        locale={locale}
                        onCopy={(to, folder, onStep) =>
                          onCopy(w, p, to, folder, onStep)
                        }
                        onRename={(folder, onStep) =>
                          onRename(w, p, folder, onStep)
                        }
                        onDelete={(onStep) => onDelete(w, p, onStep)}
                      />
                    ))}
                  </ul>
                )}
            </li>
          ))}
        </ul>
      )}
      <ServerOnlyList sync={sync} onDownload={onDownload} />
    </div>
  );
}

/** The chevron that folds the Examples workspace — apart from the row's button, which opens it. */
function FoldToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      className="-mr-2 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      aria-expanded={open}
      aria-label={open ? m["repos.fold"]() : m["repos.unfold"]()}
      onClick={onToggle}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
