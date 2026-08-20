// project.ts — the file-service routes every project app needs: resolving a repository to a
// workspace on this machine, the tree and the files in it, the compiled views the engine and
// the graph are drawn from, and the repository's git. st0 spreads this into its own client and
// adds what only it has (timeline, waveforms, video); z0's editor uses it as it stands.

import type { ProjectDoc } from "@studio/engine-protocol/project";
import type { WebGraph } from "@studio/graph-model";
// The wire shape only, from the browser-safe half of @studio/song — `surfaces.ts` beside it
// walks a disk and is the file service's. A type-only import, so nothing of the parser ships.
import type { ProjectSurfaces } from "@studio/song/yaml/surfaceFile";
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

/**
 * A derived view a writing command may be asked to build and hand back — see `command` below.
 *
 * A union of one, and deliberately a list rather than a boolean: the question a caller answers
 * here is "which of the pictures will I draw", and the next expensive one to arrive (the picture
 * document, the errors) is a member rather than a second flag beside the first.
 */
export type CommandWant = "graph";

export const projectApi = {
  // --- Resolving what pl8 named -------------------------------------------------
  // pl8 knows a REPOSITORY; this machine knows folders. These three bridge that, cloning
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
   * screen rather than being asked for silently. See apps/pl8/docs/banc.md.
   */
  openBench: (project: string | undefined, libraries: string) =>
    fsend<{ workspace: string; project: string }>("POST", "/workspaces/bench", {
      // The account's library repository: the chain being opened is IN it, and so are the
      // modules that chain names. Passed for the same reason `open` takes it.
      libraries,
      // What the address named, handed over as it was written: `chains/<path>.st0` opens the
      // bench on that médiathèque chain, anything else on the catalogue at large. The machine
      // decides, because the machine is what holds the médiathèque.
      project,
    }),

  // --- The open project ---------------------------------------------------------
  workspace: () => fget<WorkspaceInfo>("/workspace"),
  /** The module libraries this project can reach, nearest first. Beside `/tree` because that
   *  one is the SONG and these sit outside it — see the file service's `moduleLibraries`. */
  moduleLibraries: () =>
    fget<{ libraries: ModuleLibrary[] }>("/module-libraries"),
  /** The CHAINS that library holds — what the chains builder lists. `ref` is what a chain is
   *  called (`process/normalize`), `path` where it is; the path comes from here rather than
   *  being built, exactly as a module library's does. */
  libraryChains: () =>
    fget<{ chains: { ref: string; path: string; nodes: string[] }[] }>(
      "/library-chains",
    ),
  /** Make an empty module in one of them. `root` is a path THAT call answered with, `rel` the
   *  module's path under it — at least `<type>/<name>`. */
  createModule: (root: string, rel: string) =>
    fsend<{ path: string; dir: string }>("POST", "/module", { root, rel }),
  project: () => fget<ProjectInfo>("/project"),
  /**
   * Open the project — and say which library repository this account's workspaces mount.
   *
   * The URI rides along because the BROWSER is the side that knows who is asking: it read it
   * from pl8 a moment ago, on this person's session, where the file service holds a machine
   * token and no session at all. The machine mounts it at `_libraries` if it is not there
   * already (see packages/file-service/src/libraries.ts).
   */
  open: (path: string, libraries?: string) =>
    fsend<WorkspaceInfo>("POST", "/open", { path, libraries }),
  unloadEngine: () => fsend<{ ok: true }>("POST", "/engine/unload", {}),
  /**
   * Play a document this browser built — the turntables surface's decks, filled into the
   * project's own compile.
   *
   * Through the file service rather than out of the app's socket so that ONE thing writes to the
   * engine: the service already loads st0's project itself, and a second writer meant whichever
   * pushed last would win. See packages/song/docs/surfaces.md.
   */
  sendEngineProject: (doc: ProjectDoc) =>
    fsend<{ ok: true }>("POST", "/engine/project", { doc }),

  // --- Derived views. A cheap token changes when the sources do; poll it, not these. ---
  revision: () => fget<{ rev: string }>("/revision"),
  projectDoc: () => fget<WebProject>("/project-doc"),
  // The compiled document the ENGINE takes, for a surface that drives one itself: the desk
  // fills its decks' clips into this and hands the result back through `sendEngineProject`.
  engineDoc: () => fget<ProjectDoc>("/engine-doc"),
  // The same folder read as PICTURE. Two compilers over one folder, not one route with a flag:
  // a song has a tempo and its picture has a viewport, and neither document has a field for the
  // other's. A song with no `video_tracks/` answers with an EMPTY document rather than an error,
  // so "no picture" and "broken picture" stay distinguishable at the call site.
  videoDoc: () => fget<WebVideoProject>("/video-doc"),
  videoErrors: () => fget<ProjectErrors>("/video-errors"),
  graph: () => fget<WebGraph>("/graph"),
  /** The graph of a library CHAIN, by the path `/library-chains` gave — the builder's drawing. */
  graphAt: (path: string) =>
    fget<WebGraph>(`/graph?at=${encodeURIComponent(path)}`),
  // The project's `surfaces/` folder, parsed — the special views it asks its editor to draw.
  // Empty for almost every project; see packages/song/docs/surfaces.md.
  surfaces: () => fget<ProjectSurfaces>("/surfaces"),
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
  createNode: (path: string, node: string) =>
    fsend<{ path: string }>("POST", "/node", { path, node }),

  // --- The repository's git. A workspace IS one clone, so none of this needs a project. ---
  // gitStatus fetches, so callers poll it rarely (st0 uses ten minutes).
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
   * Run a verb. `graph` comes back ONLY when the command changed the project AND the caller asked
   * for it — the service builds it once inside this request rather than making the caller fetch
   * it (see the route). Optional on purpose: a host that ignores it behaves exactly as before.
   *
   * `want` is what a caller says when it will NOT draw the picture. Building it is ~62 ms on a
   * real song, on the one thread the service has, and st0 runs mute/solo/faders through a path
   * that never refetches the graph — so that whole class of gesture was paying for a document
   * nobody read. Omit the option and the graph comes back as it always did; pass `want: []` to
   * say no. The `rev` beside it does NOT depend on it: every writing command answers with the
   * token it produced, which is what lets a client stop re-asking what this reply already said.
   *
   * `refused` is the same shape of fact about the OTHER half: the command was understood and
   * declined, and the lines in `output` say why. Present only when true — a surface that ignores
   * it reads a refusal exactly as it always did, which is as ordinary output.
   */
  command: (
    line: string,
    // `at` points the verbs at a folder OTHER than the open project — the chains builder's
    // template. A path this caller was GIVEN (`/library-chains` answered it), never one it built.
    opts?: { at?: string; want?: CommandWant[] },
  ) =>
    fsend<{
      output: string[];
      refused?: boolean;
      graph?: WebGraph;
      rev?: string;
    }>("POST", "/command", {
      line,
      ...(opts?.at ? { at: opts.at } : {}),
      ...(opts?.want ? { want: opts.want } : {}),
    }),

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
  // Remember that two interface inputs are grouped into one stereo device. The ENGINE was told
  // separately and immediately — this is what makes it still true after the next restart, exactly
  // as the audio-device pick is (see engine/moteur/docs/audioDevice.md).
  setInputPair: (channel: number, stereo: boolean) =>
    fsend<{ inputPairs: number[] }>("PUT", "/preferences/input-pair", {
      channel,
      stereo,
    }),
  logs: (offset?: number, tail = 300) =>
    fget<{ offset: number; lines: string[] }>(
      offset != null ? `/logs?offset=${offset}` : `/logs?tail=${tail}`,
    ),
};
