// ProjectsPane.tsx — the home page's body: the machine's workspaces, or the tree of whichever one
// is unfolded. It holds the async for the two presentational views beside it. Which one is open
// comes from the address (Home.tsx), not from local state. See ../../docs/projects.md.

import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import type {
  FileNode,
  MachineWorkspace,
  RepoProject,
  ShareSummary,
} from "@studio/web-protocol";
import { useCallback, useEffect, useState } from "react";
import { engineMachine, projectHref, workspaceHref } from "./api";
import { LibrariesCard } from "./LibrariesCard";
import {
  copyProjectOnMachine,
  createLocalWorkspace,
  createProjectOnMachine,
  deleteProjectOnMachine,
  ensureWorkspace,
  type Machine,
  publishWorkspace,
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
}: {
  /** What the machine holds, projects included — the only source, a project being a folder there. */
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
  const blocked = machine
    ? ""
    : "aucune machine moteur joignable — un projet est un dossier sur la machine, et c'est elle qui les fait";

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
      if (gripe) setError(`${folder} créé, mais : ${gripe}`);
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
      if (gripe) setError(`${p.path} supprimé, mais : ${gripe}`);
    },
    [chosen, onChanged],
  );

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
      if (gripe) setError(`${folder} copié dans ${to.name}, mais : ${gripe}`);
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
      <LibrariesCard machine={machine} />
      {ws ? (
        <RepoTree
          workspace={ws}
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
          hasMachine={machine !== null}
          onImport={importRepo}
          onCreateWorkspace={createWorkspace}
          onPublish={publish}
          onOpen={(w) => onOpen(w.name)}
          blocked={blocked}
          onCreate={create}
          onDelete={removeProject}
          onRemoveWorkspace={removeWorkspace}
          onCopy={copyProject}
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
