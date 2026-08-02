// workspace.ts — the filesystem layer over ONE workspace root: file ops, the active
// project, and the compiled/waveform caches, all per-instance because the service
// serves many users' workspaces from one process. The active project is remembered in
// a `.lanes-active` dotfile in the root. Full rationale: docs/workspace.md.

import {
  type Dirent,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  MP3_CODEC,
  type Radiok7Result,
  readRadiok7Config,
  renderMixdown,
  shareToRadiok7,
  transcode,
} from "@studio/commands/render";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import { scannedPluginNames } from "@studio/engine-client/pluginCache";
import { projectHints } from "@studio/song/hints";
import { type IoPort, ioPorts } from "@studio/song/ioPorts";
import {
  cloneModuleFile,
  createModuleInstance,
  type Diagnostic,
  listBaseModules,
  moduleRefOf,
  notSupportedModules,
} from "@studio/song/loader";
import {
  type CatalogueModule,
  moduleCatalogue,
} from "@studio/song/moduleCatalogue";
import {
  type ForkedModule,
  forkSharedModule,
  sharedModuleRef,
} from "@studio/song/moduleFork";
import {
  formatAudioDevice,
  formatChannels,
  loadPreferences,
  setEditorVim,
} from "@studio/song/preferences";
import type {
  ClipDoc,
  ProjectDoc,
  TrackDoc,
  VideoTrackDoc,
} from "@studio/song/project";
import {
  loadAudioClipDoc,
  loadProject,
  trackMixer,
} from "@studio/song/project";
import { isInSharedModules } from "@studio/song/sharedFolders";
import {
  loadUiLibrary,
  SHARED_UI_PATH,
  uiFileText,
  uiPathFor,
} from "@studio/song/uiLibrary";
import { isProjectFolder } from "@studio/song/yaml/moduleIO";
import type {
  FileContent,
  FileNode,
  Hints,
  PreviewReq,
  ProjectInfo,
  WaveformStatus,
  WebGraph,
  WebMixer,
  WebProject,
  WebTrack,
  WebVideoTrack,
  WebWaveform,
  WorkspaceInfo,
} from "@studio/web-protocol";
import { buildGraphDoc } from "./graphDoc.ts";
import { createProjectIn, importDawprojectInto } from "./projectLifecycle.ts";
import {
  AUDIO_EXT,
  DEFAULT_WF_BUCKETS,
  findClip,
  WaveformOps,
} from "./waveformOps.ts";

export { DEFAULT_WF_BUCKETS } from "./waveformOps.ts";

// Turn a compiler error into editor diagnostics; a line with no "<file>: " prefix yields none but still counts.
function parseCompileError(msg: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const line of msg.split("\n")) {
    const m = /^\s*(\S+\.ya?ml)(?::(\d+))?:\s*(.+)$/i.exec(line);
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

// A lanes project is any directory with a project file.
export const isProjectDir = (dir: string): boolean => isProjectFolder(dir);

// Files shown in the tree but not editable as text.
const BINARY_EXT = new Set([
  ".wav",
  ".mp3",
  ".ogg",
  ".flac",
  ".vstpreset",
  ".png",
  ".ico",
  ".jpg",
  ".jpeg",
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".mkv",
]);
const isBinary = (name: string): boolean =>
  BINARY_EXT.has(extname(name).toLowerCase());

// Where deleted projects go — hidden by skip(), so "deleting" is a reversible move.
const RECYCLE_DIR = "_recycle_bin";

// A project FILE by name — every "file or folder?" test asks this rather than naming an extension.
const PROJECT_FILE = /\.ya?ml$/i;

// Hidden files and deps are never shown/edited.
const skip = (name: string): boolean =>
  name.startsWith(".") ||
  name === "node_modules" ||
  name === RECYCLE_DIR ||
  name.endsWith(".cache"); // engine-written waveform sidecars ({source}.cache)

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

// The strip a track's surfaces read: the mixer module at the end of its chain, flattened to the five numbers a
// fader panel needs plus the module ref an edit has to address. Spread into the WebTrack, so a track with no
// strip simply has no `mixer` key rather than one full of zeroes that look like settings.
function mixerOf(t: TrackDoc): { mixer?: WebMixer } {
  const p = trackMixer(t);
  if (!p) return {};
  const v = (name: string) => Number(p.params?.[name] ?? 0);
  return {
    mixer: {
      module: p.name,
      volume: v("Volume"),
      pan: v("Pan"),
      low: v("Low"),
      mid: v("Mid"),
      high: v("High"),
    },
  };
}

// TrackDoc[] -> the flat WebTrack[] the Timeline draws, root-independent so live lanes share it.
export function toWebTracks(tracks: TrackDoc[]): WebTrack[] {
  return tracks.map((t) => ({
    id: t.id,
    name: t.name,
    group: t.group,
    generated: t.generated,
    contentType: t.contentType,
    color: t.color,
    ...mixerOf(t),
    mute: t.mute,
    solo: t.solo,
    clips: t.clips.map((c) => ({
      id: c.id,
      type: c.type,
      name: c.name,
      start: c.start,
      length: c.length,
      loopStart: c.loopStart,
      loopEnd: c.loopEnd,
      warped: c.warp ? true : undefined,
      disabled: c.disabled ? true : undefined,
      notes: c.notes.map((n) => ({
        time: n.time,
        duration: n.duration,
        key: n.key,
      })),
    })),
    plugins: t.plugins.map((pl) => ({
      id: pl.id,
      type: pl.type,
      name: pl.name,
    })),
    docs: t.docs,
    todos: t.todos,
    frozen: t.frozen,
  }));
}

// The user's global preferences — per-MACHINE, not per-workspace, hence module-level.
export function preferences(): {
  audioDevice: string | null;
  channels: { in: string; out: string };
  vim: boolean;
} {
  const p = loadPreferences();
  return {
    audioDevice: p.audioDevice ? formatAudioDevice(p.audioDevice) : null,
    channels: formatChannels(p),
    vim: p.editor.vim,
  };
}

export function setVim(on: boolean): boolean {
  return setEditorVim(on).editor.vim;
}

// The per-workspace active-project marker; a dotfile, so skip() hides it from the tree.
const ACTIVE_MARKER = ".lanes-active";

export class Workspace {
  readonly root: string;
  /** `root` with symlinks resolved — what safePath compares against. */
  private readonly realRoot: string;
  readonly rootIsProject: boolean;
  private activeProject: string | null;
  private docCache: { dir: string; doc: ProjectDoc } | null = null;
  private mutations = 0; // half the change token — the half reacting to our own writes with no clock tick
  // The waveform machinery (slice + memo + prewarm) — see waveformOps.ts.
  private readonly wf: WaveformOps;

  constructor(root: string) {
    this.root = resolve(root);
    // Normally succeeds (the root exists); falls back to the lexical root if it raced away.
    try {
      this.realRoot = realpathSync(this.root);
    } catch {
      this.realRoot = this.root;
    }
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
      skip,
    });
  }

  // --- path guards (verbatim from store.ts, reading this.root) ---------------
  private withinRoot(abs: string): boolean {
    return abs === this.root || abs.startsWith(this.root + sep);
  }

  /**
   * Resolve `rel` inside the workspace, or throw.
   *
   * TWO gates, both needed:
   *  1. the lexical one — `resolve` + prefix — which catches `../` without a syscall;
   *  2. a realpath check, because `resolve` does NOT follow symlinks. A symlink planted
   *     in the workspace (by an unzip, a git checkout, a CLI run) pointing at ~/.ssh
   *     passes gate 1 happily, and `GET /file?path=link/id_rsa` would read straight
   *     through it.
   *
   * The trap in gate 2 is that `realpathSync` throws ENOENT for a path being CREATED,
   * which would break every write to a new file. So realpath the nearest ancestor that
   * exists and re-attach the rest: a component that doesn't exist yet cannot be a
   * symlink, so nothing is lost by not resolving it.
   */
  private safePath(rel: string): string {
    const abs = rel === "." ? this.root : resolve(this.root, rel);
    if (abs !== this.root && !abs.startsWith(this.root + sep))
      throw new Error(`path escapes the workspace: ${rel}`);

    let existing = abs;
    const tail: string[] = [];
    while (!existsSync(existing)) {
      const parent = dirname(existing);
      if (parent === existing) break; // hit the filesystem root
      tail.unshift(basename(existing));
      existing = parent;
    }
    let real: string;
    try {
      real = resolve(realpathSync(existing), ...tail);
    } catch {
      return abs; // unreadable ancestor — the lexical check already passed
    }
    if (real !== this.realRoot && !real.startsWith(this.realRoot + sep))
      throw new Error(`path escapes the workspace: ${rel}`);
    return abs;
  }
  private toRel(abs: string): string {
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
  private readActiveMarker(): string | null {
    try {
      const rel = readFileSync(join(this.root, ACTIVE_MARKER), "utf8").trim();
      return rel ? resolve(this.root, rel) : null;
    } catch {
      return null;
    }
  }
  private writeActiveMarker(abs: string): void {
    try {
      writeFileSync(
        join(this.root, ACTIVE_MARKER),
        this.toRel(abs) + "\n",
        "utf8",
      );
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
    if (!isProjectDir(abs))
      throw new Error(`not a project (no project.yaml): ${rel}`);
    this.activeProject = abs;
    this.writeActiveMarker(abs);
    this.invalidateProjectDoc();
    void this.prewarmWaveforms();
    return abs;
  }

  /**
   * Delete a project: move its folder into the workspace's _recycle_bin, returning the
   * recycled workspace-relative path. Not a destructive erase — recycled projects are
   * hidden from the tree (skip) and refused by setActiveProject, so they can't be
   * started, but the files survive for a manual restore.
   *
   * `beforeMove` runs with the project's ABSOLUTE path while it is still in place: the
   * caller unloads the engine and stops file watchers there, which on Windows must
   * happen before the directory can be renamed out from under them. If the project was
   * the active one, its active pointer + marker are cleared (the workspace then has no
   * active project until one is picked).
   */
  async deleteProject(
    rel: string,
    beforeMove?: (projectAbs: string) => void | Promise<unknown>,
  ): Promise<{ recycled: string }> {
    const abs = this.safePath(rel);
    if (abs === this.root) throw new Error("can't delete the workspace root");
    if (this.isRecycled(abs))
      throw new Error(`already in the recycle bin: ${rel}`);
    if (!isProjectDir(abs))
      throw new Error(`not a project (no project.yaml): ${rel}`);

    const wasActive = this.activeProject === abs;
    // Release every handle inside the folder before renaming (Windows EPERM): the prewarm, the engine and the watcher.
    this.cancelPrewarm();
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
        writeFileSync(join(this.root, ACTIVE_MARKER), "", "utf8"); // clear the reopen marker
      } catch {
        /* best-effort */
      }
      this.invalidateProjectDoc();
    }
    return { recycled: this.toRel(dest) };
  }

  // The path guards projectLifecycle.ts works through, without making safePath public API.
  private lifecycleHost() {
    return {
      root: this.root,
      safePath: (rel: string) => this.safePath(rel),
      toRel: (abs: string) => this.toRel(abs),
    };
  }

  /** Import a .dawproject archive into a NEW project folder — see projectLifecycle.ts. */
  importDawproject(rel: string): { project: string; log: string[] } {
    return importDawprojectInto(this.lifecycleHost(), rel);
  }

  /** Scaffold a NEW project folder at the workspace root — see projectLifecycle.ts. */
  createProject(type: "audio" | "video", rawName: string): { project: string } {
    return createProjectIn(this.lifecycleHost(), type, rawName);
  }

  // --- compiled-project cache ------------------------------------------------
  cachedProjectDoc(dir: string): ProjectDoc {
    if (this.docCache && this.docCache.dir === dir) return this.docCache.doc;
    const doc = loadProject(dir);
    this.docCache = { dir, doc };
    return doc;
  }
  setCachedProjectDoc(dir: string, doc: ProjectDoc): void {
    this.docCache = { dir, doc };
  }
  invalidateProjectDoc(): void {
    this.docCache = null;
    this.mutations++;
  }

  // A cheap token that changes when the project's sources do, so clients poll it instead of the derivations.
  // See docs/workspace.md for why it is a mutation counter plus a walk, and deliberately not a content hash.
  revision(): { rev: string } {
    const dir = this.activeProject;
    if (!dir) return { rev: `none:${this.mutations}` };
    let count = 0;
    let newest = 0;
    const walk = (abs: string): void => {
      let entries: Dirent[];
      try {
        entries = readdirSync(abs, { withFileTypes: true });
      } catch {
        return; // unreadable — treated as empty rather than failing the poll
      }
      for (const e of entries) {
        if (skip(e.name)) continue;
        const p = join(abs, e.name);
        if (e.isDirectory()) {
          walk(p);
          continue;
        }
        // The project's own files only — an out-of-band edit moves the token, a media copy doesn't.
        if (!PROJECT_FILE.test(e.name)) continue;
        count++;
        try {
          const m = statSync(p).mtimeMs;
          if (m > newest) newest = m;
        } catch {
          /* raced away between readdir and stat — the next poll sees it */
        }
      }
    };
    walk(dir);
    return { rev: `${this.mutations}:${count}:${newest}` };
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
      return e.isDirectory()
        ? {
            name: e.name,
            path,
            dir: true,
            project: isProjectDir(childAbs) || undefined,
            children: this.walk(childAbs),
          }
        : {
            name: e.name,
            path,
            dir: false,
            kind: isBinary(e.name) ? "binary" : "text",
          };
    });
  }
  tree(): FileNode[] {
    return this.walk(this.root);
  }

  workspaceInfo(): WorkspaceInfo {
    const projects: string[] = [];
    const collect = (nodes: FileNode[]): void => {
      for (const n of nodes)
        if (n.dir) {
          if (n.project) projects.push(n.path);
          if (n.children) collect(n.children);
        }
    };
    collect(this.tree());
    if (this.rootIsProject) projects.unshift(".");
    return {
      root: this.root,
      rootIsProject: this.rootIsProject,
      activeProject: this.activeProject ? this.toRel(this.activeProject) : null,
      projects,
    };
  }

  read(rel: string): FileContent {
    const abs = this.safePath(rel);
    if (isBinary(basename(abs)))
      return { path: rel, binary: true, content: "" };
    return { path: rel, binary: false, content: readFileSync(abs, "utf8") };
  }

  /**
   * Save a file — except in the shared module library, where the save lands on a project-local copy instead
   * and the chains are repointed at it (see moduleFork.ts). `forked` is what the editor needs to follow the
   * file it is now editing; a plain save returns nothing.
   *
   * There is NO opt-out. There used to be one, for the module builder that edited `_modules` in place; the
   * builder lives in the médiathèque now, which is the only editable catalogue, so a workspace's `_modules`
   * is read-only without exception — and the fork is what "read-only" does here instead of refusing.
   */
  write(rel: string, content: string): { forked?: ForkedModule } {
    const abs = this.safePath(rel);
    if (isInSharedModules(this.toRel(abs))) {
      const dir = this.requireActive();
      const forked = forkSharedModule(dir, abs, content);
      this.invalidateProjectDoc();
      // Re-rooted to the workspace, because that is the only path space the editor and the file tree speak.
      return {
        forked: { ...forked, path: this.toRel(join(dir, forked.path)) },
      };
    }
    if (isBinary(basename(abs))) throw new Error("cannot edit a binary file");
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
    this.invalidateProjectDoc();
    return {};
  }

  // Drop a file into `dir` under a safe single-segment name. Binary-safe, and throws EEXIST rather than clobbering.
  uploadFile(dir: string, name: string, bytes: Buffer): { path: string } {
    const clean = basename(name).replace(/[\\/]/g, "").trim();
    if (!clean || clean === "." || clean === "..")
      throw new Error(`invalid filename: ${name}`);
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
    writeFileSync(abs, bytes);
    this.invalidateProjectDoc();
    return { path: this.toRel(abs) };
  }

  /**
   * Make an empty folder `name` inside `dir`. Same shape as uploadFile — one path segment, no traversal, no
   * clobber — because it is the same kind of act: putting something new into a folder the user pointed at.
   *
   * No guardMutable: that one asks "may this ENTRY be moved or destroyed", and creating inside the active
   * project is the ordinary case, not the dangerous one. The recycle bin is still off-limits, since a folder
   * made in there would be invisible and would look like a silent failure.
   */
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
    // An empty folder changes nothing the compiler reads, but the cached doc is also what the revision token is
    // derived from — without this the tree would not refresh until something else touched the project.
    this.invalidateProjectDoc();
    return { path: this.toRel(abs) };
  }

  /**
   * The shared module library is read-only to every route.
   *
   * `_modules` is shared by every project in the workspace, so a save made while mixing one song would silently
   * change the others. `module populate` rebuilds it from the plugin scan and writes it directly, not through
   * here — which is what makes it the only writer. A UI edit lands as a project-local instance instead
   * (see routes/files.ts).
   *
   * Enforced HERE and not in the UI because the routes are reachable without it.
   */
  private guardShared(abs: string, verb: string): void {
    if (isInSharedModules(this.toRel(abs)))
      throw new Error(
        `can't ${verb} '${this.toRel(abs)}': the shared module library is read-only — ` +
          `edit it from a project to get your own copy, or run 'module populate' to rebuild it`,
      );
  }

  // Never the root, the recycle bin, or the active project's own folder — but anything INSIDE it is fair game.
  private guardMutable(abs: string, verb: string): void {
    if (abs === this.root) throw new Error(`can't ${verb} the workspace root`);
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
  async renameEntry(rel: string, newName: string): Promise<{ path: string }> {
    const abs = this.safePath(rel);
    this.guardMutable(abs, "rename");
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
    this.invalidateProjectDoc();
    return { path: this.toRel(destAbs) };
  }

  /**
   * Move an entry into another folder — the file tree's drag-and-drop.
   *
   * The same move as renameEntry, aimed at a different parent instead of a different name, so it inherits the
   * same three concerns: the workspace sandbox, no clobber, and Windows handles (a folder holding a wav the
   * engine has mapped, or one the watcher is walking, fails with EPERM until they let go — hence cancelPrewarm
   * and the retry).
   *
   * The tree already refuses to drop a folder into itself or its own descendant, but that check is re-done here:
   * the route is reachable without the tree, and the filesystem's own answer to that move is either an obscure
   * error or, worse, a folder that has swallowed itself.
   */
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

  // Delete by moving into the recycle bin — reversible and hidden, like deleteProject.
  async deleteEntry(rel: string): Promise<{ recycled: string }> {
    const abs = this.safePath(rel);
    this.guardMutable(abs, "delete");
    const bin = join(this.root, RECYCLE_DIR);
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
    return { path: newPath };
  }

  // Add an INSTANCE to a module (it inherits the folder's generic automatically); same path handling as cloneModule.
  createModuleInstance(rel: string, instance: string): { path: string } {
    const abs = this.safePath(rel);
    let modDir = abs;
    if (PROJECT_FILE.test(basename(abs))) modDir = dirname(abs);
    const category = basename(dirname(modDir));
    const name = basename(modDir);
    const dir = this.requireActive();
    const newPath = createModuleInstance(dir, category, name, instance);
    this.invalidateProjectDoc();
    return { path: newPath };
  }

  /**
   * The `_ui` panel file for a module file — the one the module editor's grid actually edits.
   *
   * A panel lives apart from its module (see uiLibrary.ts), so the editor needs two files, and the second one
   * may not exist yet: this answers the path it WOULD take plus a scaffold, so a first save creates it through
   * the ordinary write route rather than needing one of its own.
   */
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

    // An existing panel is found by REF, wherever its file was moved to — the path is only filing.
    const found = loadUiLibrary(dir).byRef[ref];
    if (found)
      return {
        ref,
        path: this.toRel(found.path),
        content: readFileSync(found.path, "utf8"),
        exists: true,
      };
    const path = join(dir, SHARED_UI_PATH, uiPathFor(ref));
    return {
      ref,
      path: this.toRel(path),
      content: uiFileText(
        ref,
        { cols: 4, rows: 2, widgets: {} },
        `panel for ${ref}`,
      ),
      exists: false,
    };
  }

  // "…/modules/<type>/<name>/<file>" -> the ref the loader keys that module by; null for anything else.
  private localModuleRef(dir: string, abs: string): string | null {
    const segs = relative(dir, abs).split(sep);
    return segs.length === 4 && segs[0] === "modules"
      ? moduleRefOf(segs[1], segs[2])
      : null;
  }

  /**
   * Read the file back after a save. Formats NOTHING: the writers already emit canonical
   * YAML, and reformatting a file a person hand-edited is exactly the reflow this format
   * was chosen to avoid.
   *
   * Kept as an endpoint because both editors call it on save and use what comes back.
   */
  fmt(rel: string): FileContent {
    return this.read(rel);
  }

  /** The declared I/O — what the panel lists and meters. Empty with no project open. */
  ioPorts(): IoPort[] {
    try {
      return ioPorts(this.requireActive());
    } catch {
      return [];
    }
  }

  /**
   * The shared `_modules` catalogue — what the module builder lists.
   *
   * The paths come back workspace-relative, like every other path on the wire: a catalogue
   * sits beside the projects, not inside one, and that is the only space the editor speaks.
   */
  moduleCatalogue(): CatalogueModule[] {
    try {
      // An ENGINE module has no file — `path` stays absent rather than becoming "".
      return moduleCatalogue(this.requireActive()).map((m) => ({
        ...m,
        path: m.path ? this.toRel(m.path) : undefined,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Just the base-module refs — what the graph's `+` picker browses.
   *
   * Its own route because the picker used to wait on the whole of `hints()`: a click paid for the tracks, the
   * clips, the plugin scan and the path map to show a list of modules. This is a fraction of that work and a
   * fraction of the payload, and the shell prefetches it, so opening the picker awaits nothing.
   */
  baseModules(): string[] {
    try {
      return listBaseModules(this.requireActive());
    } catch {
      return [];
    }
  }

  hints(): Hints {
    try {
      const dir = this.requireActive();
      return {
        ...projectHints(dir),
        pluginNames: scannedPluginNames(),
        projectRoot: dir,
      };
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
        libraryFiles: [],
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
  ): Promise<WebWaveform> {
    return this.wf.waveform(clipId, buckets, whole);
  }

  // --- export / share -------------------------------------------------------

  // Render the mixdown ("mp3" transcodes, needing ffmpeg). The caller streams `path`, then runs `cleanup`.
  exportMix(format: "wav" | "mp3"): {
    path: string;
    filename: string;
    mime: string;
    cleanup: () => void;
  } {
    const dir = this.requireActive();
    const engine = findEngineBinary();
    if (!engine)
      throw new Error("engine binary not found — cannot render the mixdown");
    const doc = this.cachedProjectDoc(dir);
    const tmp = mkdtempSync(join(tmpdir(), "tbmix-"));
    const cleanup = () => {
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    };
    try {
      const manifest = renderMixdown(engine, doc, tmp);
      const wav = join(tmp, manifest.mix);
      const name = (doc.name || basename(dir) || "mixdown").replace(
        /[\\/:*?"<>|]+/g,
        "_",
      );
      if (format === "wav")
        return {
          path: wav,
          filename: `${name}.wav`,
          mime: "audio/wav",
          cleanup,
        };
      const mp3 = join(tmp, "mix.mp3");
      if (!transcode(wav, mp3, MP3_CODEC))
        throw new Error(
          "mp3 needs ffmpeg on the engine host — install ffmpeg, or use Export WAV",
        );
      return {
        path: mp3,
        filename: `${name}.mp3`,
        mime: "audio/mpeg",
        cleanup,
      };
    } catch (e) {
      cleanup();
      throw e;
    }
  }

  // Publish to radiok7. An unknown song throws NEEDS_META, which the route turns into a prompt for artist and title.
  async shareRadiok7(opts: {
    artist?: string;
    title?: string;
  }): Promise<Radiok7Result> {
    const dir = this.requireActive();
    const engine = findEngineBinary();
    if (!engine)
      throw new Error("engine binary not found — cannot render the mixdown");
    // Credentials sit at the WORKSPACE root — one radiok7 login serves every project in it.
    const cfg = readRadiok7Config(this.root);
    if ("error" in cfg) throw new Error(cfg.error);
    return shareToRadiok7(engine, dir, cfg, opts);
  }

  // Resolve a play-button request to a file + window: an absolute path (guarded), else a clip id, else a media path.
  resolvePreview(req: PreviewReq): {
    file: string;
    start: number;
    length: number;
  } {
    const dir = this.requireActive();
    // A clip id / media path / absolute audio path -> an absolute file within the root.
    const resolveSource = (spec: string): string => {
      if (!spec) throw new Error("preview: empty source");
      if (isAbsolute(spec) && AUDIO_EXT.test(spec)) {
        const abs = resolve(spec);
        if (!this.withinRoot(abs))
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
      if (clip && clip.type === "audio") return clip.source;
      const abs = resolve(dir, spec);
      if (!this.withinRoot(abs))
        throw new Error("audio path is outside the workspace");
      if (!existsSync(abs)) throw new Error(`no audio for '${spec}'`);
      return abs;
    };
    if (req.kind === "clip") {
      const clip =
        findClip(this.cachedProjectDoc(dir), req.clip) ??
        loadAudioClipDoc(dir, req.clip);
      if (!clip) throw new Error(`no clip '${req.clip}'`);
      if (clip.type !== "audio")
        throw new Error(`'${req.clip}' is not an audio clip`);
      return { file: clip.source, start: 0, length: 0 };
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

  /** Clear the in-memory memo + every `{source}.cache` sidecar — see waveformOps.ts. */
  clearWaveformCache(): number {
    return this.wf.clear();
  }

  /** Stop any in-flight prewarm (called before a delete/rename) — see waveformOps.ts. */
  cancelPrewarm(): void {
    this.wf.cancel();
  }

  async prewarmWaveforms(buckets: number = DEFAULT_WF_BUCKETS): Promise<void> {
    return this.wf.prewarm(buckets);
  }

  toWebVideoTracks(
    videoTracks: VideoTrackDoc[],
    tempo: number,
  ): WebVideoTrack[] {
    return videoTracks.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      mute: t.mute,
      kind: t.kind,
      x: t.x,
      y: t.y,
      w: t.w,
      h: t.h,
      clips: t.clips.map((c) => ({
        id: c.id,
        name: c.name,
        src: c.source ? this.toRel(c.source) : "",
        start: c.start,
        length: c.length,
        sourceFrom: c.sourceFrom,
        startBeat: (c.start * tempo) / 60,
      })),
      // Shapes carry no media path — each variant's fields pass straight through.
      shapes: t.shapes.map((s) => ({ ...s })),
    }));
  }

  // Everything wrong with the project, from ONE layer — the compile itself, reusing the cache and parsing its throw.
  projectErrors(): { errors: string[]; diagnostics: Diagnostic[] } {
    const dir = this.activeProject;
    if (!dir) return { errors: [], diagnostics: [] };
    try {
      this.cachedProjectDoc(dir);
      // Clean — but a "not_supported" plugin is a non-blocking WARNING, so surface it here.
      return { errors: [], diagnostics: notSupportedModules(dir) };
    } catch (e) {
      const diagnostics = parseCompileError((e as Error).message);
      const errors = diagnostics.length
        ? diagnostics.map((d) => `${d.file}: ${d.message}`)
        : [(e as Error).message];
      return { errors, diagnostics };
    }
  }

  projectDoc(): WebProject {
    const p = this.cachedProjectDoc(this.requireActive());
    return {
      name: p.name,
      tempo: p.tempo,
      timeSigNumerator: p.timeSigNumerator,
      timeSigDenominator: p.timeSigDenominator,
      tracks: toWebTracks(p.tracks),
      groups: p.groups.map((g) => ({
        id: g.id,
        name: g.name,
        color: g.color,
        mute: g.mute,
        solo: g.solo,
      })),
      metronome: p.settings.metronome,
      countIn: p.settings.countIn,
      strudel: p.strudel,
      video: p.video,
      viewport: p.viewport,
      fps: p.fps,
      videoTracks: this.toWebVideoTracks(p.videoTracks, p.tempo),
      markers: p.markers.map((m) => ({ beat: m.beat, name: m.name, tc: m.tc })),
    };
  }

  /**
   * The routing graph the Chains tab draws — see graphDoc.ts. Memoised on `revision()`.
   *
   * Building it reads every chain, module, track, clip, sequence and curve in the song: ~280 ms on a real one,
   * paid on EVERY fetch, and the Chains tab refetches after any command. That is most of the second a bypass
   * click used to take, and it was spent re-deriving a picture that had not changed.
   *
   * Keyed on the revision token rather than on invalidateProjectDoc, which is what the compiled doc uses. The
   * token is `mutations:fileCount:newestMtime` — so it moves for our own writes AND for an edit made outside the
   * service (a git pull, another editor), where the mutation counter alone would sit still and serve a stale
   * picture. Computing it costs a directory walk: 4.8 ms against the 278 ms it saves, and the frontend already
   * polls it anyway.
   */
  private graphCache: { dir: string; rev: string; graph: WebGraph } | null =
    null;

  graphDoc(): WebGraph {
    const dir = this.requireActive();
    // The token describes the ACTIVE project; for anything else there is nothing honest to key on, so build it.
    if (dir !== this.activeProject) return buildGraphDoc(dir);
    const { rev } = this.revision();
    const hit = this.graphCache;
    if (hit && hit.dir === dir && hit.rev === rev) return hit.graph;
    const graph = buildGraphDoc(dir);
    this.graphCache = { dir, rev, graph };
    return graph;
  }

  projectInfo(): ProjectInfo {
    const dir = this.activeProject ?? this.root;
    let name = basename(dir);
    try {
      const m = /name:\s*"([^"]+)"/.exec(
        readFileSync(join(dir, "project.yaml"), "utf8"),
      );
      if (m) name = m[1];
    } catch {
      /* no project.yaml — keep the folder name */
    }
    return { name, root: dir };
  }
}
