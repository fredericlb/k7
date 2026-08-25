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
import type { ShareBundle } from "@studio/commands/share-bundle";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import { scannedPluginNames } from "@studio/engine-client/pluginCache";
// WebGraph is graph-model's, not web-protocol's: an app that draws chains needn't pull in auth and the registry.
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
import { isFrozenClipId, materialRefOf } from "@studio/song/nodeProject";
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
import {
  isVideoProject,
  projectSurfaces,
  surfaceIssues,
} from "@studio/song/surfaces";
import { UI_FILE, uiFileText } from "@studio/song/uiLibrary";
import { ensureVideoRun } from "@studio/song/videoOutputs";
import { PRESETS_BASE } from "@studio/song/yaml/moduleIO";
import {
  ENGINE_NS,
  type ModuleNamespace,
} from "@studio/song-schema/moduleTypes";
import { PLAYLISTS_DIR, parsePlaylist } from "@studio/song-schema/playlist";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
import type {
  VideoProjectDoc,
  VideoTrackDoc,
} from "@studio/song-video/videoDoc";
import { loadVideoProject } from "@studio/song-video/videoProject";
import { videoDuration } from "@studio/song-video/videoTracks";
import type { K7Result } from "@studio/take-render/render";
import { wavSeconds } from "@studio/take-render/wavLength";
import type {
  ChangedFile,
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
// The four export acts, behind a host of six members — see shareOps.ts.
import {
  buildShare,
  exportMix,
  type ShareHost,
  shareK7,
  shareLink,
} from "./shareOps.ts";
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

// Hidden files and deps are never shown, edited or WATCHED — the strudel watcher prunes this same list.
export const skip = (name: string): boolean =>
  name.startsWith(".") ||
  name === "node_modules" ||
  name === RECYCLE_DIR ||
  isHistoryDir(name) || // the undo/redo journal, never listed or diffed
  name.endsWith(".cache"); // engine-written waveform sidecars ({source}.cache)

/** One file found by `walkProject`, from a single `statSync` — see docs/workspace.md. */
interface WalkedFile {
  abs: string;
  size: number;
  mtimeMs: number;
  binary: boolean;
  source: boolean;
}

/** What a journalled mutation answers, tokens included — see docs/workspace.md. */
export interface Recorded<T> {
  value: T;
  /** Before the mutation. `after !== before` is what "this command changed the project" means. */
  before: string;
  after: string;
  /** …and WHICH files moved, project-relative; `null` when the diff could not be taken. */
  files: ChangedFile[] | null;
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

// The strip a track's surfaces read — level and pan only, spread in. See docs/workspace.md.
function mixerOf(t: TrackDoc): { mixer?: WebMixer } {
  const p = trackMixer(t);
  if (!p) return {};
  const v = (name: string) => Number(p.params?.[name] ?? 0);
  return { mixer: { module: p.name, volume: v("Volume"), pan: v("Pan") } };
}

/** How long a source is, memoised on the file's IDENTITY rather than its name — docs/workspace.md. */
const durations = new Map<string, { key: string; secs: number | null }>();
function sourceSeconds(abs: string): number | null {
  let key: string;
  try {
    const s = statSync(abs);
    key = `${s.size}-${s.mtimeMs}`;
  } catch {
    return null; // gone, or never there — the caller draws what the document says
  }
  const hit = durations.get(abs);
  if (hit && hit.key === key) return hit.secs;
  const secs = wavSeconds(abs);
  durations.set(abs, { key, secs });
  return secs;
}

/** The extent a clip DRAWS at, for one whose document states none — see docs/workspace.md. */
function naturalBeats(c: TrackDoc["clips"][number], tempo: number): number {
  if (c.type !== "audio" || !c.source || tempo <= 0) return 0;
  const secs = sourceSeconds(c.source);
  if (secs === null) return 0;
  const rest = secs - (c.sourceFrom ?? 0);
  return rest > 0 ? (rest * tempo) / 60 : 0;
}

// One clip as the browser reads it, named so a TAKE draws identically to the arrangement it was.
function toWebClip(
  c: TrackDoc["clips"][number],
  // The extent to draw when the document states none — absent for a lane with no files behind it.
  natural?: (c: TrackDoc["clips"][number]) => number,
) {
  return {
    id: c.id,
    type: c.type,
    name: c.name,
    start: c.start,
    // `|| natural`, not `??`: 0 is precisely the value that means "unstated" — docs/workspace.md.
    length: c.length || natural?.(c) || 0,
    // The window of material this placement draws — what the browser's envelope cache keys on.
    offset: c.offset,
    sourceFrom: c.sourceFrom,
    sourceTo: c.sourceTo,
    // The NAME only: a browser has no business resolving a path on the engine's machine.
    sourceName: c.source ? basename(c.source) : undefined,
    loopStart: c.loopStart,
    loopEnd: c.loopEnd,
    // `warped` is "there is a map at play here"; `warpOff` is what draws the icon CROSSED.
    warped: c.warp || c.warpOff ? true : undefined,
    warpOff: c.warpOff ? true : undefined,
    disabled: c.disabled ? true : undefined,
    // The fades, `|| undefined` rather than copied: a zero fade is no fade — docs/workspace.md.
    fadeIn: c.fadeIn || undefined,
    fadeOut: c.fadeOut || undefined,
    // A render standing in for a frozen lane, told by the suffix the compiler reserves for one.
    frozen: isFrozenClipId(c.id) ? true : undefined,
    // The placement's own words, straight through — the only part a paste can write back.
    event: c.event,
    notes: c.notes.map((n) => ({
      time: n.time,
      duration: n.duration,
      key: n.key,
      // Only when the file SAID one: the compiler defaults `vel` to 1 — see docs/workspace.md.
      ...(n.vel !== undefined && n.vel !== 1 ? { vel: n.vel } : {}),
      // The pad's effects, unexpanded — what the sequencer draws its icon from.
      ...(n.repeat ? { repeat: n.repeat } : {}),
      ...(n.skip ? { skip: n.skip } : {}),
    })),
  };
}

/** TrackDoc[] -> the flat WebTrack[] the Timeline draws; `tempo` turns seconds into beats. */
export function toWebTracks(tracks: TrackDoc[], tempo?: number): WebTrack[] {
  const natural =
    tempo === undefined
      ? undefined
      : (c: TrackDoc["clips"][number]) => naturalBeats(c, tempo);
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
    clips: t.clips.map((c) => toWebClip(c, natural)),
    // The takes, through the same mapping — packages/song/docs/takes.md.
    ...(t.takes?.length
      ? {
          takes: t.takes.map((k) => ({
            ...(k.name ? { name: k.name } : {}),
            clips: k.clips.map((c) => toWebClip(c, natural)),
          })),
        }
      : {}),
    plugins: t.plugins.map((pl) => ({
      id: pl.id,
      type: pl.type,
      name: pl.name,
    })),
    // `docs`/`todos`, `frozen` and the alternatives belong to the graph — packages/song/docs/docModules.md.
  }));
}

// The user's global preferences — per-MACHINE, not per-workspace, hence module-level.
export function preferences(): {
  audioDevice: string | null;
  channels: { in: string; out: string };
  vim: boolean;
  stemsChain: string | null;
} {
  const p = loadPreferences();
  return {
    audioDevice: p.audioDevice ? formatAudioDevice(p.audioDevice) : null,
    channels: formatChannels(p),
    vim: p.editor.vim,
    stemsChain: p.stemsChain ?? null,
  };
}

export function setVim(on: boolean): boolean {
  return setEditorVim(on).editor.vim;
}

// Remember which interface this machine plays through; the engine forgets, so engineLink replays this.
export function setAudioDevicePref(name: string, type?: string): string | null {
  const p = setAudioDevice(name, type);
  return p.audioDevice ? formatAudioDevice(p.audioDevice) : null;
}

// The per-workspace active-project marker, a dotfile — exported so workspaces.ts can read it bare.
export const ACTIVE_MARKER = ".studio-active";

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

/** The two diffs above, project-relative and said as appeared / edited / disappeared. */
function changedFiles(
  base: string,
  // Both diffs, read only for their SHAPE: a path, and which side was absent.
  ...diffs: { path: string; before: unknown; after: unknown }[][]
): ChangedFile[] {
  const head = base === "." || base === "" ? "" : `${base}/`;
  const out = new Map<string, ChangedFile>();
  for (const c of diffs.flat()) {
    // A prefix that did not match would otherwise be reported as an absolute-looking path.
    if (head && !c.path.startsWith(head)) continue;
    const path = head ? c.path.slice(head.length) : c.path;
    const kind =
      c.before === null ? "added" : c.after === null ? "removed" : "edited";
    // A file in both lists is one change, and appearing or disappearing outranks being rewritten.
    const seen = out.get(path);
    if (!seen || seen.kind === "edited") out.set(path, { path, kind });
  }
  return [...out.values()];
}

// Binary files created or overwritten, by presence and by the snapshotted pre-image — docs/workspace.md.
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
    // Read the bytes only where they can end up in the journal — see docs/workspace.md.
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

  /** Resolve `rel` inside the workspace, or throw — TWO gates, both needed, docs/workspace.md. */
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
    // Release every handle inside the folder before renaming, or Windows answers EPERM.
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
  createProject(
    shape: ProjectShape,
    rawName: string,
  ): { project: string; missing: string[] } {
    const r = createProjectIn(this.lifecycleHost(), shape, rawName);
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

  /** Run `fn` over ONE walk of the active project; nothing inside may WRITE — docs/workspace.md. */
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
    // The walk a mutation already has open, else its own and a NARROW one — see docs/workspace.md.
    return this.revisionOf(this.walkScope ?? this.walkProject(dir, true));
  }

  /** The token from a walk: the mutation counter, the SOURCE count, and the newest mtime. */
  private revisionOf(files: WalkedFile[]): string {
    // …and the two files OUTSIDE the project a derived view still reads — see docs/workspace.md.
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

  /** Run a project mutation and journal what it changed, so Ctrl+Z can undo it — docs/workspace.md. */
  async recordChange<T>(
    label: string,
    mutate: (snapshot: (abs: string) => void) => T | Promise<T>,
  ): Promise<Recorded<T>> {
    const dir = this.activeProject;
    if (!dir) {
      // No project, no journal, no walk — and `files: null`, since nothing was diffed.
      const rev = this.revision().rev;
      return {
        value: await mutate(() => {}),
        before: rev,
        after: rev,
        files: null,
      };
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
    // Null until the diff is taken: a throw below must never read as a false "nothing changed".
    let files: ChangedFile[] | null = null;
    try {
      const changes = diffText(before.text, after.text);
      const blobs = diffBin(this.root, before.bin, after.bin, pre);
      files = changedFiles(this.toRel(dir), changes, blobs);
      if (changes.length || blobs.length)
        this.history(dir).push({ label, changes, blobs });
    } catch {
      /* journaling must never break a good write */
    }
    return { value: result, before: before.rev, after: after.rev, files };
  }

  /** The project at one instant from ONE walk: two images and the token naming the moment. */
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

  /** Every text file's content, re-reading only what MOVED — see docs/workspace.md. */
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
            // WHICH app opens it, beside the flag that says one does — that row must not guess.
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
  /** The file tree an editor draws: the ACTIVE PROJECT's own files — see docs/activeProject.md. */
  tree(): FileNode[] {
    return this.walk(this.activeProject ?? this.root);
  }

  /** The WHOLE workspace as a tree — the home page's 'look inside', not the editor's. */
  workspaceTree(): FileNode[] {
    return this.walk(this.root);
  }

  /** The module libraries this project can reach, in precedence order — see docs/workspace.md. */
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

  /** The CHAINS the account's library repository holds — see docs/workspace.md. */
  libraryChains(): { ref: string; path: string; nodes: string[] }[] {
    const root = librariesDirFor(this.activeProject ?? this.root, "chains");
    const out: { ref: string; path: string; nodes: string[] }[] = [];
    // A chain's node files by NAME; a chain with no `nodes/` yet is a real state, so never a throw.
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
    return { path: rel, binary: false, content: readFileSync(abs, "utf8") };
  }

  /** Save a file, forking a `_modules` one instead of refusing it — see docs/workspace.md. */
  write(
    rel: string,
    content: string,
  ): { forked?: ForkedModule; pushed?: boolean } {
    const abs = this.safePath(rel);

    // The active project ABSOLUTE, which is how it is held.
    const active = this.activeProject;

    // `_libraries/…` is an ORDINARY path now; only `_modules` still forks — docs/workspace.md.
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

    // The CHAIN bench's write-through, after the ordinary write — see docs/workspace.md.
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
    writeFileSync(abs, bytes);
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

  /** The shared module library is read-only to every route — see docs/workspace.md. */
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

  /** Give an ENGINE module a folder in this project and repoint the chains — see moduleFork.ts. */
  materialiseModule(ref: string): ForkedModule {
    const dir = this.requireActive();
    const out = materialiseEngineModule(dir, ref);
    this.invalidateProjectDoc();
    return { ...out, path: this.toRel(join(dir, out.path)) };
  }

  /** The `presets.yaml` for a module file — the third file, answered exactly like its panel. */
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

  /** Just the base-module refs — its own route so the graph's `+` picker never waits on `hints()`. */
  baseModules(): string[] {
    return this.onRevision("baseModules", (dir) => listBaseModules(dir), []);
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

  // The four acts live in `shareOps.ts` and reach the workspace only through the host below.
  private shareHost(): ShareHost {
    return {
      root: this.root,
      requireActive: () => this.requireActive(),
      cachedProjectDoc: (dir) => this.cachedProjectDoc(dir),
      projectDoc: () => this.projectDoc(),
      graphDoc: () => this.graphDoc(),
      surfaces: () => this.surfaces(),
    };
  }

  /** Render the mixdown ("mp3" transcodes, needing ffmpeg) — see shareOps.ts. */
  exportMix(format: "wav" | "mp3"): {
    path: string;
    filename: string;
    mime: string;
    cleanup: () => void;
  } {
    return exportMix(this.shareHost(), format);
  }

  /** The frozen snapshot `project share link` sends to pl8 — what it carries is shareOps.ts. */
  buildShare(): ShareBundle {
    return buildShare(this.shareHost());
  }

  /** Render the snapshot and send it to pl8 on the machine's own bearer — see docs/mediatekLink.md. */
  async shareLink(
    userEmail: string,
  ): Promise<{ token: string; bytes: number }> {
    return shareLink(this.shareHost(), userEmail);
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
      // Workspace-RELATIVE on the way out: the browser fetches every byte back through /media.
      clips: t.clips.map((c) => ({
        id: c.id,
        name: c.name,
        src: c.source ? this.toRel(c.source) : "",
        start: c.start,
        length: c.length,
        sourceFrom: c.sourceFrom,
        // A fade names its kind; the kind's GLSL rides on the project, once per name.
        ...(c.fadeIn ? { fadeIn: { ...c.fadeIn } } : {}),
        ...(c.fadeOut ? { fadeOut: { ...c.fadeOut } } : {}),
      })),
      // Shapes carry no media path — each variant's fields pass straight through.
      shapes: t.shapes.map((s) => ({ ...s })),
      // …and this lane's own video run — a shader's GLSL travels INLINE, so there is no path here.
      ...(t.plugins?.length
        ? { plugins: t.plugins.map((p) => ({ ...p })) }
        : {}),
    }));
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
      this.cachedProjectDoc(dir);
      // Clean — but the non-blocking WARNINGS below surface here or nowhere at all.
      return {
        errors: [],
        diagnostics: [
          ...notSupportedModules(dir),
          ...libraryModuleIssues(dir),
          ...deadProjectFields(dir),
          // A `surfaces/` file that is THERE and malformed draws nothing, and says nothing either.
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
      const p = this.cachedProjectDoc(dir);
      const doc: WebProject = {
        name: p.name,
        tempo: p.tempo,
        timeSigNumerator: p.timeSigNumerator,
        timeSigDenominator: p.timeSigDenominator,
        tracks: toWebTracks(p.tracks, p.tempo),
        groups: p.groups.map((g) => ({
          id: g.id,
          name: g.name,
          color: g.color,
          mute: g.mute,
          solo: g.solo,
        })),
        masterVolume: p.masterVolume,
        metronome: p.settings.metronome,
        metronomeLevel: p.settings.metronomeLevel,
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
    if (!isVideoProject(dir))
      return {
        name: basename(dir),
        viewport: [0, 0],
        fps: 0,
        duration: 0,
        markers: [],
        videoTracks: [],
        framePlugins: [],
        transitions: {},
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
      framePlugins: p.framePlugins.map((pl) => ({ ...pl })),
      transitions: Object.fromEntries(
        Object.entries(p.transitions).map(([k, t]) => [
          k,
          { ...t, params: { ...t.params } },
        ]),
      ),
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
