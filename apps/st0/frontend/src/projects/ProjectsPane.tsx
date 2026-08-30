// ProjectsPane.tsx — the home page's body: the machine's workspaces, or the tree of whichever one
// is unfolded. It holds the async for the two presentational views beside it. Which one is open
// comes from the address (Home.tsx), not from local state. See ../../docs/projects.md.

import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import type {
  FileNode,
  MachineWorkspace,
  RepoProject,
  RepoSummary,
  ShareSummary,
} from "@studio/web-protocol";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  projects as api,
  engineMachine,
  projectHref,
  workspaceHref,
} from "./api";
import { LibrariesCard } from "./LibrariesCard";
import {
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
  repos,
  shares,
  busy,
  openWs,
  machine,
  lanUrls,
  onOpen,
  onChanged,
}: {
  /** What the machine holds, projects included — the only source, a project being a folder there. */
  workspaces: MachineWorkspace[];
  /** pl8's register — not a list to draw, but the other half of 'does this address resolve': a copy it ignores opens `@local`. */
  repos: RepoSummary[];
  /** Frozen snapshots published by `project share link` — the account's WHOLE list, cut up by the rows with `sharesOf`. */
  shares: ShareSummary[];
  busy: boolean;
  /** The unfolded workspace's name, taken from the address, or null for the list. */
  openWs: string | null;
  /** The chosen machine, or null when none answers — it is what READS the list, projects being its folders. */
  machine: Machine | null;
  /** Where a second device reaches this app — empty on the hosted build, whose origin already is one. */
  lanUrls: string[];
  onOpen: (name: string | null) => void;
  /** Call after any write, so the page reloads without waiting for the poll. */
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<FileNode[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const ws = workspaces.find((w) => w.name === openWs) ?? null;
  // The register by short name. A Map rather than a `find` per row, which every project re-runs.
  const registry = useMemo(
    () => new Map(repos.map((r) => [r.name, r])),
    [repos],
  );
  const registered = useMemo(() => new Set(registry.keys()), [registry]);
  /** The registered repository behind a workspace, or null — which is what makes removal possible. */
  const repoFor = useCallback(
    (w: MachineWorkspace) => (w.repoName && registry.get(w.repoName)) || null,
    [registry],
  );

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
        await api.add(uri);
        onChanged();
        await ensureWorkspace(chosen(), uri, (s) => setAdding(s));
      } finally {
        // The dialog reports its own failure and stays open; this only stops the row's narration.
        setAdding(null);
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

  /** …and its first repository. `api.add` is the register, passed in so the act stays one call. */
  const publish = useCallback(
    (w: MachineWorkspace, uri: string, onStep: (s: string) => void) => {
      setError(null);
      return publishWorkspace(chosen(), w.name, uri, onStep, (u) =>
        api.add(u).then(onChanged),
      );
    },
    [chosen, onChanged],
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

  /** Remove a repository from pl8's register and nothing else: the row stays, and what changes is the address. */
  const forgetRepo = useCallback(
    (r: RepoSummary) => {
      setError(null);
      void api
        .remove(r.id)
        .then(onChanged)
        .catch((e: Error) => setError(e.message));
    },
    [onChanged],
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
      <LibrariesCard />
      {ws ? (
        <RepoTree
          workspace={ws}
          nodes={nodes}
          onBack={() => onOpen(null)}
          projectHref={(path, app) =>
            projectHref(ws, { path, app }, registered)
          }
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
          repoFor={repoFor}
          onForget={forgetRepo}
          // Same departure as from the tree: the app's address, not a view local to here.
          projectHref={(w, p) => projectHref(w, p, registered)}
          workspaceHref={(w) => workspaceHref(w, registered)}
          // Shares COME OUT of a project, so they belong to its row rather than to a card below.
          shares={shares}
          onChanged={onChanged}
          // A surface is an address ONTO the running engine, so its row needs the machine itself.
          machine={machine}
          lanUrls={lanUrls}
        />
      )}
    </div>
  );
}
