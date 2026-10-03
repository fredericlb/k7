// RepoList.tsx — the account's workspaces, each with its projects indented: add one by SSH URI
// (which registers it with pl8 AND clones it), or open a project straight into a new tab.
// Presentational — the section holds the async and this file draws. See ../../docs/projects.md.

import { Badge } from "@frediverse/ui/badge";
import {
  CornerDownRight,
  FolderGit2,
  FolderPlus,
  HardDrive,
  Loader2,
  ServerOff,
  TriangleAlert,
} from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import type {
  AccountWorkspace,
  RepoProject,
  ShareSummary,
} from "@studio/web-protocol";
import { projectLabel } from "@studio/web-protocol/projects";
import { type DragEvent, useState } from "react";
import { parts } from "../i18nParts";
import { m } from "../paraglide/messages.js";
import { ImportWorkspace } from "./ImportWorkspace";
import { NewProject } from "./NewProject";
import { NewWorkspace } from "./NewWorkspace";
import { ProjectMenu } from "./ProjectMenu";
import { ProjectShares } from "./ProjectShares";
import { PublishWorkspace } from "./PublishWorkspace";
import { RemoveWorkspace } from "./RemoveWorkspace";
import { sharesOf } from "./sharesForProject";
import type { ImportProgress } from "./workspaceOps";

/** The folder's name without its suffix, with the path that places it in the workspace beside it. */
const nameOf = (p: RepoProject): string =>
  projectLabel(p.path.split("/").pop() ?? p.path);

/**
 * Where a copy of a project may land: every workspace but its own, minus the ones that ARE a
 * single project — those list nothing under them, so a copy in one would exist and never show.
 */
const targetsFor = (
  all: AccountWorkspace[],
  from: AccountWorkspace,
): AccountWorkspace[] =>
  all.filter((w) => w.name !== from.name && !w.isSingleProject);

/** The folder holding the project, or null when it sits at the workspace root. */
const parentOf = (p: RepoProject): string | null => {
  const cut = p.path.lastIndexOf("/");
  return cut > 0 ? p.path.slice(0, cut) : null;
};

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
  adding,
  progress,
  hasFileService,
  onImport,
  onCreateWorkspace,
  onPublish,
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
  onOpenSettings,
}: {
  /** Opens the settings PANEL beside this list — the key is read there, not on a page. */
  onOpenSettings: () => void;
  workspaces: AccountWorkspace[];
  busy: boolean;
  error: string | null;
  /** Where the running clone is, in git's own words, or null. */
  adding: string | null;
  /** …and which of the import's steps it is on, for the dialog's bar. */
  progress: ImportProgress | null;
  hasFileService: boolean;
  /** Clone a repository onto the server — the Import button's act. */
  onImport: (uri: string) => Promise<void>;
  /** A workspace of one's own, git-initialised here with no repository behind it and nothing in it. */
  onCreateWorkspace: (
    workspace: string,
    onStep: (s: string) => void,
  ) => Promise<void>;
  /** Its first repository: the remote and the push — offered on a local workspace only. */
  onPublish: (
    ws: AccountWorkspace,
    uri: string,
    onStep: (s: string) => void,
  ) => Promise<void>;
  onOpen: (ws: AccountWorkspace) => void;
  /** Why create and delete are impossible, or "" — both go through the file service, which is also what READS this list (../../docs/projects.md). */
  blocked: string;
  /** What stops a workspace being MADE or IMPORTED, on top of `blocked` — the account's library, which everything in one resolves through. */
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
  /** Rename a project's folder in place — the SAME workspace commits, and pushes if it has a repository. */
  onRename: (
    ws: AccountWorkspace,
    project: RepoProject,
    folder: string,
    onStep: (s: string) => void,
  ) => Promise<void>;
  /** Copy a project into ANOTHER workspace — the destination commits, and pushes if it has a repository. */
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
}) {
  // Which row the pointer is over, so exactly one lights up — a boolean would light them all.
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4 p-6">
      {/* The two ways one appears, side by side: made here, or brought back from a repository. */}
      <div className="flex items-center gap-2">
        <NewWorkspace blocked={blockedWorkspace} onCreate={onCreateWorkspace} />
        <ImportWorkspace
          blocked={blockedWorkspace}
          step={adding}
          progress={progress}
          onImport={onImport}
        />
      </div>

      {error && (
        <code className="max-w-full overflow-x-auto rounded bg-muted px-2 py-1 text-xs text-red-400">
          {error}
        </code>
      )}

      {!hasFileService ? (
        // With no file service there is no list, and an empty one would read as a new account.
        <div className="flex flex-col items-center gap-2 rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
          <ServerOff className="h-5 w-5 text-amber-500" />
          <span>{m["repos.noFilesTitle"]()}</span>
          <span className="text-xs">
            {parts((h) => m["repos.noFilesAside"](h), {
              settings: (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="underline"
                >
                  {m["repos.settingsWord"]()}
                </button>
              ),
            })}
          </span>
        </div>
      ) : workspaces.length === 0 ? (
        <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />{" "}
              {m["common.loading"]()}
            </span>
          ) : (
            parts((h) => m["repos.empty"](h), {
              new: <strong>{m["repos.newWord"]()}</strong>,
              import: <strong>{m["repos.importWord"]()}</strong>,
              key: (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="underline"
                >
                  {m["repos.deployKeyWord"]()}
                </button>
              ),
            })
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {workspaces.map((w) => (
            <li
              key={w.name}
              className={cn(
                "flex flex-col rounded-md border border-border p-3",
                // The row lights up only for something it can actually take — see `DROPPABLE`.
                over === w.name && "border-primary bg-primary/5",
              )}
              onDragOver={(e) => {
                if (!carriesFiles(e)) return;
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
                if (!carriesFiles(e)) return;
                e.preventDefault();
                setOver(null);
                onDropProject(w, Array.from(e.dataTransfer.files));
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => onOpen(w)}
                >
                  {/* A clone and a hand-made folder are not the same thing, and the icon says so before the URI below is read. */}
                  {w.origin ? (
                    <FolderGit2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <HardDrive className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{w.name}</span>
                      <Badge variant={w.projects.length ? "tag" : "default"}>
                        {m["repos.projectCount"]({
                          n: w.projects.length,
                          s: w.projects.length === 1 ? "" : "s",
                        })}
                      </Badge>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {w.origin ?? m["repos.hereOnly"]()}
                    </span>
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  {/* Inside the workspace's block, beside its contents: creating a project acts ON it, not on the list. */}
                  <NewProject
                    blocked={blocked}
                    onCreate={(folder, onStep, shape) =>
                      onCreate(w, folder, onStep, shape)
                    }
                  />
                  {/* A workspace with no repository has one gesture the others do not: getting one. */}
                  {!w.origin && (
                    <PublishWorkspace
                      workspace={w.name}
                      blocked={blocked}
                      onPublish={(uri, onStep) => onPublish(w, uri, onStep)}
                    />
                  )}
                  {/* Last, and discreet: the one act on this row that cannot be undone. */}
                  <RemoveWorkspace
                    workspace={w.name}
                    origin={w.origin ?? null}
                    blocked={blocked}
                    onRemove={() => onRemoveWorkspace(w)}
                  />
                </div>
              </div>

              {/* Nothing in it yet. The link opens the WORKSPACE, and the editor asks for the
                  first project there — see FirstProject.tsx. It is the only way in: with no
                  project there is no project row to click. */}
              {w.projects.length === 0 && (
                <a
                  className="mt-2 ml-2 flex w-fit items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent/50"
                  href={workspaceHref(w)}
                  target="_blank"
                  rel="noopener"
                  title={m["repos.openAndCreate"]({ name: w.name })}
                >
                  <FolderPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{m["repos.createFirst"]()}</span>
                </a>
              )}

              {/* The projects, indented under their workspace: a click goes straight into the app
                  that opens one, in a NEW TAB — this screen is a list you come back to
                  (../../docs/projects.md). */}
              {w.projects.length > 0 && (
                <ul className="mt-2 ml-2 flex flex-col border-l border-border pl-3">
                  {w.projects.map((p) => (
                    // The row holds the link AND the buttons: the link stretches, and each button's `preventDefault` stops it opening.
                    <li key={p.path} className="flex items-center gap-1">
                      <a
                        className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent/50"
                        title={m["repos.openProject"]({
                          path: p.path,
                          app: p.app,
                        })}
                        href={projectHref(w, p)}
                        target="_blank"
                        rel="noopener"
                      >
                        <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">
                          {p.path === "." ? projectLabel(w.name) : nameOf(p)}
                        </span>
                        <Badge variant="tag">{p.app}</Badge>
                        {parentOf(p) && (
                          <span className="truncate text-xs text-muted-foreground">
                            {parentOf(p)}
                          </span>
                        )}
                      </a>
                      {/* Before Supprimer: reading what you published comes ahead of the destructive act, and needs the file service (../../docs/projects.md). */}
                      <ProjectShares
                        label={p.path === "." ? w.name : nameOf(p)}
                        shares={sharesOf(shares, w.name, p.path)}
                        onChanged={onChanged}
                      />
                      {/* …and the three ACTS behind one ⋮: the row is a link first, and these are rare. */}
                      <ProjectMenu
                        path={p.path}
                        label={p.path === "." ? w.name : nameOf(p)}
                        app={p.app}
                        blocked={blocked}
                        targets={targetsFor(workspaces, w)}
                        onCopy={(to, folder, onStep) =>
                          onCopy(w, p, to, folder, onStep)
                        }
                        onRename={(folder, onStep) =>
                          onRename(w, p, folder, onStep)
                        }
                        onDelete={(onStep) => onDelete(w, p, onStep)}
                      />
                    </li>
                  ))}
                </ul>
              )}

              {/* A workspace whose portable address does not resolve opens through `@local`, which names the workspace's own folder. */}
              {w.origin && !w.uniqueName && (
                <span className="mt-2 flex items-start gap-1 text-xs text-amber-500">
                  <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    {m["repos.nameClash"]({ name: w.repoName ?? w.name })}
                  </span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
