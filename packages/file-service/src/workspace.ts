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
import {
  buildShareBundle,
  type ShareBundle,
  uploadShare,
} from "@studio/commands/share-bundle";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import { scannedPluginNames } from "@studio/engine-client/pluginCache";
// WebGraph is graph-model's, not web-protocol's — the graph types were split out so the three apps that draw chains needn't pull in auth and the registry.
import type { WebGraph } from "@studio/graph-model";
import { moduleBaseChoices } from "@studio/song/basePreset";
import { CHAIN_FILE, chainFromBench } from "@studio/song/benchChain";
import { EXTS_PATH, engineModules } from "@studio/song/engineCatalogue";
import { projectHints } from "@studio/song/hints";
import { type IoPort, ioPorts } from "@studio/song/ioPorts";
import {
  cloneModuleFile,
  createNode,
  type Diagnostic,
  deadProjectFields,
  freeNodeName,
  libraryModuleIssues,
  listBaseModules,
  loadModuleRefs,
  moduleRefOf,
  notSupportedModules,
  withModuleStamp,
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
import { isFrozenClipId, materialRefOf } from "@studio/song/nodeProject";
import {
  PLAYLIST_EXT,
  PLAYLISTS_DIR,
  parsePlaylist,
  playlistStub,
} from "@studio/song/playlist";
import {
  formatAudioDevice,
  formatChannels,
  loadPreferences,
  PREFS_PATH,
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
import { BENCH_EDGES } from "@studio/song/scaffoldBench";
import {
  isInSharedModules,
  librariesDirFor,
  moduleLibraryDirs,
  moduleNamespaceOf,
} from "@studio/song/sharedFolders";
import { projectSurfaces, surfaceIssues } from "@studio/song/surfaces";
import { UI_FILE, uiFileText } from "@studio/song/uiLibrary";
import type { VideoProjectDoc, VideoTrackDoc } from "@studio/song/videoDoc";
import { isVideoProject, loadVideoProject } from "@studio/song/videoProject";
import { videoDuration } from "@studio/song/videoTracks";
import { GRAPH_FILE } from "@studio/song/yaml/graphSchema";
import { PRESETS_BASE } from "@studio/song/yaml/moduleIO";
import type { ProjectShape } from "@studio/song/yaml/projectSchema";
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
import { guard } from "./background.ts";
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
import { mediatekBase, mediatekToken } from "./mediatekLink.ts";
import { moduleFoldersMoved } from "./moduleWatch.ts";
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
 * A project is any directory whose NAME claims an app — `mysong.st0`, `party.z0`.
 *
 * The name, not a `project.yaml` inside, because pl8 has to answer the same question from a
 * bare blobless mirror it has never checked out, where no file can be opened. One rule on both
 * sides, so what the médiathèque lists and what this tree marks cannot disagree. See
 * packages/web-protocol/projects.ts and apps/pl8/docs/projects.md.
 *
 * `isProjectFolder` (a `project.yaml` exists) is still the COMPILER's question, and
 * `@studio/song` still asks it: a `.st0` folder with no project file opens and then fails to
 * compile, with the loader's own error saying so.
 *
 * It must EXIST, though — the name rule on its own answers "yes" for a folder that is not
 * there, and pl8 names one out of a mirror that can be a fetch behind this machine's clone.
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

/**
 * Every project folder under `root`, workspace-relative, at any depth.
 *
 * Directories only, and `skip()`ped the same way the tree is, so what this answers and what a
 * tree draws cannot disagree. Its own scan rather than collecting a `FileNode` walk: that built
 * an object per FILE and threw the tree away to keep a handful of directory paths — 30.7 ms a
 * pass on a real workspace against 5.3 here.
 *
 * **A project inside a project is descended into and reported.** Nesting one is not the ordinary
 * arrangement, but a `.m9` set living inside a `.st0` song is a real one, and picking an
 * outermost winner would hide the inner one with nothing on screen to say so.
 *
 * Sorted by name at each level, which is what makes two calls comparable — a listing that
 * reordered itself between polls would redraw for nothing.
 */
export function projectDirsUnder(
  root: string,
  abs = root,
  out: string[] = [],
): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    // Unreadable: no projects here rather than a throw. Raising failed a whole poll over one
    // folder nobody could have opened anyway.
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

// Hidden files and deps are never shown/edited — and, exported, never WATCHED either: the
// strudel watcher prunes the same names, so "what this service considers part of a project"
// is one list rather than two that drift.
export const skip = (name: string): boolean =>
  name.startsWith(".") ||
  name === "node_modules" ||
  name === RECYCLE_DIR ||
  isHistoryDir(name) || // the undo/redo journal, never listed or diffed
  name.endsWith(".cache"); // engine-written waveform sidecars ({source}.cache)

/**
 * One file found by `Workspace.walkProject` — everything the three readers of the tree want,
 * gathered by the single `statSync` they used to do one apiece.
 *
 * `binary` and `source` are not the same question and neither implies the other: a `.yaml` is a
 * source and text, a `.md` is text and not a source, a `.wav` is neither.
 *
 * No workspace-relative path here, deliberately, though both journal readers want one: computing
 * it is `relative()` plus a separator pass, and the token wants none of it. Putting it in cost
 * the two-second poll ~1 ms of arithmetic for 186 files it was only going to count. `textOf` and
 * `binOf` take one half of the walk each, so between them they still work it out exactly once
 * per file — which is what the two separate walks used to do.
 */
interface WalkedFile {
  abs: string;
  size: number;
  mtimeMs: number;
  binary: boolean;
  source: boolean;
}

/**
 * What a journalled mutation answers: whatever the mutation returned, and the revision token
 * either side of it.
 *
 * The tokens ride along because `recordChange` is the one thing that BRACKETS a write, and it
 * walked the tree twice to do its diff anyway — naming the two instants costs it a filter over a
 * list it already has. Its caller would otherwise walk twice more to learn the same two facts,
 * which is exactly what `POST /command` did.
 */
export interface Recorded<T> {
  value: T;
  /** Before the mutation. `after !== before` is what "this command changed the project" means. */
  before: string;
  after: string;
}

/** One file's mtime, or 0 when it is not there — absent is a state, not a failure. */
const mtimeOf = (path: string): number => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
};

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

// The strip a track's surfaces read: the mixer module at the end of its chain, flattened to the two numbers a
// fader panel needs plus the module ref an edit has to address. Spread into the WebTrack, so a track with no
// strip simply has no `mixer` key rather than one full of zeroes that look like settings.
//
// Level and pan only. The mixer's three tone bands are still its params — nothing about the plugin or the
// module changed — but they are not lifted onto the track: they are read and written where the module's other
// params are, which is the one place that cannot disagree with itself.
function mixerOf(t: TrackDoc): { mixer?: WebMixer } {
  const p = trackMixer(t);
  if (!p) return {};
  const v = (name: string) => Number(p.params?.[name] ?? 0);
  return { mixer: { module: p.name, volume: v("Volume"), pan: v("Pan") } };
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
    // The window of material this placement draws — what the browser's envelope cache keys on.
    offset: c.offset,
    sourceFrom: c.sourceFrom,
    sourceTo: c.sourceTo,
    // The NAME only: a browser has no business resolving a path on the engine's machine.
    sourceName: c.source ? basename(c.source) : undefined,
    loopStart: c.loopStart,
    loopEnd: c.loopEnd,
    // `warped` is "there is a map at play here", which a declined one is not — so an event with
    // warping switched off draws the icon CROSSED rather than lit: `warpOff` is what says which.
    warped: c.warp || c.warpOff ? true : undefined,
    warpOff: c.warpOff ? true : undefined,
    disabled: c.disabled ? true : undefined,
    // The fades, which the compiler has always produced and this mapping has always dropped.
    // `|| undefined` rather than a copy: a zero fade is no fade, and sending one would make every
    // untouched event carry two explicit zeroes on a document polled every two seconds.
    fadeIn: c.fadeIn || undefined,
    fadeOut: c.fadeOut || undefined,
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
    // Said apart from the name rule below because it is the one that actually happens: a
    // bookmark, or a link somebody sent, naming a folder that has been renamed or is on
    // somebody else's machine. It used to name a THIRD cause — pl8 linking here out of a mirror
    // that could be behind this clone — and that one is gone: the listing is this machine's own.
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
    this.invalidateProjectDoc();
    guard("waveform prewarm", this.prewarmWaveforms());
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
    this.forgetProjects();
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
    const r = importProjectInto(this.lifecycleHost(), rel);
    this.forgetProjects();
    return r;
  }

  /** Scaffold a NEW project folder at the workspace root — see projectLifecycle.ts. */
  createProject(shape: ProjectShape, rawName: string): { project: string } {
    const r = createProjectIn(this.lifecycleHost(), shape, rawName);
    this.forgetProjects();
    return r;
  }

  /**
   * A project folder appeared or went: the list `workspaceInfo` serves must be re-scanned NOW.
   *
   * The three places that move one say so, rather than the list being invalidated by the
   * mutation counter — which every file write bumps and which would therefore throw the scan
   * away thirty times while you type, to re-find the same five folders.
   */
  private forgetProjects(): void {
    this.projectsCache = null;
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
    // …and tell the module watcher, which cannot learn this in time on its own: `fs.watch`
    // delivers on a later tick, so a command that writes a module file and then rebuilds the
    // graph in the same request would be told nothing had moved. See moduleWatch.ts.
    moduleFoldersMoved();
  }

  /**
   * The token, held for the duration of ONE derivation.
   *
   * `graphDoc()` asked for it, then called `clipExtents()` → `cachedProjectDoc()`, which asked
   * again — two full walks of the project per `GET /graph`, on a total cache HIT. `POST /command`
   * managed four. Each is the 4.8 ms this file's own comment quotes, spent proving nothing had
   * changed since the last one, microseconds earlier.
   *
   * Re-entrant rather than plumbed through the request: the nesting is already synchronous, so
   * the outermost derivation opens the scope and the inner ones find it open. Exactly the shape
   * `withModuleStamp` has in `@studio/song`, and for the same reason.
   *
   * `/revision` itself is unaffected — it is polled outside any scope and still walks.
   */
  private revScope: string | null = null;
  /**
   * `seed` is a token the caller ALREADY holds, taken microseconds earlier and after the same
   * write — `POST /command` gets one out of `recordChange`, which walked the tree to journal the
   * mutation and can name the instant it finished for nothing. Opening the scope on it rather
   * than on a fresh walk is the difference between one walk per phase and two.
   *
   * Only ever a token this class produced. A caller inventing one would be keying every memo
   * under it on a lie.
   */
  withRevision<T>(fn: () => T, seed?: string): T {
    if (this.revScope !== null) return fn(); // already inside one
    this.revScope = seed ?? this.freshRevision();
    try {
      return fn();
    } finally {
      this.revScope = null;
    }
  }

  // A cheap token that changes when the project's sources do, so clients poll it instead of the derivations.
  // See docs/workspace.md for why it is a mutation counter plus a walk, and deliberately not a content hash.
  revision(): { rev: string } {
    return { rev: this.revScope ?? this.freshRevision() };
  }

  // --- the walk the three readers of the tree share --------------------------
  /**
   * ONE walk of the project, shared by everything that needs the shape of the tree at one
   * instant — `withWalk` opens it, `revisionOf` / `textOf` / `binOf` read it.
   *
   * They were three walks, and a command that writes took six of them: the token before, the
   * journal's two images before, the same two after, the token after. All of the same tree, with
   * the same `skip()`, microseconds apart. Measured on the reference song (39 directories, 284
   * files after `skip`): the readdir sweep is 2,1 ms and the stats on top of it 6,2 — so the
   * three readers cost 16,4 ms per phase, of which two thirds was proving, twice over, what the
   * first pass had just established.
   *
   * `sourcesOnly` is what keeps `/revision` as cheap as it was: polled every two seconds per
   * tab, it wants the `.yaml` files alone and has no reason to stat a folder of wavs.
   */
  private walkScope: WalkedFile[] | null = null;
  private walkProject(dir: string, sourcesOnly = false): WalkedFile[] {
    const out: WalkedFile[] = [];
    const walk = (abs: string): void => {
      let entries: Dirent[];
      try {
        entries = readdirSync(abs, { withFileTypes: true });
      } catch {
        return; // unreadable — treated as empty rather than failing the caller
      }
      for (const e of entries) {
        if (skip(e.name)) continue;
        const p = join(abs, e.name);
        if (e.isDirectory()) {
          walk(p);
          continue;
        }
        // A project SOURCE — an out-of-band edit to one moves the token, a media copy does not.
        const source = PROJECT_FILE.test(e.name);
        if (sourcesOnly && !source) continue;
        try {
          const s = statSync(p);
          out.push({
            abs: p,
            size: s.size,
            mtimeMs: s.mtimeMs,
            binary: isBinary(e.name),
            source,
          });
        } catch {
          /* raced away between readdir and stat — the next walk sees it */
        }
      }
    };
    walk(dir);
    return out;
  }

  /**
   * Run `fn` over ONE walk of the active project, shared by everything inside it.
   *
   * Re-entrant and synchronous-only, exactly like `withRevision` above and for the same reason:
   * the readers nest already, so the outermost opens the scope and the inner ones find it open.
   * Nothing inside may WRITE — the whole promise is that every reader is describing the same
   * instant, and a write in the middle would make half of them describe a different one.
   */
  private withWalk<T>(dir: string, fn: (files: WalkedFile[]) => T): T {
    if (this.walkScope !== null) return fn(this.walkScope);
    this.walkScope = this.walkProject(dir);
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
    // The walk a mutation already has open, when there is one — see `withWalk`. Otherwise its
    // own, and a NARROW one: the token counts sources, so an unscoped poll never stats a folder
    // of media. That is the whole reason `walkProject` takes the flag rather than always
    // reporting everything — `/revision` is asked for every two seconds, per tab.
    return this.revisionOf(this.walkScope ?? this.walkProject(dir, true));
  }

  /**
   * The token, from a walk: the mutation counter, how many SOURCES there are, and the newest
   * thing among them.
   *
   * One derivation whichever walk fed it, which is the half that must not drift — a token
   * computed two ways is two answers to "has this project moved", and every memo in this file is
   * keyed on it.
   */
  private revisionOf(files: WalkedFile[]): string {
    // …and the two files OUTSIDE the project that a derived view still reads: the engine's scan
    // cache (`@engine/…` modules come out of it) and the machine's preferences (a channel's
    // label). Two stats on a walk of hundreds, and without them the views memoised on this token
    // were wrong after a plugin rescan or a `system channel set` until the next edit — which
    // `hints()` already was, quietly, before anything else was keyed here.
    let newest = mtimeOf(EXTS_PATH);
    const prefsAt = mtimeOf(PREFS_PATH);
    if (prefsAt > newest) newest = prefsAt;
    let count = 0;
    for (const f of files) {
      if (!f.source) continue;
      count++;
      if (f.mtimeMs > newest) newest = f.mtimeMs;
    }
    return `${this.mutations}:${count}:${newest}`;
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
  ): Promise<Recorded<T>> {
    const dir = this.activeProject;
    if (!dir) {
      // No project, no journal — and no walk either: the token is `none:<mutations>`.
      const rev = this.revision().rev;
      return { value: await mutate(() => {}), before: rev, after: rev };
    }
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
    const before = this.treeShot(dir);
    const result = await mutate(snapshot);
    const after = this.treeShot(dir);
    try {
      const changes = diffText(before.text, after.text);
      const blobs = diffBin(this.root, before.bin, after.bin, pre);
      if (changes.length || blobs.length)
        this.history(dir).push({ label, changes, blobs });
    } catch {
      /* journaling must never break a good write */
    }
    return { value: result, before: before.rev, after: after.rev };
  }

  /**
   * The project at one instant, from ONE walk: the two images a diff compares, and the token
   * that names the moment they were taken.
   *
   * The token comes back with them because it is free here and expensive anywhere else — the
   * walk it needs is the walk that has just happened. `POST /command` used to take two of its
   * own around this call, one either side, and each was a second pass over the tree this one had
   * already crossed. See `withRevision`'s `seed`.
   */
  private treeShot(dir: string): {
    text: Map<string, string>;
    bin: Map<string, string>;
    rev: string;
  } {
    return this.withWalk(dir, (files) => ({
      text: this.textOf(files),
      bin: this.binOf(files),
      rev: this.revisionOf(files),
    }));
  }

  /**
   * Every text file's content, keyed by workspace-relative path — the before/after images a diff
   * compares.
   *
   * Only files that MOVED are re-read: each one's size+mtime is checked against the last walk's,
   * and the content is carried over when it matches. Every command takes two of these images —
   * one before the mutation and one after — so a song of 180 small YAML files would read 360 of
   * them to journal the one line a command rewrote, and the "before" image is almost always the
   * "after" image of the command before it.
   *
   * The gate is the one `binOf` already trusts for binaries: a write that kept both the size and
   * the sub-millisecond mtime would be missed, which no real write does.
   *
   * It takes the walk rather than doing one — it and `binOf` split the same tree between them
   * (text here, binaries there) and used to cross it separately to do it. See `withWalk`.
   */
  private textOf(files: WalkedFile[]): Map<string, string> {
    const out = new Map<string, string>();
    // Built fresh so a deleted file leaves the cache with it, rather than lingering for ever.
    const seen = new Map<string, { stamp: string; text: string }>();
    for (const f of files) {
      if (f.binary) continue;
      const rel = this.toRel(f.abs);
      const stamp = `${f.size}:${f.mtimeMs}`;
      const hit = this.textCache.get(rel);
      let text: string;
      if (hit?.stamp === stamp) text = hit.text;
      else
        try {
          text = readFileSync(f.abs, "utf8");
        } catch {
          continue; // unreadable — treated as absent, as it always was
        }
      out.set(rel, text);
      seen.set(rel, { stamp, text });
    }
    this.textCache = seen;
    return out;
  }

  // Size+mtime of every binary file — enough to tell created/overwritten from untouched.
  private binOf(files: WalkedFile[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const f of files)
      if (f.binary) out.set(this.toRel(f.abs), `${f.size}:${f.mtimeMs}`);
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
            // WHICH app opens it, beside the flag that says one does. The home page's tree
            // draws a departure per project and needs the name of where it leads — a `.z0`
            // in an st0 workspace opens somewhere else, and that row must not guess.
            app: (isProjectDir(childAbs) && projectApp(e.name)) || undefined,
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
   * The WHOLE workspace as a tree — everything `tree()` deliberately leaves out.
   *
   * Its own method rather than a flag on `tree()`, because they answer different questions and
   * only one of them is the editor's. This one is the home page's 'look inside' pane: the
   * repository around the song, which is exactly what an editor must not draw and what
   * somebody choosing a project wants.
   *
   * It replaces pl8's `/api/projects/:id/tree`, which read the same shape out of a bare mirror.
   * Same `FileNode`, same `project` flag, same `skip()` — so the rows did not change when the
   * source did.
   */
  workspaceTree(): FileNode[] {
    return this.walk(this.root);
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
   * The CHAINS the account's library repository holds — what the chains builder lists.
   *
   * A chain is a folder holding a `graph.yaml`, at any depth under `chains/`, and nothing
   * inside one is another: the médiathèque's own rule, and the same walk `processChain`'s
   * `libraryChains` does for `@st0/…` refs. Restated rather than imported because that one is
   * bound to a command's argument and this answers a browser — but the rule is one rule, and if
   * it ever gains a case both have to learn it.
   *
   * `ref` is what the chain is CALLED (`process/normalize`), `path` where it is, workspace-
   * relative, because that is the only address a browser may hand back. A missing submodule is
   * an empty list, never a throw: an account with no library yet has no chains, which is a fact
   * and not an error.
   */
  libraryChains(): { ref: string; path: string; nodes: string[] }[] {
    const root = librariesDirFor(this.activeProject ?? this.root, "chains");
    const out: { ref: string; path: string; nodes: string[] }[] = [];
    // A chain's node files, by NAME — the folder holding them is fixed, and the caller addresses
    // them under the chain's own `path`. A chain with no `nodes/` yet is a real state (one just
    // created), so an unreadable folder is an empty list rather than a throw.
    const nodesIn = (at: string): string[] => {
      try {
        return readdirSync(join(at, "nodes"), { withFileTypes: true })
          .filter((e) => e.isFile() && /\.ya?ml$/i.test(e.name))
          .map((e) => e.name)
          .sort();
      } catch {
        return [];
      }
    };
    const walk = (at: string, ref: string): void => {
      let entries: Dirent[];
      try {
        entries = readdirSync(at, { withFileTypes: true });
      } catch {
        return;
      }
      if (entries.some((e) => e.isFile() && e.name === GRAPH_FILE)) {
        if (ref) out.push({ ref, path: this.toRel(at), nodes: nodesIn(at) });
        return;
      }
      for (const e of entries)
        if (e.isDirectory())
          walk(join(at, e.name), ref ? `${ref}/${e.name}` : e.name);
    };
    walk(root, "");
    return out.sort((a, b) => a.ref.localeCompare(b.ref));
  }

  /**
   * The playlists this workspace holds — `_playlists/**\/*.yaml`, at any depth.
   *
   * Its own answer for the reason `moduleLibraries` is: `tree()` shows the active PROJECT, and
   * `_playlists` sits at the workspace root beside `_modules`, so no amount of walking the song's
   * own tree could ever find it (`docs/activeProject.md`).
   *
   * The workspace ROOT and not `../_playlists` beside the project, which is where the two module
   * libraries live. A set list belongs to the repository rather than to one song in it — you
   * build one once and open it against whichever project you are working in — and rooting it at
   * the project would give a workspace of four songs four separate playlist folders.
   *
   * `title` and `count` come from PARSING each file, which is the whole of what a listing needs
   * to draw a row. A file that does not parse is listed anyway, with `ok: false`: it is on the
   * disk, and a listing that hid it would leave you unable to click the thing you have to go and
   * repair — the same rule the médiathèque's scan followed for the family this replaced.
   */
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
        if (!e.isFile() || !/\.ya?ml$/i.test(e.name)) continue;
        let parsed: ReturnType<typeof parsePlaylist> = null;
        try {
          parsed = parsePlaylist(readFileSync(abs, "utf8"));
        } catch {
          parsed = null; // unreadable bytes read exactly like unparseable ones from here
        }
        out.push({
          path: this.toRel(abs),
          name: e.name.replace(/\.ya?ml$/i, ""),
          ...(parsed?.title ? { title: parsed.title } : {}),
          count: parsed?.items.length ?? 0,
          ok: parsed !== null,
        });
      }
    };
    walk(root);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Make a new playlist and answer where it landed.
   *
   * Writes the STUB rather than an empty file, for the reason the médiathèque's "Nouvelle
   * playlist…" did: the screen draws its right-hand pane from the text, so an empty file would
   * open on a parse failure for a playlist nobody has yet had a chance to get wrong.
   *
   * The extension is added when it is missing — it is what makes the file a playlist, there
   * being no marker inside one — and an existing file is refused rather than opened, so a
   * "create" never quietly hands back somebody else's set list.
   */
  createPlaylist(name: string): { path: string } {
    const clean = name.trim().replace(/^\/+|\/+$/g, "");
    if (!clean) throw new Error("a playlist needs a name");
    const rel = `${PLAYLISTS_DIR}/${/\.ya?ml$/i.test(clean) ? clean : `${clean}${PLAYLIST_EXT}`}`;
    // Through safePath, so a `..` in the name cannot leave the workspace.
    const abs = this.safePath(rel);
    if (existsSync(abs)) throw new Error(`${rel} is already there`);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(
      abs,
      playlistStub(basename(abs).replace(/\.ya?ml$/i, "")),
      "utf8",
    );
    return { path: this.toRel(abs) };
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

  /**
   * The named bases the module at `rel` may be set to — its own `base/`, then every module it
   * extends, nearest first.
   *
   * Off the LOADED refs rather than by listing `base/` here, because the ancestry is the whole
   * value of the answer: the bases are snapshotted onto the shared module that names the plugin,
   * and a song points at it through a thin local module whose own folder holds none. Listing that
   * folder would offer nothing on exactly the module built to be chosen from — the mistake
   * `moduleAssetChoices` exists to have stopped making for assets.
   *
   * An unreadable project is an empty list, never a throw: a builder asking what a module offers
   * must not be the thing that reports a broken song somewhere else in it.
   */
  moduleBases(rel: string): string[] {
    const abs = this.safePath(rel);
    const dir = this.activeProject ?? this.root;
    try {
      const refs = withModuleStamp(dir, () => loadModuleRefs(dir)) as Record<
        string,
        { extends?: unknown; folderAbs?: unknown }
      >;
      // The module being edited is addressed by its FILE, so its folder is that file's — and its
      // `extends` is read from the same map, by whichever ref names this folder.
      const folderAbs = dirname(abs);
      const self = Object.values(refs).find((m) => m.folderAbs === folderAbs);
      return moduleBaseChoices({ folderAbs, extends: self?.extends }, refs);
    } catch {
      return [];
    }
  }

  /**
   * Where a named BASE goes: `base/<name>.vstpreset` beside the module file.
   *
   * A base is an opaque `.vstpreset` blob kept with the module, for the plugins whose sound is not
   * in their automatable parameters — an Arturia patch is not, so `presets.yaml` (numbers only)
   * cannot hold one. `base/` is its own folder rather than more files loose in the module folder,
   * because the loader already reads `<name>.vstpreset` THERE as the module's single default and a
   * second spelling in the same directory would be two rules over one namespace.
   *
   * Resolved HERE and not by the caller, twice over: the builder is forbidden from constructing a
   * path at all (see `ModuleStore`), and a name that arrives from a browser is not a path component
   * until something has said so. `basename` plus the separator strip is `renameEntry`'s rule, for
   * the same reason — this name only ever names a file in one directory.
   *
   * Returns both spellings because both are needed and neither is derivable by its consumer: the
   * ENGINE writes the absolute one (it is a different process), the browser is told the relative
   * one (it has no idea where the workspace lives).
   */
  baseSnapshotPath(rel: string, name: string): { abs: string; path: string } {
    const moduleAbs = this.safePath(rel);
    const clean = basename(name).replace(/[\\/]/g, "").trim();
    if (!clean || clean === "." || clean === "..")
      throw new Error(`invalid name: ${name}`);
    // Spelt once, whether or not the user typed it — a base called `warm.vstpreset` and one
    // called `warm` are the same base, and two files would be the surprise.
    const leaf = clean.endsWith(".vstpreset") ? clean : `${clean}.vstpreset`;
    const dir = this.safePath(this.toRel(join(dirname(moduleAbs), "base")));
    const abs = this.safePath(this.toRel(join(dir, leaf)));
    mkdirSync(dir, { recursive: true });
    return { abs, path: this.toRel(abs) };
  }

  /**
   * The project list, re-scanned at most this often — see `workspaceInfo`.
   *
   * The same shape as engineLink's `RECONCILE_EVERY_MS`, and for the same reason: a poll asking
   * a question whose answer almost never changes needs a floor under how often it may ask.
   */
  private static readonly PROJECTS_RESCAN_MS = 5_000;
  private projectsCache: { at: number; list: string[] } | null = null;

  /**
   * What the workspace holds, and which project is open.
   *
   * Polled every two seconds by every tab, and what the poll actually WANTS is `activeProject`
   * (another tab switched) and `lastTake` (a recording landed) — both free. `projects` is the
   * expensive field by three orders of magnitude: 721 directories on a real workspace, 26 ms,
   * to answer a question whose answer changes when somebody creates a project.
   *
   * So it is rescanned when this service MOVED one — `forgetProjects`, said by the three
   * methods that create, import or recycle a project — and otherwise at most every five
   * seconds. Not the revision token: that one describes the ACTIVE project, and a project
   * appearing beside it does not move it.
   *
   * The window is what covers what those three cannot see: a folder created on disk by a hand
   * outside this process, or arriving in a `git pull`. `cachedProjectDoc` refused that trade
   * and had to — a stale COMPILE is confidently wrong about a song. A project list five seconds
   * behind is a picker that has not noticed a folder yet, which is a wait, not a lie.
   */
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
    // From the ROOT, not `tree()`: this lists every project the workspace holds, and the
    // tree now shows only the open one. The walk itself is shared with the home page's
    // listing (`projectDirsUnder`), which asks the same question about every workspace at once.
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
     * that ARE the chain go back to it: `graph.yaml`, translated at the edges the way it was
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
  createNode(rel: string, node?: string): { path: string } {
    const abs = this.safePath(rel);
    let modDir = abs;
    if (PROJECT_FILE.test(basename(abs))) modDir = dirname(abs);
    const category = basename(dirname(modDir));
    const name = basename(modDir);
    const dir = this.requireActive();
    // Unnamed is the ordinary case: the file tree's "new node" asks for a module and nothing
    // else, so the name is `<module>_<n>`. No lane prefix — this one is not born in a chain.
    const newPath = createNode(
      dir,
      category,
      name,
      node || freeNodeName(dir, name),
    );
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

  /**
   * A derived view, memoised on the revision token — the rule `hints`, `graphDoc` and
   * `projectDoc` each state for themselves, said once for the three below that had no cache
   * at all and read the whole module vocabulary on every request.
   *
   * Same token and therefore the same guarantee: it moves for an edit made outside this service
   * as well as for one of ours. `build` may only READ — everything keyed here is a projection of
   * the folder, and a builder that wrote would be memoising its own side effect away.
   */
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
      // No project open, or a folder that will not read: the empty answer, never a cached one.
      return empty;
    }
  }

  /** The declared I/O — what the panel lists and meters. Empty with no project open. */
  ioPorts(): IoPort[] {
    return this.onRevision("ioPorts", (dir) => ioPorts(dir), []);
  }

  /**
   * The shared `_modules` catalogue — what the module builder lists.
   *
   * The paths come back workspace-relative, like every other path on the wire: a catalogue
   * sits beside the projects, not inside one, and that is the only space the editor speaks.
   */
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

  /**
   * Just the base-module refs — what the graph's `+` picker browses.
   *
   * Its own route because the picker used to wait on the whole of `hints()`: a click paid for the tracks, the
   * clips, the plugin scan and the path map to show a list of modules. This is a fraction of that work and a
   * fraction of the payload, and the shell prefetches it, so opening the picker awaits nothing.
   */
  baseModules(): string[] {
    return this.onRevision("baseModules", (dir) => listBaseModules(dir), []);
  }

  /**
   * The editor's completion vocabulary, memoised on the revision exactly as the graph is.
   *
   * A pure read of the project folder, and st0 asks for it after EVERY command — the editor pane
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

  /**
   * The frozen snapshot `project share link` sends to pl8 — rendered here, uploaded by the caller.
   *
   * The three documents are what a BROWSER draws a project from, and each is here for a reason
   * the next person should not have to re-derive:
   *
   * - `project-doc.json` (`WebProject`) is the arrangement. It carries `sourceName` — the audio
   *   file's NAME and never its path — so it says what a clip is called without saying where
   *   anything lives on this machine.
   * - `graph.json` (`WebGraph`) is the chains, the modules and their AUTHORED parameter values.
   *   That is the feature: "see the modules without editing them" is this document.
   * - `surfaces.json` is what the project DECLARES, verbatim. A project with a viewport surface
   *   is shared with that surface still declared and no video beside it; the snapshot says which
   *   media it carries (`media.video: false`) rather than editing the project's own claims.
   *
   * Three documents are deliberately NOT here. `video-doc` carries workspace-relative media paths
   * (`toWebVideoTracks`) and the share is audio-only anyway; `project-errors` quotes file paths
   * and lines of YAML; `/tree` and `/file` are the source itself. A share shows the song, not the
   * folder it was made in.
   *
   * Nothing here writes to the project. Freezing a shared copy is a RENDER, not `node freeze` ×N.
   */
  buildShare(): ShareBundle {
    const dir = this.requireActive();
    const engine = findEngineBinary();
    if (!engine)
      throw new Error("engine binary not found — cannot render the share");
    const web = this.projectDoc();
    return buildShareBundle(
      engine,
      this.cachedProjectDoc(dir),
      {
        "project-doc.json": web,
        "graph.json": this.graphDoc(),
        "surfaces.json": this.surfaces(),
      },
      { name: web.name || basename(dir) },
    );
  }

  /**
   * Render the snapshot and send it to pl8. Answers the secret the link is built from.
   *
   * The credential is NOT k7's `.settings.json` pair but the machine's own pl8 bearer —
   * `mediatekBase()` / `mediatekToken()`, the `service:st0` token `npm run tokens` already writes
   * into the supervisor's settings for the library pull. Sharing needed no new plumbing: this
   * service has been talking to pl8 with it all along.
   *
   * A service token has no person of its own, so the user is named on every call (`?user=`) —
   * the same arrangement, and the same accepted cost, that `/ssh-key/private` documents.
   */
  async shareLink(
    userEmail: string,
  ): Promise<{ token: string; bytes: number }> {
    const base = mediatekBase();
    const token = mediatekToken();
    if (!base)
      throw new Error("no médiathèque to share to — this machine caches none");
    if (!token)
      throw new Error(
        "no médiathèque token on this machine — run `npm run tokens`",
      );
    const dir = this.requireActive();
    const bundle = this.buildShare();
    try {
      const link = await uploadShare(bundle, {
        base,
        token,
        user: userEmail,
        // Where it came from, for the author's own list. Never served publicly.
        origin: { repo: basename(this.root), project: basename(dir) },
      });
      return { token: link.token, bytes: link.bytes };
    } finally {
      // The upload streams from these files, so they live until it is over — and go whether it
      // ended well or not. A share of a long song is half a gigabyte of temp.
      bundle.cleanup();
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
      const p = this.cachedProjectDoc(dir);
      // The grid, so a TIMECODE `from:`/`to:` becomes seconds here as it does in the compiler —
      // the same pair waveformOps passes, and for the same reason: an imported song writes nearly
      // all of its windows that way, and without it the definition comes back with none.
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
      /**
       * The clip's own WINDOW, not the whole file — auditioning has to play what the clip plays.
       *
       * This returned `{0, 0}` and so played the file end to end, which for a take trimmed down to
       * one bar of a five-minute pass meant the ▶ said nothing about the clip you were looking at.
       * `sourceFrom`/`sourceTo` are the compiler's own answer in file seconds, timecode spelling
       * already resolved (see AudioClipSchema), and on a placement they are the material's window
       * already narrowed by the event's.
       *
       * A `to` that is absent — or not past the in-point, which is what an empty intersection
       * leaves — stays a length of 0: the engine reads that as "to the end of the file", and it is
       * the only honest thing to say about an extent no one here has opened the wav to measure.
       */
      const start = Math.max(0, clip.sourceFrom ?? 0);
      const to = clip.sourceTo ?? 0;
      return {
        file: clip.source,
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

  /**
   * Everything wrong with the project, from ONE layer — the compile itself, reusing the cache
   * and parsing its throw.
   *
   * Wrapped in BOTH scopes, and it is the route that needed them most. It reads and writes
   * nothing, which is the whole permission `withModuleStamp` asks for; without it,
   * `notSupportedModules` and `libraryModuleIssues` each reached `loadModuleRefs` and each paid
   * the module stamp walk over again. Measured on a real song: 48.5 ms became 29, and the 19 ms
   * saved is one walk, not one read — both reads were already cache hits.
   */
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

  /**
   * The compiled song as the BROWSER wants it, memoised on the revision.
   *
   * The compile underneath was already cached; this projection of it was not — the only one of
   * the three derived views (`graphDoc`, `hints`, this) that rebuilt on every request. And it is
   * the most asked-for: three components are mounted for the app's life and each fetches it on
   * the same `reloadKey`, so one command meant three full re-maps of every track, clip and note
   * per tab, plus three `JSON.stringify` of the whole song.
   *
   * Same token, same rule, same reason as the other two: it moves for an edit made outside this
   * service as well as for one of ours.
   */
  private webDocCache: { dir: string; rev: string; doc: WebProject } | null =
    null;

  projectDoc(): WebProject {
    return this.withRevision(() => {
      const dir = this.requireActive();
      const { rev } = this.revision();
      const hit = this.webDocCache;
      if (hit && hit.dir === dir && hit.rev === rev) return hit.doc;
      const p = this.cachedProjectDoc(dir);
      const doc: WebProject = {
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
        masterVolume: p.masterVolume,
        metronome: p.settings.metronome,
        countIn: p.settings.countIn,
        strudel: p.strudel,
        markers: p.markers.map((m) => ({
          beat: m.beat,
          name: m.name,
          tc: m.tc,
        })),
      };
      this.webDocCache = { dir, rev, doc };
      return doc;
    });
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

  // `at` builds the graph of a folder OTHER than the open project — a library chain, for the
  // builder. The cache below already refuses to key on anything but the active project, which is
  // why passing one costs nothing to explain: it takes the branch that was there for it.
  graphDoc(at?: string): WebGraph {
    // TWO scopes for the whole derivation, and both are the same idea one level apart. The
    // revision token, because `clipExtents` below reaches `cachedProjectDoc`, which asks for it
    // again. And the module stamp, because on a rebuild this compiles the project (one walk) and
    // then builds the graph (another) — 19 ms each, both proving the module folders had not
    // moved since the line before. Nothing here writes, which is the permission the stamp asks.
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
