// types.ts — the API contract between lanes/web's backend and frontend.
// The backend serves the files of one lanes project directory; the frontend
// renders a tree, edits text files, and autocompletes from schema-aware hints.

// A node in the project file tree: dirs carry `children`, files a `kind` (`binary` is shown, not edited).
export interface FileNode {
  name: string; // basename
  path: string; // workspace-relative, POSIX separators (e.g. "modules/instruments/synth/module.yaml")
  dir: boolean;
  kind?: "text" | "binary"; // files only
  project?: boolean; // dirs only — true when the folder is a lanes project (has project.yaml)
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

// A module's panel file in the workspace's `_ui` library — what the module editor's widget grid edits. It may
// not exist on disk yet: `path` is then where it WOULD go and `content` a blank grid, so the first save creates
// it through the ordinary write route.
export interface ModuleUiFile {
  ref: string; // the module the panel draws, e.g. "@engine/audio/delay/tape-delay"
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
}

// Where the workspace's repo stands vs upstream, for the share badge (mirrors @lanes/commands/git).
export interface GitStatus {
  tracked: boolean;
  ahead: number;
  behind: number;
  conflicted: boolean;
}

// The alternatives (branches) of the workspace repo — mirrors @lanes/commands/git.
// `parent` is the branch an alternative was started from, "" for one that is not an
// alternative (the root branch, or a branch made outside lanes).
export interface Alternatives {
  current: string;
  parent: string;
  branches: { name: string; parent: string; current: boolean }[];
}

// Result of POST /git/commit — mirrors @lanes/commands/git's CommitOutcome.
export interface GitCommitResult {
  nothingToCommit: boolean;
  sha?: string;
  changed?: number;
  pushed: boolean;
  pushError?: string;
}

// Result of POST /git/pull — mirrors @lanes/commands/git's PullOutcome.
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

// Autocompletion source — the project's real entities; empty arrays when it is malformed, so the editor degrades.
export interface Hints {
  baseModules: string[]; // plugin module refs a module can extend ("type/name", "@ns/type/name")
  ioSinks: string[]; // io module names ("OUT")
  // Chain `use` refs: a bare name for the folder's generic, plus "<name>:<instance>" per
  // instance file, then the inherited modules by ref ("@ns/type/name").
  modules: string[];
  tracks: string[];
  channels: string[]; // input-channel labels from the machine's preferences
  clips: string[];
  // Video track ids — what an audio track's `video_source` may name to inherit its placements and audio.
  videoTracks: string[];
  sequences: string[];
  chains: string[];
  // The shared asset library (project.libraries_from), library-relative — a UI's library dropdown lists these.
  libraryFiles: string[];
  paramsByBase: Record<string, string[]>; // base ref -> known param names
  // …and their ranges, for the bases whose plugin is a built-in lanes defines. A widget bound without one is
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
  // Scanned plugin names by format, lowercased key — from the engine's scan cache (~/.lanes/exts.json).
  pluginNames: Record<string, string[]>;
  // "kind:name" -> the project-relative file defining it (module|base|sink|track|clip|sequence|chain).
  paths: Record<string, string>;
  projectRoot: string; // absolute path to the active project (for resolving entity paths)
  // Audio files by project-relative folder ("" = root) — completes `source:`/`clip:` against neighbouring audio.
  media: Record<string, string[]>;
}

// One declared port — a module under an io/ folder, the project's own or an inherited one
// (mirrors @lanes/song/ioPorts). What the I/O panel lists; the LEVELS come from the
// engine socket, keyed by position in the array this arrives in.
export interface IoPort {
  ref: string; // how a chain names it ("OUT", "@engine/io/IN:in-1")
  name: string; // the part worth showing ("IN:in-1")
  dir: "in" | "out";
  channels: number[]; // interface channels, a preferences label already resolved
  label?: string; // the `channel:` as authored, when it named a label
  unknownLabel?: boolean; // …and this rig has no input by that name
  namespace: string; // the shared catalogue it came from, "" for a project's own
  generic: boolean; // the folder's module.yaml rather than one of its instances
}

// One entry of the shared `_modules` catalogue (mirrors @lanes/song/moduleCatalogue).
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
  instances: number; // how many instances sit beside it
  hasUi: boolean; // it already has a panel in `_ui`
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
  transients: number[]; // display seconds where transients are detected
}

// Audition one sample through the engine: a media path, a clip id, or a slice window in seconds into a source.
export type PreviewReq =
  | { kind: "source"; source: string }
  | { kind: "clip"; clip: string }
  | { kind: "slice"; source: string; from: number; to: number };

// A selectable module preset — found by the engine in the plugin (program/file), or authored by the user ("user").
export interface PresetInfo {
  name: string;
  source: "program" | "file" | "user";
  index: number; // program-list index (source "program"), else -1
  path: string; // absolute preset path (source "file" | "user"), else ""
}

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
// One track's strip, read off the mixer module at the end of its chain. `module` is the instance ref an edit
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
  // Authored notes and a to-do checklist for the Docs panel; absent when unset.
  docs?: string;
  todos?: string[];
  // Set while the track is FROZEN: the render it plays instead of its own material, absolute. By the time the doc
  // is built that render is already the track's one clip and `plugins` is empty — this is here so the timeline can
  // say why a lane it won't let you edit looks the way it does.
  frozen?: string;
}
// A group track (mirrors GroupDoc): clipless, drawn as a header with its member tracks indented under it.
export interface WebGroup {
  id: string;
  name: string;
  color: string;
  mute: boolean;
  solo: boolean;
}
// A video clip on a video track. Times are SECONDS — `startBeat` serves the shared ruler only, never the model.
export interface WebVideoClip {
  id: string;
  name: string;
  src: string; // workspace-relative media path
  start: number; // seconds
  length: number; // seconds (0 == natural)
  sourceFrom: number; // seconds into the source
  startBeat: number; // start converted to beats, for the timeline only
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
export interface CommandArg {
  name: string;
  kind: ArgClass;
  // One line on what this argument accepts; empty when there is nothing to promise, and the palette shows no clue.
  hint: string;
}
export interface CommandInfo {
  command: string;
  help?: string;
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
  // Count-in length in BARS from settings.yaml (0 == none); the engine applies the actual pre-roll.
  countIn: number;
  // Named timeline markers, sorted by beat. Empty when the song has none.
  markers: WebMarker[];
  // Picture. `video` gates the viewport pane; when false the rest are inert. viewport is [w,h] px, fps for export.
  video: boolean;
  viewport: [number, number];
  fps: number;
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

// --- Chains: the routing graph (mirrors the brain's GraphDoc essentials) --------

export interface WebOut {
  to: string; // a chain name or an io sink (e.g. "OUT")
  gain: number; // 0..1 share (1 == whole signal)
}
// One widget on a module's UI grid — the wire copy of the brain's Widget; `hidden` is resolved away by the merge.
export interface WebWidget {
  type:
    | "label"
    | "knob"
    | "slider"
    | "fader"
    | "number"
    | "toggle"
    | "button"
    | "meter"
    | "tabs"
    | "waveform"
    | "dropdown";
  col: number;
  row: number;
  colSpan?: number;
  rowSpan?: number;
  label?: string;
  text?: string; // label only
  bind?: string; // everything but label/tabs/waveform: the param it reads/writes
  min?: number; // knob | slider | number
  max?: number;
  step?: number;
  curve?: "lin" | "log";
  pages?: Record<string, Record<string, WebWidget>>; // tabs only: named pages of sub-widgets
  source?: "input" | "output"; // waveform only: which audio tap to display
  // dropdown only: a discrete param's named settings with the value that selects each (not derivable from index).
  options?: { label: string; value: number }[];
  // dropdown only: choices from a library folder ("ir"). Picking one writes the module's own field, not a param.
  library?: string;
}
export interface WebModuleUI {
  cols: number;
  rows: number;
  widgets: Record<string, WebWidget>;
}
// What a cable carries, derived from the module's TYPE FOLDER (see loader.ts MODULE_TYPES). Colours the cable.
export type WebSignal = "audio" | "midi" | "video";

// A module's type folder. The graph draws an icon per kind, which `emits` can't stand in for.
export type WebModuleCategory =
  | "io"
  | "instruments"
  | "audio"
  | "transformers"
  | "midi" // the legacy alias of transformers
  | "video_effects"
  | "video_transitions";

export interface WebChainStep {
  module: string; // a module instance name
  category?: WebModuleCategory; // its type folder — picks the node's icon
  // What this module EMITS. Absent for a module that emits nothing (a sink) or whose category is unknown.
  emits?: WebSignal;
  enabled?: boolean; // false == bypassed
  // The chain names a module this project doesn't have. Not fatal: the step compiles to nothing and the graph
  // draws the name with a `?`. Bypass is the one thing it takes.
  missing?: boolean;
  // Library files this module loads, by asset kind ("ir", "nam"), library-relative — the dropdown's current choice.
  assets?: Record<string, string>;
  stub?: boolean; // a plugin module that resolved to no plugin (missing on import)
  notSupported?: boolean; // plugin.type is "not_supported" — lanes can't load it; bypassed
  unknownPlugin?: boolean; // plugin.type is an UNKNOWN format (typo / unimported) — bypassed
  hasNativePluginUI?: boolean; // an external plugin with a native editor the engine can open
  // The UI drawn inside this module's rectangle, already merged (extended module's, overridden per widget id by
  // this one's). Undefined == neither defines one.
  ui?: WebModuleUI;
  // What the module actually runs with (defaults + overrides). A bound param may be ABSENT — the plugin's own
  // default is known only to the engine, so a widget with no value falls back to its authored min.
  params?: Record<string, number>;
  // The engine's PluginDoc id (`chain:module`) — what set-plugin-param addresses. Only for a real plugin.
  pluginId?: string;
  // io "in" only: whether the interface signal is audible. A module FIELD, not a param — which is why a widget
  // bound to it needs a target of its own (see widgetTarget's "module" kind).
  monitor?: "off" | "auto" | "on";
  // Where this node's waveform widget listens. Normally its own plugin's output; an io "in" module has no
  // plugin at all, so it borrows the INPUT side of the first plugin on the lane it feeds — the same signal,
  // one step downstream. Absent ⇒ the widget falls back to `pluginId` + the widget's own `source`.
  tap?: { id: string; side: "input" | "output" };
  // Which curve (by id) drives which param. The graph draws each as a curve node arrowing into the module.
  automations?: WebAutomation[];
}
// One automation binding — a curve id driving a named param on a module.
export interface WebAutomation {
  param: string;
  curve: string; // a curve id (keys WebGraph.curves)
}
// A curve's shape, enough to LABEL its node — the full definition stays on disk.
export interface WebCurve {
  type: "lfo" | "custom";
  shape?: "sine" | "triangle" | "saw" | "square"; // lfo only
}
export interface WebChain {
  from?: string; // a track id (or another chain)
  use: WebChainStep[]; // ordered module instances
  enabled?: boolean; // whole-chain bypass
  out: WebOut[];
}
// Per-module metadata off the signal path (notes, to-dos), keyed by the name a chain step's `module` references.
export interface WebModuleMeta {
  docs?: string;
  todos?: string[];
}
export interface WebGraph {
  // The shared asset library, library-relative — what a module UI's library dropdown offers. Carried here because
  // that is what the node renderer has in hand; the same list is in Hints.
  libraryFiles?: string[];
  chains: Record<string, WebChain>;
  tracks: string[]; // track ids, for resolving `from`
  // Video track ids. A video lane is a chain source like any other, and one no chain mentions is still drawn.
  videoTracks?: string[];
  // What each track EMITS into a chain's first module, by track id; a track absent here is treated as audio.
  trackSignals?: Record<string, WebSignal>;
  // Per-track display colour by track id — the timeline's colour. Absent when the track authors none.
  trackColors?: Record<string, string>;
  // The ids of tracks currently FROZEN: playing a render of themselves. The graph marks their lane and every
  // module downstream of it, because those modules are in the render and no longer run — and a node you can still
  // click a knob on had better not be one the engine stopped listening to.
  frozenTracks?: string[];
  // Every module's notes/checklist by name — always populated by the backend, so the Docs panel is complete.
  // Optional because the layout-only subgraphs feeding dagre carry geometry, not docs.
  modules?: Record<string, WebModuleMeta>;
  // Every curve a module binds, keyed by id — its shape, for the node's label. An unreferenced curve draws nothing.
  curves?: Record<string, WebCurve>;
  warnings: string[];
}

// ── Engine-side file service headers ─────────────────────────────────────────
// The browser talks to the file service directly (cross-origin) with no OIDC cookie there, so it passes
// identity, context and a light gate as headers.

/** The authenticated user's email — the file service slugifies it to pick the root. */
export const USER_HEADER = "x-lanes-user";
/** The chosen workspace name under ~/.lanes/root/<slug>/. */
export const WORKSPACE_HEADER = "x-lanes-workspace";
/** The engine's token (from the whoami probe) — the file service's light LAN gate. */
export const ENGINE_TOKEN_HEADER = "x-lanes-engine-token";

// ── The engine assignment ────────────────────────────────────────────────────
// "Assigned" is a LEASE: a closed tab can only say goodbye best-effort, so the truth has to expire on its own.
// The driving tab renews with an idempotent re-POST of /api/engine/select. Per-engine across users.

/** How often the driving tab re-selects to keep its engine assignment alive. */
export const ENGINE_ASSIGN_RENEW_MS = 5000;

/** No renewal for this long ⇒ the assignment lapses and the engine shows free. */
export const ENGINE_ASSIGN_TTL_MS = 15000;

// ── The engine registry ──────────────────────────────────────────────────────
// An engine registers itself (via the supervisor) with these addresses; the browser probes them for a locality
// tier (see the frontend's engineProbe.ts) and picks from the unassigned ones. See the backend `registry.ts`.

/** The addresses a browser can try to reach an engine at, in tier order. */
export interface EngineAddresses {
  loopback: string; // "127.0.0.1" — reachable only from the same machine (Tier 1)
  lanIps: string[]; // non-internal IPv4s — reachable from the same LAN (Tier 2)
  port: number; // the engine's WebSocket port (same on every address)
  filePort: number; // the engine-side file service's HTTP port (same host set)
}

/** A workspace under ~/.lanes/root/<slug>/, as the picker lists them. */
export interface WorkspaceSummary {
  name: string; // the folder name (== the workspace name the user picks)
  projectCount: number; // number of project.yaml folders inside (0 for empty)
  isSingleProject: boolean; // the folder itself is a project (has project.yaml)
}

/** Reply to GET /workspaces on the file service. */
export interface WorkspaceList {
  workspaces: WorkspaceSummary[];
}

/** Reply to GET/POST /ssh-key — the user's public key for cloning git workspaces
 * over SSH (the private half stays on the engine's machine and is never served). */
export interface SshKeyInfo {
  publicKey: string | null;
}

/** An engine as the browser sees it — the secret token is never sent to the client. */
export interface PublicEngine {
  id: string;
  hostname: string;
  addresses: EngineAddresses;
  assigned: boolean; // already selected by someone; hidden from the pick list
  // This engine's heartbeat arrived from the browser's own public IP — a LAN hint (Tier 2), not authoritative.
  sameSourceIp: boolean;
}

/** Locality tier of a reachable engine, lower = closer/faster. */
export type EngineTier = 1 | 2 | 3;
