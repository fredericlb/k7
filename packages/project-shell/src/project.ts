// project.ts — the file-service routes every project app needs: resolving a repository to a
// workspace on this machine, the tree and the files in it, the compiled views the engine and
// the graph are drawn from, and the repository's git. st0 spreads this into its own client and
// adds what only it has (timeline, waveforms, video); z0's editor uses it as it stands.

import type { ProjectDoc } from "@studio/engine-protocol/project";
import type { WebGraph } from "@studio/graph-model";
// The wire shape only, type-only, so nothing of the parser that walks a disk ships here.
import type { ProjectSurfaces } from "@studio/song-schema/yaml/surfaceFile";
import type {
  Alternatives,
  CatalogueModule,
  ChangedFile,
  CloneJob,
  CommandInfo,
  FileContent,
  FileNode,
  ForkedModule,
  GitCommitResult,
  GitPullResult,
  GitStatus,
  Hints,
  HistoryState,
  IoPort,
  ModuleLibrary,
  ModulePresetsFile,
  ModuleUiFile,
  ProjectErrors,
  ProjectInfo,
  UndoResult,
  WebPreferences,
  WebProject,
  WebVideoProject,
  WorkspaceForRepo,
  WorkspaceInfo,
} from "@studio/web-protocol";
import { fget, fsend } from "./fileApi.ts";

/** A derived view a writing command may be asked to build — a list, see docs/fileApi.md. */
export type CommandWant = "graph";

export const projectApi = {
  // --- pl8 knows a REPOSITORY, this machine knows folders (file-service/docs/cloneJobs.md) ---
  workspaceByRepo: (uri: string) =>
    fget<WorkspaceForRepo>(
      `/workspaces/by-repo?uri=${encodeURIComponent(uri)}`,
    ),
  startClone: (uri: string) =>
    fsend<CloneJob>("POST", "/workspaces/clone", { uri }),
  cloneStatus: (id: string) => fget<CloneJob>(`/workspaces/clone/${id}`),
  /** The BENCH, INSTEAD of the three calls above — see docs/fileApi.md. */
  openBench: (project: string | undefined, libraries: string) =>
    fsend<{ workspace: string; project: string }>("POST", "/workspaces/bench", {
      // The account's library repository: every module the rig can name is in it.
      libraries,
      // What the address named, verbatim: the machine builds the bench, so the machine decides.
      project,
    }),

  // --- The open project ---------------------------------------------------------
  workspace: () => fget<WorkspaceInfo>("/workspace"),
  /** The module libraries this project can reach, nearest first — see docs/fileApi.md. */
  moduleLibraries: () =>
    fget<{ libraries: ModuleLibrary[] }>("/module-libraries"),
  /** The CHAINS a library holds: `ref` is what one is called, `path` where it is. */
  libraryChains: () =>
    fget<{ chains: { ref: string; path: string; nodes: string[] }[] }>(
      "/library-chains",
    ),
  /** …and the ASSEMBLY templates, the third family — packages/song/docs/assemblies.md. */
  libraryAssemblies: () =>
    fget<{ assemblies: { ref: string; path: string; file: string }[] }>(
      "/library-assemblies",
    ),
  /** Make an empty module in one: `root` is a path that call answered with, `rel` at least `<type>/<name>`. */
  createModule: (root: string, rel: string) =>
    fsend<{ path: string; dir: string }>("POST", "/module", { root, rel }),
  project: () => fget<ProjectInfo>("/project"),
  /** Scaffold a project in the OPEN workspace: `name` carries its suffix, `shape` is the archetype. */
  createProject: (shape: string, name: string) =>
    fsend<{ project: string }>("POST", "/project/create", { shape, name }),
  /** Open the project, and say which library repository to mount — see docs/fileApi.md. */
  open: (path: string, libraries?: string) =>
    fsend<WorkspaceInfo>("POST", "/open", { path, libraries }),
  unloadEngine: () => fsend<{ ok: true }>("POST", "/engine/unload", {}),

  /** Play a document this browser built, through the service so ONE thing writes to the engine. */
  sendEngineProject: (doc: ProjectDoc) =>
    fsend<{ ok: true }>("POST", "/engine/project", { doc }),

  // --- Derived views. A cheap token changes when the sources do; poll it, not these. ---
  revision: () => fget<{ rev: string }>("/revision"),
  projectDoc: () => fget<WebProject>("/project-doc"),
  // The compiled document the ENGINE takes, for a surface that drives one itself — the desk.
  engineDoc: () => fget<ProjectDoc>("/engine-doc"),
  // The same folder read as PICTURE, by a second compiler — see docs/fileApi.md.
  videoDoc: () => fget<WebVideoProject>("/video-doc"),
  videoErrors: () => fget<ProjectErrors>("/video-errors"),
  graph: () => fget<WebGraph>("/graph"),
  /** The graph of a library CHAIN, by the path `/library-chains` gave — the builder's drawing. */
  graphAt: (path: string) =>
    fget<WebGraph>(`/graph?at=${encodeURIComponent(path)}`),
  // The project's `surfaces/` folder, parsed, and empty for almost every project — packages/song/docs/surfaces.md.
  surfaces: () => fget<ProjectSurfaces>("/surfaces"),
  projectErrors: () => fget<ProjectErrors>("/project-errors"),

  // --- The tree and the files in it ---------------------------------------------
  tree: () => fget<FileNode[]>("/tree"),
  read: (path: string) =>
    fget<FileContent>(`/file?path=${encodeURIComponent(path)}`),
  // Saving into the shared `_modules` library forks instead; `forked` says where — docs/fileApi.md.
  write: (path: string, content: string) =>
    fsend<{ ok: true; forked?: ForkedModule }>("PUT", "/file", {
      path,
      content,
    }),
  fmt: (path: string) => fsend<FileContent>("POST", "/fmt", { path }),
  createFolder: (dir: string, name: string) =>
    fsend<{ path: string }>("POST", "/folder", { dir, name }),
  renameFile: (path: string, name: string) =>
    fsend<{ path: string }>("POST", "/rename", { path, name }),
  moveFile: (path: string, toDir: string) =>
    fsend<{ path: string }>("POST", "/move", { path, toDir }),
  // Recycled, not erased — reversible, but no longer listed or startable.
  deleteFile: (path: string) =>
    fsend<{ recycled: string }>("POST", "/entry/delete", { path }),

  // --- Modules, as a project sees them ------------------------------------------
  hints: () => fget<Hints>("/hints"),
  /** The refs a node may be an instance of, each with the name it CALLS itself — packages/song/docs/moduleLabel.md. */
  baseModules: () =>
    fget<
      { ref: string; label?: string; panel?: { cols: number; rows: number } }[]
    >("/base-modules"),
  ioPorts: () => fget<IoPort[]>("/io-ports"),
  moduleCatalogue: () => fget<CatalogueModule[]>("/module-catalogue"),
  moduleUi: (path: string) =>
    fget<ModuleUiFile>(`/module-ui?path=${encodeURIComponent(path)}`),
  modulePresets: (path: string) =>
    fget<ModulePresetsFile>(`/module-presets?path=${encodeURIComponent(path)}`),
  cloneModule: (path: string, newName: string) =>
    fsend<{ path: string }>("POST", "/module/clone", { path, newName }),
  // `node` is optional: without one the service names it `<module>_<n>` (see `freeNodeName`).
  createNode: (path: string, node?: string) =>
    fsend<{ path: string }>("POST", "/node", {
      path,
      ...(node ? { node } : {}),
    }),

  // --- The repository's git. A workspace IS one clone, so none of this needs a project. ---
  gitStatus: () => fget<GitStatus>("/git/status"), // fetches, so callers poll it rarely
  alternatives: () => fget<Alternatives>("/git/alternatives"),
  gitCommit: (message: string) =>
    fsend<GitCommitResult>("POST", "/git/commit", { message }),
  gitPull: () => fsend<GitPullResult>("POST", "/git/pull", {}),

  // --- The CLI's own verbs, which the command bar dispatches through ------------
  commands: () => fget<CommandInfo[]>("/commands"),
  complete: (line: string) =>
    fget<string[]>(`/complete?line=${encodeURIComponent(line)}`),
  /** Run a verb; `want`, `graph`, `rev`, `refused` and `changed` are all in docs/fileApi.md. */
  command: (
    line: string,
    // `at` points the verbs at another folder — a path this caller was GIVEN, never one it built.
    opts?: { at?: string; want?: CommandWant[] },
  ) =>
    fsend<{
      output: string[];
      refused?: boolean;
      graph?: WebGraph;
      rev?: string;
      changed?: ChangedFile[];
    }>("POST", "/command", {
      line,
      ...(opts?.at ? { at: opts.at } : {}),
      ...(opts?.want ? { want: opts.want } : {}),
    }),

  // --- The project-wide undo/redo journal, driven by Ctrl+Z / Ctrl+Y ------------
  historyState: () => fget<HistoryState>("/history"),
  // `confirm` applies a process step; without it one comes back `needsConfirm` for the client to gate.
  undo: (confirm?: boolean) => fsend<UndoResult>("POST", "/undo", { confirm }),
  redo: (confirm?: boolean) => fsend<UndoResult>("POST", "/redo", { confirm }),

  // --- This machine's preferences, and the merged engine + file-service log -----
  preferences: () => fget<WebPreferences>("/preferences"),
  setVim: (vim: boolean) =>
    fsend<{ vim: boolean }>("PUT", "/preferences/vim", { vim }),
  logs: (offset?: number, tail = 300) =>
    fget<{ offset: number; lines: string[] }>(
      offset != null ? `/logs?offset=${offset}` : `/logs?tail=${tail}`,
    ),
};
