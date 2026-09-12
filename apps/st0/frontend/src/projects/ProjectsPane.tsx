// ProjectsPane.tsx — the home page's body: the machine's workspaces, or the tree of whichever one
// is unfolded. It holds the async for the two presentational views beside it. Which one is open
// comes from the address (Home.tsx), not from local state. See ../../docs/projects.md.

import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import type {
  FileNode,
  MachineWorkspace,
  RepoProject,
  RepoRef,
  ShareSummary,
} from "@studio/web-protocol";
import { isDroppableProject } from "@studio/web-protocol/projects";
import { useCallback, useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";
import { engineMachine, projectHref, workspaceHref } from "./api";
import { BenchCard } from "./BenchCard";
import { type DroppedProject, ImportProject } from "./ImportProject";
import { LibrariesCard } from "./LibrariesCard";
import {
  copyProjectOnMachine,
  createLocalWorkspace,
  createProjectOnMachine,
  deleteProjectOnMachine,
  ensureWorkspace,
  type Machine,
  publishWorkspace,
  renameProjectOnMachine,
} from "./machine";
import { RepoList } from "./RepoList";
import { RepoTree } from "./RepoTree";

export function ProjectsPane({
  workspaces,
  shares,
  busy,
  openWs,
  machine,
  onOpen,
  onChanged,
  onOpenSettings,
}: {
  /** What the machine holds, projects included — the only source, a project being a folder there. */
  /** Forwarded to RepoList, whose prose points at the deploy key. */
  onOpenSettings: () => void;
  workspaces: MachineWorkspace[];
  /** Frozen snapshots published by `project share link` — the account's WHOLE list, cut up by the rows with `sharesOf`. */
  shares: ShareSummary[];
  busy: boolean;
  /** The unfolded workspace's name, taken from the address, or null for the list. */
  openWs: string | null;
  /** The chosen machine, or null when none answers — it is what READS the list, projects being its folders. */
  machine: Machine | null;
  onOpen: (name: string | null) => void;
  /** Call after any write, so the page reloads without waiting for the poll. */
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<FileNode[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const ws = workspaces.find((w) => w.name === openWs) ?? null;

  /** What stops a write, in one sentence, or "". Said on the button rather than found on click. */
  const blocked = machine ? "" : m["projects.noMachineBlocked"]();

  // The account's library, read by the card below and kept HERE: it also decides whether a
  // workspace may be made at all, and two reads would be two answers.
  const [libraries, setLibraries] = useState<RepoRef | null | undefined>(
    undefined,
  );
  /** …and what that costs the two workspace buttons. Still reading is not yet a refusal: the machine says no anyway. */
  const blockedWorkspace =
    blocked || (libraries === null ? m["ws.needLibraries"]() : "");

  /** The machine, or a refusal that reads — reaching here means it vanished between the dialog opening and the click. */
  const chosen = useCallback((): Machine => {
    if (!machine) throw new Error(blocked);
    return machine;
  }, [machine, blocked]);

  /** Importing means registering it with pl8 AND THEN cloning it here — the clone is what makes it APPEAR. */
  const importRepo = useCallback(
    async (uri: string) => {
      setError(null);
      try {
        // Importing IS the clone: the workspace lands on this disk and opens by its
        // `@local` address, which the row then says in words — ../../docs/projects.md.
        await ensureWorkspace(chosen(), uri, (s) => setAdding(s));
      } finally {
        // The dialog reports its own failure and stays open; this only stops the row's narration.
        setAdding(null);
        onChanged();
      }
    },
    [chosen, onChanged],
  );

  /** Take a workspace off the machine. Final: there is no bin a whole workspace fits in. */
  const removeWorkspace = useCallback(
    async (w: MachineWorkspace) => {
      setError(null);
      try {
        await engineMachine.removeWorkspace(chosen(), w.name);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        onChanged();
      }
    },
    [chosen, onChanged],
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

  /** …and its first repository, which is the remote and the push on the machine. */
  const publish = useCallback(
    (w: MachineWorkspace, uri: string, onStep: (s: string) => void) => {
      setError(null);
      return publishWorkspace(chosen(), w.name, uri, onStep);
    },
    [chosen],
  );

  const create = useCallback(
    async (
      w: MachineWorkspace,
      folder: string,
      onStep: (s: string) => void,
      shape: ProjectShape,
    ) => {
      const { gripe } = await createProjectOnMachine(
        chosen(),
        w.name,
        folder,
        onStep,
        shape,
        !w.origin,
      );
      onChanged();
      // The project EXISTS on the machine; only the push failed. Throwing would invite a retry.
      if (gripe) setError(m["projects.createdBut"]({ folder, gripe }));
    },
    [chosen, onChanged],
  );

  const removeProject = useCallback(
    async (
      w: MachineWorkspace,
      p: RepoProject,
      onStep: (s: string) => void,
    ) => {
      const { gripe } = await deleteProjectOnMachine(
        chosen(),
        w.name,
        p.path,
        onStep,
        !w.origin,
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
  const dropProject = useCallback((w: MachineWorkspace, files: File[]) => {
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
      const { project, log } = await engineMachine.importProjectFile(
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

  /** …and open what it wrote, in a new tab like every other project link on this page. */
  const openImported = useCallback(() => {
    const ws = workspaces.find((w) => w.name === dropped?.workspace);
    if (ws && imported)
      window.open(projectHref(ws, { path: imported, app: "st0" }), "_blank");
    setDropped(null);
    setImported(null);
  }, [workspaces, dropped, imported]);

  /** …and copying one across: the DESTINATION is what commits, so it is its repository that decides the push. */
  const copyProject = useCallback(
    async (
      w: MachineWorkspace,
      p: RepoProject,
      to: MachineWorkspace,
      folder: string,
      onStep: (s: string) => void,
    ) => {
      const { gripe } = await copyProjectOnMachine(
        chosen(),
        w.name,
        p.path,
        to.name,
        folder,
        onStep,
        !to.origin,
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
      w: MachineWorkspace,
      p: RepoProject,
      folder: string,
      onStep: (s: string) => void,
    ) => {
      const { gripe } = await renameProjectOnMachine(
        chosen(),
        w.name,
        p.path,
        folder,
        onStep,
        !w.origin,
      );
      onChanged();
      // Renamed on the machine, unpushed: the same rule the other three follow — say it, do not throw.
      if (gripe)
        setError(m["projects.renamedBut"]({ path: p.path, folder, gripe }));
    },
    [chosen, onChanged],
  );

  /** The unfolded workspace's tree, read off the machine — one request, no retry: it is a `readdir` on a disk that is there. */
  useEffect(() => {
    if (!openWs || !machine) {
      setNodes(null);
      return;
    }
    let stop = false;
    setNodes(null);
    void engineMachine
      .workspaceTree(machine, openWs)
      .then((n) => {
        if (!stop) setNodes(n);
      })
      .catch((e: Error) => {
        if (!stop) setError(e.message);
      });
    return () => {
      stop = true;
    };
  }, [openWs, machine]);

  // The libraries repository comes FIRST: nothing else here works until a new account has one.
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
      <LibrariesCard machine={machine} onRepo={setLibraries} />
      {/* Under the card that declares the library, because every module the rig can name is in it. */}
      <BenchCard libraries={libraries} />
      {ws ? (
        <RepoTree
          workspace={ws}
          nodes={nodes}
          onBack={() => onOpen(null)}
          projectHref={(path, app) => projectHref(ws, { path, app })}
        />
      ) : (
        <RepoList
          onOpenSettings={onOpenSettings}
          workspaces={workspaces}
          busy={busy}
          error={error}
          adding={adding}
          hasMachine={machine !== null}
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
