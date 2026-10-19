// ProjectsPane.tsx — the home page's body: the account's workspaces, or the tree of whichever one
// is unfolded. It holds the async for the two presentational views beside it. Which one is open
// comes from the address (Home.tsx), not from local state. See ../../docs/projects.md.

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
import { m } from "../paraglide/messages.js";
import { accountFiles, projectHref, workspaceHref } from "./api";
import { type DroppedProject, ImportProject } from "./ImportProject";
import { LibrariesNotice } from "./LibrariesNotice";
import { RepoList } from "./RepoList";
import { RepoTree } from "./RepoTree";
import { useWorkspaceSync } from "./useWorkspaceSync";
import {
  type AccountFiles,
  copyProject as copyProjectOp,
  createProject as createProjectOp,
  createWorkspace as createWorkspaceOp,
  deleteProject as deleteProjectOp,
  renameProject as renameProjectOp,
} from "./workspaceOps";

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
  // A warning that is not a failure — the library modules a project just created still owes.
  const [notice, setNotice] = useState<string | null>(null);
  const [nodes, setNodes] = useState<FileNode[] | null>(null);
  const ws = workspaces.find((w) => w.name === openWs) ?? null;
  const { sync, reload: reloadSync } = useWorkspaceSync(
    fileService,
    workspaces,
  );

  /** What stops a write, in one sentence, or "". Said on the button rather than found on click. */
  const blocked = fileService ? "" : m["projects.noFilesBlocked"]();

  /** What the libraries cost the New workspace button. Still reading is not yet a refusal: the file service says no anyway. */
  const blockedWorkspace =
    blocked || (libraries?.length === 0 ? m["ws.needLibraries"]() : "");

  /** The file service, or a refusal that reads — reaching here means it vanished between the dialog opening and the click. */
  const chosen = useCallback((): AccountFiles => {
    if (!fileService) throw new Error(blocked);
    return fileService;
  }, [fileService, blocked]);

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

  /** The demos back as they shipped; the list is read again, a deleted demo being back in it. */
  const resetExamples = useCallback(async () => {
    setError(null);
    try {
      await accountFiles.resetExamples(chosen());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      onChanged();
    }
  }, [chosen, onChanged]);

  /** A workspace made HERE, and EMPTY — the editor asks for the first project. */
  const createWorkspace = useCallback(
    async (workspace: string, onStep: (s: string) => void) => {
      setError(null);
      await createWorkspaceOp(chosen(), workspace, onStep);
      onChanged();
    },
    [chosen, onChanged],
  );

  const create = useCallback(
    async (
      w: AccountWorkspace,
      folder: string,
      onStep: (s: string) => void,
      shape: ProjectShape,
    ) => {
      const { project, missing } = await createProjectOp(
        chosen(),
        w.name,
        folder,
        onStep,
        shape,
      );
      setNotice(
        missing.length
          ? m["project.missingModules"]({
              project,
              modules: missing.join(", "),
            })
          : null,
      );
      onChanged();
    },
    [chosen, onChanged],
  );

  const removeProject = useCallback(
    async (
      w: AccountWorkspace,
      p: RepoProject,
      onStep: (s: string) => void,
    ) => {
      await deleteProjectOp(chosen(), w.name, p.path, onStep);
      onChanged();
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
      window.location.assign(projectHref(ws, { path: imported, app: "k7" }));
    setDropped(null);
    setImported(null);
  }, [workspaces, dropped, imported]);

  /** …and copying one across, into another workspace of the account. */
  const copyProject = useCallback(
    async (
      w: AccountWorkspace,
      p: RepoProject,
      to: AccountWorkspace,
      folder: string,
      onStep: (s: string) => void,
    ) => {
      await copyProjectOp(chosen(), w.name, p.path, to.name, folder, onStep);
      onChanged();
    },
    [chosen, onChanged],
  );

  /** …and renaming one in place. */
  const renameProject = useCallback(
    async (
      w: AccountWorkspace,
      p: RepoProject,
      folder: string,
      onStep: (s: string) => void,
    ) => {
      await renameProjectOp(chosen(), w.name, p.path, folder, onStep);
      onChanged();
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
          notice={notice}
          hasFileService={fileService !== null}
          onCreateWorkspace={createWorkspace}
          onOpen={(w) => onOpen(w.name)}
          blocked={blocked}
          blockedWorkspace={blockedWorkspace}
          onDropProject={dropProject}
          onCreate={create}
          onDelete={removeProject}
          onRemoveWorkspace={removeWorkspace}
          onResetExamples={resetExamples}
          onCopy={copyProject}
          onRename={renameProject}
          // Same departure as from the tree: the app's address, not a view local to here.
          projectHref={(w, p) => projectHref(w, p)}
          workspaceHref={(w) => workspaceHref(w)}
          // Shares COME OUT of a project, so they belong to its row rather than to a card below.
          shares={shares}
          onChanged={onChanged}
          sync={sync}
          onDownload={async (name, server) => {
            try {
              await accountFiles.downloadWorkspace(chosen(), name, server);
            } catch (e) {
              setError((e as Error).message);
            }
            onChanged();
            reloadSync();
          }}
          onMove={async (w, to) => {
            try {
              await accountFiles.moveWorkspace(chosen(), w.name, to);
            } catch (e) {
              setError((e as Error).message);
            }
            reloadSync();
          }}
          onCopyWorkspace={async (w, to) => {
            try {
              await accountFiles.copyWorkspace(chosen(), w.name, to);
            } catch (e) {
              setError((e as Error).message);
            }
            reloadSync();
          }}
        />
      )}
    </div>
  );
}
