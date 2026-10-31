// workspaceTypes.ts — the file service's contract for a workspace: its tree, its files, the undo
// journal, the hints the editor completes from, the libraries and the preferences. Re-exported by
// types.ts, which is what every consumer imports.

import type { ProjectApp } from "./projects.ts";

// A node in the project file tree: dirs carry `children`, files a `kind` (`binary` is shown, not edited).
export interface FileNode {
  name: string; // basename
  path: string; // workspace-relative, POSIX separators (e.g. "modules/instruments/synth/module.k7x")
  dir: boolean;
  kind?: "text" | "binary"; // files only
  project?: boolean; // dirs only — the folder is a project someone can open
  app?: ProjectApp; // dirs only — WHICH app opens it, from the `.k7` suffix
  children?: FileNode[]; // dirs only
}

// A save in the read-only `_modules` library lands on a project-local copy, and the chains follow it.
export interface ForkedModule {
  ref: string; // the shared module that was edited, e.g. "@engine/audio/delay/tape-delay"
  module: string; // the local module the copy became — what the chains now name
  path: string; // workspace-relative path of the file the edit actually landed in
  chains: string[]; // the chains repointed at the copy
}

// A module's `ui.k7x`, which may not exist yet: `path` is then where it WOULD go, and the first save creates it.
export interface ModuleUiFile {
  ref: string; // the module the panel draws, e.g. "@engine/audio/delay/tape-delay"
  path: string; // workspace-relative
  content: string;
  exists: boolean;
}

// A text file beside a module — its DSP source, its widgets' script — and like the panel above it may not exist yet.
export interface ModuleSidecarFile {
  ref: string; // the module the file belongs to
  path: string; // workspace-relative
  content: string;
  exists: boolean;
}

// The opened folder — one project or a workspace of several; `activeProject` is the one the DAW acts on.
export interface WorkspaceInfo {
  root: string; // absolute path opened
  rootIsProject: boolean;
  activeProject: string | null; // workspace-relative ("." for the root), or null
  projects: string[]; // workspace-relative project dirs
  // The clip the recorder wrote most recently: only the file service learns the id, and it stays set until the next take.
  lastTake?: { clip: string; track: string } | null;
  // The project's files being copied to the engine's machine before it plays — packages/file-service/docs/engineSync.md.
  engineSync?: EngineSyncState | null;
  // Where the opened project stands on its way to playable; null once it is — packages/file-service/docs/engineLoad.md.
  engineLoad?: EngineLoadPhase | null;
  // The engine's plugin scan while a project naming an external plugin waits for it, or the scan it gave up on — docs/engineLoad.md there.
  engineScan?: EngineScanState | null;
  // What the account's file service is busy with: a command past a second, a verb's background work — packages/file-service/docs/background.md.
  processes?: ServiceProcess[];
  // The open project is a bundled demo, which the next start of the service overwrites — packages/file-service/src/demos.ts.
  activeIsDemo?: boolean;
  // The change token as of this answer, set by `/open` alone: the page's views start from it rather than fetching twice.
  rev?: string;
}

// One process the file service runs: listed while it runs, and a few seconds after it ended so its end is seen.
export interface ServiceProcess {
  id: string;
  // What it is, as a person reads it: the command line, or the background work's tag.
  label: string;
  state: "running" | "done" | "failed";
  startedAt: number; // ms since the epoch
  endedAt?: number;
  // 0..1 when the work knows how far it is; absent, it is a spinner.
  progress?: number;
  // A word on where it stands ("frame 300 / 1800"), or why it failed.
  detail?: string;
}

// Held for the engine's plugin scan when it names an external plugin, copied to the engine's machine, applied, then played half a second in silence.
export type EngineLoadPhase = "scanning" | "copying" | "applying" | "warming";

// Where the engine's plugin scan stands, as the gate holding a project for it reads it; `total` is 0 while the folders are listed.
export interface EngineScanState {
  done: number;
  total: number;
  // The plugin file being loaded, "" between loads.
  current: string;
  // The scan stopped answering or ran past its bound: the project went on without it, its unscanned plugins reported missing.
  stalled?: boolean;
}

// A copy to the engine's machine: only the files it had to copy count; `error`/`failed` once it went wrong.
export interface EngineSyncState {
  files: number;
  filesDone: number;
  bytes: number;
  bytesDone: number;
  failed?: number;
  // One line per file that did not arrive: its name, then why.
  failures?: string[];
  error?: string;
}

// A file's contents. `binary` files return no `content` (not editable here).
export interface FileContent {
  path: string;
  binary: boolean;
  content: string; // empty when binary
}

// --- undo/redo journal ---------------------------------------------------------

// What one undo/redo step touched (or would touch) — enough to toast and to navigate the editor.
export interface HistoryPeek {
  kind: "text" | "process"; // "process" restores a bounced audio file — confirm before undoing
  label: string;
  files: string[]; // workspace-relative paths the step reverts
}
export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  nextUndo?: HistoryPeek;
  nextRedo?: HistoryPeek;
}
/** One journal step as the History panel lists it — `paths` PROJECT-relative, `undone` past the cursor. */
export interface HistoryListEntry {
  id: number;
  ts: number; // ms since the epoch
  kind: "text" | "process";
  label: string;
  paths: string[];
  undone: boolean;
}
// The POST /undo | /redo reply: applied, refused pending confirmation, or nothing to do.
/** The largest file one upload carries — the file service's limit, which the browser checks first so it can say so by name. */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

export interface UndoResult {
  applied?: boolean;
  needsConfirm?: boolean;
  kind?: "text" | "process";
  label?: string;
  files?: string[];
}

/** One file a writing command touched, PROJECT-relative — what narrows the reload; see docs/document.md. */
export interface ChangedFile {
  path: string;
  kind: "added" | "edited" | "removed";
}

// Autocompletion source — the project's real entities; empty arrays when it is malformed, so the editor degrades.
export interface Hints {
  baseModules: string[]; // plugin module refs a module can extend ("type/name", "@ns/type/name")
  ioSinks: string[]; // io module names ("OUT")
  // Chain `use` refs: a bare name for the folder's generic, "<name>:<node>" per node file, then inherited refs.
  modules: string[];
  tracks: string[];
  channels: string[]; // input-channel labels from the machine's preferences
  clips: string[];
  // The song's picture lanes, by id — the `@meta/picture-track` nodes, which a sounding lane's `video_source` may name.
  videoTracks: string[];
  sequences: string[];
  chains: string[];
  // Each module's own assets/ walked, keyed by chain `use` ref: a module carries what it loads, there is no shared library.
  moduleAssets: Record<string, string[]>;
  paramsByBase: Record<string, string[]>; // base ref -> known param names
  // …and their ranges, for k7's built-in plugins: without one a widget draws 0..1, wrong for a -60..+6 dB fader.
  paramMetaByBase: Record<
    string,
    Record<string, { min: number; max: number; def?: number }>
  >;
  // Rack modules -> their effective rack, keyed by chain `use` ref: note grids show symbols, slices draw windows.
  racks: Record<
    string,
    {
      rackType: "samples" | "slice";
      source?: string; // slice: the clip id every symbol slices from
      symbols: { symbol: string; note: number; from?: number; to?: number }[];
    }
  >;
  keywords: string[]; // words the file format gives meaning to (true/false/null, …)
  // Scanned plugin names by format, lowercased key — from the engine's scan cache (~/.k7/exts.json).
  pluginNames: Record<string, string[]>;
  // "kind:name" -> the project-relative file defining it (module|base|sink|track|clip|sequence|chain).
  paths: Record<string, string>;
  projectRoot: string; // absolute path to the active project (for resolving entity paths)
  // Audio files by project-relative folder ("" = root) — completes `source:`/`clip:` against neighbouring audio.
  media: Record<string, string[]>;
}

// One declared port, a module under an io/ folder (mirrors @studio/song/ioPorts); the LEVELS come from the engine socket, by position.
export interface IoPort {
  ref: string; // how a chain names it ("OUT", "@engine/io/IN:in-1")
  name: string; // the part worth showing ("IN:in-1")
  dir: "in" | "out";
  channels: number[]; // interface channels, a preferences label already resolved
  label?: string; // the `channel:` as authored, when it named a label
  unknownLabel?: boolean; // …and this rig has no input by that name
  namespace: string; // the shared catalogue it came from, "" for a project's own
  generic: boolean; // the folder's module.k7x rather than one of its nodes
}

// One entry of the shared `_modules` catalogue (mirrors @studio/song/moduleCatalogue) — what the module builder lists.
export interface CatalogueModule {
  ref: string; // how a chain names it ("@engine/audio/delay/tape-delay")
  name: string; // the part worth showing, namespace dropped
  namespace: string;
  category: string; // its type folder (audio, io, instruments…)
  kind: string; // what it IS, as the type folder decides
  plugin?: string; // the plugin it loads, for display
  extends?: string;
  // Where the module builder opens it, workspace-relative; absent for an ENGINE module, whose substance is the plugin.
  path?: string;
  nodes: number; // how many nodes sit beside it
  hasUi: boolean; // it already has a `ui.k7x` beside it
  panel?: { cols: number; rows: number }; // its panel grid, what the picker sizes a card by
}

/** A model being fetched into this machine's cache — `POST …/download`, then polled at `GET /account/models/:id`. */
export interface ModelDownloadJob {
  id: string;
  file: string;
  url: string;
  received: number;
  /** Null when the server did not announce a size. */
  total: number | null;
  done: boolean;
  error: string | null;
}

/** `GET /workspaces/sync` — on a machine paired with a remote server, where each workspace lives: both, here only, or there only. */
export interface WorkspaceSyncStatus {
  /** False on the server itself and on a machine never paired: every workspace is simply here. */
  paired: boolean;
  /** The MAIN server this machine syncs with, as an origin — its libraries, and where a new workspace goes. */
  server: string | null;
  /** Every link it syncs with — one account on one server each, several possibly on one server — the main one first. */
  servers?: { origin: string; main: boolean; id?: string; as?: string }[];
  /** Each workspace, here or on a server: `server` is the origin it syncs with, `link` the link's id, `room` its name there when that differs. */
  workspaces: {
    name: string;
    state: "synced" | "local" | "server";
    server?: string;
    link?: string;
    room?: string;
    /** A move under way to `to` (the link `link`) — a copy when `copy`, which leaves it where it is — or why it failed (`error`). */
    moving?: { to: string; link?: string; error?: string; copy?: boolean };
  }[];
}

/** `GET /sync/project` — whether a project is up to date with the relay, which is what `/open` waits for (file-service docs/liveCapture.md). */
export interface ProjectSyncState {
  /** Where the copy here stands against the relay; each state is spelled out in file-service docs/liveCapture.md. */
  state:
    | "ready"
    | "offline"
    | "connecting"
    | "catching-up"
    | "downloading"
    | "refused";
  /** With `refused`: `update` this k7, or the server's k7 is older than this one (live-sync docs/sync.md, "Versions"). */
  refused?: "update" | "server-older";
  /** Whether the project may be opened: up to date, or offline with every file it names on disk. */
  ready: boolean;
  /** Files of the project still waiting for their bytes. */
  pending: number;
}

/** One of the origin's libraries: the name its refs use (`@<name>/…`), and whether the server holds its folder. */
export interface AccountLibrary {
  name: string;
  present: boolean;
  /** Its published versions, oldest first — docs/library-versions-plan.md. */
  versions?: LibraryVersionInfo[];
  /** Whether it has the draft its admins edit. */
  draft?: boolean;
}

/** One published version of a library: the lowest LIBRARY_LEVEL that runs it, and what changed. */
export interface LibraryVersionInfo {
  version: number;
  requires: number;
  notes?: string;
}

/** `POST /account/libraries/<name>/publish` — the draft frozen as the next version; `requires` unsaid is the previous one's. */
export interface PublishLibraryBody {
  requires?: number;
  notes?: string;
}

/** What giving a library its folder did, said as the hub would say it. */
export interface LibraryNote {
  name: string;
  state: "seeded" | "created" | "current" | "failed";
  note: string;
}

/** `GET`/`PUT /account/libraries` — the list, and what the call did to each. */
export interface AccountLibrariesReply {
  libraries: AccountLibrary[];
  notes?: LibraryNote[];
}

/** The machine's two separating choices and the libraries' COLD chains to make them from — `GET /account/cold-chains`. */
export interface ColdChainsReply {
  chains: {
    /** `@<library>/<path>`. */
    ref: string;
    /** One of its offline steps writes an instrumental. */
    instrumental: boolean;
    /** Why THIS machine cannot run it yet (a model not downloaded), null when it can. */
    unavailable: string | null;
    /** Models it needs that this machine can DOWNLOAD — their module gives a `model_url`. */
    downloads: { file: string; url: string }[];
  }[];
  /** `null` is "never told": this machine separates nothing. */
  stemsChain: string | null;
  instrumentalChain: string | null;
}

/** One chain of the library, and whether the bench can PLAY it live — `GET /account/live-chains`. */
/** One step of a frozen chain: a module, the engine it runs as when it has several, and that engine's values. */
export interface FrozenChainStep {
  /** The step's id in the file, kept across saves so an unchanged step keeps its comments. */
  id?: string;
  /** The module it extends, `@<library>/<path>`. */
  module: string;
  engine?: string;
  params: Record<string, number | string>;
  bypass?: boolean;
}

/** A chain the home page's Frozen chains lists: the account's own (`@account/…`), or a library's cold one. */
export interface FrozenChain {
  ref: string;
  /** Its path under `chains/`, what a person calls it. */
  name: string;
  /** In the account's library, so this account edits it; a library's is read-only here. */
  mine: boolean;
  /** Every step is offline: it separates a file rather than treating a signal. */
  cold: boolean;
  steps: FrozenChainStep[];
  /** The interface input the bench's IN is fed from when it opens on the chain: channels, or a preferences label. */
  input?: { channel: string | number[] };
  /** Why it cannot be recorded through live, null when it can. */
  liveRefusal: string | null;
  /** Why the file does not read, when it does not; its steps are then empty. */
  unreadable?: string;
}

export interface LiveChain {
  /** Its path under `chains/` (`vocals/warm`), what the bench's `chain` names. */
  ref: string;
  /** Why it cannot run on a live input (a cold step, a clashing node name), null when it can. */
  unavailable: string | null;
}

// User preferences, formatted for display. `vim` is the only one the web writes back; the rest mirror rig config.
export interface WebPreferences {
  audioDevice: string | null;
  channels: { in: string; out: string };
  vim: boolean; // the editor's vim mode
  /** The chain that separates a record into stems, null when this machine separates nothing — so no surface asks for one. */
  stemsChain: string | null;
  instrumentalChain: string | null;
}

// The project the backend is serving (name + absolute path) — for the header.
export interface ProjectInfo {
  name: string;
  root: string;
}
