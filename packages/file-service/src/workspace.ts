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
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  scannedPluginNames,
  scannedPlugins,
} from "@studio/engine-client/pluginCache";
// WebGraph is graph-model's, not web-protocol's: an app that draws chains needn't pull in auth and the registry.
import type { WebGraph } from "@studio/graph-model";
import { writeFileAtomic } from "@studio/song/atomicWrite";
import type { AutoFreeze } from "@studio/song/autoFreeze";
import { confineTo } from "@studio/song/confine";
import type { ConsoleSystem } from "@studio/song/console";
import { enginesBeside } from "@studio/song/engines";
import { loadGraph } from "@studio/song/graph";
import { projectHints } from "@studio/song/hints";
import { type IoPort, ioPorts } from "@studio/song/ioPorts";
import {
  type BaseModuleRef,
  type Diagnostic,
  listBaseModuleRefs,
  withModuleStamp,
} from "@studio/song/loader";
import { type MissingModel, missingModel } from "@studio/song/modelCache";
import {
  type CatalogueModule,
  moduleCatalogue,
} from "@studio/song/moduleCatalogue";
import type { ForkedModule } from "@studio/song/moduleFork";
import { compileWithAutoFreezes } from "@studio/song/nodeProject";
import {
  formatAudioDevice,
  formatChannels,
  loadPreferences,
  setEditorVim,
} from "@studio/song/preferences";
import type { ProjectDoc } from "@studio/song/project";
import { loadProjectWithFreezes } from "@studio/song/project";
import {
  isLibraryName,
  LIBRARIES_DIR,
  librariesHome,
  libraryOf,
  libraryRoot,
} from "@studio/song/sharedFolders";
import { hasPicture, projectSurfaces } from "@studio/song/surfaces";
import { ensureVideoRun } from "@studio/song/videoOutputs";
import { ACCOUNT_LIBRARY } from "@studio/song-schema/moduleTypes";
import type { ReferenceTrack } from "@studio/song-schema/reference";
import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import type { VideoProjectDoc } from "@studio/song-video/videoDoc";
import { loadVideoProject } from "@studio/song-video/videoProject";
import type { K7Result } from "@studio/take-render/render";
import type {
  FileContent,
  FileNode,
  Hints,
  ModuleLibrary,
  PreviewReq,
  ProjectErrors,
  ProjectInfo,
  ShareProgress,
  WaveformStatus,
  WebProject,
  WebVideoProject,
  WebWaveform,
  WorkspaceInfo,
} from "@studio/web-protocol";
import type { Compatibility } from "@studio/web-protocol/compat";
import { isWithin } from "@studio/web-protocol/paths";
import type { PlaylistInfo } from "@studio/web-protocol/playlists";
import {
  PROJECT_SUFFIXES,
  type ProjectApp,
  projectApp,
} from "@studio/web-protocol/projects";
import { readActiveMarker, writeActiveMarker } from "./activeMarker.ts";
import { guard } from "./background.ts";
import { isManagedDemo } from "./demos.ts";
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
import { resolvePreview } from "./previewSource.ts";
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
import { DEFAULT_WF_BUCKETS, WaveformOps } from "./waveformOps.ts";
import { webProjectOf } from "./webProject.ts";
import {
  EMPTY_HINTS,
  emptyVideoProject,
  ifCompiles,
  projectErrorsIn,
  projectInfoOf,
  webVideoProjectOf,
} from "./workspaceDocs.ts";
import {
  assertLibraryWritable,
  createFolderIn,
  deleteEntryIn,
  type EntriesHost,
  guardShared,
  moveEntryIn,
  moveLibraryModuleIn,
  refuseYamlName,
  renameEntryIn,
  renameWithRetry,
  uploadFileIn,
} from "./workspaceEntries.ts";
import { isBinary, RECYCLE_DIR, skip } from "./workspaceFilter.ts";
import { type Recorded, WorkspaceHistory } from "./workspaceHistory.ts";
import {
  fileTree,
  isProjectDir,
  playlistsIn,
  referencesIn,
} from "./workspaceListings.ts";
import {
  baseSnapshotPathOf,
  cloneModuleIn,
  consolesIn,
  createModuleIn,
  createNodeIn,
  libraryAssembliesOf,
  libraryChainsOf,
  type ModulesHost,
  moduleBasesOf,
  moduleLibrariesOf,
  moduleUiOf,
} from "./workspaceModules.ts";

export { isBinary, isProjectDir, skip };

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
export class Workspace {
  readonly root: string;
  readonly rootIsProject: boolean;
  private activeProject: string | null;
  // The automatic freezes come out of the same compile, so `autoFreezes()` never compiles again; absent when a doc was SET.
  private docCache: {
    dir: string;
    rev: string;
    doc: ProjectDoc;
    freezes?: AutoFreeze[];
  } | null = null;
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
  /** The project an `/open` set up in THIS process — a remembered one still gets its prewarm on its first open. */
  private opened: string | null = null;

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
    return isWithin(this.root, abs);
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
    return isWithin(join(this.root, RECYCLE_DIR), abs);
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
    // Opened again as it is: the revision token already sees any change to its files, so nothing is thrown away.
    if (this.opened === abs && this.activeProject === abs) return abs;
    this.opened = abs;
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
    guardShared((a) => this.toRel(a), abs, "rename");
    if (this.isRecycled(abs))
      throw new Error(`'${this.toRel(abs)}' is already in the recycle bin`);
    if (!isProjectDir(abs))
      throw new Error(
        `not a project (the folder must end in ${Object.values(PROJECT_SUFFIXES).join(", ")}): ${rel}`,
      );
    const clean = basename(newName).replace(/[\\/]/g, "").trim();
    // The SUFFIX is the app: renaming a `.k7` into anything else would stop it being a project.
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
    const wasActive = !!this.activeProject && isWithin(abs, this.activeProject);
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
    const { doc, freezes } = loadProjectWithFreezes(dir);
    this.docCache = { dir, rev, doc, freezes };
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
    return fileTree(abs, (a) => this.toRel(a));
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
      (dir) => {
        // Off the memoised compile when it holds them: one compile answers the doc and its freezes.
        this.cachedProjectDoc(dir);
        return this.docCache?.freezes ?? compileWithAutoFreezes(dir).freezes;
      },
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
    return moduleLibrariesOf(this.modulesHost());
  }

  /** The CHAINS the account's libraries hold, by `@<library>/<path>`: `path` is the chain's file, or a folder chain's folder. */
  libraryChains(): { ref: string; path: string; nodes: string[] }[] {
    return libraryChainsOf(this.modulesHost());
  }

  /** The ASSEMBLY templates the library holds — what the builder lists and `assembly new` completes on. */
  libraryAssemblies(): { ref: string; path: string; file: string }[] {
    return libraryAssembliesOf(this.modulesHost());
  }

  // The path guards workspaceModules.ts works through, without making safePath public API.
  private modulesHost(): ModulesHost {
    return {
      root: this.root,
      activeProject: () => this.activeProject,
      requireActive: () => this.requireActive(),
      safePath: (rel) => this.safePath(rel),
      toRel: (abs) => this.toRel(abs),
      tree: (abs) => this.walk(abs),
      assertLibraryWritable: (abs, verb) =>
        this.assertLibraryWritable(abs, verb),
      invalidateProjectDoc: () => this.invalidateProjectDoc(),
    };
  }

  /** The playlists this workspace holds, at the ROOT and at any depth — see docs/workspace.md. */
  playlists(): PlaylistInfo[] {
    return playlistsIn(this.root, (a) => this.toRel(a));
  }

  /** The reference tracks this workspace holds — `_references/` at any depth, see docs/workspace.md. */
  references(): ReferenceTrack[] {
    return referencesIn(this.root, (a) => this.toRel(a));
  }

  /** Make an empty module in one of those libraries, creating the folder on the way. */
  createModule(root: string, rel: string): { path: string; dir: string } {
    return createModuleIn(this.modulesHost(), root, rel);
  }

  /** The named bases the module at `rel` may be set to, ancestors included — docs/workspace.md. */
  moduleBases(rel: string): string[] {
    return moduleBasesOf(this.modulesHost(), rel);
  }

  /** Where a named BASE goes: `base/<name>.vstpreset` beside the module file — docs/workspace.md. */
  baseSnapshotPath(rel: string, name: string): { abs: string; path: string } {
    return baseSnapshotPathOf(this.modulesHost(), rel, name);
  }

  /** The project list, re-scanned at most this often — see `workspaceInfo` and docs/workspace.md. */
  private static readonly PROJECTS_RESCAN_MS = 5_000;
  private projectsCache: { at: number; list: string[] } | null = null;

  /** What the workspace holds and which project is open — polled every 2 s, docs/workspace.md. */
  workspaceInfo(): WorkspaceInfo {
    const active = this.activeProject ? this.toRel(this.activeProject) : null;
    return {
      root: this.root,
      rootIsProject: this.rootIsProject,
      activeProject: active,
      projects: this.projects(),
      // The editor warns on a demo: a restart overwrites it, edits and all (demos.ts).
      ...(active && isManagedDemo(basename(this.root), active)
        ? { activeIsDemo: true }
        : {}),
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
    return { path: rel, binary: false, content: readFileSync(abs, "utf8") };
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
    refuseYamlName(rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileAtomic(abs, content);
    this.invalidateProjectDoc();
    return {};
  }

  /** Drop a file into `dir` under `name`, which may carry FOLDERS. Binary-safe, EEXIST rather than clobber. */
  uploadFile(dir: string, name: string, bytes: Buffer): { path: string } {
    return uploadFileIn(this.entriesHost(), dir, name, bytes);
  }

  /** Make an empty folder `name` inside `dir` — uploadFile's shape, and no guardMutable. */
  createFolder(dir: string, name: string): { path: string } {
    return createFolderIn(this.entriesHost(), dir, name);
  }

  /** A library is written only by an admin, whose account overlays it writable — docs/libraries.md. */
  assertLibraryWritable(abs: string, verb = "change"): void {
    assertLibraryWritable((a) => this.toRel(a), abs, verb);
  }

  // Rename within the same parent: workspace-sandboxed, no clobber, Windows-handle-retry.
  renameEntry(
    rel: string,
    newName: string,
  ): Promise<{ path: string; repointed?: string[] }> {
    return renameEntryIn(this.entriesHost(), rel, newName);
  }

  /** Move an entry into another folder — renameEntry's three concerns, plus the self-descent check. */
  moveEntry(rel: string, toDir: string): Promise<{ path: string }> {
    return moveEntryIn(this.entriesHost(), rel, toDir);
  }

  /** Move a LIBRARY module to another folder of its library, repointing every ref to it here — song docs/moduleMove.md. */
  moveLibraryModule(
    rel: string,
    toDir: string,
  ): Promise<{ path: string; from: string; to: string; repointed: string[] }> {
    return moveLibraryModuleIn(this.entriesHost(), rel, toDir);
  }

  // Delete by moving into the recycle bin — reversible and hidden, like deleteProject.
  deleteEntry(rel: string): Promise<{ recycled: string }> {
    return deleteEntryIn(this.entriesHost(), rel);
  }

  // The path guards workspaceEntries.ts works through, without making safePath public API.
  private entriesHost(): EntriesHost {
    return {
      root: this.root,
      activeProject: () => this.activeProject,
      safePath: (rel) => this.safePath(rel),
      toRel: (abs) => this.toRel(abs),
      isRecycled: (abs) => this.isRecycled(abs),
      cancelPrewarm: () => this.cancelPrewarm(),
      invalidateProjectDoc: () => this.invalidateProjectDoc(),
    };
  }

  // Clone a module folder under a new name; `rel` may be the folder or any file inside it.
  cloneModule(rel: string, newName: string): { path: string } {
    return cloneModuleIn(this.modulesHost(), rel, newName);
  }

  /** Add one USE of a module; the file lands in the project's flat `nodes/`, NOT under `rel`. */
  createNode(rel: string, node?: string): { path: string } {
    return createNodeIn(this.modulesHost(), rel, node);
  }

  /** The `ui.k7x` panel beside a module file, or the path it WOULD take plus a scaffold. */
  moduleUi(rel: string): {
    ref: string;
    path: string;
    content: string;
    exists: boolean;
  } {
    return moduleUiOf(this.modulesHost(), rel);
  }

  /** The console systems the libraries hold, and the one this project runs — packages/song/docs/console.md. */
  consoles(): { systems: ConsoleSystem[]; current?: string } {
    return consolesIn(this.requireActive());
  }

  /** The engines a module file's folder holds, and the one it runs — packages/song/docs/engines.md. */
  moduleEngines(rel: string): { engines: string[]; engine?: string } {
    return enginesBeside(this.safePath(rel));
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
      return EMPTY_HINTS;
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

  // Resolve a play-button request to a file + window — previewSource.ts.
  resolvePreview(req: PreviewReq): {
    file: string;
    start: number;
    length: number;
  } {
    return resolvePreview(
      {
        requireActive: () => this.requireActive(),
        withinRoot: (abs) => this.withinRoot(abs),
        cachedProjectDoc: (dir) => this.cachedProjectDoc(dir),
      },
      req,
    );
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
  projectErrors(): ProjectErrors {
    return this.onRevision(
      "projectErrors",
      (dir) =>
        this.withRevision(() =>
          withModuleStamp(dir, () => this.projectErrorsIn(dir)),
        ),
      { errors: [], diagnostics: [] },
    );
  }
  private projectErrorsIn(dir: string): ProjectErrors {
    return projectErrorsIn(dir, () => this.cachedProjectDoc(dir));
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
    if (!hasPicture(dir)) return emptyVideoProject(dir);
    return webVideoProjectOf(this.cachedVideoDoc(dir), (a) => this.toRel(a));
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
    return ifCompiles(() => clipExtentsOf(this.cachedProjectDoc(dir)));
  }

  /** …and each lane's colour, off the same compile: a lane that states none takes its category's shade there. */
  private trackColors(dir: string): Record<string, string> | undefined {
    return ifCompiles(() => trackColorsOf(this.cachedProjectDoc(dir)));
  }

  /** …and which node is each lane's fader, off the same compile: `graph.k7x` does not say what a module IS. */
  private trackMixers(dir: string): TrackMixers | undefined {
    return ifCompiles(() => trackMixersOf(this.cachedProjectDoc(dir)));
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
    return projectInfoOf(this.activeProject ?? this.root);
  }
}
