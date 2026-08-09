// project.ts — the file-service routes every project app needs: resolving a repository to a
// workspace on this machine, the tree and the files in it, the compiled views the engine and
// the graph are drawn from, and the repository's git. l8 spreads this into its own client and
// adds what only it has (timeline, waveforms, video); m9 uses it as it stands.

import type { ProjectDoc } from "@studio/engine-protocol/project";
import type { WebGraph } from "@studio/graph-model";
import type {
  Alternatives,
  CatalogueModule,
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

export const projectApi = {
  // --- Resolving what st0 named -------------------------------------------------
  // st0 knows a REPOSITORY; this machine knows folders. These three bridge that, cloning
  // when it has never seen one. See packages/file-service/docs/cloneJobs.md.
  workspaceByRepo: (uri: string) =>
    fget<WorkspaceForRepo>(
      `/workspaces/by-repo?uri=${encodeURIComponent(uri)}`,
    ),
  startClone: (uri: string) =>
    fsend<CloneJob>("POST", "/workspaces/clone", { uri }),
  cloneStatus: (id: string) => fget<CloneJob>(`/workspaces/clone/${id}`),
  /**
   * The module bench: made if absent, refreshed from the médiathèque either way.
   *
   * Instead of the three calls above, not beside them — the bench has no repository, so there is
   * no name to resolve and nothing to clone. `@banc` in the address is what routes here. It is
   * slow the first time (a full modules sync), which is why it replaces the clone's progress
   * screen rather than being asked for silently. See apps/st0/docs/banc.md.
   */
  openBench: () =>
    fsend<{ workspace: string; project: string }>(
      "POST",
      "/workspaces/bench",
      {},
    ),

  // --- The open project ---------------------------------------------------------
  workspace: () => fget<WorkspaceInfo>("/workspace"),
  project: () => fget<ProjectInfo>("/project"),
  open: (path: string) => fsend<WorkspaceInfo>("POST", "/open", { path }),
  unloadEngine: () => fsend<{ ok: true }>("POST", "/engine/unload", {}),

  // --- Derived views. A cheap token changes when the sources do; poll it, not these. ---
  revision: () => fget<{ rev: string }>("/revision"),
  projectDoc: () => fget<WebProject>("/project-doc"),
  // The compiled document the ENGINE takes, for an app that drives one itself — m9 fills its
  // decks' clips into this and sends it. l8 never calls it: the file service plays l8's project
  // on its own machine, so l8 has no document to hold.
  engineDoc: () => fget<ProjectDoc>("/engine-doc"),
  // The same folder read as PICTURE — v1's document. A `.l8` folder fails here and a `.v1`
  // folder fails at projectDoc: they are two compilers, not one route with a flag.
  videoDoc: () => fget<WebVideoProject>("/video-doc"),
  videoErrors: () => fget<ProjectErrors>("/video-errors"),
  graph: () => fget<WebGraph>("/graph"),
  projectErrors: () => fget<ProjectErrors>("/project-errors"),

  // --- The tree and the files in it ---------------------------------------------
  tree: () => fget<FileNode[]>("/tree"),
  read: (path: string) =>
    fget<FileContent>(`/file?path=${encodeURIComponent(path)}`),
  // Saving a file in the shared `_modules` library doesn't write there: it copies the module
  // into the project and repoints the chains at the copy, and `forked` says where the edit
  // actually landed. There is no opt-out — the catalogue is edited in the médiathèque.
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
  baseModules: () => fget<string[]>("/base-modules"),
  ioPorts: () => fget<IoPort[]>("/io-ports"),
  moduleCatalogue: () => fget<CatalogueModule[]>("/module-catalogue"),
  moduleUi: (path: string) =>
    fget<ModuleUiFile>(`/module-ui?path=${encodeURIComponent(path)}`),
  modulePresets: (path: string) =>
    fget<ModulePresetsFile>(`/module-presets?path=${encodeURIComponent(path)}`),
  cloneModule: (path: string, newName: string) =>
    fsend<{ path: string }>("POST", "/module/clone", { path, newName }),
  createModuleInstance: (path: string, instance: string) =>
    fsend<{ path: string }>("POST", "/module/instance", { path, instance }),

  // --- The repository's git. A workspace IS one clone, so none of this needs a project. ---
  // gitStatus fetches, so callers poll it rarely (l8 uses ten minutes).
  gitStatus: () => fget<GitStatus>("/git/status"),
  alternatives: () => fget<Alternatives>("/git/alternatives"),
  gitCommit: (message: string) =>
    fsend<GitCommitResult>("POST", "/git/commit", { message }),
  gitPull: () => fsend<GitPullResult>("POST", "/git/pull", {}),

  // --- The CLI's own verbs, which the command bar dispatches through ------------
  commands: () => fget<CommandInfo[]>("/commands"),
  complete: (line: string) =>
    fget<string[]>(`/complete?line=${encodeURIComponent(line)}`),
  /**
   * Run a verb. `graph` comes back ONLY when the command changed the project — the service
   * builds it once inside this request rather than making the caller fetch it (see the route).
   * Optional on purpose: a host that ignores it behaves exactly as before, and still benefits,
   * because building it warmed the cache its next `/graph` will hit.
   */
  command: (line: string) =>
    fsend<{ output: string[]; graph?: WebGraph; rev?: string }>(
      "POST",
      "/command",
      { line },
    ),

  // --- The project-wide undo/redo journal, driven by Ctrl+Z / Ctrl+Y ------------
  // `confirm` applies a process step (restoring a bounced file); without it, a process step
  // comes back `needsConfirm` for the client to gate. historyState() enables the shortcuts.
  historyState: () => fget<HistoryState>("/history"),
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
