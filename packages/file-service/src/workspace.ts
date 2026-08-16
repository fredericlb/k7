// workspace.ts — the filesystem layer over ONE workspace root: file ops, the active
// project, and the compiled/waveform caches, all per-instance because the service
// serves many users' workspaces from one process. The active project is remembered in
// a `.studio-active` dotfile in the root. Full rationale: docs/workspace.md.

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
  type K7Result,
  MP3_CODEC,
  readK7Config,
  renderMixdown,
  shareToK7,
  transcode,
} from "@studio/commands/render";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import { scannedPluginNames } from "@studio/engine-client/pluginCache";
// WebGraph is graph-model's, not web-protocol's — the graph types were split out so the three apps that draw chains needn't pull in auth and the registry.
import type { WebGraph } from "@studio/graph-model";
import { CHAIN_FILE, chainFromBench } from "@studio/song/benchChain";
import { engineModules } from "@studio/song/engineCatalogue";
import { projectHints } from "@studio/song/hints";
import { type IoPort, ioPorts } from "@studio/song/ioPorts";
import {
  cloneModuleFile,
  createNode,
  type Diagnostic,
  deadProjectFields,
  libraryModuleIssues,
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
  materialiseEngineModule,
  sharedModuleRef,
} from "@studio/song/moduleFork";
import { ENGINE_NS, type ModuleNamespace } from "@studio/song/moduleTypes";
import { isFrozenClipId } from "@studio/song/nodeProject";
import {
  formatAudioDevice,
  formatChannels,
  loadPreferences,
  setAudioDevice,
  setEditorVim,
  setInputPair,
} from "@studio/song/preferences";
import type { ClipDoc, ProjectDoc, TrackDoc } from "@studio/song/project";
import {
  loadAudioClipDoc,
  loadProject,
  trackMixer,
} from "@studio/song/project";
import type { ProjectShape } from "@studio/song/projectMode";
import { projectTypeIssues } from "@studio/song/projectType";
import { BENCH_EDGES } from "@studio/song/scaffoldBench";
import {
  isInSharedModules,
  moduleLibraryDirs,
  moduleNamespaceOf,
} from "@studio/song/sharedFolders";
import { projectSurfaces, surfaceIssues } from "@studio/song/surfaces";
import { UI_FILE, uiFileText } from "@studio/song/uiLibrary";
import type { VideoProjectDoc, VideoTrackDoc } from "@studio/song/videoDoc";
import { isVideoProject, loadVideoProject } from "@studio/song/videoProject";
import { videoDuration } from "@studio/song/videoTracks";
import { PRESETS_BASE } from "@studio/song/yaml/moduleIO";
import type {
  FileContent,
  FileNode,
  Hints,
  ModuleLibrary,
  PreviewReq,
  ProjectInfo,
  WaveformStatus,
  WebMixer,
  WebProject,
  WebTrack,
  WebVideoProject,
  WebVideoTrack,
  WebWaveform,
  WorkspaceInfo,
} from "@studio/web-protocol";
import { PROJECT_SUFFIXES, projectApp } from "@studio/web-protocol/projects";
import {
  benchChainOf,
  isBenchProject,
  writeChainToLibraries,
} from "./bench.ts";
import { buildGraphDoc, type ClipExtents, clipExtentsOf } from "./graphDoc.ts";
import {
  type FileChange,
  type HistoryPeek,
  type HistoryState,
  isHistoryDir,
  ProjectHistory,
} from "./history.ts";
import { createProjectIn, importProjectInto } from "./projectLifecycle.ts";
import {
  AUDIO_EXT,
  DEFAULT_WF_BUCKETS,
  findClip,
  WaveformOps,
} from "./waveformOps.ts";

export { DEFAULT_WF_BUCKETS } from "./waveformOps.ts";

/** The module's third file, spelled as it is written. */
const PRESETS_FILE = `${PRESETS_BASE}.yaml`;

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

/**
 * A project is any directory whose NAME claims an app — `mysong.l8`, `party.z0`.
 *
 * The name, not a `project.yaml` inside, because st0 has to answer the same question from a
 * bare blobless mirror it has never checked out, where no file can be opened. One rule on both
 * sides, so what the médiathèque lists and what this tree marks cannot disagree. See
 * packages/web-protocol/projects.ts and apps/st0/docs/projects.md.
 *
 * `isProjectFolder` (a `project.yaml` exists) is still the COMPILER's question, and
 * `@studio/song` still asks it: a `.l8` folder with no project file opens and then fails to
 * compile, with the loader's own error saying so.
 *
 * It must EXIST, though — the name rule on its own answers "yes" for a folder that is not
 * there, and st0 names one out of a mirror that can be a fetch behind this machine's clone.
 * See docs/activeProject.md.
 */
export const isProjectDir = (dir: string): boolean => {
  if (projectApp(basename(dir)) === null) return false;
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

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
  isHistoryDir(name) || // the undo/redo journal, never listed or diffed
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

// One clip as the browser reads it. Named, rather than written inline where the lane's clips are
// mapped, because a lane's TAKES hold the same thing and a take should draw identically to the
// arrangement it was — two copies of this is how the two would come to differ.
function toWebClip(c: TrackDoc["clips"][number]) {
  return {
    id: c.id,
    type: c.type,
    name: c.name,
    start: c.start,
    length: c.length,
    loopStart: c.loopStart,
    loopEnd: c.loopEnd,
    warped: c.warp ? true : undefined,
    disabled: c.disabled ? true : undefined,
    // A render standing in for a frozen lane, told by the suffix the compiler reserves for one.
    frozen: isFrozenClipId(c.id) ? true : undefined,
    notes: c.notes.map((n) => ({
      time: n.time,
      duration: n.duration,
      key: n.key,
      // Only when the file SAID one: the compiler defaults `vel` to 1, and passing that through
      // would make every note look explicitly full — which is what a roll's velocity line has to
      // tell apart from a note that states nothing. See WebNote.
      ...(n.vel !== undefined && n.vel !== 1 ? { vel: n.vel } : {}),
    })),
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
    clips: t.clips.map(toWebClip),
    // The takes, through the same mapping — absent when the lane has none, exactly as the
    // compiled doc leaves it. See packages/song/docs/takes.md.
    ...(t.takes?.length
      ? {
          takes: t.takes.map((k) => ({
            ...(k.name ? { name: k.name } : {}),
            clips: k.clips.map(toWebClip),
          })),
        }
      : {}),
    plugins: t.plugins.map((pl) => ({
      id: pl.id,
      type: pl.type,
      name: pl.name,
    })),
    // `docs`/`todos` were copied here for the Docs panel. Gone with it — a note is a doc
    // module on the graph now. See packages/song/docs/docModules.md. `frozen`, `alternatives`
    // and `alternative` followed, with the fields they came from (docs/trackModules.md).
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

// Remember which interface this machine plays through. The engine itself forgets — see
// docs/audioDevice.md — so this file is what re-selects it, replayed by engineLink on
// every connect. An empty name clears the pick and hands the machine back to the default.
export function setAudioDevicePref(name: string, type?: string): string | null {
  const p = setAudioDevice(name, type);
  return p.audioDevice ? formatAudioDevice(p.audioDevice) : null;
}

// …and how that interface's inputs are grouped, forgotten by the engine for the same reason and
// replayed on the same connect. Returns the whole set, since setting one pair is how the list is edited.
export function setInputPairPref(channel: number, stereo: boolean): number[] {
  return setInputPair(channel, stereo).inputPairs;
}

// The per-workspace active-project marker; a dotfile, so skip() hides it from the tree.
const ACTIVE_MARKER = ".studio-active";

// Text files that differ between two snapshots — a null side means the file was absent then.
function diffText(
  before: Map<string, string>,
  after: Map<string, string>,
): FileChange[] {
  const changes: FileChange[] = [];
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(path);
    const a = after.get(path);
    if (b !== a) changes.push({ path, before: b ?? null, after: a ?? null });
  }
  return changes;
}

// Binary files that were created or overwritten. A newly created file is caught by presence
// (absent before, present after) and undone by deleting it. An overwrite is caught by the
// pre-image the mutation captured via snapshot() — bytes are compared directly, so a same-size
// overwrite (which size+mtime can miss on a coarse-mtime filesystem) still registers. A binary
// that existed and changed but was never snapshotted can't be restored, so it is left out
// rather than wrongly deleted on undo.
function diffBin(
  base: string, // the workspace root, since paths are root-relative
  before: Map<string, string>,
  after: Map<string, string>,
  pre: Map<string, Buffer>,
): { path: string; before: Buffer | null; after: Buffer | null }[] {
  const blobs: { path: string; before: Buffer | null; after: Buffer | null }[] =
    [];
  const readBytes = (path: string): Buffer | null => {
    try {
      return readFileSync(join(base, path));
    } catch {
      return null;
    }
  };
  for (const path of new Set([
    ...before.keys(),
    ...after.keys(),
    ...pre.keys(),
  ])) {
    const existedBefore = before.has(path);
    // Read the bytes only where they can end up in the journal — a file the mutation created,
    // or one it snapshotted. Reading first and deciding after meant every command read every
    // binary in the project: a song with 650 MB of takes in `clips/` paid all of it to journal
    // one rewritten line of YAML, and paid it again on the next command.
    if (!existedBefore) {
      const afterBytes = after.has(path) ? readBytes(path) : null;
      if (afterBytes) blobs.push({ path, before: null, after: afterBytes }); // created
      continue;
    }
    const preBytes = pre.get(path);
    if (!preBytes) continue; // existed but no pre-image — nothing to restore to
    const afterBytes = after.has(path) ? readBytes(path) : null;
    if (afterBytes === null || !preBytes.equals(afterBytes))
      blobs.push({ path, before: preBytes, after: afterBytes });
  }
  return blobs;
}

/**
 * `@engine` as a library: what this machine's plugin scan offers, grouped by type folder.
 *
 * The odd one, and it is worth saying exactly how. Every other level is a FOLDER; this one is
 * not — `engineCatalogue` synthesises it from `~/.studio/exts.json`, so there is no path, no
 * file to open and nothing to write. The rows are a vocabulary a chain can name.
 *
 * The type folders are synthesised too: a ref is flat (`@engine/nam`), and two hundred and
 * fifty plugins in one list is a level nobody can find anything in. So the folder rows carry a
 * made-up path and the LEAVES carry the real ref, which is the one string anything downstream
 * would want. Null when the machine has never scanned — an empty `@engine` says nothing true.
 */
function engineLibrary(): ModuleLibrary | null {
  const byType = new Map<string, FileNode[]>();
  for (const [ref, m] of Object.entries(engineModules()) as [
    string,
    { category?: unknown; file?: unknown },
  ][]) {
    const type = String(m.category ?? "audio");
    const list = byType.get(type) ?? [];
    // A LEAF, and deliberately: `foldModules` turns a folder holding `module.yaml` into an
    // openable module row, and this has no such file. A leaf it cannot fold is a row that
    // draws the name and opens nothing, which is the truth about a scanned plugin.
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
  /** `root` with symlinks resolved — what safePath compares against. */
  private readonly realRoot: string;
  readonly rootIsProject: boolean;
  private activeProject: string | null;
  private docCache: { dir: string; rev: string; doc: ProjectDoc } | null = null;
  // The last snapshotText walk, so the next one only re-reads what moved. See snapshotText.
  private textCache = new Map<string, { stamp: string; text: string }>();
  // The picture compile's own cache — see cachedVideoDoc for why it is not a branch inside the one above.
  private videoCache: {
    dir: string;
    rev: string;
    doc: VideoProjectDoc;
  } | null = null;
  private historyCache: { dir: string; h: ProjectHistory } | null = null;
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
    // Said apart from the name rule below because it is the one that actually happens, and the
    // one with a fix: st0 links here out of a mirror that can be behind this machine's clone.
    if (!existsSync(abs))
      throw new Error(
        `no project '${rel}' in this workspace — it may have been renamed or removed since ` +
          `the médiathèque last read the repository; refresh it there and open it again`,
      );
    if (!isProjectDir(abs))
      throw new Error(
        `not a project (the folder must end in ${Object.values(PROJECT_SUFFIXES).join(", ")}): ${rel}`,
      );
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
      throw new Error(
        `not a project (the folder must end in ${Object.values(PROJECT_SUFFIXES).join(", ")}): ${rel}`,
      );

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

  /** Import a .dawproject or .als into a NEW project folder — see projectLifecycle.ts. */
  importProject(rel: string): { project: string; log: string[] } {
    return importProjectInto(this.lifecycleHost(), rel);
  }

  /** Scaffold a NEW project folder at the workspace root — see projectLifecycle.ts. */
  createProject(shape: ProjectShape, rawName: string): { project: string } {
    return createProjectIn(this.lifecycleHost(), shape, rawName);
  }

  // --- compiled-project cache ------------------------------------------------
  /**
   * The compiled project, memoised against the REVISION rather than against our own writes.
   *
   * It used to be invalidated only by edits this service made, which meant a project changed
   * any other way served a stale compile until the process restarted: a `git pull`, an editor
   * on the same disk, a tool writing the folder directly. The symptom is the worst kind —
   * every derived view (the graph, the engine's document, the errors) is confidently wrong,
   * and the files on screen say otherwise.
   *
   * `revision()` is the token built for exactly this question, and clients already poll it
   * rather than the derivations; using it here applies the same rule on this side of the wire
   * instead of trusting that nobody else touches the disk. It is the trade `graphDoc()` made
   * first, and measured: a 4.8 ms directory walk against the ~280 ms it saves.
   *
   * The token describes the ACTIVE project, which every caller passes — `dir` is there because
   * loading takes one, not because a second project can be cached beside it.
   */
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

  // --- undo/redo journal -----------------------------------------------------
  // One ProjectHistory per active project, cached so the on-disk journal is read once.
  private history(dir: string): ProjectHistory {
    if (this.historyCache?.dir !== dir)
      this.historyCache = { dir, h: new ProjectHistory(dir, this.root) };
    return this.historyCache.h;
  }

  /**
   * Run a project mutation and journal what it changed, so Ctrl+Z can undo it.
   *
   * The diff is taken by snapshotting the project's text files (small YAML) before and
   * after and comparing — so it catches an edit however it was written, whether the editor
   * PUT it or a command rewrote it. Binary files (a process bounce) are handled by the
   * `snapshot(abs)` callback the mutation calls before overwriting one: it stashes the
   * pre-image bytes, and the after-image is read from disk once the mutation returns.
   */
  async recordChange<T>(
    label: string,
    mutate: (snapshot: (abs: string) => void) => T | Promise<T>,
  ): Promise<T> {
    const dir = this.activeProject;
    if (!dir) return mutate(() => {}); // no project, no journal
    const textBefore = this.snapshotText(dir);
    const binBefore = this.snapshotBinMeta(dir);
    const pre = new Map<string, Buffer>(); // rel -> pre-image bytes of a binary about to be overwritten
    const snapshot = (abs: string): void => {
      try {
        const rel = this.toRel(abs);
        if (!pre.has(rel) && existsSync(abs) && statSync(abs).isFile())
          pre.set(rel, readFileSync(abs));
      } catch {
        /* best effort — a missed pre-image just means that one file can't be undone */
      }
    };
    const result = await mutate(snapshot);
    try {
      const changes = diffText(textBefore, this.snapshotText(dir));
      const blobs = diffBin(
        this.root,
        binBefore,
        this.snapshotBinMeta(dir),
        pre,
      );
      if (changes.length || blobs.length)
        this.history(dir).push({ label, changes, blobs });
    } catch {
      /* journaling must never break a good write */
    }
    return result;
  }

  /**
   * Every text file's content, keyed by workspace-relative path — the before/after images a diff
   * compares.
   *
   * Only files that MOVED are re-read: each one's size+mtime is checked against the last walk's,
   * and the content is carried over when it matches. Every command took two of these walks — one
   * before the mutation and one after — so a song of 180 small YAML files read 360 of them to
   * journal the one line a command rewrote, and the "before" image is almost always the "after"
   * image of the command before it.
   *
   * The gate is the one `snapshotBinMeta` already trusts for binaries: a write that kept both the
   * size and the sub-millisecond mtime would be missed, which no real write does.
   */
  private snapshotText(dir: string): Map<string, string> {
    const out = new Map<string, string>();
    // Built fresh so a deleted file leaves the cache with it, rather than lingering for ever.
    const seen = new Map<string, { stamp: string; text: string }>();
    const walk = (abs: string): void => {
      let entries: Dirent[];
      try {
        entries = readdirSync(abs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (skip(e.name)) continue;
        const p = join(abs, e.name);
        if (e.isDirectory()) walk(p);
        else if (!isBinary(e.name)) {
          const rel = this.toRel(p);
          try {
            const s = statSync(p);
            const stamp = `${s.size}:${s.mtimeMs}`;
            const hit = this.textCache.get(rel);
            const text =
              hit?.stamp === stamp ? hit.text : readFileSync(p, "utf8");
            out.set(rel, text);
            seen.set(rel, { stamp, text });
          } catch {
            /* unreadable — treated as absent */
          }
        }
      }
    };
    walk(dir);
    this.textCache = seen;
    return out;
  }

  // Size+mtime of every binary file — enough to tell created/overwritten from untouched.
  private snapshotBinMeta(dir: string): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (abs: string): void => {
      let entries: Dirent[];
      try {
        entries = readdirSync(abs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (skip(e.name)) continue;
        const p = join(abs, e.name);
        if (e.isDirectory()) walk(p);
        else if (isBinary(e.name)) {
          try {
            const s = statSync(p);
            out.set(this.toRel(p), `${s.size}:${s.mtimeMs}`);
          } catch {
            /* raced away */
          }
        }
      }
    };
    walk(dir);
    return out;
  }

  /** Undo the most recent journalled change on the active project. */
  undoHistory(): HistoryPeek | null {
    const dir = this.activeProject;
    if (!dir) return null;
    const r = this.history(dir).undo();
    if (r) this.invalidateProjectDoc();
    return r;
  }
  /** Redo the change undo just reverted. */
  redoHistory(): HistoryPeek | null {
    const dir = this.activeProject;
    if (!dir) return null;
    const r = this.history(dir).redo();
    if (r) this.invalidateProjectDoc();
    return r;
  }
  peekUndo(): HistoryPeek | null {
    const dir = this.activeProject;
    return dir ? this.history(dir).peekUndo() : null;
  }
  peekRedo(): HistoryPeek | null {
    const dir = this.activeProject;
    return dir ? this.history(dir).peekRedo() : null;
  }
  historyState(): HistoryState {
    const dir = this.activeProject;
    return dir ? this.history(dir).state() : { canUndo: false, canRedo: false };
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
  /**
   * The file tree an editor draws: the ACTIVE PROJECT's own files, not the workspace's.
   *
   * A workspace is one git clone, and a clone holds whatever else the repository holds —
   * other songs, a `_modules` library, mixdowns, an `orig/` full of foreign sessions. An app is
   * opened ON one project and picks nothing itself, so showing all of that is
   * showing the repository rather than the song. See docs/activeProject.md.
   *
   * Paths stay workspace-relative, because that is what every other route takes: only the
   * ROOT of the walk moves, and `/file`, `/rename`, `/move` are unchanged. With no active
   * project (nothing opened yet) it is the workspace, which is also what a lone-project
   * workspace gives, its root being the project.
   */
  tree(): FileNode[] {
    return this.walk(this.activeProject ?? this.root);
  }

  /**
   * The module libraries this project can reach, in precedence order, each as a tree.
   *
   * Its own answer and not a corner of `tree()`, because `tree()` deliberately shows the SONG
   * and not the repository around it (see above): `_modules` and `_libraries` are outside the
   * active project and are excluded from it on purpose. Reading them out of that tree is
   * impossible, which is exactly the bug this replaced.
   *
   * The roots come from `@studio/song` — the project's own `modules/`, then `moduleLibraryDirs`
   * — so this lists what the LOADER resolves against and cannot drift from it. Each carries the
   * namespace `moduleNamespaceOf` gives it, which is the word a chain writes.
   *
   * A root that is not there is still REPORTED, with `exists: false` and no nodes. A level you
   * could put a module in is a real answer, and the surface offers to create one; leaving it out
   * would make "no library" and "an empty library" look the same when only one of them can be
   * fixed by adding a module. `@st0` is the exception — it is a git submodule somebody has to
   * mount, so an absent one is not a folder to fill in.
   */
  moduleLibraries(): ModuleLibrary[] {
    const dir = this.activeProject ?? this.root;
    const own = join(dir, "modules");
    const roots: { ns: ModuleNamespace; abs: string }[] = [
      { ns: "project", abs: own },
      ...moduleLibraryDirs(dir).map((abs) => ({
        ns: moduleNamespaceOf(abs),
        abs,
      })),
    ];
    const out: ModuleLibrary[] = roots.map(({ ns, abs }) => {
      const exists = existsSync(abs);
      return {
        ns,
        path: this.toRel(abs),
        exists,
        nodes: exists ? this.walk(abs) : [],
      };
    });
    const engine = engineLibrary();
    if (engine) out.push(engine);
    return out;
  }

  /**
   * Make an empty module in one of those libraries, and answer where its file landed.
   *
   * The folder is created on the way, which is what makes a level with `exists: false` an
   * offer rather than a dead row: `_modules` need not be there for you to put the first module
   * in it. Refuses an existing module rather than opening it — "create" that quietly returned
   * somebody else's file is how you edit the wrong one.
   *
   * The stub is deliberately the smallest thing the loader will read: a module with no plugin
   * yet is a folder you then fill in, and writing a fake `plugin.type` would be a guess that
   * compiles into a real refusal later.
   */
  createModule(root: string, rel: string): { path: string; dir: string } {
    const segs = rel.split("/").filter(Boolean);
    // At least a TYPE folder and a name: `audio/reverb` is the shortest thing the loader will
    // key, and a folder dropped straight under a library is not a module however it is named.
    if (segs.length < 2)
      throw new Error(
        `a module is named <type>/<name> — '${rel}' names no type folder`,
      );
    for (const seg of segs)
      if (!/^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(seg))
        throw new Error(`'${seg}' is not something a folder can be called`);
    // Through safePath, so a `..` in either part cannot leave the workspace.
    const dir = this.safePath(`${root}/${segs.join("/")}`);
    const file = join(dir, "module.yaml");
    if (existsSync(file)) throw new Error(`${this.toRel(file)} already exists`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      file,
      `# ${segs[segs.length - 1]}\nplugin:\n  type: \n  name: \n`,
      "utf8",
    );
    this.invalidateProjectDoc();
    return { path: this.toRel(file), dir: this.toRel(dir) };
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
    // From the ROOT, not `tree()`: this lists every project the workspace holds, and the
    // tree now shows only the open one.
    collect(this.walk(this.root));
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
   * ONE exception, and only one: a module's `ui.yaml`. A panel is drawn for the plugin, not for the song — every
   * project that reaches for the same compressor wants the same face — so it is written where the module is, and
   * forking a whole module to move a knob is precisely the copy nobody wanted. Everything a module IS stays
   * read-only here: the fork is what "read-only" does instead of refusing. See docs/uiLibrary.md.
   */
  write(
    rel: string,
    content: string,
  ): { forked?: ForkedModule; pushed?: boolean } {
    const abs = this.safePath(rel);

    // The active project ABSOLUTE, which is how it is held.
    const active = this.activeProject;

    /**
     * A shared module used to need an exception here — the bench's `modules/` was a mirror of a
     * machine-wide cache, so a save had to be pushed to the hosted médiathèque or the next open
     * would discard it. There is no mirror and no push any more: the libraries are a git
     * submodule inside the workspace, so `_libraries/…` is an ORDINARY path and falls through
     * to the plain write below. What publishes it is `project commit`, which is somebody's
     * decision rather than a side effect of typing. See `@studio/song`'s docs/sharedFolders.md.
     *
     * `_modules` is untouched by all of that and still forks: it is the WORKSPACE's own library,
     * one copy backing every project beside it, and nothing has given it a way back.
     */
    if (isInSharedModules(this.toRel(abs)) && basename(abs) !== UI_FILE) {
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

    /**
     * The CHAIN bench's write-through, after the ordinary write rather than instead of it.
     *
     * A chain bench is a view of one chain in the library submodule (bench.ts), so the two files
     * that ARE the chain go back to it: `chains.yaml`, translated at the edges the way it was
     * translated on the way in, and the flat `nodes/` beside it. Everything else in the folder —
     * the project, the scaffold's furniture — is the bench's own and stays here.
     *
     * The bench's LANE is in `nodes/` too, and is furniture: it is somewhere to put material
     * while you listen, and has no business in a chain other projects load. It is kept back by
     * NAME, which is the only thing that tells it apart — `chainToBench` puts `@in` under that
     * name on the way in, and `chainFromBench` turns it back.
     *
     * A plain write into the submodule, where this used to also push to the hosted médiathèque.
     * Committing is `project commit`.
     */
    const chain = active && benchChainOf(this.root, this.toRel(active));
    if (chain) {
      const rel = relative(active, abs).split(sep).join("/");
      const back =
        rel === CHAIN_FILE
          ? chainFromBench(content, BENCH_EDGES)
          : rel.startsWith("nodes/") &&
              rel !== `nodes/${BENCH_EDGES.track}.yaml`
            ? content
            : null;
      if (back !== null) writeChainToLibraries(this.root, chain, rel, back);
    }
    return {};
  }

  /**
   * Drop a file into `dir` under `name`. Binary-safe, and throws EEXIST rather than clobbering.
   *
   * `name` may carry FOLDERS — `audio/reverb/module.yaml`. It could not, once, and that was fine while a drop
   * was a flat list of files; a module is a folder of three files now, so "add this module" is a folder drop
   * and a single segment cannot express it. Every segment is still checked: `..` is the only one that could
   * escape, and `safePath` below refuses it too. Belt and braces, because this is a public write route.
   */
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
   * here — which is what makes it the only writer. A UI edit lands as a project-local node instead
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

  /**
   * Add one USE of a module. `rel` names the module being used — its folder or any file in it,
   * same path handling as cloneModule — but the file lands in the project's flat `nodes/`,
   * so what comes back is NOT under `rel`. Callers that reveal the new path in a tree must read
   * the returned path rather than assume it sits beside what was clicked.
   */
  createNode(rel: string, node: string): { path: string } {
    const abs = this.safePath(rel);
    let modDir = abs;
    if (PROJECT_FILE.test(basename(abs))) modDir = dirname(abs);
    const category = basename(dirname(modDir));
    const name = basename(modDir);
    const dir = this.requireActive();
    const newPath = createNode(dir, category, name, node);
    this.invalidateProjectDoc();
    return { path: newPath };
  }

  /**
   * The `ui.yaml` panel for a module file — the one the module editor's grid actually edits.
   *
   * The two files are siblings (see uiLibrary.ts), so this is `dirname` and nothing more; `rel` may be either
   * of them, which is what lets a click on `ui.yaml` open the same builder as a click on `module.yaml`. The
   * panel may not exist yet: this answers the path it WOULD take plus a scaffold, so a first save creates it
   * through the ordinary write route rather than needing one of its own.
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

    return this.sidecar(abs, ref, UI_FILE, () =>
      uiFileText({ cols: 4, rows: 2, widgets: {} }, `panel for ${ref}`),
    );
  }

  /**
   * Give a module the ENGINE provides a folder in this project, and repoint the chains at it.
   *
   * The one way a module without files gets some. A panel and a shelf are FILES in a module's folder, so
   * wanting either for a scanned plugin is the moment it stops being ambient — see moduleFork.ts.
   */
  materialiseModule(ref: string): ForkedModule {
    const dir = this.requireActive();
    const out = materialiseEngineModule(dir, ref);
    this.invalidateProjectDoc();
    return { ...out, path: this.toRel(join(dir, out.path)) };
  }

  /**
   * The `presets.yaml` for a module file — its named settings (see presets.ts).
   *
   * The module's third file, answered exactly like its panel: `rel` may name any of the three, an absent shelf
   * comes back as the path it would take plus a header, and the first save creates it through the ordinary
   * write route.
   */
  modulePresets(rel: string): {
    ref: string;
    path: string;
    content: string;
    exists: boolean;
  } {
    const abs = this.safePath(rel);
    const dir = this.requireActive();
    const ref = sharedModuleRef(dir, abs)?.ref ?? this.localModuleRef(dir, abs);
    if (!ref) throw new Error(`${this.toRel(abs)} is not a module file`);
    return this.sidecar(abs, ref, PRESETS_FILE, () => `# presets for ${ref}\n`);
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
    // Everything between the TYPE and the file is the module's name: `audio/reverb` keys as
    // "reverb", `audio/amps/neural-amp-modeler` as "amps/neural-amp-modeler". One level of
    // filing, which is what `loadModules` walks and what the médiathèque's catalogue uses.
    //
    // This was pinned at exactly four segments, so a filed module was "not a module file" —
    // a 400 from /module-ui and /module-presets for a file plainly sitting in the tree. It
    // could not happen while a project's own modules were always flat; the bench, whose
    // `modules/` IS the catalogue, is the first project where they are not.
    return moduleRefOf(segs[1], segs.slice(2, -1).join("/"));
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

  /**
   * The editor's completion vocabulary, memoised on the revision exactly as the graph is.
   *
   * A pure read of the project folder, and l8 asks for it after EVERY command — the editor pane
   * is mounted in every layout and refreshes with the tree — so a track's alternative switch was
   * paying a full rebuild of the tracks, clips, params and path map for a pane that may not even
   * be on screen. Same token as `graphDoc`, so an out-of-band edit still moves it.
   */
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

  // Publish to k7. An unknown song throws NEEDS_META, which the route turns into a prompt for artist and title.
  async shareK7(opts: { artist?: string; title?: string }): Promise<K7Result> {
    const dir = this.requireActive();
    const engine = findEngineBinary();
    if (!engine)
      throw new Error("engine binary not found — cannot render the mixdown");
    // Credentials sit at the WORKSPACE root — one k7 login serves every project in it.
    const cfg = readK7Config(this.root);
    if ("error" in cfg) throw new Error(cfg.error);
    return shareToK7(engine, dir, cfg, opts);
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

  toWebVideoTracks(videoTracks: VideoTrackDoc[]): WebVideoTrack[] {
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
      // Workspace-RELATIVE on the way out: the compiled doc holds absolute paths, and the
      // browser fetches every byte back through this service's own media route.
      clips: t.clips.map((c) => ({
        id: c.id,
        name: c.name,
        src: c.source ? this.toRel(c.source) : "",
        start: c.start,
        length: c.length,
        sourceFrom: c.sourceFrom,
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
      // Clean — but two things are non-blocking WARNINGS, so they surface here or nowhere: a
      // "not_supported" plugin, and a library module that would not read. The second has no
      // other symptom at all while nothing names it, which is exactly how it goes unnoticed
      // until a song that used to play stops.
      return {
        errors: [],
        diagnostics: [
          ...notSupportedModules(dir),
          ...libraryModuleIssues(dir),
          ...deadProjectFields(dir),
          // A folder named `.z0` that declares `type: l8`, or the reverse. It compiles
          // either way — the two signals feed different readers — which is exactly why it
          // has to be said out loud rather than left for the day someone trusts the file.
          ...projectTypeIssues(dir),
          // A `surfaces/` file that will not read. The folder is optional and its absence is
          // silent, but a surface that is THERE and malformed draws nothing — and a blank
          // screen where a desk should be says less than the line that would not parse.
          ...surfaceIssues(dir),
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

  /**
   * The compiled document itself, for an app that drives the engine over its own socket.
   *
   * The same memoised compile every other view is built from — `withGroupMix`/`withoutVideo`
   * are NOT applied, deliberately: those are the folds a SENDER does on the way to the engine
   * (see docs/mixFolding.md), and doing them here would mean this route decided something the
   * sender owns. The caller sends; the caller folds.
   */
  engineDoc(): ProjectDoc {
    return this.cachedProjectDoc(this.requireActive());
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
      mode: p.mode,
      markers: p.markers.map((m) => ({ beat: m.beat, name: m.name, tc: m.tc })),
    };
  }

  /**
   * The same folder read as PICTURE. Memoised on the revision, exactly as the song compile is and
   * for the same reason: every other way of invalidating it serves a confidently wrong view
   * after a `git pull`.
   *
   * A SECOND cache rather than a branch inside `cachedProjectDoc`, because the two compiles
   * return different documents from the same folder — a song has a tempo, its picture has a
   * viewport. Both are warm at once for a song that carries video, which is the ordinary case
   * now that picture is a song's own and not a separate kind of project.
   */
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

  /**
   * The project's picture, or an EMPTY one when it has none.
   *
   * Empty rather than a 400, and that is the whole reason this reads `video_tracks/` first: every
   * song may carry picture now, so the editor asks every project for its frame and must be able
   * to tell "this song has no picture" from "this song's picture will not compile". A throw for
   * the ordinary case would make the second unreadable — the shell would show a compile error to
   * anyone who ever opened a song without video.
   *
   * `viewport:` stays REQUIRED the moment there IS a lane, which is what the compile still says.
   */
  videoProjectDoc(): WebVideoProject {
    const dir = this.requireActive();
    if (!isVideoProject(dir))
      return {
        name: basename(dir),
        viewport: [0, 0],
        fps: 0,
        duration: 0,
        markers: [],
        videoTracks: [],
      };
    const p = this.cachedVideoDoc(dir);
    const videoTracks = this.toWebVideoTracks(p.videoTracks);
    return {
      name: p.name,
      viewport: p.viewport,
      fps: p.fps,
      duration: videoDuration(p.videoTracks),
      markers: p.markers.map((m) => ({ sec: m.sec, name: m.name, tc: m.tc })),
      videoTracks,
    };
  }

  /** Everything wrong with a song's PICTURE — the compile's own throw, same shape as projectErrors. */
  videoProjectErrors(): { errors: string[]; diagnostics: Diagnostic[] } {
    const dir = this.activeProject;
    // No lanes is not an error, for the same reason the document above is empty rather than a throw.
    if (!dir || !isVideoProject(dir)) return { errors: [], diagnostics: [] };
    try {
      this.cachedVideoDoc(dir);
      return { errors: [], diagnostics: [] };
    } catch (e) {
      return { errors: [(e as Error).message], diagnostics: [] };
    }
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

  /**
   * The project's declared surfaces, parsed, with whatever would not read.
   *
   * Not cached, unlike the graph beside it: a project has none or a handful of small files, so
   * the walk is nothing, and a surface is edited exactly while somebody is looking at it — a
   * cache keyed on the revision would be right and would still be a thing to get wrong for no
   * measurable gain.
   */
  surfaces(): ReturnType<typeof projectSurfaces> {
    return projectSurfaces(this.requireActive());
  }

  /**
   * The clip extents the graph draws its mini timelines from, or nothing.
   *
   * Off the MEMOISED compile, so this costs a map on a hit and a compile only when the project
   * has moved — the same document the timeline is already served from. Failure is not fatal and
   * is not reported here: a project that will not compile still has a graph, and the graph is
   * the screen you fix it from. It simply loses the clip widths, which the node draws without.
   */
  private clipExtents(dir: string): ClipExtents | undefined {
    try {
      return clipExtentsOf(this.cachedProjectDoc(dir));
    } catch {
      return undefined;
    }
  }

  graphDoc(): WebGraph {
    const dir = this.requireActive();
    // The token describes the ACTIVE project; for anything else there is nothing honest to key on, so build it.
    if (dir !== this.activeProject)
      return buildGraphDoc(dir, this.clipExtents(dir));
    const { rev } = this.revision();
    const hit = this.graphCache;
    if (hit && hit.dir === dir && hit.rev === rev) return hit.graph;
    const graph = buildGraphDoc(dir, this.clipExtents(dir));
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
