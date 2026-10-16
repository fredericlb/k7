// workspace.ts — the filesystem layer over ONE workspace root: file ops, the active
// project, and the compiled/waveform caches, all per-instance because the service
// serves many users' workspaces from one process. The active project is remembered in a
// marker BESIDE the workspace, never in it (`activeMarkerOf`). Full rationale: docs/workspace.md.

import {
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  scannedPluginNames,
  scannedPlugins,
} from "@studio/engine-client/pluginCache";
// WebGraph is graph-model's, not web-protocol's: an app that draws chains needn't pull in auth and the registry.
import type { WebGraph } from "@studio/graph-model";
import {
  ASSEMBLY_FILE,
  assemblyIssues,
  libraryAssemblies,
} from "@studio/song/assemblies";
import { writeFileAtomic } from "@studio/song/atomicWrite";
import type { AutoFreeze } from "@studio/song/autoFreeze";
import { moduleBaseChoices } from "@studio/song/basePreset";
import { confineTo, confineToProject } from "@studio/song/confine";
import { type ConsoleSystem, consoleSystems } from "@studio/song/console";
import { deadAutomations } from "@studio/song/deadAutomations";
import { engineModules } from "@studio/song/engineCatalogue";
import { enginesBeside } from "@studio/song/engines";
import { loadGraph } from "@studio/song/graph";
import { projectHints } from "@studio/song/hints";
import { type IoPort, ioPorts } from "@studio/song/ioPorts";
import { libraryChainDirs } from "@studio/song/libraryChains";
import {
  type BaseModuleRef,
  cloneModuleFile,
  createNode,
  type Diagnostic,
  deadProjectFields,
  freeNodeName,
  libraryModuleIssues,
  listBaseModuleRefs,
  loadModuleRefs,
  moduleRefOf,
  notSupportedModules,
  withModuleStamp,
} from "@studio/song/loader";
import { type MissingModel, missingModel } from "@studio/song/modelCache";
import {
  type CatalogueModule,
  moduleCatalogue,
} from "@studio/song/moduleCatalogue";
import { type ForkedModule, sharedModuleRef } from "@studio/song/moduleFork";
import {
  assertNotEngine,
  planModuleMove,
  refAt,
  repointRefs,
} from "@studio/song/moduleMove";
import {
  compileWithAutoFreezes,
  materialRefOf,
} from "@studio/song/nodeProject";
import {
  formatAudioDevice,
  formatChannels,
  loadPreferences,
  setEditorVim,
} from "@studio/song/preferences";
import type { ClipDoc, ProjectDoc } from "@studio/song/project";
import { loadAudioClipDoc, loadProject } from "@studio/song/project";
import {
  accountLibraries,
  isInSharedModules,
  isLibraryEditable,
  isLibraryName,
  isLibraryRootEditable,
  LIBRARIES_DIR,
  librariesHome,
  libraryOf,
  libraryRoot,
  moduleLibraryDirs,
  moduleNamespaceOf,
} from "@studio/song/sharedFolders";
import {
  hasPicture,
  projectSurfaces,
  surfaceIssues,
} from "@studio/song/surfaces";
import { UI_FILE, uiFileText } from "@studio/song/uiLibrary";
import { ensureVideoRun } from "@studio/song/videoOutputs";
import {
  isDocName,
  isK7xPath,
  realPath,
  wsExists,
  wsRead,
  wsWrite,
} from "@studio/song/yaml/workspaceFile";
import {
  ACCOUNT_LIBRARY,
  ENGINE_NS,
  type ModuleNamespace,
} from "@studio/song-schema/moduleTypes";
import { PLAYLISTS_DIR, parsePlaylist } from "@studio/song-schema/playlist";
import {
  isReferenceFile,
  REFERENCES_DIR,
  type ReferenceTrack,
  referenceName,
} from "@studio/song-schema/reference";
import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import type { VideoProjectDoc } from "@studio/song-video/videoDoc";
import { loadVideoProject } from "@studio/song-video/videoProject";
import { videoDuration } from "@studio/song-video/videoTracks";
import type { K7Result } from "@studio/take-render/render";
import type {
  FileContent,
  FileNode,
  Hints,
  ModuleLibrary,
  PreviewReq,
  ProjectInfo,
  ShareProgress,
  WaveformStatus,
  WebProject,
  WebVideoProject,
  WebWaveform,
  WorkspaceInfo,
} from "@studio/web-protocol";
import type { Compatibility } from "@studio/web-protocol/compat";
import {
  PROJECT_SUFFIXES,
  type ProjectApp,
  projectApp,
} from "@studio/web-protocol/projects";
import { parse as parseYaml } from "yaml";
import { readActiveMarker, writeActiveMarker } from "./activeMarker.ts";
import { guard } from "./background.ts";
import {
  buildGraphDoc,
  type ClipExtents,
  clipExtentsOf,
  type TrackMixers,
  trackColorsOf,
  trackMixersOf,
} from "./graphDoc.ts";
import type { HistoryListEntry, HistoryPeek, HistoryState } from "./history.ts";
import type { ChangeFeed } from "./liveCapture.ts";
import { closeModuleWatchesUnder, moduleFoldersMoved } from "./moduleWatch.ts";
import {
  type PluginNeed,
  pluginNeedsOf,
  projectCompatOf,
} from "./pluginNeeds.ts";
import {
  copyProjectInto,
  createProjectIn,
  importProjectBytes,
  importProjectInto,
} from "./projectLifecycle.ts";
import { revisionOf, type WalkedFile, walkProject } from "./projectWalk.ts";
import { shareProgress, startShareLink } from "./shareLink.ts";
// The export acts, behind a host of a few members — see shareOps.ts.
import { exportMix, type ShareHost, shareK7 } from "./shareOps.ts";
import {
  AUDIO_EXT,
  DEFAULT_WF_BUCKETS,
  findClip,
  WaveformOps,
} from "./waveformOps.ts";
import { webProjectOf } from "./webProject.ts";
import { toWebVideoTracks, webPlugin } from "./webTracks.ts";
import { isBinary, RECYCLE_DIR, skip } from "./workspaceFilter.ts";
import { type Recorded, WorkspaceHistory } from "./workspaceHistory.ts";

export { isBinary, skip };

// Turn a compiler error into editor diagnostics; a line with no "<file>: " prefix yields none but still counts.
function parseCompileError(msg: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const line of msg.split("\n")) {
    const m = /^\s*(\S+\.(?:ya?ml|k7x))(?::(\d+))?:\s*(.+)$/i.exec(line);
    if (m)
      out.push({
        file: m[1].replace(/^\.\//, ""),
        line: m[2] ? Number(m[2]) : 1,
        col: 1,
        message: m[3].trim(),
      });
  }
  return out;
}

/** A directory whose NAME claims an app and that EXISTS — the name rule, see docs/activeProject.md. */
export const isProjectDir = (dir: string): boolean => {
  if (projectApp(basename(dir)) === null) return false;
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

/** Every project folder under `root`, workspace-relative, at any depth — see docs/workspace.md. */
export function projectDirsUnder(
  root: string,
  abs = root,
  out: string[] = [],
): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    // Unreadable: no projects here rather than a throw, which failed a whole poll over one folder.
    return out;
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && !skip(e.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const e of dirs) {
    const child = join(abs, e.name);
    if (isProjectDir(child))
      out.push(relative(root, child).split(sep).join("/"));
    projectDirsUnder(root, child, out);
  }
  return out;
}

// A project FILE by name — every "file or folder?" test asks this rather than naming an extension.
const PROJECT_FILE = /\.(ya?ml|k7x)$/i;
/** Is `abs` inside one of the account libraries' `samples/`, `irs/` or `wavetables/` — and nowhere else of theirs? */
function inLibrarySounds(abs: string): boolean {
  const lib = libraryOf(abs);
  if (!lib) return false;
  const family = relative(lib.root, abs).split(sep)[0];
  return family === "samples" || family === "irs" || family === "wavetables";
}

// Rename, retrying briefly while Windows releases a lingering handle; a non-transient error still throws.
async function renameWithRetry(
  from: string,
  to: string,
  tries = 25,
  delayMs = 100,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      const transient =
        code === "EPERM" ||
        code === "EBUSY" ||
        code === "EACCES" ||
        code === "ENOTEMPTY";
      if (!transient || attempt >= tries) throw e;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

// The user's global preferences — one file for this service, not per workspace, hence module-level.
export function preferences(): {
  audioDevice: string | null;
  channels: { in: string; out: string };
  vim: boolean;
  stemsChain: string | null;
  instrumentalChain: string | null;
} {
  const p = loadPreferences();
  return {
    audioDevice: p.audioDevice ? formatAudioDevice(p.audioDevice) : null,
    channels: formatChannels(p),
    vim: p.editor.vim,
    stemsChain: p.stemsChain ?? null,
    instrumentalChain: p.instrumentalChain ?? null,
  };
}

export function setVim(on: boolean): boolean {
  return setEditorVim(on).editor.vim;
}

/** `abs` if it stays inside `root` both LEXICALLY and on the REAL path, else a throw — docs/workspace.md. */
function confined(
  abs: string,
  root: string,
  rel: string,
  what: "workspace" | "libraries",
): string {
  const inside = confineTo([root], abs);
  if (inside === null) throw new Error(`path escapes the ${what}: ${rel}`);
  return inside;
}

/** `@engine` as a library — synthesised, not a folder. See docs/workspace.md. */
function engineLibrary(): ModuleLibrary | null {
  const byType = new Map<string, FileNode[]>();
  for (const [ref, m] of Object.entries(engineModules()) as [
    string,
    { category?: unknown; file?: unknown },
  ][]) {
    const type = String(m.category ?? "audio");
    const list = byType.get(type) ?? [];
    // A LEAF deliberately: a row that draws the name and opens nothing is the truth about a scan.
    list.push({
      name: String(m.file ?? ref),
      path: ref,
      dir: false,
      kind: "text",
    });
    byType.set(type, list);
  }
  if (!byType.size) return null;
  const nodes = [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, children]) => ({
      name: type,
      // Synthetic — no such folder exists. Unique per type, which is all the tree needs it for.
      path: `${ENGINE_NS}/${type}`,
      dir: true,
      children: children.sort((a, b) => a.name.localeCompare(b.name)),
    }));
  return { ns: "engine", path: "", exists: true, readOnly: true, nodes };
}

export class Workspace {
  readonly root: string;
  readonly rootIsProject: boolean;
  private activeProject: string | null;
  private docCache: { dir: string; rev: string; doc: ProjectDoc } | null = null;
  // The picture compile's own cache — see cachedVideoDoc for why it is not a branch inside the one above.
  private videoCache: {
    dir: string;
    rev: string;
    doc: VideoProjectDoc;
  } | null = null;
  // The undo/redo journal — see workspaceHistory.ts.
  private readonly journal: WorkspaceHistory;
  /** Live sync's capture, when on: a mutation window holds its batch open — docs/liveCapture.md. */
  liveCapture:
    | (ChangeFeed & { hold(): void; release(label: string): void })
    | null = null;
  private mutations = 0; // half the change token — the half reacting to our own writes with no clock tick
  // The waveform machinery (slice + memo + prewarm) — see waveformOps.ts.
  private readonly wf: WaveformOps;

  constructor(root: string) {
    this.root = resolve(root);
    this.rootIsProject = isProjectDir(this.root);
    // ROOT when it is itself a project, else the remembered one if still valid, else null.
    const remembered = this.readActiveMarker();
    this.activeProject = this.rootIsProject
      ? this.root
      : remembered && this.withinRoot(remembered) && isProjectDir(remembered)
        ? remembered
        : null;
    this.wf = new WaveformOps({
      root: this.root,
      requireActive: () => this.requireActive(),
      activeProject: () => this.activeProject,
      cachedProjectDoc: (dir) => this.cachedProjectDoc(dir),
      withinRoot: (abs) => this.withinRoot(abs),
    });
    this.journal = new WorkspaceHistory({
      root: this.root,
      activeProject: () => this.activeProject,
      toRel: (abs) => this.toRel(abs),
      revision: () => this.revision(),
      withWalk: (dir, fn) => this.withWalk(dir, fn),
      revisionOf: (files) => this.revisionOf(files),
      invalidateProjectDoc: () => this.invalidateProjectDoc(),
    });
  }

  // --- path guards (verbatim from store.ts, reading this.root) ---------------
  private withinRoot(abs: string): boolean {
    return abs === this.root || abs.startsWith(this.root + sep);
  }

  /** Resolve `rel` inside the workspace, or throw — TWO gates, both needed, docs/workspace.md.
   *
   * `_libraries/<name>/…` is the one path that is not IN the workspace: it names the account's
   * library `<name>`, the hub's folder of it, and is confined THERE by the same two
   * gates — docs/sharedFolders.md. */
  private safePath(rel: string): string {
    const segs = rel.split(/[\\/]+/).filter((s) => s && s !== ".");
    if (segs[0] === LIBRARIES_DIR) {
      // Each library is confined to its OWN root, wherever an overlay points it.
      if (segs[1] && (isLibraryName(segs[1]) || segs[1] === ACCOUNT_LIBRARY)) {
        const root = libraryRoot(segs[1], this.activeProject ?? this.root);
        return confined(
          resolve(root, ...segs.slice(2)),
          root,
          rel,
          "libraries",
        );
      }
      // Anything else below `_libraries/` (the relay's `.sync-relay/` above all) is no library's, so nobody's to read or write.
      if (segs.length > 1) throw new Error(`names no library: ${rel}`);
      const home = librariesHome();
      return confined(home, home, rel, "libraries");
    }
    return confined(
      rel === "." ? this.root : resolve(this.root, rel),
      this.root,
      rel,
      "workspace",
    );
  }
  private toRel(abs: string): string {
    // A library file answers to the virtual folder it is reached through, never to where it lies on disk.
    const lib = libraryOf(abs);
    if (lib)
      return [LIBRARIES_DIR, lib.name, relative(lib.root, abs)]
        .filter(Boolean)
        .join(sep)
        .split(sep)
        .join("/");
    return abs === this.root
      ? "."
      : relative(this.root, abs).split(sep).join("/");
  }
  mediaPath(rel: string): string {
    return this.safePath(rel);
  }

  // --- active project + marker ----------------------------------------------
  activeProjectPath(): string | null {
    return this.activeProject;
  }
  private requireActive(): string {
    if (!this.activeProject)
      throw new Error(
        "no active project — select a project in the workspace first",
      );
    return this.activeProject;
  }

  /** The model a node of the ACTIVE project names and this machine has not got, resolved as the graph resolves it — null when it has it. */
  missingModelOf(node: string): MissingModel | null {
    const m = loadGraph(this.requireActive()).modules[node];
    if (!m) throw new Error(`no node '${node}' in this project`);
    return missingModel(m);
  }
  private readActiveMarker(): string | null {
    return readActiveMarker(this.root);
  }
  private writeActiveMarker(abs: string): void {
    try {
      writeActiveMarker(this.root, this.toRel(abs));
    } catch {
      /* best-effort — a failed write just means the reopen won't stick */
    }
  }

  // Whether `abs` is in _recycle_bin — a deleted project, never listed, opened or started.
  private isRecycled(abs: string): boolean {
    const bin = join(this.root, RECYCLE_DIR);
    return abs === bin || abs.startsWith(bin + sep);
  }

  setActiveProject(rel: string): string {
    const abs = this.safePath(rel);
    if (this.isRecycled(abs))
      throw new Error(`project is in the recycle bin: ${rel}`);
    // Said apart from the name rule below because it is the one that actually happens: a stale link.
    if (!existsSync(abs))
      throw new Error(
        `no project '${rel}' in this workspace — it may have been renamed, removed, or ` +
          `never have been on this machine; go back to the projects page and open it from there`,
      );
    if (!isProjectDir(abs))
      throw new Error(
        `not a project (the folder must end in ${Object.values(PROJECT_SUFFIXES).join(", ")}): ${rel}`,
      );
    this.activeProject = abs;
    this.writeActiveMarker(abs);
    this.repairVideoOutputs(abs);
    this.invalidateProjectDoc();
    guard("waveform prewarm", this.prewarmWaveforms());
    return abs;
  }

  /** A project declaring a viewport gains its VIDEO_OUT run on open — packages/song/docs/videoOutputs.md. */
  private repairVideoOutputs(abs: string): void {
    try {
      const declaresViewport = projectSurfaces(abs).surfaces.some(
        (s) => s.surface.type === "viewport",
      );
      if (declaresViewport) ensureVideoRun(abs);
    } catch {
      /* best-effort — a project whose surfaces will not read still opens */
    }
  }

  /** Move a project into _recycle_bin; `beforeMove` releases handles first — see docs/workspace.md. */
  async deleteProject(
    rel: string,
    beforeMove?: (projectAbs: string) => void | Promise<unknown>,
  ): Promise<{ recycled: string }> {
    const abs = this.safePath(rel);
    if (abs === this.root) throw new Error("can't delete the workspace root");
    if (this.isRecycled(abs))
      throw new Error(`already in the recycle bin: ${rel}`);
    if (!isProjectDir(abs))
      throw new Error(
        `not a project (the folder must end in ${Object.values(PROJECT_SUFFIXES).join(", ")}): ${rel}`,
      );

    const wasActive = this.activeProject === abs;
    // Release every handle inside the folder before renaming, or Windows answers EPERM. The module
    // WATCH is one of them: `fs.watch` holds the directory, and it is only dropped on a switch to
    // another project — never on a project that is going away (docs/moduleWatch.md).
    this.cancelPrewarm();
    closeModuleWatchesUnder(abs);
    await beforeMove?.(abs);

    const bin = join(this.root, RECYCLE_DIR);
    mkdirSync(bin, { recursive: true });
    // Don't clobber an earlier deletion of the same name — suffix a counter.
    const base = basename(abs);
    let dest = join(bin, base);
    for (let n = 2; existsSync(dest); n++) dest = join(bin, `${base}-${n}`);
    await renameWithRetry(abs, dest); // retry while Windows releases any lingering handle

    if (wasActive) {
      this.activeProject = null;
      try {
        writeActiveMarker(this.root, ""); // clear the reopen marker
      } catch {
        /* best-effort */
      }
      this.invalidateProjectDoc();
    }
    this.forgetProjects();
    return { recycled: this.toRel(dest) };
  }

  /**
   * Rename a project FOLDER in place, keeping the suffix that decides which app opens it.
   * `beforeMove` STOPS the engine when it is serving this folder — a rename is a `renameEntry`
   * the ACTIVE project is allowed, which is why it is not one. See docs/workspaces.md.
   */
  async renameProject(
    rel: string,
    newName: string,
    beforeMove?: (projectAbs: string) => void | Promise<unknown>,
  ): Promise<{ path: string }> {
    const abs = this.safePath(rel);
    if (abs === this.root) throw new Error("can't rename the workspace root");
    this.guardShared(abs, "rename");
    if (this.isRecycled(abs))
      throw new Error(`'${this.toRel(abs)}' is already in the recycle bin`);
    if (!isProjectDir(abs))
      throw new Error(
        `not a project (the folder must end in ${Object.values(PROJECT_SUFFIXES).join(", ")}): ${rel}`,
      );
    const clean = basename(newName).replace(/[\\/]/g, "").trim();
    // The SUFFIX is the app: renaming a `.k7` into a `.z0` would hand the folder to another editor.
    if (projectApp(clean) !== projectApp(basename(abs)))
      throw new Error(
        `a project keeps the suffix that says which app opens it — '${clean}' should end in '${PROJECT_SUFFIXES[projectApp(basename(abs)) as ProjectApp]}'`,
      );
    const destAbs = this.safePath(this.toRel(join(dirname(abs), clean)));
    if (destAbs === abs) return { path: this.toRel(abs) }; // the name it has already
    if (existsSync(destAbs)) {
      const err = new Error(
        `already exists: ${this.toRel(destAbs)}`,
      ) as NodeJS.ErrnoException;
      err.code = "EEXIST";
      throw err;
    }
    const wasActive =
      !!this.activeProject &&
      (abs === this.activeProject || this.activeProject.startsWith(abs + sep));
    // Release every handle inside the folder before renaming, or Windows answers EPERM.
    this.cancelPrewarm();
    await beforeMove?.(abs);
    await renameWithRetry(abs, destAbs);
    // The project did not END, it moved: the marker follows it rather than being cleared.
    if (wasActive) {
      this.activeProject = destAbs;
      this.writeActiveMarker(destAbs);
      this.invalidateProjectDoc();
    }
    this.forgetProjects();
    return { path: this.toRel(destAbs) };
  }

  // The path guards projectLifecycle.ts works through, without making safePath public API.
  private lifecycleHost() {
    return {
      root: this.root,
      safePath: (rel: string) => this.safePath(rel),
      toRel: (abs: string) => this.toRel(abs),
    };
  }

  /** Import a .dawproject or .als into a NEW project folder — see projectLifecycle.ts. */
  importProject(rel: string): { project: string; log: string[] } {
    const r = importProjectInto(this.lifecycleHost(), rel);
    this.forgetProjects();
    return r;
  }

  /** …and the same from bytes, into a folder the caller NAMED — a project dropped on the home page. */
  importProjectFile(
    file: string,
    bytes: Uint8Array,
    as: string,
  ): { project: string; log: string[] } {
    const r = importProjectBytes(this.lifecycleHost(), file, bytes, as);
    this.forgetProjects();
    return r;
  }

  /** Scaffold a NEW project folder at the workspace root — see projectLifecycle.ts. */
  createProject(
    shape: ProjectShape,
    rawName: string,
  ): { project: string; missing: string[] } {
    const r = createProjectIn(this.lifecycleHost(), shape, rawName);
    this.forgetProjects();
    return r;
  }

  /** One of this workspace's projects, guarded — what a copy to ANOTHER workspace reads from. */
  projectFolder(rel: string): string {
    const abs = this.safePath(rel);
    if (this.isRecycled(abs))
      throw new Error(`project is in the recycle bin: ${rel}`);
    if (!isProjectDir(abs))
      throw new Error(
        `not a project (the folder must end in ${Object.values(PROJECT_SUFFIXES).join(", ")}): ${rel}`,
      );
    return abs;
  }

  /** …and the receiving end: that folder copied in here under `name` — see projectLifecycle.ts. */
  async copyProject(
    srcAbs: string,
    name: string,
  ): Promise<{ project: string }> {
    // A workspace that IS one project lists nothing under it, so a copy in it would be invisible.
    if (this.rootIsProject)
      throw new Error(
        `${basename(this.root)} is itself a project — copy into a workspace that holds several`,
      );
    const r = await copyProjectInto(this.lifecycleHost(), srcAbs, name, skip);
    this.forgetProjects();
    return r;
  }

  /** A project folder appeared or went, so the list must be re-scanned NOW — docs/workspace.md. */
  private forgetProjects(): void {
    this.projectsCache = null;
  }

  // --- compiled-project cache ------------------------------------------------

  /** The compiled project, memoised against the REVISION rather than our own writes — docs/workspace.md. */
  cachedProjectDoc(dir: string): ProjectDoc {
    const rev = this.revision().rev;
    if (this.docCache && this.docCache.dir === dir && this.docCache.rev === rev)
      return this.docCache.doc;
    const doc = loadProject(dir);
    this.docCache = { dir, rev, doc };
    return doc;
  }
  setCachedProjectDoc(dir: string, doc: ProjectDoc): void {
    this.docCache = { dir, rev: this.revision().rev, doc };
  }
  invalidateProjectDoc(): void {
    this.docCache = null;
    this.mutations++;
    // …and tell the module watcher, which `fs.watch` would only reach a tick later — moduleWatch.ts.
    moduleFoldersMoved();
  }

  /** The token, held for the duration of ONE derivation — re-entrant, see docs/workspace.md. */
  private revScope: string | null = null;
  /** `seed` is a token the caller already holds, and only ever one this class produced. */
  withRevision<T>(fn: () => T, seed?: string): T {
    if (this.revScope !== null) return fn(); // already inside one
    this.revScope = seed ?? this.freshRevision();
    try {
      return fn();
    } finally {
      this.revScope = null;
    }
  }

  // A cheap token that changes when the project's sources do — see docs/workspace.md.
  revision(): { rev: string } {
    return { rev: this.revScope ?? this.freshRevision() };
  }

  // --- the walk the three readers of the tree share --------------------------

  /** ONE walk of the project, opened by `withWalk` and read by three — see docs/workspace.md. */
  private walkScope: WalkedFile[] | null = null;
  /** Run `fn` over ONE walk of the active project; nothing inside may WRITE — docs/workspace.md. */
  private withWalk<T>(dir: string, fn: (files: WalkedFile[]) => T): T {
    if (this.walkScope !== null) return fn(this.walkScope);
    this.walkScope = walkProject(dir);
    try {
      return fn(this.walkScope);
    } finally {
      this.walkScope = null;
    }
  }

  /** The walk itself. Only `withRevision` and an unscoped `revision()` reach it. */
  private freshRevision(): string {
    const dir = this.activeProject;
    if (!dir) return `none:${this.mutations}`;
    // The walk a mutation already has open, else its own and a NARROW one — see docs/workspace.md.
    return this.revisionOf(this.walkScope ?? walkProject(dir, true));
  }

  /** The token from a walk — projectWalk.ts — with this workspace's mutation counter. */
  private revisionOf(files: WalkedFile[]): string {
    return revisionOf(files, this.mutations);
  }

  // --- undo/redo journal -----------------------------------------------------

  /** Run a project mutation and journal what it changed, so Ctrl+Z can undo it — docs/workspace.md. */
  async recordChange<T>(
    label: string,
    mutate: (snapshot: (abs: string) => void) => T | Promise<T>,
  ): Promise<Recorded<T>> {
    this.liveCapture?.hold();
    try {
      return await this.journal.record(label, mutate);
    } finally {
      this.liveCapture?.release(label);
    }
  }

  /** Undo the most recent journalled change on the active project. */
  undoHistory(): Promise<HistoryPeek | null> {
    return this.journal.undo();
  }
  /** Redo the change undo just reverted. */
  redoHistory(): Promise<HistoryPeek | null> {
    return this.journal.redo();
  }
  /** The open project's journal for the History panel, its paths PROJECT-relative like a commit's. */
  historyList(): HistoryListEntry[] {
    return this.journal.list();
  }
  peekUndo(): HistoryPeek | null {
    return this.journal.peekUndo();
  }
  peekRedo(): HistoryPeek | null {
    return this.journal.peekRedo();
  }
  historyState(): HistoryState {
    return this.journal.state();
  }

  // --- tree / text I/O -------------------------------------------------------
  private walk(abs: string): FileNode[] {
    const entries = readdirSync(abs, { withFileTypes: true })
      .filter((e) => !skip(e.name))
      .sort(
        (a, b) =>
          Number(b.isDirectory()) - Number(a.isDirectory()) ||
          a.name.localeCompare(b.name),
      );
    return entries.map((e): FileNode => {
      const childAbs = join(abs, e.name);
      const path = this.toRel(childAbs);
      const children = e.isDirectory() ? this.walk(childAbs) : undefined;
      return children
        ? {
            name: e.name,
            path,
            dir: true,
            project: isProjectDir(childAbs) || undefined,
            // WHICH app opens it, beside the flag that says one does — that row must not guess.
            app: (isProjectDir(childAbs) && projectApp(e.name)) || undefined,
            children,
          }
        : {
            name: e.name,
            path,
            dir: false,
            kind: isBinary(e.name) ? "binary" : "text",
          };
    });
  }
  /** The file tree an editor draws: the WHOLE workspace, every project in it — see docs/activeProject.md. */
  tree(): FileNode[] {
    return this.walk(this.root);
  }

  /** The same walk under the home page's own route, which asks it of a workspace it has not opened. */
  workspaceTree(): FileNode[] {
    return this.tree();
  }

  /**
   * Which project a bare workspace address opens: the one last open, else the first on disk,
   * else none — a workspace holding no project is a tree and nothing more. See docs/workspaces.md.
   */
  defaultProject(): string | null {
    if (this.rootIsProject) return ".";
    const marked = this.readActiveMarker();
    if (marked && isProjectDir(marked)) return this.toRel(marked);
    return projectDirsUnder(this.root)[0] ?? null;
  }

  /** The active project's automatic freezes, ready or not, memoised on the revision — packages/song/docs/autoFreeze.md. */
  autoFreezes(): AutoFreeze[] {
    return this.onRevision(
      "autoFreezes",
      (dir) => compileWithAutoFreezes(dir).freezes,
      [],
    );
  }

  /** The plugins one project of this workspace needs its engine to host, read without opening it — pluginNeeds.ts. */
  pluginNeeds(project: string): PluginNeed[] {
    return pluginNeedsOf(this.projectDirOf(project));
  }

  /** …scored against THIS machine's engine scan, for a project living beside its engine; null when the scan cannot say. */
  pluginCompat(project: string): Compatibility | null {
    return projectCompatOf(this.projectDirOf(project), scannedPlugins());
  }

  private projectDirOf(project: string): string {
    const dir = this.safePath(project);
    if (!isProjectDir(dir)) throw new Error(`not a project: ${project}`);
    return dir;
  }

  /** The module libraries this project can reach, in precedence order — see docs/workspace.md. */
  moduleLibraries(): ModuleLibrary[] {
    const dir = this.activeProject ?? this.root;
    const roots: { ns: ModuleNamespace; abs: string }[] = moduleLibraryDirs(
      dir,
    ).map((abs) => ({
      ns: moduleNamespaceOf(abs),
      abs,
    }));
    // Every library is a row, one with no `modules/` yet included: its chains are listed under it.
    for (const lib of accountLibraries(dir))
      if (!roots.some((r) => r.ns === lib.name))
        roots.push({ ns: lib.name, abs: join(lib.root, "modules") });
    const out: ModuleLibrary[] = roots.map(({ ns, abs }) => {
      const exists = existsSync(abs);
      // A library REPOSITORY's sound folders too, walked like its modules: the tab draws them and takes drops on them.
      const lib = accountLibraries(dir).find((l) => l.name === ns);
      const sounds = (family: "samples" | "irs" | "wavetables" | "models") => {
        const at = lib ? join(lib.root, family) : null;
        return at && existsSync(at) ? this.walk(at) : [];
      };
      return {
        ns,
        path: this.toRel(abs),
        exists,
        nodes: exists ? this.walk(abs) : [],
        ...(lib
          ? {
              samples: sounds("samples"),
              irs: sounds("irs"),
              wavetables: sounds("wavetables"),
              models: sounds("models"),
            }
          : {}),
      };
    });
    const engine = engineLibrary();
    if (engine) out.push(engine);
    return out;
  }

  /** The CHAINS the account's libraries hold, by `@<library>/<path>`: `path` is the chain's file, or a folder chain's folder. */
  libraryChains(): { ref: string; path: string; nodes: string[] }[] {
    // The walk is shared with the ACCOUNT's own listing, which has no workspace to be relative to.
    return libraryChainDirs(this.activeProject ?? this.root).map((c) => ({
      ref: c.ref,
      path: this.toRel(c.at),
      nodes: c.nodes,
    }));
  }

  /** The ASSEMBLY templates the library holds — what the builder lists and `assembly new` completes on.
   *
   * `file` is the `assembly.yaml` inside, and it is answered HERE rather than joined in a browser:
   * a path a caller builds is one `safePath` never saw. Same rule as `/module-libraries`. */
  libraryAssemblies(): { ref: string; path: string; file: string }[] {
    return libraryAssemblies(this.activeProject ?? this.root).map((a) => ({
      ref: a.ref,
      path: this.toRel(a.path),
      file: this.toRel(join(a.path, ASSEMBLY_FILE)),
    }));
  }

  /** The playlists this workspace holds, at the ROOT and at any depth — see docs/workspace.md. */
  playlists(): {
    path: string;
    name: string;
    title?: string;
    count: number;
    ok: boolean;
  }[] {
    const root = join(this.root, PLAYLISTS_DIR);
    const out: {
      path: string;
      name: string;
      title?: string;
      count: number;
      ok: boolean;
    }[] = [];
    const walk = (at: string): void => {
      let entries: Dirent[];
      try {
        entries = readdirSync(at, { withFileTypes: true });
      } catch {
        return; // no folder yet: an account with no set list has none, which is not an error
      }
      for (const e of entries) {
        const abs = join(at, e.name);
        if (e.isDirectory()) {
          walk(abs);
          continue;
        }
        if (!e.isFile() || !isDocName(e.name)) continue;
        let parsed: ReturnType<typeof parsePlaylist> = null;
        try {
          parsed = parsePlaylist(wsRead(abs));
        } catch {
          parsed = null; // unreadable bytes read exactly like unparseable ones from here
        }
        out.push({
          path: this.toRel(abs),
          name: e.name.replace(/\.(ya?ml|k7x)$/i, ""),
          ...(parsed?.title ? { title: parsed.title } : {}),
          count: parsed?.items.length ?? 0,
          ok: parsed !== null,
        });
      }
    };
    walk(root);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** The reference tracks this workspace holds — `_references/` at any depth, see docs/workspace.md. */
  references(): ReferenceTrack[] {
    const out: ReferenceTrack[] = [];
    const walk = (at: string): void => {
      let entries: Dirent[];
      try {
        entries = readdirSync(at, { withFileTypes: true });
      } catch {
        return; // no folder yet: a workspace with nothing to listen against has none
      }
      for (const e of entries) {
        const abs = join(at, e.name);
        if (e.isDirectory()) {
          walk(abs);
          continue;
        }
        if (!e.isFile() || !isReferenceFile(e.name)) continue;
        // The size is the one thing a listing can say without decoding; an unstattable file is 0.
        let bytes = 0;
        try {
          bytes = statSync(abs).size;
        } catch {}
        out.push({
          path: this.toRel(abs),
          name: referenceName(e.name),
          bytes,
        });
      }
    };
    walk(join(this.root, REFERENCES_DIR));
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Make an empty module in one of those libraries, creating the folder on the way. */
  createModule(root: string, rel: string): { path: string; dir: string } {
    const segs = rel.split("/").filter(Boolean);
    // At least a TYPE folder and a name: `audio/reverb` is the shortest thing the loader will key.
    if (segs.length < 2)
      throw new Error(
        `a module is named <type>/<name> — '${rel}' names no type folder`,
      );
    for (const seg of segs)
      if (!/^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(seg))
        throw new Error(`'${seg}' is not something a folder can be called`);
    // Through safePath, so a `..` in either part cannot leave the workspace.
    const dir = this.safePath(`${root}/${segs.join("/")}`);
    this.assertLibraryWritable(dir, "create a module in");
    const file = join(dir, "module.yaml");
    if (wsExists(file))
      throw new Error(`${this.toRel(realPath(file))} already exists`);
    mkdirSync(dir, { recursive: true });
    wsWrite(file, `# ${segs[segs.length - 1]}\nplugin:\n  type: \n  name: \n`);
    this.invalidateProjectDoc();
    return { path: this.toRel(realPath(file)), dir: this.toRel(dir) };
  }

  /** The named bases the module at `rel` may be set to, ancestors included — docs/workspace.md. */
  moduleBases(rel: string): string[] {
    const abs = this.safePath(rel);
    const dir = this.activeProject ?? this.root;
    try {
      const refs = withModuleStamp(dir, () => loadModuleRefs(dir)) as Record<
        string,
        { extends?: unknown; folderAbs?: unknown }
      >;
      // The module is addressed by its FILE, so its folder is that file's, and its `extends` the map's.
      const folderAbs = dirname(abs);
      const self = Object.values(refs).find((m) => m.folderAbs === folderAbs);
      return moduleBaseChoices({ folderAbs, extends: self?.extends }, refs);
    } catch {
      return [];
    }
  }

  /** Where a named BASE goes: `base/<name>.vstpreset` beside the module file — docs/workspace.md. */
  baseSnapshotPath(rel: string, name: string): { abs: string; path: string } {
    const moduleAbs = this.safePath(rel);
    const clean = basename(name).replace(/[\\/]/g, "").trim();
    if (!clean || clean === "." || clean === "..")
      throw new Error(`invalid name: ${name}`);
    // Spelt once whether or not the user typed it: `warm` and `warm.vstpreset` are one base.
    const leaf = clean.endsWith(".vstpreset") ? clean : `${clean}.vstpreset`;
    const dir = this.safePath(this.toRel(join(dirname(moduleAbs), "base")));
    const abs = this.safePath(this.toRel(join(dir, leaf)));
    this.assertLibraryWritable(abs, "snapshot a base into");
    mkdirSync(dir, { recursive: true });
    return { abs, path: this.toRel(abs) };
  }

  /** The project list, re-scanned at most this often — see `workspaceInfo` and docs/workspace.md. */
  private static readonly PROJECTS_RESCAN_MS = 5_000;
  private projectsCache: { at: number; list: string[] } | null = null;

  /** What the workspace holds and which project is open — polled every 2 s, docs/workspace.md. */
  workspaceInfo(): WorkspaceInfo {
    return {
      root: this.root,
      rootIsProject: this.rootIsProject,
      activeProject: this.activeProject ? this.toRel(this.activeProject) : null,
      projects: this.projects(),
    };
  }

  /** The list itself, behind the window above. */
  private projects(): string[] {
    const hit = this.projectsCache;
    if (hit && Date.now() - hit.at < Workspace.PROJECTS_RESCAN_MS)
      return hit.list;
    // From the ROOT, not `tree()`, and through the walk the home page's listing shares.
    const list = projectDirsUnder(this.root);
    if (this.rootIsProject) list.unshift(".");
    this.projectsCache = { at: Date.now(), list };
    return list;
  }

  read(rel: string): FileContent {
    const abs = this.safePath(rel);
    if (isBinary(basename(abs)))
      return { path: rel, binary: true, content: "" };
    // A .k7x path is served as written; a YAML name reads a .k7x file as YAML (packages/song/docs/k7xFiles.md).
    const content = isK7xPath(abs) ? readFileSync(abs, "utf8") : wsRead(abs);
    return { path: rel, binary: false, content };
  }

  /** Save a file, forking a `_modules` one instead of refusing it — see docs/workspace.md. */
  // `_modules` and `_libraries/<name>/…` are both ORDINARY paths now — a module lives at `@workspace`
  // or `@<name>` and is edited in place, there being no project-local copy left to fork into instead
  // (docs/workspace.md). Renaming or deleting either is still refused, by guardShared elsewhere.
  write(
    rel: string,
    content: string,
  ): { forked?: ForkedModule; pushed?: boolean } {
    const abs = this.safePath(rel);
    this.assertLibraryWritable(abs, "write");
    if (isBinary(basename(abs))) throw new Error("cannot edit a binary file");
    mkdirSync(dirname(abs), { recursive: true });
    if (isK7xPath(abs)) writeFileAtomic(abs, content);
    else wsWrite(abs, content);
    this.invalidateProjectDoc();
    return {};
  }

  /** Drop a file into `dir` under `name`, which may carry FOLDERS. Binary-safe, EEXIST rather than clobber. */
  uploadFile(dir: string, name: string, bytes: Buffer): { path: string } {
    const segs = name
      .split(/[\\/]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!segs.length || segs.some((s) => s === "." || s === ".."))
      throw new Error(`invalid filename: ${name}`);
    const clean = segs.join("/");
    const base = dir && dir !== "." ? dir.replace(/\/+$/, "") : "";
    const rel = base ? `${base}/${clean}` : clean;
    const abs = this.safePath(rel);
    this.guardShared(abs, "add a file to");
    if (existsSync(abs)) {
      const err = new Error(`already exists: ${rel}`) as NodeJS.ErrnoException;
      err.code = "EEXIST";
      throw err;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileAtomic(abs, bytes);
    this.invalidateProjectDoc();
    return { path: this.toRel(abs) };
  }

  /** Make an empty folder `name` inside `dir` — uploadFile's shape, and no guardMutable. */
  createFolder(dir: string, name: string): { path: string } {
    const clean = basename(name).replace(/[\\/]/g, "").trim();
    if (!clean || clean === "." || clean === "..")
      throw new Error(`invalid folder name: ${name}`);
    const base = dir && dir !== "." ? dir.replace(/\/+$/, "") : "";
    const rel = base ? `${base}/${clean}` : clean;
    const abs = this.safePath(rel);
    this.guardShared(abs, "create a folder in");
    if (this.isRecycled(abs))
      throw new Error("can't create a folder in the recycle bin");
    if (existsSync(abs)) {
      const err = new Error(`already exists: ${rel}`) as NodeJS.ErrnoException;
      err.code = "EEXIST";
      throw err;
    }
    mkdirSync(abs, { recursive: true });
    // The compiler reads nothing new, but the token is what refreshes the tree.
    this.invalidateProjectDoc();
    return { path: this.toRel(abs) };
  }

  /** `_modules`'s own STRUCTURE is fixed to every route — its files are edited in place, never renamed, moved or deleted this way — see docs/workspace.md. */
  /** A library is written only by an admin, whose account overlays it writable — docs/libraries.md. */
  assertLibraryWritable(abs: string, verb = "change"): void {
    const lib = libraryOf(abs);
    if (lib && !isLibraryRootEditable(lib))
      throw new Error(
        isLibraryEditable(lib.name)
          ? `can't ${verb} '${this.toRel(abs)}': a published version never changes — edit the draft`
          : `can't ${verb} '${this.toRel(abs)}': only the origin's admins edit a library`,
      );
  }

  private guardShared(abs: string, verb: string): void {
    this.assertLibraryWritable(abs, verb);
    if (isInSharedModules(this.toRel(abs)))
      throw new Error(
        `can't ${verb} '${this.toRel(abs)}': a shared module is edited in place — ` +
          `change its files directly, or run 'module populate' to rebuild it`,
      );
  }

  // Never the root, the recycle bin, or the active project's own folder — but anything INSIDE it is fair game.
  private guardMutable(abs: string, verb: string): void {
    if (abs === this.root) throw new Error(`can't ${verb} the workspace root`);
    // A library is added and removed from the origin's list, never from a workspace's tree.
    const lib = abs === librariesHome() ? null : libraryOf(abs);
    if (abs === librariesHome() || lib?.root === abs)
      throw new Error(
        `can't ${verb} '${this.toRel(abs)}': the libraries are listed by the admins, not moved from a workspace`,
      );
    this.guardShared(abs, verb);
    if (this.isRecycled(abs))
      throw new Error(`'${this.toRel(abs)}' is already in the recycle bin`);
    if (
      this.activeProject &&
      (abs === this.activeProject || this.activeProject.startsWith(abs + sep))
    )
      throw new Error(
        `can't ${verb} the active project's folder — stop it first, then ${verb} it`,
      );
  }

  // Rename within the same parent: workspace-sandboxed, no clobber, Windows-handle-retry.
  async renameEntry(
    rel: string,
    newName: string,
  ): Promise<{ path: string; repointed?: string[] }> {
    const abs = this.safePath(rel);
    this.guardMutable(abs, "rename");
    // A library module's ref IS its path: renaming it, or a folder of them, repoints every ref (song docs/moduleMove.md).
    const library = libraryOf(abs);
    const oldRef = library ? refAt(library, abs) : null;
    if (library && oldRef) assertNotEngine(library, abs);
    // A single path segment — no separators or traversal (the new name stays in place).
    const clean = basename(newName).replace(/[\\/]/g, "").trim();
    if (!clean || clean === "." || clean === "..")
      throw new Error(`invalid name: ${newName}`);
    const destAbs = this.safePath(this.toRel(join(dirname(abs), clean)));
    if (destAbs === abs) return { path: this.toRel(abs) }; // no-op rename to the same name
    if (existsSync(destAbs)) {
      const err = new Error(
        `already exists: ${this.toRel(destAbs)}`,
      ) as NodeJS.ErrnoException;
      err.code = "EEXIST";
      throw err;
    }
    // Release our own handles first; renameWithRetry covers a watcher's that lingers.
    this.cancelPrewarm();
    await renameWithRetry(abs, destAbs);
    const newRef = library ? refAt(library, destAbs) : null;
    const repointed =
      library && oldRef && newRef
        ? repointRefs([library.root, this.root], oldRef, newRef, true)
        : [];
    this.invalidateProjectDoc();
    return {
      path: this.toRel(destAbs),
      ...(repointed.length
        ? { repointed: repointed.map((f) => this.toRel(f)) }
        : {}),
    };
  }

  /** Move an entry into another folder — renameEntry's three concerns, plus the self-descent check. */
  async moveEntry(rel: string, toDir: string): Promise<{ path: string }> {
    const abs = this.safePath(rel);
    this.guardMutable(abs, "move");
    const destDir = this.safePath(toDir);
    this.guardShared(destDir, "move into"); // the destination too — a move IN is a write
    if (!existsSync(destDir) || !statSync(destDir).isDirectory())
      throw new Error(`not a folder: ${toDir}`);
    if (this.isRecycled(destDir))
      throw new Error(
        "can't move something into the recycle bin — delete it instead",
      );
    if (destDir === dirname(abs)) return { path: this.toRel(abs) }; // already there
    if (destDir === abs || destDir.startsWith(abs + sep))
      throw new Error(`can't move '${basename(abs)}' into itself`);
    const destAbs = join(destDir, basename(abs));
    if (existsSync(destAbs)) {
      const err = new Error(
        `already exists: ${this.toRel(destAbs)}`,
      ) as NodeJS.ErrnoException;
      err.code = "EEXIST";
      throw err;
    }
    this.cancelPrewarm();
    await renameWithRetry(abs, destAbs);
    this.invalidateProjectDoc();
    return { path: this.toRel(destAbs) };
  }

  /** Move a LIBRARY module to another folder of its library, repointing every ref to it here — song docs/moduleMove.md. */
  async moveLibraryModule(
    rel: string,
    toDir: string,
  ): Promise<{ path: string; from: string; to: string; repointed: string[] }> {
    const abs = this.safePath(rel);
    const destDir = this.safePath(toDir);
    const library = libraryOf(abs);
    if (!library)
      throw new Error(`${rel} is not in one of the account's libraries`);
    this.assertLibraryWritable(abs, "move");
    if (libraryOf(destDir)?.name !== library.name)
      throw new Error(
        `a module stays in its library — this one is ${library.name}'s`,
      );
    this.guardMutable(abs, "move");
    const plan = planModuleMove(library, abs, destDir);
    this.cancelPrewarm();
    await renameWithRetry(abs, plan.dest);
    // The library itself first — its chains, assemblies and modules — then every song of this workspace.
    const repointed = repointRefs(
      [library.root, this.root],
      plan.from,
      plan.to,
    );
    this.invalidateProjectDoc();
    return {
      path: this.toRel(plan.dest),
      from: plan.from,
      to: plan.to,
      repointed: repointed.map((f) => this.toRel(f)),
    };
  }

  // Delete by moving into the recycle bin — reversible and hidden, like deleteProject.
  async deleteEntry(rel: string): Promise<{ recycled: string }> {
    const abs = this.safePath(rel);
    this.guardMutable(abs, "delete");
    // A library keeps its own bin at its root: it may sit on another disk than the workspace's.
    const lib = libraryOf(abs);
    const bin = join(lib ? lib.root : this.root, RECYCLE_DIR);
    mkdirSync(bin, { recursive: true });
    // Don't clobber an earlier deletion of the same name — suffix a counter.
    const base = basename(abs);
    let dest = join(bin, base);
    for (let n = 2; existsSync(dest); n++) dest = join(bin, `${base}-${n}`);
    this.cancelPrewarm();
    await renameWithRetry(abs, dest);
    this.invalidateProjectDoc();
    return { recycled: this.toRel(dest) };
  }

  // Clone a module folder under a new name; `rel` may be the folder or any file inside it.
  cloneModule(rel: string, newName: string): { path: string } {
    const abs = this.safePath(rel);
    // A clone copies the whole folder, so the MODULE is what's cloned whichever of its files the caller had open.
    let modDir = abs;
    if (PROJECT_FILE.test(basename(abs))) modDir = dirname(abs);
    const category = basename(dirname(modDir));
    const name = basename(modDir);
    const dir = this.requireActive();
    const newPath = cloneModuleFile(dir, category, name, newName);
    this.invalidateProjectDoc();
    // Re-rooted to the workspace: a clone now lands in `_modules`, beside the project rather than under it.
    return { path: this.toRel(join(dir, newPath)) };
  }

  /** Add one USE of a module; the file lands in the project's flat `nodes/`, NOT under `rel`. */
  createNode(rel: string, node?: string): { path: string } {
    const abs = this.safePath(rel);
    let modDir = abs;
    if (PROJECT_FILE.test(basename(abs))) modDir = dirname(abs);
    const category = basename(dirname(modDir));
    const name = basename(modDir);
    const dir = this.requireActive();
    // Unnamed is the ordinary case, so `<module>_<n>` — no lane prefix, this one is not born in a chain.
    const newPath = createNode(
      dir,
      category,
      name,
      node || freeNodeName(dir, name),
    );
    this.invalidateProjectDoc();
    return { path: newPath };
  }

  /** The `ui.yaml` panel beside a module file, or the path it WOULD take plus a scaffold. */
  moduleUi(rel: string): {
    ref: string;
    path: string;
    content: string;
    exists: boolean;
  } {
    const abs = this.safePath(rel);
    const dir = this.requireActive();
    const ref = sharedModuleRef(dir, abs)?.ref ?? this.localModuleRef(dir, abs);
    if (!ref) throw new Error(`${this.toRel(abs)} is not a module file`);

    return this.sidecar(abs, ref, UI_FILE, () =>
      uiFileText({ cols: 4, rows: 2, widgets: {} }, `panel for ${ref}`),
    );
  }

  /** The console systems the libraries hold, and the one this project runs — packages/song/docs/console.md. */
  consoles(): { systems: ConsoleSystem[]; current?: string } {
    return this.consolesIn(this.requireActive());
  }
  private consolesIn(dir: string): {
    systems: ConsoleSystem[];
    current?: string;
  } {
    let current: string | undefined;
    try {
      const root = parseYaml(wsRead(join(dir, "project.yaml"))) as {
        project?: { console?: unknown };
      };
      if (typeof root?.project?.console === "string")
        current = root.project.console;
    } catch {
      current = undefined; // no project.yaml, or one that will not read: the compile says so, not this
    }
    return { systems: consoleSystems(loadModuleRefs(dir)), current };
  }

  /** The engines a module file's folder holds, and the one it runs — packages/song/docs/engines.md. */
  moduleEngines(rel: string): { engines: string[]; engine?: string } {
    return enginesBeside(this.safePath(rel));
  }

  // One of the module's own files beside `abs`, or the path it would take plus `scaffold()`.
  private sidecar(
    abs: string,
    ref: string,
    name: string,
    scaffold: () => string,
  ): { ref: string; path: string; content: string; exists: boolean } {
    const path = join(dirname(abs), name);
    const exists = existsSync(path);
    return {
      ref,
      path: this.toRel(path),
      content: exists ? readFileSync(path, "utf8") : scaffold(),
      exists,
    };
  }

  // "…/modules/<type>/<name>/<file>" -> the ref the loader keys that module by; null for anything else.
  private localModuleRef(dir: string, abs: string): string | null {
    const segs = relative(dir, abs).split(sep);
    if (segs.length < 4 || segs[0] !== "modules") return null;
    // Everything between the TYPE and the file is the name, so a FILED module keys too.
    return moduleRefOf(segs[1], segs.slice(2, -1).join("/"));
  }

  /** Read the file back after a save, formatting NOTHING — both editors call it and use the reply. */
  fmt(rel: string): FileContent {
    return this.read(rel);
  }

  /** A derived view memoised on the revision token; `build` may only READ — docs/workspace.md. */
  private derived = new Map<
    string,
    { dir: string; rev: string; value: unknown }
  >();
  private onRevision<T>(key: string, build: (dir: string) => T, empty: T): T {
    try {
      const dir = this.requireActive();
      const { rev } = this.revision();
      const hit = this.derived.get(key);
      if (hit && hit.dir === dir && hit.rev === rev) return hit.value as T;
      const value = build(dir);
      this.derived.set(key, { dir, rev, value });
      return value;
    } catch {
      return empty; // no project open, or a folder that will not read — never a cached answer
    }
  }

  /** The declared I/O — what the panel lists and meters. Empty with no project open. */
  ioPorts(): IoPort[] {
    return this.onRevision("ioPorts", (dir) => ioPorts(dir), []);
  }

  /** The shared `_modules` catalogue, with workspace-relative paths like everything on the wire. */
  moduleCatalogue(): CatalogueModule[] {
    return this.onRevision(
      "moduleCatalogue",
      (dir) =>
        // An ENGINE module has no file — `path` stays absent rather than becoming "".
        moduleCatalogue(dir).map((m) => ({
          ...m,
          path: m.path ? this.toRel(m.path) : undefined,
        })),
      [],
    );
  }

  /** Just the base modules, each with the name it calls itself — its own route so the graph's `+` picker never waits on `hints()`. */
  baseModules(): BaseModuleRef[] {
    return this.onRevision("baseModules", (dir) => listBaseModuleRefs(dir), []);
  }

  /** The editor's completion vocabulary, memoised on the revision like the graph — docs/workspace.md. */
  private hintsCache: { dir: string; rev: string; hints: Hints } | null = null;

  hints(): Hints {
    try {
      const dir = this.requireActive();
      const { rev } = this.revision();
      const hit = this.hintsCache;
      if (hit && hit.dir === dir && hit.rev === rev) return hit.hints;
      const hints = {
        ...projectHints(dir),
        pluginNames: scannedPluginNames(),
        projectRoot: dir,
      };
      this.hintsCache = { dir, rev, hints };
      return hints;
    } catch {
      return {
        baseModules: [],
        ioSinks: [],
        modules: [],
        tracks: [],
        channels: [],
        clips: [],
        videoTracks: [],
        sequences: [],
        chains: [],
        moduleAssets: {},
        paramsByBase: {},
        paramMetaByBase: {},
        racks: {},
        keywords: [],
        pluginNames: {},
        paths: {},
        projectRoot: "",
        media: {},
      };
    }
  }

  // --- waveform cache (see waveformOps.ts) ----------------------------------
  async waveform(
    clipId: string,
    buckets: number = DEFAULT_WF_BUCKETS,
    whole = false,
    sensitivity?: number,
  ): Promise<WebWaveform> {
    return this.wf.waveform(clipId, buckets, whole, sensitivity);
  }

  // --- export / share -------------------------------------------------------

  // The export acts live in `shareOps.ts` and reach the workspace only through the host below.
  private shareHost(): ShareHost {
    return {
      root: this.root,
      requireActive: () => this.requireActive(),
      cachedProjectDoc: (dir) => this.cachedProjectDoc(dir),
    };
  }

  /** Render the mixdown ("mp3" transcodes, needing ffmpeg) — see shareOps.ts. */
  exportMix(format: "wav" | "mp3"): Promise<{
    path: string;
    filename: string;
    mime: string;
    cleanup: () => void;
  }> {
    return exportMix(this.shareHost(), format);
  }

  /** Start `project share link`: a share at a checkpoint, made as a job — shareLink.ts. */
  startShareLink(userEmail: string): void {
    startShareLink(
      { root: this.root, requireActive: () => this.requireActive() },
      userEmail,
    );
  }

  /** Where that job is, for the progress bar; null when none was asked for. */
  shareLinkProgress(): ShareProgress | null {
    return shareProgress(this.root);
  }

  /** Publish to k7; an unknown song throws NEEDS_META, which the route turns into a prompt. */
  async shareK7(opts: { artist?: string; title?: string }): Promise<K7Result> {
    return shareK7(this.shareHost(), opts);
  }

  // Resolve a play-button request to a file + window: an absolute path (guarded), else a clip id, else a media path.
  resolvePreview(req: PreviewReq): {
    file: string;
    start: number;
    length: number;
  } {
    const dir = this.requireActive();
    // A clip's source is text a file holds: inside the project's roots or nothing (@studio/song docs/confine.md).
    const confinedSource = (source: string): string => {
      const abs = confineToProject(dir, source);
      if (!abs) throw new Error("audio path is outside the project");
      return abs;
    };
    // A clip id / media path / absolute audio path -> an absolute file within the root.
    const resolveSource = (spec: string): string => {
      if (!spec) throw new Error("preview: empty source");
      if (isAbsolute(spec) && AUDIO_EXT.test(spec)) {
        const abs = resolve(spec);
        // A library module's own audio is the other place a preview may play from.
        if (!this.withinRoot(abs) && !libraryOf(abs))
          throw new Error("audio path is outside the workspace");
        return abs;
      }
      let clip: ClipDoc | null | undefined;
      try {
        clip =
          findClip(this.cachedProjectDoc(dir), spec) ??
          loadAudioClipDoc(dir, spec);
      } catch {
        clip = undefined; // not a clip id — try it as a plain path below
      }
      if (clip && clip.type === "audio") return confinedSource(clip.source);
      const abs = resolve(dir, spec);
      // …or in a library's shared SOUNDS, where a rack tap's sample and a cabinet IR live (@studio/song's libraryFiles.md).
      if (!this.withinRoot(abs) && !inLibrarySounds(abs))
        throw new Error("audio path is outside the workspace");
      if (!existsSync(abs)) throw new Error(`no audio for '${spec}'`);
      return abs;
    };
    if (req.kind === "clip") {
      const p = this.cachedProjectDoc(dir);
      // The grid, so a TIMECODE `from:`/`to:` becomes seconds here as it does in the compiler.
      const grid = {
        tempo: p.tempo,
        num: p.timeSigNumerator,
        den: p.timeSigDenominator,
      };
      // A clip id may name a PLACEMENT (`bass_2_0@16`); the definition is keyed by the material.
      const clip =
        findClip(p, req.clip) ??
        loadAudioClipDoc(dir, materialRefOf(req.clip), grid);
      if (!clip) throw new Error(`no clip '${req.clip}'`);
      if (clip.type !== "audio")
        throw new Error(`'${req.clip}' is not an audio clip`);
      // The clip's own WINDOW, not the whole file — see docs/workspace.md.
      const start = Math.max(0, clip.sourceFrom ?? 0);
      const to = clip.sourceTo ?? 0;
      return {
        file: confinedSource(clip.source),
        start,
        length: to > start ? to - start : 0,
      };
    }
    if (req.kind === "slice") {
      const from = Math.max(0, req.from);
      return {
        file: resolveSource(req.source),
        start: from,
        length: Math.max(0, req.to - from),
      };
    }
    // kind === "source": the whole file.
    return { file: resolveSource(req.source), start: 0, length: 0 };
  }

  waveformStatus(): WaveformStatus {
    return this.wf.status();
  }

  /** Stop any in-flight prewarm (called before a delete/rename) — see waveformOps.ts. */
  cancelPrewarm(): void {
    this.wf.cancel();
  }

  async prewarmWaveforms(buckets: number = DEFAULT_WF_BUCKETS): Promise<void> {
    return this.wf.prewarm(buckets);
  }

  /** Everything wrong with the project, from the compile itself, in BOTH scopes — docs/workspace.md. */
  projectErrors(): { errors: string[]; diagnostics: Diagnostic[] } {
    return this.onRevision(
      "projectErrors",
      (dir) =>
        this.withRevision(() =>
          withModuleStamp(dir, () => this.projectErrorsIn(dir)),
        ),
      { errors: [], diagnostics: [] },
    );
  }
  private projectErrorsIn(dir: string): {
    errors: string[];
    diagnostics: Diagnostic[];
  } {
    try {
      const doc = this.cachedProjectDoc(dir);
      // Clean — but the non-blocking WARNINGS below surface here or nowhere at all.
      return {
        errors: [],
        diagnostics: [
          ...notSupportedModules(dir),
          // A curve the engine will refuse, which it otherwise only logs.
          ...deadAutomations(dir, doc),
          ...libraryModuleIssues(dir),
          ...deadProjectFields(dir),
          // A `surfaces/` file that is THERE and malformed draws nothing, and says nothing either.
          ...surfaceIssues(dir),
          // …and an assembly whose template is not in the library draws a box with no plugs.
          ...assemblyIssues(dir),
        ],
      };
    } catch (e) {
      const diagnostics = parseCompileError((e as Error).message);
      const errors = diagnostics.length
        ? diagnostics.map((d) => `${d.file}: ${d.message}`)
        : [(e as Error).message];
      return { errors, diagnostics };
    }
  }

  /** The compiled document itself, UNFOLDED — the caller sends, the caller folds. */
  engineDoc(): ProjectDoc {
    return this.cachedProjectDoc(this.requireActive());
  }

  /** The compiled song as the BROWSER wants it, memoised on the revision — docs/workspace.md. */
  private webDocCache: { dir: string; rev: string; doc: WebProject } | null =
    null;

  projectDoc(): WebProject {
    return this.withRevision(() => {
      const dir = this.requireActive();
      const { rev } = this.revision();
      const hit = this.webDocCache;
      if (hit && hit.dir === dir && hit.rev === rev) return hit.doc;
      const doc = webProjectOf(this.cachedProjectDoc(dir));
      this.webDocCache = { dir, rev, doc };
      return doc;
    });
  }

  /** The same folder read as PICTURE, in a SECOND cache on the same token — docs/workspace.md. */
  cachedVideoDoc(dir: string): VideoProjectDoc {
    const rev = this.revision().rev;
    if (
      this.videoCache &&
      this.videoCache.dir === dir &&
      this.videoCache.rev === rev
    )
      return this.videoCache.doc;
    const doc = loadVideoProject(dir);
    this.videoCache = { dir, rev, doc };
    return doc;
  }

  /** The project's picture, or an EMPTY one when it has none — never a throw, since every song may carry one. */
  videoProjectDoc(): WebVideoProject {
    const dir = this.requireActive();
    if (!hasPicture(dir))
      return {
        name: basename(dir),
        viewport: [0, 0],
        fps: 0,
        duration: 0,
        markers: [],
        videoTracks: [],
        framePlugins: [],
        transitions: {},
        stretches: {},
      };
    const p = this.cachedVideoDoc(dir);
    const videoTracks = toWebVideoTracks(p.videoTracks, (a) => this.toRel(a));
    return {
      name: p.name,
      viewport: p.viewport,
      fps: p.fps,
      duration: videoDuration(p.videoTracks),
      markers: p.markers.map((m) => ({ sec: m.sec, name: m.name, tc: m.tc })),
      videoTracks,
      framePlugins: p.framePlugins.map((pl) =>
        webPlugin(pl, (a) => this.toRel(a)),
      ),
      transitions: Object.fromEntries(
        Object.entries(p.transitions).map(([k, t]) => [
          k,
          { ...t, params: { ...t.params } },
        ]),
      ),
      stretches: Object.fromEntries(
        Object.entries(p.stretches).map(([k, run]) => [
          k,
          run.map((pl) => webPlugin(pl, (a) => this.toRel(a))),
        ]),
      ),
    };
  }

  /** Everything wrong with a song's PICTURE — the compile's own throw, same shape as projectErrors. */
  videoProjectErrors(): { errors: string[]; diagnostics: Diagnostic[] } {
    const dir = this.activeProject;
    // No lanes is not an error, for the same reason the document above is empty rather than a throw.
    if (!dir || !hasPicture(dir)) return { errors: [], diagnostics: [] };
    try {
      // A picture that BUILT can still be wrong — a shot naming no clip draws nothing and, without
      // this, said nothing either. A throw is the other case: a picture that cannot be built at all.
      return { errors: this.cachedVideoDoc(dir).warnings, diagnostics: [] };
    } catch (e) {
      return { errors: [(e as Error).message], diagnostics: [] };
    }
  }

  /** The routing graph the Chains tab draws — graphDoc.ts, memoised on `revision()`, docs/workspace.md. */
  private graphCache: { dir: string; rev: string; graph: WebGraph } | null =
    null;

  /** The project's declared surfaces, parsed, and deliberately NOT cached — docs/workspace.md. */
  surfaces(): ReturnType<typeof projectSurfaces> {
    return projectSurfaces(this.requireActive());
  }

  /** The clip extents the graph draws its mini timelines from, off the MEMOISED compile, or nothing. */
  private clipExtents(dir: string): ClipExtents | undefined {
    try {
      return clipExtentsOf(this.cachedProjectDoc(dir));
    } catch {
      return undefined;
    }
  }

  /** …and each lane's colour, off the same compile: a lane that states none takes its category's shade there. */
  private trackColors(dir: string): Record<string, string> | undefined {
    try {
      return trackColorsOf(this.cachedProjectDoc(dir));
    } catch {
      return undefined;
    }
  }

  /** …and which node is each lane's fader, off the same compile: `graph.yaml` does not say what a module IS. */
  private trackMixers(dir: string): TrackMixers | undefined {
    try {
      return trackMixersOf(this.cachedProjectDoc(dir));
    } catch {
      return undefined;
    }
  }

  // `at` builds the graph of a folder OTHER than the open project — a library chain, for the builder.
  graphDoc(at?: string): WebGraph {
    // TWO scopes for the whole derivation, one level apart — see docs/workspace.md.
    return this.withRevision(() =>
      withModuleStamp(at ?? this.activeProject ?? this.root, () =>
        this.graphDocIn(at),
      ),
    );
  }
  private graphDocIn(at?: string): WebGraph {
    const dir = at ?? this.requireActive();
    // The token describes the ACTIVE project; for anything else there is nothing honest to key on, so build it.
    if (dir !== this.activeProject)
      return buildGraphDoc(
        dir,
        this.clipExtents(dir),
        this.trackMixers(dir),
        undefined,
        this.trackColors(dir),
      );
    const { rev } = this.revision();
    const hit = this.graphCache;
    if (hit && hit.dir === dir && hit.rev === rev) return hit.graph;
    const graph = buildGraphDoc(
      dir,
      this.clipExtents(dir),
      this.trackMixers(dir),
      this.autoFreezes(),
      this.trackColors(dir),
    );
    this.graphCache = { dir, rev, graph };
    return graph;
  }

  projectInfo(): ProjectInfo {
    const dir = this.activeProject ?? this.root;
    let name = basename(dir);
    try {
      const root = parseYaml(wsRead(join(dir, "project.yaml"))) as {
        project?: { name?: unknown };
      } | null;
      if (typeof root?.project?.name === "string") name = root.project.name;
    } catch {
      /* no project.yaml — keep the folder name */
    }
    return { name, root: dir };
  }
}
