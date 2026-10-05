// ProjectsPane.tsx — the home page's body: the account's workspaces, or the tree of whichever one
// is unfolded. It holds the async for the two presentational views beside it. Which one is open
// comes from the address (Home.tsx), not from local state. See ../../docs/projects.md.

import { showToast } from "@studio/project-shell/toast";
import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import type {
  AccountLibrary,
  AccountWorkspace,
  FileNode,
  RepoProject,
  ShareSummary,
} from "@studio/web-protocol";
import { isDroppableProject } from "@studio/web-protocol/projects";
import { useCallback, useEffect, useState } from "react";
import { type GitReport, runGit } from "../components/GitBusy";
import { formatBytes } from "../components/UploadProgress";
import { m } from "../paraglide/messages.js";
import { accountFiles, projectHref, workspaceHref } from "./api";
import { type DroppedProject, ImportProject } from "./ImportProject";
import { LibrariesNotice } from "./LibrariesNotice";
import { RepoList } from "./RepoList";
import { RepoTree } from "./RepoTree";
import { useWorkspaceSync } from "./useWorkspaceSync";
import {
  type AccountFiles,
  copyProjectAndCommit,
  createLocalWorkspace,
  createProjectAndCommit,
  deleteProjectAndCommit,
  ensureWorkspace,
  type ImportProgress,
  publishWorkspace,
  pullWorkspace,
  pushWorkspace,
  renameProjectAndCommit,
} from "./workspaceOps";

/** A step callback that also feeds the git overlay's detail line. */
const narrate =
  (onStep: (s: string) => void, report: GitReport) =>
  (s: string): void => {
    onStep(s);
    report({ detail: s });
  };

export function ProjectsPane({
  workspaces,
  shares,
  busy,
  openWs,
  fileService,
  onOpen,
  onChanged,
  libraries,
}: {
  /** The origin's libraries as this account sees them, read by Home; they decide whether a workspace may be made. */
  libraries: AccountLibrary[] | undefined;
  /** The account's workspaces, projects included — the only source, a project being a folder there. */
  workspaces: AccountWorkspace[];
  /** Frozen snapshots published by `project share link` — the account's WHOLE list, cut up by the rows with `sharesOf`. */
  shares: ShareSummary[];
  busy: boolean;
  /** The unfolded workspace's name, taken from the address, or null for the list. */
  openWs: string | null;
  /** The account's file service, or null when it does not answer — it is what READS the list. */
  fileService: AccountFiles | null;
  onOpen: (name: string | null) => void;
  /** Call after any write, so the page reloads without waiting for the poll. */
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<FileNode[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const ws = workspaces.find((w) => w.name === openWs) ?? null;
  const { sync, refresh: refreshSync } = useWorkspaceSync(fileService);
  // A list that moved is a repository that moved: a project created, copied or deleted commits.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `workspaces` is the trigger, not an input.
  useEffect(() => refreshSync(), [workspaces]);

  /** What stops a write, in one sentence, or "". Said on the button rather than found on click. */
  const blocked = fileService ? "" : m["projects.noFilesBlocked"]();

  /** What the libraries cost the two workspace buttons. Still reading is not yet a refusal: the file service says no anyway. */
  const blockedWorkspace =
    blocked || (libraries?.length === 0 ? m["ws.needLibraries"]() : "");

  /** The file service, or a refusal that reads — reaching here means it vanished between the dialog opening and the click. */
  const chosen = useCallback((): AccountFiles => {
    if (!fileService) throw new Error(blocked);
    return fileService;
  }, [fileService, blocked]);

  /** Importing means registering it with pl8 AND THEN cloning it here — the clone is what makes it APPEAR. */
  const importRepo = useCallback(
    async (uri: string) => {
      setError(null);
      try {
        // Importing IS the clone: the workspace lands on this disk and opens by its
        // `@local` address, which the row then says in words — ../../docs/projects.md.
        await runGit(m["git.cloning"](), (report) =>
          ensureWorkspace(chosen(), uri, setAdding, (p) => {
            setProgress(p);
            report({ detail: p.detail, percent: p.percent });
          }),
        );
      } finally {
        // The dialog reports its own failure and stays open; this only stops the row's narration.
        setAdding(null);
        setProgress(null);
        onChanged();
      }
    },
    [chosen, onChanged],
  );

  /** Delete a workspace. Final: there is no bin a whole workspace fits in. */
  const removeWorkspace = useCallback(
    async (w: AccountWorkspace) => {
      setError(null);
      try {
        await accountFiles.removeWorkspace(chosen(), w.name);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        onChanged();
      }
    },
    [chosen, onChanged],
  );

  /** Compact a workspace's repository, and say what it gave back — or that origin refused the force-push. */
  const compactWorkspace = useCallback(
    async (w: AccountWorkspace) => {
      setError(null);
      try {
        const r = await runGit(m["git.compacting"]({ workspace: w.name }), () =>
          accountFiles.compactWorkspace(chosen(), w.name),
        );
        const freed = formatBytes(r.freed);
        showToast(
          r.pushError
            ? {
                message: m["ws.compactedNoPush"]({ freed, error: r.pushError }),
                variant: "error",
                duration: 15_000,
              }
            : { message: m["ws.compacted"]({ workspace: w.name, freed }) },
        );
      } catch (e) {
        setError((e as Error).message);
      } finally {
        onChanged();
        refreshSync();
      }
    },
    [chosen, onChanged, refreshSync],
  );

  /** The sync line's two buttons: what git said goes to the page's error line, the counts are asked again either way. */
  const pushOrPull = useCallback(
    async (message: string, act: () => Promise<string | null>) => {
      setError(null);
      try {
        const gripe = await runGit(message, act);
        if (gripe) setError(gripe);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        onChanged();
        refreshSync();
      }
    },
    [onChanged, refreshSync],
  );
  const push = useCallback(
    (w: AccountWorkspace) =>
      pushOrPull(m["git.commit"](), () =>
        pushWorkspace(chosen(), w.name, !w.origin),
      ),
    [pushOrPull, chosen],
  );
  const pull = useCallback(
    (w: AccountWorkspace) =>
      pushOrPull(m["git.pull"](), () => pullWorkspace(chosen(), w.name)),
    [pushOrPull, chosen],
  );

  /** A workspace made HERE: git, no repository, and EMPTY — the editor asks for the first project. */
  const createWorkspace = useCallback(
    async (workspace: string, onStep: (s: string) => void) => {
      setError(null);
      await createLocalWorkspace(chosen(), workspace, onStep);
      onChanged();
    },
    [chosen, onChanged],
  );

  /** …and its first repository, which is the remote and the push. */
  const publish = useCallback(
    (w: AccountWorkspace, uri: string, onStep: (s: string) => void) => {
      setError(null);
      return runGit(m["git.publishing"]({ workspace: w.name }), (report) =>
        publishWorkspace(chosen(), w.name, uri, narrate(onStep, report)),
      ).finally(refreshSync);
    },
    [chosen, refreshSync],
  );

  const create = useCallback(
    async (
      w: AccountWorkspace,
      folder: string,
      onStep: (s: string) => void,
      shape: ProjectShape,
    ) => {
      const { gripe } = await runGit(
        m["git.creatingProject"]({ name: folder }),
        (report) =>
          createProjectAndCommit(
            chosen(),
            w.name,
            folder,
            narrate(onStep, report),
            shape,
            !w.origin,
          ),
      );
      onChanged();
      // The project EXISTS; only the push failed. Throwing would invite a retry.
      if (gripe) setError(m["projects.createdBut"]({ folder, gripe }));
    },
    [chosen, onChanged],
  );

  const removeProject = useCallback(
    async (
      w: AccountWorkspace,
      p: RepoProject,
      onStep: (s: string) => void,
    ) => {
      const { gripe } = await runGit(
        m["git.deletingProject"]({ path: p.path }),
        (report) =>
          deleteProjectAndCommit(
            chosen(),
            w.name,
            p.path,
            narrate(onStep, report),
            !w.origin,
          ),
      );
      onChanged();
      if (gripe) setError(m["projects.deletedBut"]({ path: p.path, gripe }));
    },
    [chosen, onChanged],
  );

  // The drop being asked about, and what it produced — the popin is the only place either shows.
  const [dropped, setDropped] = useState<DroppedProject | null>(null);
  const [imported, setImported] = useState<string | null>(null);

  /** What a drop on a row does: take the one file this can import, and SAY so when there is none. */
  const dropProject = useCallback((w: AccountWorkspace, files: File[]) => {
    const file = files.find((f) => isDroppableProject(f.name));
    // The row lights up for any file — a dragover cannot read a name — so the refusal is said here.
    if (!file)
      return setError(m["importDrop.refused"]({ what: files[0]?.name ?? "" }));
    setError(null);
    setDropped({ file, workspace: w.name });
  }, []);

  /** Translate the dropped file into a project of its own. The bytes go up; nothing is left in the workspace. */
  const importDropped = useCallback(
    async (folder: string): Promise<string[]> => {
      if (!dropped) return [];
      const { project, log } = await accountFiles.importProjectFile(
        chosen(),
        dropped.workspace,
        dropped.file,
        folder,
      );
      setImported(project);
      // The row's project count is now wrong; the list re-reads rather than waiting for the poll.
      onChanged();
      return log;
    },
    [dropped, chosen, onChanged],
  );

  /** …and open what it wrote, in this tab like every other project link on this page. */
  const openImported = useCallback(() => {
    const ws = workspaces.find((w) => w.name === dropped?.workspace);
    if (ws && imported)
      window.location.assign(projectHref(ws, { path: imported, app: "st0" }));
    setDropped(null);
    setImported(null);
  }, [workspaces, dropped, imported]);

  /** …and copying one across: the DESTINATION is what commits, so it is its repository that decides the push. */
  const copyProject = useCallback(
    async (
      w: AccountWorkspace,
      p: RepoProject,
      to: AccountWorkspace,
      folder: string,
      onStep: (s: string) => void,
    ) => {
      const { gripe } = await runGit(
        m["git.copyingProject"]({ path: p.path, to: to.name }),
        (report) =>
          copyProjectAndCommit(
            chosen(),
            w.name,
            p.path,
            to.name,
            folder,
            narrate(onStep, report),
            !to.origin,
          ),
      );
      onChanged();
      // The copy IS there; only its push failed. Throwing would invite a retry that clobbers.
      if (gripe)
        setError(m["projects.copiedBut"]({ folder, to: to.name, gripe }));
    },
    [chosen, onChanged],
  );

  /** …and renaming one in place: the folder moves, and the SAME workspace commits and pushes it. */
  const renameProject = useCallback(
    async (
      w: AccountWorkspace,
      p: RepoProject,
      folder: string,
      onStep: (s: string) => void,
    ) => {
      const { gripe } = await runGit(
        m["git.renamingProject"]({ path: p.path, name: folder }),
        (report) =>
          renameProjectAndCommit(
            chosen(),
            w.name,
            p.path,
            folder,
            narrate(onStep, report),
            !w.origin,
          ),
      );
      onChanged();
      // Renamed, unpushed: the same rule the other three follow — say it, do not throw.
      if (gripe)
        setError(m["projects.renamedBut"]({ path: p.path, folder, gripe }));
    },
    [chosen, onChanged],
  );

  /** The unfolded workspace's tree, read off the file service — one request, no retry: it is a `readdir` on a disk that is there. */
  useEffect(() => {
    if (!openWs || !fileService) {
      setNodes(null);
      return;
    }
    let stop = false;
    setNodes(null);
    void accountFiles
      .workspaceTree(fileService, openWs)
      .then((n) => {
        if (!stop) setNodes(n);
      })
      .catch((e: Error) => {
        if (!stop) setError(e.message);
      });
    return () => {
      stop = true;
    };
  }, [openWs, fileService]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      {/* A project dropped on a row: what to call it, then what the translation cost. */}
      <ImportProject
        dropped={dropped}
        onImport={importDropped}
        onOpen={openImported}
        onClose={() => {
          setDropped(null);
          setImported(null);
        }}
      />
      {/* FIRST when it says anything: nothing else here works until a library is cloned. */}
      <LibrariesNotice libraries={libraries} />
      {ws ? (
        <RepoTree
          workspace={ws}
          files={fileService}
          nodes={nodes}
          onBack={() => onOpen(null)}
          projectHref={(path, app) => projectHref(ws, { path, app })}
        />
      ) : (
        <RepoList
          workspaces={workspaces}
          busy={busy}
          error={error}
          adding={adding}
          progress={progress}
          hasFileService={fileService !== null}
          onImport={importRepo}
          onCreateWorkspace={createWorkspace}
          onPublish={publish}
          onOpen={(w) => onOpen(w.name)}
          blocked={blocked}
          blockedWorkspace={blockedWorkspace}
          onDropProject={dropProject}
          onCreate={create}
          onDelete={removeProject}
          onRemoveWorkspace={removeWorkspace}
          onCompactWorkspace={compactWorkspace}
          sync={sync}
          onPush={push}
          onPull={pull}
          onCopy={copyProject}
          onRename={renameProject}
          // Same departure as from the tree: the app's address, not a view local to here.
          projectHref={(w, p) => projectHref(w, p)}
          workspaceHref={(w) => workspaceHref(w)}
          // Shares COME OUT of a project, so they belong to its row rather than to a card below.
          shares={shares}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}
