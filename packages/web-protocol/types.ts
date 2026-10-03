// types.ts — the API contract between st0/web's backend and frontend.
// The backend serves the files of one st0 project directory; the frontend
// renders a tree, edits text files, and autocompletes from schema-aware hints.

import type { EnginePerformance } from "./performance.ts";
import type { ProjectApp } from "./projects.ts";

// A node in the project file tree: dirs carry `children`, files a `kind` (`binary` is shown, not edited).
export interface FileNode {
  name: string; // basename
  path: string; // workspace-relative, POSIX separators (e.g. "modules/instruments/synth/module.yaml")
  dir: boolean;
  kind?: "text" | "binary"; // files only
  project?: boolean; // dirs only — the folder is a project someone can open
  app?: ProjectApp; // dirs only — WHICH app opens it, from the `.st0`/`.z0` suffix
  children?: FileNode[]; // dirs only
}

// A save in the read-only `_modules` library lands on a project-local copy, and the chains follow it.
export interface ForkedModule {
  ref: string; // the shared module that was edited, e.g. "@engine/audio/delay/tape-delay"
  module: string; // the local module the copy became — what the chains now name
  path: string; // workspace-relative path of the file the edit actually landed in
  chains: string[]; // the chains repointed at the copy
}

// A module's `ui.yaml`, which may not exist yet: `path` is then where it WOULD go, and the first save creates it.
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
}

// A copy to the engine's machine: only the files it had to copy count; `error`/`failed` once it went wrong.
export interface EngineSyncState {
  files: number;
  filesDone: number;
  bytes: number;
  bytesDone: number;
  failed?: number;
  error?: string;
}

// Where the workspace's repo stands vs upstream, for the share badge (mirrors @studio/commands/git).
export interface GitStatus {
  tracked: boolean;
  ahead: number;
  behind: number;
  conflicted: boolean;
}

// The workspace repo's branches (mirrors @studio/commands/git); `parent` is "" for one st0 did not start.
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
  // Video track ids (video_tracks/<id>.yaml) — the song's picture lanes, and what `layers:` may name.
  videoTracks: string[];
  sequences: string[];
  chains: string[];
  // Each module's own assets/ walked, keyed by chain `use` ref: a module carries what it loads, there is no shared library.
  moduleAssets: Record<string, string[]>;
  paramsByBase: Record<string, string[]>; // base ref -> known param names
  // …and their ranges, for st0's built-in plugins: without one a widget draws 0..1, wrong for a -60..+6 dB fader.
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
  // Scanned plugin names by format, lowercased key — from the engine's scan cache (~/.st0/exts.json).
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
  generic: boolean; // the folder's module.yaml rather than one of its nodes
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
  hasUi: boolean; // it already has a `ui.yaml` beside it
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

/** One of the account's libraries: the name its refs use (`@<name>/…`), its repository, and whether this machine holds a clone yet. */
export interface AccountLibrary {
  name: string;
  uri: string;
  cloned: boolean;
}

/** What a sync or a prune did to one library, said as the file service would say it. */
export interface LibraryNote {
  name: string;
  state: "cloned" | "updated" | "current" | "kept" | "failed";
  note: string;
}

/** `GET`/`PUT /account/libraries` and `POST /account/libraries/update` — the list, and what the call did to each. */
export interface AccountLibrariesReply {
  libraries: AccountLibrary[];
  notes?: LibraryNote[];
}

/** The machine's two separating choices and the libraries' COLD chains to make them from — `GET /account/cold-chains`. */
export interface ColdChainsReply {
  /**
   * `@<library>/<path>` refs; `instrumental` when one of its offline steps writes an instrumental;
   * `unavailable` says why THIS machine cannot run it yet (a model not downloaded), null when it can.
   */
  chains: {
    ref: string;
    instrumental: boolean;
    unavailable: string | null;
    /** Models it needs that this machine can DOWNLOAD — their module gives a `model_url`. */
    downloads: { file: string; url: string }[];
  }[];
  /** `null` is "never told": this machine separates nothing. */
  stemsChain: string | null;
  instrumentalChain: string | null;
}

/** One chain of the library, and whether the bench can PLAY it live — `GET /account/live-chains`. */
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

// --- Timeline: the compiled, flat project (mirrors the brain's ProjectDoc) ------

// Compiled by the backend, so the Timeline knows nothing about chains or modules — see docs/document.md.

export interface WebNote {
  time: number; // beats, relative to the clip
  duration: number; // beats
  key: number; // MIDI note number
  // 0..1 as the file states it (NoteSchema's `v`); ABSENT means the schema's default of 1, and dragging back to full clears the field.
  vel?: number;
  // A pad's two effects UNREALISED, drawn as an icon and expanded by the engine — see packages/song/docs/padEffects.md.
  repeat?: number;
  skip?: number;
}
export interface WebClip {
  id: string;
  type: "audio" | "midi";
  name: string;
  start: number; // beats
  length: number; // beats (0 == natural)
  /** WHICH part of the source this placement draws, all three optional — see docs/document.md. */
  offset?: number; // audio: seconds into the source; midi: playStart (beats)
  sourceFrom?: number;
  sourceTo?: number;
  // The audio file's NAME, never its path — enough to tell that a bounce repointed the clip; see docs/document.md.
  sourceName?: string;
  // A clip-relative loop [loopStart, loopEnd) in beats, repeated to fill `length`; absent or both 0 == no loop.
  loopStart?: number;
  loopEnd?: number;
  // The clip is time-stretched: just the fact (markers stay engine-side), so the timeline can flag it.
  warped?: boolean;
  // …and THIS event declines that map (`event status warp`); both are sent, since `warped` alone cannot tell it from "never stretched".
  warpOff?: boolean;
  // Placed but silenced — the event-level `mute`. Still drawn dimmed; the ENGINE is what skips it.
  disabled?: boolean;
  /** How long this event fades in and out, IN BEATS; absent means no fade — see docs/document.md. */
  fadeIn?: number;
  fadeOut?: number;
  /** This clip is a RENDER standing in for a frozen lane, and cannot be edited — see packages/song/docs/freeze.md. */
  frozen?: boolean;
  /** What the PLACEMENT itself said, unmerged — read by clipboard.ts alone; see docs/document.md. */
  event?: WebEvent;
  notes: WebNote[]; // midi only
}

/** A placement's own fields, as authored — mirrors `EventDoc` in @studio/engine-protocol. */
export interface WebEvent {
  from?: number | string;
  to?: number | string;
  fadeIn?: string;
  fadeOut?: string;
  loop?: number;
  disabled?: boolean;
  warp?: boolean;
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
  /** The FILE second this point pins, which a surface cannot invert from two numbers — see docs/document.md. */
  src: number;
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
  /** `display = (file − inPoint) × stretch` — the mapping a GESTURE has to go back through; see docs/document.md. */
  sourceMap: { inPoint: number; stretch: number; zeroBeat: number };
  /** The span of the source this clip IS, sent only when the picture is WIDER than it — see docs/document.md. */
  sourceWindow?: { from: number; to: number };
  // Display seconds where the onsets ARE, corrections applied — the one list every surface agrees on.
  transients: number[];
  // The same list before corrections, and the corrections themselves, in FILE seconds — see docs/document.md.
  detected?: number[];
  onsetEdits?: { added?: number[]; removed?: number[] };
}

// Audition one sample through the engine: a media path, a clip id, or a slice window in seconds into a source.
export type PreviewReq =
  | { kind: "source"; source: string }
  | { kind: "clip"; clip: string }
  | { kind: "slice"; source: string; from: number; to: number };

// A plugin's FACTORY preset, shaped by the engine that discovers it.
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
// One track's strip, read off the mixer module at the end of its chain; the tone bands left it — see docs/document.md.
export interface WebMixer {
  module: string;
  volume: number;
  pan: number;
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
  // The strip at the end of this track's chain; absent means NO strip — not "at unity" — see docs/document.md.
  mixer?: WebMixer;
  mute: boolean;
  solo: boolean;
  disabled?: boolean; // true ⇒ track is ignored (filtered by the brain); absent when false
  clips: WebClip[];
  plugins: WebPlugin[];
  // `docs`/`todos`, `frozen`, `alternatives` and `alternative` all left this type — see docs/document.md.
}
// A group track (mirrors GroupDoc): clipless, drawn as a header with its member tracks indented under it.
export interface WebGroup {
  id: string;
  name: string;
  color: string;
  mute: boolean;
  solo: boolean;
}
// A video clip: every time here is SECONDS, picture being cut against the wall clock — apps/st0/frontend/docs/picture.md.
export interface WebVideoClip {
  id: string;
  name: string;
  src: string; // workspace-relative media path
  start: number; // seconds
  length: number; // seconds (0 == natural)
  sourceFrom: number; // seconds into the source
  fadeIn?: WebVideoFade;
  fadeOut?: WebVideoFade;
}
/** A transition ON a placement (mirrors VideoFadeDoc): how long, and which kind — song-video/docs/transitions.md. */
export interface WebVideoFade {
  over: number; // seconds
  with: string; // a modules/video_transitions/ name, or "dissolve"
}
/** A transition's two stages (mirrors VideoTransitionDoc), keyed by NAME on the project — its GLSL rides inline. */
export interface WebVideoTransition {
  name: string;
  vertex: string;
  fragment: string;
  params: Record<string, number>;
}
// A shape module (mirrors ShapeDoc): a fill or text on the viewport, geometry in px, `color` any CSS
// colour. `id` is the module NODE that draws it — see packages/song-video/docs/shapes.md.
export type WebShape =
  | {
      id: string;
      type: "square";
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
    }
  | {
      id: string;
      type: "circle";
      x: number;
      y: number;
      r: number;
      color: string;
    }
  | {
      id: string;
      type: "text";
      content: string;
      font: string;
      fontSize: number;
      x: number;
      y: number;
      w?: number;
      color: string;
    };
/** One pass over the picture (mirrors VideoPluginDoc); its GLSL rides inline and `audioFrom` names a lane — see docs/document.md. */
export interface WebVideoPlugin {
  id: string;
  // No `video_transition`: one is NAMED by a cut and never wired — song-video/docs/transitions.md.
  type: "video_effect" | "shader";
  name: string;
  enabled: boolean;
  params: Record<string, number>;
  shader?: { name: string; vertex: string; fragment: string };
  audioFrom?: string;
}
// A video-mode lane (mirrors VideoTrackDoc): places picture, shows a lens, or draws the `shapes`
// wired to it. In draw order (bottom first).
export interface WebVideoTrack {
  id: string;
  name: string;
  color: string;
  mute: boolean;
  /** Soloed, off `project.yaml`'s `soloed:` — the same list audio reads (packages/song-video/docs/picture.md). */
  solo: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  clips: WebVideoClip[];
  shapes: WebShape[];
  // This lane's own run, applied to the layer BEFORE it is composited; absent on a lane no run starts at.
  plugins?: WebVideoPlugin[];
  /** A live CAMERA feeds this lane instead of its placements — the LABEL a node wired to it names,
   *  and "" for whichever this machine calls default. See packages/song/docs/camera.md. */
  camera?: string;
  /** …and WHEN that lens opens: `off` never, `auto` while the lane is armed, `on` always. */
  cameraMonitor?: "off" | "auto" | "on";
}
// GET /commands — the palette's catalogue; mirrors ARG_CLASSES in packages/commands/src/commandSpec.ts.
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
// The PRECISE type of thing an argument names, where `kind` is only its colour — see docs/document.md.
export type ArgProvider =
  | "alternatives"
  // A BOX this project declares — `assemblies/<name>.yaml`, see packages/song/docs/assemblies.md.
  | "assemblies"
  // …and a TEMPLATE the library holds, which is what a new one is made from.
  | "assemblyTemplates"
  | "audioFiles"
  | "baseModules"
  | "engineModules"
  | "categories"
  | "chains"
  | "clipTargets"
  // An automation CURVE of this project, by id — what `node automate` points a param at.
  | "curves"
  | "markerNames"
  | "modules"
  | "moduleAlternatives"
  | "moduleEngines"
  // One of this project's USES of a module, which is what the `node …` verbs address — packages/song/docs/nodes.md.
  | "nodes"
  // A PICTURE lane of this song — video_tracks/<id>.yaml, read off the folder rather than the compile.
  | "pictureLanes"
  // A set list of the REPOSITORY — the one provider that reads nothing of the open project.
  | "playlists"
  // A sample a rack tap may play — a library's or this project's `samples/`, packages/song/docs/libraryFiles.md.
  | "samples"
  | "sequenceFiles"
  // The kinds of SURFACE the editor can draw — a closed set of words, since the file is about to be created.
  | "surfaceTypes"
  | "tracks";
export interface CommandArg {
  name: string;
  kind: ArgClass;
  // What this argument NAMES off the project — what st0's contextMenu.ts matches a right-click on.
  provider?: ArgProvider;
  // One line on what this argument accepts; empty when there is nothing to promise, and the palette shows no clue.
  hint: string;
  // TRAILING args only: the line runs without it, so a form knows when it has collected enough.
  optional?: boolean;
}
// What a right-click can be ON, as commands.yaml `menu:` names it — mirrors MENU_ENTITIES in packages/commands/src/commandSpec.ts.
export const MENU_ENTITIES = [
  "track",
  "group",
  // A block in the graph or on a lane's strip: the USE of a module, which is what the `node …` verbs address.
  "node",
  // A PLACEMENT on a lane, plus the rectangle a drag left around it.
  "event",
  "param",
  "curve",
  // The timeline RULER, where nothing is yet — what a click there could put one.
  "ruler",
  "marker",
  "assembly",
  // A stretch point in a clip's warp view.
  "warp",
  // A shot on a picture lane.
  "shot",
  "pad",
  "note",
  // A rack's PAD on a node's card: one sound of the kit.
  "tap",
] as const;
export type MenuEntity = (typeof MENU_ENTITIES)[number];
export interface CommandInfo {
  command: string;
  help?: string;
  // One sentence per language on what the command DOES; the NAME is never translated — see docs/document.md.
  readable?: { en: string; fr: string };
  args: CommandArg[];
  // Where a right-click may offer it. Absent ⇒ wherever its leading arguments fit — st0's frontend/docs/contextMenu.md.
  menu?: MenuEntity[];
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
  // The song's OUTPUT level in dB, 0 unity and +6 the top of the fader — packages/song/docs/masterVolume.md.
  masterVolume: number;
  tracks: WebTrack[];
  groups: WebGroup[];
  // The metronome enable from settings.yaml — the header button's source of truth; toggling rewrites the file.
  metronome: boolean;
  // …and how loud it clicks, 0.2 … 1; never 0, because silence is the flag above (see METRONOME_MIN).
  metronomeLevel: number;
  // Count-in length in BARS from settings.yaml (0 == none); the engine applies the actual pre-roll.
  countIn: number;
  // Named timeline markers, sorted by beat. Empty when the song has none.
  markers: WebMarker[];
}

// --- PICTURE: the same folder, read again ----------------------------------------

// Nothing here is a beat, and it is a separate document for that reason — see docs/document.md.

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
  /** The `RENDER -> VIDEO_OUT` run over the composited frame — the picture's `masterPlugins`, empty by default. */
  framePlugins: WebVideoPlugin[];
  /** Every transition a placement NAMES, by name; the built-in dissolve is absent — the renderer owns it. */
  transitions: Record<string, WebVideoTransition>;
}

// --- Project errors: whether the project even compiles --------------------------

// Everything the compile reports, `file` project-relative and line/col 1-based; a superset of what breaks the Timeline.
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

// Moved to @studio/graph-model, since three apps draw chains and only st0 wants the rest of this file.

// ── Engine-side file service headers ─────────────────────────────────────────

// Cross-origin with no OIDC cookie, so identity, context and the gate ride as headers — see docs/machine.md.

/** The authenticated user's email — the file service slugifies it to pick the root. */
export const USER_HEADER = "x-studio-user";
/** The chosen workspace name under ~/.st0/root/<slug>/. */
export const WORKSPACE_HEADER = "x-studio-workspace";
/** The engine's token (from the whoami probe) — the file service's light LAN gate. */
export const ENGINE_TOKEN_HEADER = "x-studio-engine-token";
/** Which engine the caller drives — how a SERVER-hosted file service learns where to send the song. */
export const ENGINE_ID_HEADER = "x-studio-engine-id";
/** The file hub's secret, the ONLY gate of a server-hosted file service — packages/file-hub/docs/fileHub.md. */
export const HUB_SECRET_HEADER = "x-studio-hub-secret";
/** Where a server that HOSTS workspaces says so; a 404 means it does not. */
export const FILE_HUB_HELLO = "/api/files-hub";

/** What that hello answers: where the files are, and the ticket that stands in for the session there. */
export interface FileHubHello {
  path: string;
  ticket: string;
}

// ── The engine assignment ────────────────────────────────────────────────────

// "Assigned" is a LEASE, because a closed tab can only say goodbye best-effort — see docs/machine.md.

/** How often the driving tab re-selects to keep its engine assignment alive. */
export const ENGINE_ASSIGN_RENEW_MS = 5000;

/** No renewal for this long ⇒ the assignment lapses and the engine shows free. */
export const ENGINE_ASSIGN_TTL_MS = 15000;

// ── Reaching an engine, and staying reached ──────────────────────────────────

// One budget for both halves, the browser probing in parallel and the relay dialling in sequence — see docs/machine.md.

/** All the time anyone gets to reach an engine — the browser's probe, and the relay's dial. */
export const ENGINE_REACH_BUDGET_MS = 3000;

/** …and the most one address may eat of it, so a first dead address cannot spend the lot. */
export const ENGINE_DIAL_TIMEOUT_MS = 1500;

// ── Keeping a link honest ────────────────────────────────────────────────────

// A half-open socket never fires `close`, and the engine has no server-side ping — see docs/machine.md.

/** Nothing inbound for this long ⇒ ask `whoami`, the one verb the engine always answers. */
export const ENGINE_IDLE_PING_MS = 10000;

/** …and no answer to it within this ⇒ the socket is dead however open it claims to be. */
export const ENGINE_PONG_TIMEOUT_MS = 5000;

/** Reconnect backoff: doubles from here, jittered, and resets on a connection that opened. */
export const ENGINE_RECONNECT_MIN_MS = 1000;

/** …and never waits longer than this, so a forgotten tab stops hammering the relay. */
export const ENGINE_RECONNECT_MAX_MS = 30000;

// The queue that covers a blink, and only a blink: unbounded, a ten-minute outage burst on reconnect.

/** Most messages held while the socket is down. Oldest go first. */
export const ENGINE_OUTBOX_MAX = 200;

/** …and none replayed after this long: a command nobody is waiting for is not worth sending. */
export const ENGINE_OUTBOX_TTL_MS = 30000;

// ── The engine registry ──────────────────────────────────────────────────────

// An engine registers these addresses; the browser measures them all (packages/engine-browser/src/probe.ts).

/** Every address a browser may try. All are probed at once; the fastest to answer is the one used. */
export interface EngineAddresses {
  loopback: string; // "127.0.0.1" — reachable only from the same machine
  lanIps: string[]; // non-internal IPv4s — reachable from the same LAN
  port: number; // the engine's WebSocket port (same on every address)
}

/** A workspace under ~/.st0/root/<slug>/, as the picker lists them. */
export interface WorkspaceSummary {
  name: string; // the folder name (== the workspace name the user picks)
  projectCount: number; // project folders inside, at any depth (0 for empty)
  isSingleProject: boolean; // the folder itself is a project
}

/** Reply to GET /workspaces on the file service. */
export interface WorkspaceList {
  workspaces: WorkspaceSummary[];
}

/** One workspace on the machine with the projects it holds — the only side that can answer; see docs/machine.md. */
export interface AccountWorkspace {
  name: string;
  origin: string | null;
  repoName: string | null;
  uniqueName: boolean;
  isSingleProject: boolean;
  projects: RepoProject[];
}

/** Reply to GET /workspaces/projects on the file service. */
export interface AccountWorkspaceList {
  workspaces: AccountWorkspace[];
}

/** Reply to POST /workspaces/compact — packages/file-service/docs/workspaces.md § Compacting. */
export interface CompactWorkspaceReply {
  /** Bytes the recycle bin and `.git` gave back. */
  freed: number;
  /** Whether the new history reached `origin`; false when there is none. */
  pushed: boolean;
  /** git's words when the force-push was refused; the local repository is compacted anyway. */
  pushError?: string;
}

/** One surface a project declares, named and typed — enough to build its address and to gate a device. */
export interface SurfaceRef {
  id: string;
  type: string;
}

/** One project declaring at least one surface, identity fields flattened onto it — see docs/machine.md. */
export interface SurfacedProject {
  workspace: string;
  repoName: string | null;
  uniqueName: boolean;
  path: string;
  app: ProjectApp;
  active: boolean;
  surfaces: SurfaceRef[];
}

/** Reply to GET /workspaces/surfaces; not @studio/song's `ProjectSurfaces` — see docs/machine.md. */
export interface SurfacedProjectList {
  projects: SurfacedProject[];
}

/** GET /engine/served — what the session actually LOADED, which is not `SurfacedProject.active`; see docs/machine.md. */
export interface ServedProject {
  workspace: string;
  /** Workspace-relative, `.` for a lone-project clone — `SurfacedProject.path`'s spelling. */
  path: string;
}

/** Reply to GET /engine/served; `project: null` means the engine holds nothing for this person. */
export interface ServedProjectReply {
  project: ServedProject | null;
}

/** The user's PUBLIC deploy key, pl8 owning the private half — see packages/git-repos/docs/keys.md. */
export interface SshKeyInfo {
  publicKey: string | null;
}

/** Reply to GET /workspaces/by-repo — which workspace already holds a repository, if any. */
export interface WorkspaceForRepo {
  workspace: string | null;
}

/** The steps of an import, in order: the clone, the account's libraries, the media through LFS. */
export const CLONE_STEPS = ["clone", "libraries", "media"] as const;
export type CloneStep = (typeof CLONE_STEPS)[number];

/** A `git clone` in flight: started, then polled, because the wait is worth showing — packages/file-service/docs/cloneJobs.md. */
export interface CloneJob {
  id: string;
  workspace: string; // the folder it is cloning into, chosen from the repository's name
  step: CloneStep; // which of the import's steps `phase` and `percent` belong to
  done: boolean;
  failed: boolean;
  error: string | null;
  phase: string; // git's own words: "Receiving objects", "Resolving deltas", …
  percent: number | null; // null while git is doing something it cannot measure
  lines: string[]; // the tail of git's output, for a failure that needs reading
  /** How many lines have been emitted ALTOGETHER — `lines` is the last few, so a reader that
   *  wants the log needs this to know what it missed. Only ever grows. */
  emitted: number;
}

/** How a stem separation is doing — CloneJob's shape plus the `files` it produced; see docs/machine.md. */
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

/** What `POST /stems` answers: `ready` is the disk, `job` only when there was work — see docs/machine.md. */
export interface StemsReply {
  ready: boolean;
  job: SeparateJob | null;
}

/** One project inside a repository; the folder's NAME decides which app opens it — see ./projects.ts. */
export interface RepoProject {
  path: string;
  app: ProjectApp;
}

/** One module LIBRARY a project can reach, nearest first; `exists: false` is a state, not an absence — docs/machine.md. */
export interface ModuleLibrary {
  /** The `@`-prefixed level a chain writes: `workspace`, `st0`, `engine`. */
  ns: string;
  /** Workspace-relative, so every other route takes it as-is; EMPTY for `@engine`, which has no folder. */
  path: string;
  exists: boolean;
  /** Nothing here can be created, renamed or written — true for `@engine` alone; see docs/machine.md. */
  readOnly?: boolean;
  nodes: FileNode[];
  /** A library's shared SOUNDS, beside its modules — what a tap and a cabinet pick, and where a drop lands (@studio/song's libraryFiles.md). */
  samples?: FileNode[];
  irs?: FileNode[];
  /** …and its shared amp MODELS, what an amp's `model` may pick besides its own assets. */
  models?: FileNode[];
}

export interface RepoRef {
  id: string;
  name: string;
  uri: string;
}

/** One frozen snapshot a person shared — the AUTHOR's view, which no public route serves; see docs/machine.md. */
export interface ShareSummary {
  /** `sha256(token)` — the directory's name on the volume, and the `:key` in every route. */
  key: string;
  /** The secret in the link. Blank once revoked. */
  token: string;
  /** The project's name, for this list and for the visitor's header. */
  name: string;
  /** Where it came from. For the author alone: it says what is on their disk. */
  origin: { repo: string; project: string };
  createdAt: string;
  /** Everything the snapshot weighs on the volume — the number that makes the cost visible. */
  bytes: number;
  stems: number;
  /** Set once revoked. The row SURVIVES dated: a share that vanished would leave a doubt. */
  revokedAt?: string;
  /** How many comments sit in each state — COUNTED on the way out, never stored on the row. */
  comments?: CommentCounts;
}

/** What an author does with a comment. `active` is where every one lands; see apps/pl8/docs/comments.md. */
export type CommentState = "active" | "resolved" | "ignored";

/** One block of text a visitor left on a frozen snapshot — public, so it carries no identity beyond a chosen name. */
export interface ShareComment {
  id: number;
  /** What the visitor typed as their name, or "" — a share has no accounts, so this is a claim and not a fact. */
  author: string;
  body: string;
  /** Where the playhead was, in seconds, or null — a comment about the whole song has no timecode. */
  at: number | null;
  state: CommentState;
  createdAt: string;
  /** When the state last moved. Equal to `createdAt` until an author touches it. */
  updatedAt: string;
}

/** The three tabs' sizes, in one object — the author's list and the row's badge read the same numbers. */
export interface CommentCounts {
  active: number;
  resolved: number;
  ignored: number;
}

/** An engine as the browser sees it — the secret token is never sent to the client. */
export interface PublicEngine {
  id: string;
  hostname: string;
  addresses: EngineAddresses;
  /** How capable the machine is, as the supervisor measured it; absent from an older supervisor — docs/performance.md. */
  performance?: EnginePerformance;
  assigned: boolean; // already selected by someone; hidden from the pick list
  /** Who holds it and what they opened, undefined when free — "busy" alone is a screen people retry; docs/machine.md. */
  heldBy?: string;
  heldProject?: string;
  /** EVERY project claimed on it and by whom — an account's bench sits beside its song, docs/claim.md. */
  heldProjects?: { holder: string; project: string }[];
  // This engine's heartbeat arrived from the browser's own public IP — a same-LAN hint, not authoritative.
  sameSourceIp: boolean;
  /** A short-lived pass for the relay, minted by `/engines` and not by the registry — packages/engine-registry/proxy.ts. */
  proxyTicket?: string;
  /** Its supervisor holds a tunnel, so a WebRTC offer can reach it — packages/engine-tunnel/docs/rtc.md. */
  rtc?: boolean;
}

// How good a link is — Q1/Q2/Q3, off a measured latency — lives in ./quality; see docs/quality.md.
// How capable the machine behind it is — one integer, 1000 the reference — lives in ./performance.
