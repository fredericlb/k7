// project.ts — every file-service route a project app needs: files.ts's, plus the compiled views
// the engine and the graph are drawn from, the modules, the CLI's verbs and the undo journal.
// k7 spreads this into its own client and adds what only it has (timeline, waveforms, video).

import type { ProjectDoc } from "@studio/engine-protocol/project";
import type { WebGraph } from "@studio/graph-model";
// The wire shape only, type-only, so nothing of the parser that walks a disk ships here.
import type { ProjectSurfaces } from "@studio/song-schema/yaml/surfaceFile";
import type {
  CatalogueModule,
  ChangedFile,
  CommandInfo,
  Hints,
  HistoryListEntry,
  HistoryState,
  IoPort,
  ModuleLibrary,
  ModuleUiFile,
  ProjectErrors,
  ProjectInfo,
  UndoResult,
  WebPreferences,
  WebProject,
  WebVideoProject,
} from "@studio/web-protocol";
import { fget, fsend } from "./fileApi.ts";
import { fileRoutes } from "./files.ts";

/** One `/complete` candidate: the line it completes to, and what a list shows for its value instead. */
export interface Completion {
  line: string;
  label?: string;
}

/** A derived view a writing command may be asked to build — a list, see docs/fileApi.md. */
export type CommandWant = "graph";

export const projectApi = {
  ...fileRoutes,

  // --- The open project's libraries, modules and scaffolding --------------------
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
    fsend<{ project: string; missing?: string[] }>("POST", "/project/create", {
      shape,
      name,
    }),
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

  /** Move a library module to another folder of its library, its refs repointed — packages/song/docs/moduleMove.md. */
  moveLibraryModule: (path: string, toDir: string) =>
    fsend<{ path: string; from: string; to: string; repointed: string[] }>(
      "POST",
      "/library/move",
      { path, toDir },
    ),
  // --- Modules, as a project sees them ------------------------------------------
  hints: () => fget<Hints>("/hints"),
  /** The refs a node may be an instance of, each with its panel size when it draws one. */
  baseModules: () =>
    fget<{ ref: string; panel?: { cols: number; rows: number } }[]>(
      "/base-modules",
    ),
  ioPorts: () => fget<IoPort[]>("/io-ports"),
  moduleCatalogue: () => fget<CatalogueModule[]>("/module-catalogue"),
  moduleUi: (path: string) =>
    fget<ModuleUiFile>(`/module-ui?path=${encodeURIComponent(path)}`),
  /** The console systems this project may run, and the one it does — packages/song/docs/console.md. */
  consoles: () =>
    fget<{ systems: { ref: string; label: string }[]; current?: string }>(
      "/consoles",
    ),
  /** The engines beside a module file — packages/song/docs/engines.md. */
  moduleEngines: (path: string) =>
    fget<{ engines: string[]; engine?: string }>(
      `/module-engines?path=${encodeURIComponent(path)}`,
    ),
  cloneModule: (path: string, newName: string) =>
    fsend<{ path: string }>("POST", "/module/clone", { path, newName }),
  // `node` is optional: without one the service names it `<module>_<n>` (see `freeNodeName`).
  createNode: (path: string, node?: string) =>
    fsend<{ path: string }>("POST", "/node", {
      path,
      ...(node ? { node } : {}),
    }),

  // --- The CLI's own verbs, which the command bar dispatches through ------------
  commands: () => fget<CommandInfo[]>("/commands"),
  /** Every candidate as an item, the label set only where the service gave one — commands/docs/completions.md. */
  complete: (line: string) =>
    fget<(string | Completion)[]>(
      `/complete?line=${encodeURIComponent(line)}&labels=1`,
    ).then((list) =>
      // A service that predates labels answers bare strings, and so does the current one for an unlabelled line.
      list.map((c): Completion => (typeof c === "string" ? { line: c } : c)),
    ),
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
      revBefore?: string;
      changed?: ChangedFile[];
    }>("POST", "/command", {
      line,
      ...(opts?.at ? { at: opts.at } : {}),
      ...(opts?.want ? { want: opts.want } : {}),
    }),

  // --- The project-wide undo/redo journal, driven by Ctrl+Z / Ctrl+Y ------------
  historyState: () => fget<HistoryState>("/history"),
  /** Every step of the open project's journal, oldest first — the History panel (docs/history.md). */
  historyEntries: () => fget<HistoryListEntry[]>("/history/entries"),
  // `confirm` applies a process step; without it one comes back `needsConfirm` for the client to gate.
  undo: (confirm?: boolean) => fsend<UndoResult>("POST", "/undo", { confirm }),
  redo: (confirm?: boolean) => fsend<UndoResult>("POST", "/redo", { confirm }),

  // --- This machine's preferences, and the merged engine + file-service log -----
  preferences: () => fget<WebPreferences>("/preferences"),
  setVim: (vim: boolean) =>
    fsend<{ vim: boolean }>("PUT", "/preferences/vim", { vim }),
  /** Both halves of the Logs panel: the engine machine's `.studio.log` by byte `offset`, this service's own lines after `after`. */
  logs: (offset?: number, tail = 300, after?: number) =>
    fget<{
      offset: number;
      lines: string[];
      service?: {
        seq: number;
        lines: {
          seq: number;
          t: number;
          level: "info" | "warn" | "error";
          text: string;
        }[];
      };
    }>(
      `/logs?${offset != null ? `offset=${offset}` : `tail=${tail}`}${after != null ? `&after=${after}` : ""}`,
    ),
};
