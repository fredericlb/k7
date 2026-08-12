// types.ts — the API contract between l8/web's backend and frontend.
// The backend serves the files of one l8 project directory; the frontend
// renders a tree, edits text files, and autocompletes from schema-aware hints.

import type { ProjectMode } from "@studio/engine-protocol/project";
import type { ProjectApp } from "./projects.ts";

// A node in the project file tree: dirs carry `children`, files a `kind` (`binary` is shown, not edited).
export interface FileNode {
  name: string; // basename
  path: string; // workspace-relative, POSIX separators (e.g. "modules/instruments/synth/module.yaml")
  dir: boolean;
  kind?: "text" | "binary"; // files only
  project?: boolean; // dirs only — the folder is a project someone can open
  app?: ProjectApp; // dirs only — WHICH app opens it, from the `.l8`/`.m9` suffix
  children?: FileNode[]; // dirs only
}

// What a save in the shared `_modules` library turned into. The library is read-only — one copy backs every
// project in the workspace — so the edit lands on a project-local copy of the module and the chains follow it.
export interface ForkedModule {
  ref: string; // the shared module that was edited, e.g. "@engine/audio/delay/tape-delay"
  module: string; // the local module the copy became — what the chains now name
  path: string; // workspace-relative path of the file the edit actually landed in
  chains: string[]; // the chains repointed at the copy
}

// A module's `ui.yaml`, the file beside its `module.yaml` — what the module editor's widget grid edits. It may
// not exist on disk yet: `path` is then where it WOULD go and `content` a blank grid, so the first save creates
// it through the ordinary write route.
export interface ModuleUiFile {
  ref: string; // the module the panel draws, e.g. "@engine/audio/delay/tape-delay"
  path: string; // workspace-relative
  content: string;
  exists: boolean;
}

// A module's `presets.yaml` — its named settings, the third file of the folder. Same four fields as the panel
// above and for the same reason: the module may not have a shelf yet, and the first save is what creates it.
export interface ModulePresetsFile {
  ref: string; // the module the presets belong to
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
  // The clip the recorder wrote most recently, so a surface can offer to review it. Rides this poll
  // because only the file service learns the id — the engine reports a FILE — and it stays set until
  // there is another take: whether it has been looked at belongs to the client.
  lastTake?: { clip: string; track: string } | null;
}

// Where the workspace's repo stands vs upstream, for the share badge (mirrors @studio/commands/git).
export interface GitStatus {
  tracked: boolean;
  ahead: number;
  behind: number;
  conflicted: boolean;
}

// The alternatives (branches) of the workspace repo — mirrors @studio/commands/git.
// `parent` is the branch an alternative was started from, "" for one that is not an
// alternative (the root branch, or a branch made outside l8).
export interface Alternatives {
  current: string;
  parent: string;
  branches: { name: string; parent: string; current: boolean }[];
}

// Result of POST /git/commit — mirrors @studio/commands/git's CommitOutcome.
export interface GitCommitResult {
  nothingToCommit: boolean;
  sha?: string;
  changed?: number;
  pushed: boolean;
  pushError?: string;
}

// Result of POST /git/pull — mirrors @studio/commands/git's PullOutcome.
export interface GitPullResult {
  upToDate: boolean;
  summary: string;
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
// The POST /undo | /redo reply: applied, refused pending confirmation, or nothing to do.
export interface UndoResult {
  applied?: boolean;
  needsConfirm?: boolean;
  kind?: "text" | "process";
  label?: string;
  files?: string[];
}

// Autocompletion source — the project's real entities; empty arrays when it is malformed, so the editor degrades.
export interface Hints {
  baseModules: string[]; // plugin module refs a module can extend ("type/name", "@ns/type/name")
  ioSinks: string[]; // io module names ("OUT")
  // Chain `use` refs: a bare name for the folder's generic, plus "<name>:<node>" per
  // node file, then the inherited modules by ref ("@ns/type/name").
  modules: string[];
  tracks: string[];
  channels: string[]; // input-channel labels from the machine's preferences
  clips: string[];
  // Video track ids (video_tracks/<id>.yaml) — the song's picture lanes, and what `layers:` may name.
  videoTracks: string[];
  sequences: string[];
  chains: string[];
  // What each module's file-valued params may be set to — its own assets/ walked, keyed by the
  // chain `use` ref. There is no shared library any more: a module carries what it loads.
  moduleAssets: Record<string, string[]>;
  paramsByBase: Record<string, string[]>; // base ref -> known param names
  // …and their ranges, for the bases whose plugin is a built-in l8 defines. A widget bound without one is
  // drawn 0..1, which is simply wrong for a -60..+6 dB fader. The live engine's report wins where it exists.
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
  keywords: string[]; // words YAML gives meaning to (true/false/null, …)
  // Scanned plugin names by format, lowercased key — from the engine's scan cache (~/.studio/exts.json).
  pluginNames: Record<string, string[]>;
  // "kind:name" -> the project-relative file defining it (module|base|sink|track|clip|sequence|chain).
  paths: Record<string, string>;
  projectRoot: string; // absolute path to the active project (for resolving entity paths)
  // Audio files by project-relative folder ("" = root) — completes `source:`/`clip:` against neighbouring audio.
  media: Record<string, string[]>;
}

// One declared port — a module under an io/ folder, the project's own or an inherited one
// (mirrors @studio/song/ioPorts). What the I/O panel lists; the LEVELS come from the
// engine socket, keyed by position in the array this arrives in.
export interface IoPort {
  ref: string; // how a chain names it ("OUT", "@engine/io/IN:in-1")
  name: string; // the part worth showing ("IN:in-1")
  dir: "in" | "out";
  channels: number[]; // interface channels, a preferences label already resolved
  label?: string; // the `channel:` as authored, when it named a label
  unknownLabel?: boolean; // …and this rig has no input by that name
  namespace: string; // the shared catalogue it came from, "" for a project's own
  generic: boolean; // the folder's module.yaml rather than one of its nodes
}

// One entry of the shared `_modules` catalogue (mirrors @studio/song/moduleCatalogue).
// What the module builder lists; `path` is workspace-relative, and is the file it opens.
export interface CatalogueModule {
  ref: string; // how a chain names it ("@engine/audio/delay/tape-delay")
  name: string; // the part worth showing, namespace dropped
  namespace: string;
  category: string; // its type folder (audio, io, instruments…)
  kind: string; // what it IS, as the type folder decides
  plugin?: string; // the plugin it loads, for display
  extends?: string;
  // Where the module builder opens it. Absent for an ENGINE module: it has no file, which
  // is the whole point — its substance is the plugin, and the plugin is the engine's.
  path?: string;
  nodes: number; // how many nodes sit beside it
  hasUi: boolean; // it already has a `ui.yaml` beside it
}

// User preferences, formatted for display. `vim` is the only one the web writes back; the rest mirror rig config.
export interface WebPreferences {
  audioDevice: string | null;
  channels: { in: string; out: string };
  vim: boolean; // the editor's vim mode
}

// The project the backend is serving (name + absolute path) — for the header.
export interface ProjectInfo {
  name: string;
  root: string;
}

// --- Timeline: the compiled, flat project (mirrors the brain's ProjectDoc) ------
// The backend compiles the node project into this, so the Timeline needs to know nothing about chains or modules.

export interface WebNote {
  time: number; // beats, relative to the clip
  duration: number; // beats
  key: number; // MIDI note number
}
export interface WebClip {
  id: string;
  type: "audio" | "midi";
  name: string;
  start: number; // beats
  length: number; // beats (0 == natural)
  // A clip-relative loop [loopStart, loopEnd) in beats, repeated to fill `length`; absent or both 0 == no loop.
  loopStart?: number;
  loopEnd?: number;
  // The clip is time-stretched: just the fact (markers stay engine-side), so the timeline can flag it.
  warped?: boolean;
  // Placed but silenced — the event-level `mute`. Still drawn (dimmed): an event you
  // can't see is a deleted one. The ENGINE is what skips it.
  disabled?: boolean;
  /**
   * This clip is a RENDER, not a placement — the lane is frozen and this is what stands in for it.
   *
   * Which matters to anything that would edit it: there is no `clips:` entry for a move to
   * rewrite, and a bar-1 render sitting over a real placement at bar 1 means a drag would move
   * material the lane is not even showing. See packages/song/docs/freeze.md.
   */
  frozen?: boolean;
  notes: WebNote[]; // midi only
}

// A downsampled waveform for one audio clip plus the bar/beat grid aligning it — for the audio-clip editor.
export interface WebWaveformGrid {
  t: number; // seconds from the region start
  bar: boolean; // a bar boundary (vs. a plain beat)
  label?: string; // bar number, on bar boundaries
}
// A warp marker in seconds from the region start: `orig` where the point is drawn, `target` where its beat lands.
export interface WebWarpMark {
  orig: number;
  target: number;
}
export interface WebWaveform {
  rms: number[]; // 0..1 linear per bucket (feeds the recorder Waveform's dB envelope)
  peak: number[]; // 0..1 per bucket
  seconds: number; // duration of the shown region
  intervalMs: number; // seconds / rms.length * 1000 (envelope sample spacing)
  startBeat: number; // the clip's start in the arrangement
  clipBeats: number; // beats the region spans
  grid: WebWaveformGrid[];
  warpMarks: WebWarpMark[]; // stretch markers, in region seconds (empty == not warped)
  // Display seconds where the onsets ARE — what the engine detected, with the clip's corrections already
  // applied. Every surface reads this one and therefore agrees; only an editor needs the two below.
  transients: number[];
  // The same list before the corrections, and the corrections themselves (in FILE seconds, as the clip
  // stores them). An onset editor needs both: to tell a detected onset from a hand-placed one, and to name
  // a removal by the time the DETECTOR gave it rather than by wherever the pointer was. See song/onsets.ts.
  detected?: number[];
  onsetEdits?: { added?: number[]; removed?: number[] };
}

// Audition one sample through the engine: a media path, a clip id, or a slice window in seconds into a source.
export type PreviewReq =
  | { kind: "source"; source: string }
  | { kind: "clip"; clip: string }
  | { kind: "slice"; source: string; from: number; to: number };

// A module preset. The ENGINE discovers these, so the shape is its; re-exported here
// because the file service's /presets route hands the same objects to the browser.
export type { PresetInfo } from "@studio/engine-protocol";

// Progress of the background waveform prewarm (for the status-line spinner).
export interface WaveformStatus {
  warming: boolean;
  done: number;
  total: number;
}
export interface WebPlugin {
  id: string;
  type: string; // xmlTypeName / format
  name: string;
}
// One track's strip, read off the mixer module at the end of its chain. `module` is the node ref an edit
// addresses (e.g. "mixer:vo.jo"); the rest are that module's params, in their own units — dB for the level and
// the three tone bands, -1..+1 for the pan.
export interface WebMixer {
  module: string;
  volume: number;
  pan: number;
  low: number;
  mid: number;
  high: number;
}
export interface WebTrack {
  id: string;
  name: string;
  // The group track this belongs to ('' == none). A group holds no material, so it never appears as a track itself.
  group: string;
  // A lane a group's algo/ pattern streams onto: nothing can be authored there, `clips` is only the look-ahead.
  generated: boolean;
  // What the track HOLDS ("audio" | "notes" | "audio notes") — the timeline uses it to refuse an illegal clip drop.
  contentType: string;
  // Authored track colour ('' == none): a swatch on the label, and the fill of this track's clips.
  color: string;
  // The channel strip at the end of this track's chain — where its level, pan and tone live now that a track
  // states none of them itself. Absent means the track has NO strip: not "at unity", but nowhere to put a
  // level, which is a thing to say rather than a dead fader to draw.
  mixer?: WebMixer;
  mute: boolean;
  solo: boolean;
  disabled?: boolean; // true ⇒ track is ignored (filtered by the brain); absent when false
  clips: WebClip[];
  plugins: WebPlugin[];
  // `docs` / `todos` were here, for the Docs panel. Both are gone with it — a note is a doc
  // module on the graph now (`@studio/doc`). See packages/song/docs/docModules.md.
  // `frozen`, `alternatives` and `alternative` were here, for the timeline's lane header. All
  // three are gone with the fields they came from, to be replaced by another mechanism later —
  // see packages/song/docs/trackModules.md.
}
// A group track (mirrors GroupDoc): clipless, drawn as a header with its member tracks indented under it.
export interface WebGroup {
  id: string;
  name: string;
  color: string;
  mute: boolean;
  solo: boolean;
}
// A video clip on a video track. Every time here is SECONDS: picture is cut against the wall
// clock, where the song's own lanes are placed in bars against its tempo. One timeline draws
// both, and its ruler reads either — see apps/l8/frontend/docs/picture.md.
export interface WebVideoClip {
  id: string;
  name: string;
  src: string; // workspace-relative media path
  start: number; // seconds
  length: number; // seconds (0 == natural)
  sourceFrom: number; // seconds into the source
}
// A shape module (mirrors ShapeDoc): a fill or text on the viewport, geometry in px, `color` any CSS colour.
export type WebShape =
  | {
      type: "square";
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
    }
  | { type: "circle"; x: number; y: number; r: number; color: string }
  | {
      type: "text";
      content: string;
      font: string;
      fontSize: number;
      x: number;
      y: number;
      w?: number;
      color: string;
    };
// A video-mode lane (mirrors VideoTrackDoc): places picture, or draws `shapes`. In draw order (bottom first).
export interface WebVideoTrack {
  id: string;
  name: string;
  color: string;
  mute: boolean;
  kind: "video" | "shape";
  x: number;
  y: number;
  w: number;
  h: number;
  clips: WebVideoClip[];
  shapes: WebShape[];
}
// GET /commands — the palette's catalogue; `args` are the trailing params in the order the palette asks them.
// The class list mirrors ARG_CLASSES in packages/commands/src/commandSpec.ts, where a test fails if they drift.
export type ArgClass =
  | "track"
  | "module"
  | "file"
  | "marker"
  | "choice"
  | "timecode"
  | "number"
  | "note"
  | "text";
// The named provider an argument completes from — the PRECISE type of thing it names, where
// `kind` is only the colour it is drawn in: `file` is a clip AND a sequence AND a module asset,
// and `module` is also a category. Absent for a scalar or a literal set. Mirrors the PROVIDERS
// keys in packages/commands/src/commandSpec.ts, where a test fails if the two drift.
export type ArgProvider =
  | "alternatives"
  | "assetFiles"
  | "audioFiles"
  | "baseModules"
  | "categories"
  | "chains"
  | "clipTargets"
  | "markerNames"
  | "modules"
  | "moduleAlternatives"
  | "sequenceFiles"
  | "tracks";
export interface CommandArg {
  name: string;
  kind: ArgClass;
  // What this argument NAMES, when the answer comes off the project. The right-click menu matches
  // on it to offer every command the clicked thing can answer — see l8's contextMenu.ts.
  provider?: ArgProvider;
  // One line on what this argument accepts; empty when there is nothing to promise, and the palette shows no clue.
  hint: string;
  // TRAILING args only: the line runs without it, so a form knows when it has collected enough.
  optional?: boolean;
}
export interface CommandInfo {
  command: string;
  help?: string;
  // One sentence on what the command DOES, per language — what the palette lists and matches
  // on. The command name stays the CLI's in every language; only the sentence is translated,
  // because a name is an identifier and a sentence is an explanation.
  readable?: { en: string; fr: string };
  args: CommandArg[];
}

// A named timeline marker: `beat` is its position, `tc` the timecode it is stored under (the delete key).
export interface WebMarker {
  beat: number;
  name: string;
  tc: string;
}

export interface WebProject {
  name: string;
  tempo: number;
  timeSigNumerator: number;
  timeSigDenominator: number;
  tracks: WebTrack[];
  groups: WebGroup[];
  // The metronome enable from settings.yaml — the header button's source of truth; toggling rewrites the file.
  metronome: boolean;
  // Whether any track streams from an algo/ pattern; false == the shell need not poll the pattern clock.
  strudel: boolean;
  // Which of l8's two shapes this project has. `live` means there is no arrangement at all, so
  // the shell draws the chains graph alone — no timeline pane, no transport, no minimap. It
  // rides on the COMPILED doc rather than being read from project.yaml by the browser, because
  // the browser reads no YAML: see packages/song/docs/projectMode.md.
  mode: ProjectMode;
  // Count-in length in BARS from settings.yaml (0 == none); the engine applies the actual pre-roll.
  countIn: number;
  // Named timeline markers, sorted by beat. Empty when the song has none.
  markers: WebMarker[];
}

// --- PICTURE: the same folder, read again ----------------------------------------
// Nothing here is a beat: a shot is cut against the wall clock. A separate document and not a
// section of WebProject, which is what keeps the frame out of what the C++ engine is handed —
// a `withoutVideo` step used to strip it at the one choke point, and a document with a section
// deleted before it is sent describes two things.
// See packages/song/docs/picture.md.

/** A named point on the picture's ruler. `sec` is its position; `tc` the `m:ss.mmm` it is stored under (the delete key). */
export interface WebVideoMarker {
  sec: number;
  name: string;
  tc: string;
}

export interface WebVideoProject {
  name: string;
  /** The frame the lanes draw into, in px. */
  viewport: [number, number];
  /** Frames per second. Authoritative for EXPORT; realtime follows the transport's own clock. */
  fps: number;
  /** Where the last picture ends, in seconds — what the timeline sizes itself against. 0 when empty. */
  duration: number;
  markers: WebVideoMarker[];
  /** Already in `layers:` draw order, bottom first — no consumer re-sorts. */
  videoTracks: WebVideoTrack[];
}

// --- Project errors: whether the project even compiles --------------------------

// Everything the compile reports, one entry per message — a superset of what breaks the Timeline (which stops
// at the first failure). Empty == clean. `file` is project-relative; line/col are 1-based.
export interface Diagnostic {
  file: string;
  line: number;
  col: number;
  message: string;
  severity?: "error" | "warning"; // "error" (default) draws red; "warning" amber
}
export interface ProjectErrors {
  errors: string[]; // flat messages — the count badge
  diagnostics: Diagnostic[]; // located, for the editor's inline squiggles
}

// --- Chains: the routing graph --------------------------------------------------
// Moved to @studio/graph-model. Three apps draw chains — l8, st0's module
// builder and m9 — and only l8 wants the rest of this file, so the graph
// model is its own package. Import it from there, not through here.

// ── Engine-side file service headers ─────────────────────────────────────────
// The browser talks to the file service directly (cross-origin) with no OIDC cookie there, so it passes
// identity, context and a light gate as headers.

/** The authenticated user's email — the file service slugifies it to pick the root. */
export const USER_HEADER = "x-studio-user";
/** The chosen workspace name under ~/.studio/root/<slug>/. */
export const WORKSPACE_HEADER = "x-studio-workspace";
/** The engine's token (from the whoami probe) — the file service's light LAN gate. */
export const ENGINE_TOKEN_HEADER = "x-studio-engine-token";

// ── The engine assignment ────────────────────────────────────────────────────
// "Assigned" is a LEASE: a closed tab can only say goodbye best-effort, so the truth has to expire on its own.
// The driving tab renews with an idempotent re-POST of /api/engine/select. Per-engine across users.

/** How often the driving tab re-selects to keep its engine assignment alive. */
export const ENGINE_ASSIGN_RENEW_MS = 5000;

/** No renewal for this long ⇒ the assignment lapses and the engine shows free. */
export const ENGINE_ASSIGN_TTL_MS = 15000;

// ── Reaching an engine, and staying reached ──────────────────────────────────
// One budget for both halves. The browser measures addresses in PARALLEL, so it spends this
// once; the relay dials them in SEQUENCE, so without a shared deadline it spends this PER
// address and is called unreachable while the engine answers. Both now stop at the same wall
// clock. See packages/engine-registry/docs/proxy.md and packages/engine-browser/docs/access.md.

/** All the time anyone gets to reach an engine — the browser's probe, and the relay's dial. */
export const ENGINE_REACH_BUDGET_MS = 3000;

/** …and the most one address may eat of it, so a first dead address cannot spend the lot. */
export const ENGINE_DIAL_TIMEOUT_MS = 1500;

// ── Keeping a link honest ────────────────────────────────────────────────────
// A half-open socket — a wedged relay, a lapsed NAT, a laptop back from sleep — never fires
// `close`, so nothing reconnects and sends go nowhere. The engine has no server-side ping
// (IXWebSocket ships `kPingIntervalSeconds(-1)`), so the client is what has to ask.

/** Nothing inbound for this long ⇒ ask `whoami`, the one verb the engine always answers. */
export const ENGINE_IDLE_PING_MS = 10000;

/** …and no answer to it within this ⇒ the socket is dead however open it claims to be. */
export const ENGINE_PONG_TIMEOUT_MS = 5000;

/** Reconnect backoff: doubles from here, jittered, and resets on a connection that opened. */
export const ENGINE_RECONNECT_MIN_MS = 1000;

/** …and never waits longer than this, so a forgotten tab stops hammering the relay. */
export const ENGINE_RECONNECT_MAX_MS = 30000;

// The queue that covers a blink, and only a blink. Unbounded, it turned a ten-minute outage
// into a burst of stale transport verbs delivered all at once on reconnect.

/** Most messages held while the socket is down. Oldest go first. */
export const ENGINE_OUTBOX_MAX = 200;

/** …and none replayed after this long: a command nobody is waiting for is not worth sending. */
export const ENGINE_OUTBOX_TTL_MS = 30000;

// ── The engine registry ──────────────────────────────────────────────────────
// An engine registers itself (via the supervisor) with these addresses; the browser MEASURES them
// (packages/engine-browser/src/probe.ts) and picks from the unassigned ones. See the backend `registry.ts`.

/** Every address a browser may try. All are probed at once; the fastest to answer is the one used. */
export interface EngineAddresses {
  loopback: string; // "127.0.0.1" — reachable only from the same machine
  lanIps: string[]; // non-internal IPv4s — reachable from the same LAN
  port: number; // the engine's WebSocket port (same on every address)
  filePort: number; // the engine-side file service's HTTP port (same host set)
}

/** A workspace under ~/.studio/root/<slug>/, as the picker lists them. */
export interface WorkspaceSummary {
  name: string; // the folder name (== the workspace name the user picks)
  projectCount: number; // number of project.yaml folders inside (0 for empty)
  isSingleProject: boolean; // the folder itself is a project (has project.yaml)
}

/** Reply to GET /workspaces on the file service. */
export interface WorkspaceList {
  workspaces: WorkspaceSummary[];
}

/** Reply to GET/POST /api/projects/ssh-key on st0 — the user's PUBLIC deploy key, the one
 * they paste into their git host. st0 generates the pair and owns the private half; see
 * packages/git-repos/docs/keys.md. */
export interface SshKeyInfo {
  publicKey: string | null;
}

/** Reply to GET /workspaces/by-repo — which workspace already holds a repository, if any. */
export interface WorkspaceForRepo {
  workspace: string | null;
}

/** A `git clone` in flight on the file service. Started by POST /workspaces/clone and polled
 * at GET /workspaces/clone/:id, because the wait is long enough to be worth showing —
 * see packages/file-service/docs/cloneJobs.md. */
export interface CloneJob {
  id: string;
  workspace: string; // the folder it is cloning into, chosen from the repository's name
  done: boolean;
  failed: boolean;
  error: string | null;
  phase: string; // git's own words: "Receiving objects", "Resolving deltas", …
  percent: number | null; // null while git is doing something it cannot measure
  lines: string[]; // the tail of git's output, for a failure that needs reading
}

/**
 * How a stem separation is doing. The same shape as CloneJob — start, poll, 404 when swept —
 * with one field it has no use for.
 *
 * A clone's product is a DIRECTORY, named by `workspace`, so there is nothing to list. A
 * separation's product is four files, and the caller needs their paths: they are what it came
 * for, and they are not derivable from the request (the stems' names come from the model).
 */
export interface SeparateJob {
  id: string;
  source: string; // the mix being split, absolute on the engine's machine
  done: boolean;
  failed: boolean;
  error: string | null;
  phase: string; // "decoding" | "loading model" | "separating" | "writing" | "done" | "failed"
  percent: number | null; // null while doing something with no measurable end
  lines: string[]; // notes worth reading — which execution provider won, and why a run failed
  files: string[]; // the stems written, absolute. Empty until `done`.
}

/** How st0's mirror of one repository is doing. `ready` means there is something to read,
 *  whether or not a refresh is running on top of it. */
export interface RepoStatus {
  fetching: boolean;
  ready: boolean;
  error: string | null;
}

/** One project inside a repository: where it is, and which app opens it. The folder's NAME
 *  decides the app — see ./projects.ts. */
export interface RepoProject {
  path: string;
  app: ProjectApp;
}

/**
 * A repository named by its short name — st0's answer to "what is behind `/l8/<name>/…`".
 *
 * The one thing an editor needs before it can resolve a workspace, and the reason the URI is
 * not in the address bar in the first place.
 */
export interface RepoRef {
  id: string;
  name: string;
  uri: string;
}

/** One git repository a person has added to st0, as the Projets section lists them. */
export interface RepoSummary extends RepoStatus {
  id: string;
  uri: string;
  /**
   * The repository's SHORT name — its last path segment without `.git`, which is also what
   * the clone is called on the engine's machine.
   *
   * This is the half of a project's address that a person can read, and it is what st0 puts
   * in the link: `/l8/<name>/<project>`. Derived from `uri` rather than stored, so the two
   * cannot drift; the URI itself never reaches the address bar, because it carries a host, a
   * port and a user, none of which belong in a bookmark.
   */
  name: string;
  label: string;
  addedAt: string;
  branch: string | null;
  /**
   * The projects the mirror found, so the listing can draw them under their repository and
   * link straight into l8/m9 — the tree is for looking around, not for the common case.
   *
   * null while the mirror has never been read: "unknown" and "none" are different answers,
   * and `[]` on an unfetched repository would claim it holds no project. The count is
   * `projects.length`, which is why there is no separate field for it.
   */
  projects: RepoProject[] | null;
}

/** An engine as the browser sees it — the secret token is never sent to the client. */
export interface PublicEngine {
  id: string;
  hostname: string;
  addresses: EngineAddresses;
  assigned: boolean; // already selected by someone; hidden from the pick list
  /**
   * Who holds it and what they opened on it, when somebody does.
   *
   * On the wire because "busy" and "busy with Fred's winter.l8" are not the same screen: an
   * engine that reads simply unavailable is one people retry, and taking a project over is a
   * thing you should only do knowing whose it is. Undefined when the engine is free.
   */
  heldBy?: string;
  heldProject?: string;
  // This engine's heartbeat arrived from the browser's own public IP — a same-LAN hint, not authoritative.
  sameSourceIp: boolean;
  /**
   * A short-lived pass for the relay at `<base>/api/engine/<id>/ws`, which is how a browser
   * reaches an engine it may not dial directly (an HTTPS page and a `ws://` LAN address).
   *
   * Optional because the REGISTRY does not mint it — the `/engines` route does, being the
   * authenticated one. See packages/engine-registry/proxy.ts.
   */
  proxyTicket?: string;
}

// How good a link to an engine is — Q1/Q2/Q3, off a measured latency — lives in ./quality,
// because the browsers measure it, the surfaces draw it and the backends will constrain on it.
// It replaced a locality tier, which ranked a gigabit LAN below a laptop running at 2048 frames.
