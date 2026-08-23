// types.ts — the API contract between st0/web's backend and frontend.
// The backend serves the files of one st0 project directory; the frontend
// renders a tree, edits text files, and autocompletes from schema-aware hints.

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
// alternative (the root branch, or a branch made outside st0).
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

/**
 * One file a writing command touched, as `POST /command` reports it.
 *
 * It comes out of the journal's own diff — the two images `recordChange` compares to build the
 * undo entry — so naming it costs nothing. What it is FOR is the reload behind a command: a
 * client that knows a marker moved inside one clip file can skip the routes that answer about
 * files and names, which cannot have changed. See apps/st0/frontend/src/reloadScope.ts.
 *
 * Paths are PROJECT-relative (`clips/x.yaml`) — the vocabulary `hints.paths` speaks, and the
 * one an anchored test can trust. The journal's own `files` stay workspace-relative.
 */
export interface ChangedFile {
  path: string;
  kind: "added" | "edited" | "removed";
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
  // …and their ranges, for the bases whose plugin is a built-in st0 defines. A widget bound without one is
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
  /** The chain that separates a record into stems, or null when this machine separates nothing.
   *  Written by `system stems <chaîne>`, read by every surface that could start a separation —
   *  which is why none of them asks for one. */
  stemsChain: string | null;
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
  // 0..1, as the file states it (NoteSchema's `v`). ABSENT means the schema's default, which is 1 —
  // so a roll draws a note that never mentioned velocity at full, and dragging it back to full
  // clears the field rather than writing one.
  vel?: number;
  // A pad's two effects, UNREALISED — the sequencer draws an icon from them, and the engine is what
  // expands them. The surface sees the pattern as authored, one note per pad, however many times
  // the engine ends up playing it (@studio/song docs/padEffects.md).
  repeat?: number;
  skip?: number;
}
export interface WebClip {
  id: string;
  type: "audio" | "midi";
  name: string;
  start: number; // beats
  length: number; // beats (0 == natural)
  /**
   * WHICH part of the source this placement draws — the same three numbers `regionWaveform`
   * reads, in the units `ClipDoc` states them in: `offset` the placement's in-point, `sourceFrom`
   * and `sourceTo` the clip file's own window in seconds (absent == the file's start / its end).
   *
   * They are here because the browser CACHES a clip's envelope, and until it could see them a
   * trim moved the window while the picture stayed: same id, so the cached envelope was reused
   * and the block went on showing material the clip no longer plays. See
   * apps/st0/frontend/src/clipEnvelope.ts, which is the only thing that reads them.
   */
  //
  // All optional, including `offset` — which is required on `ClipDoc` and cannot be here: the
  // shell SYNTHESISES stand-in clips to open an editor over (EditorTab, ModuleSidePane), and
  // those know an id and a name and nothing about a placement. A required 0 would have them
  // claim an in-point they never had.
  offset?: number; // audio: seconds into the source; midi: playStart (beats)
  sourceFrom?: number;
  sourceTo?: number;
  // The audio file's NAME, never its path — enough to tell that a bounce repointed the clip at a
  // new file, which is the other way its material changes without the placement moving. The path
  // itself stays server-side: nothing in the browser may resolve one.
  sourceName?: string;
  // A clip-relative loop [loopStart, loopEnd) in beats, repeated to fill `length`; absent or both 0 == no loop.
  loopStart?: number;
  loopEnd?: number;
  // The clip is time-stretched: just the fact (markers stay engine-side), so the timeline can flag it.
  warped?: boolean;
  // …and THIS event declines that map (`event status warp`), so it plays at the sample's own
  // rate. Both are sent: `warped` alone cannot tell "never stretched" from "stretched, switched
  // off here", and the timeline draws the second as the icon with a line through it.
  warpOff?: boolean;
  // Placed but silenced — the event-level `mute`. Still drawn (dimmed): an event you
  // can't see is a deleted one. The ENGINE is what skips it.
  disabled?: boolean;
  /**
   * How long this event fades in and out, IN BEATS. Absent means no fade, which is also how the
   * file says it — the field is deleted rather than written as zero.
   *
   * These were on the placement, on the engine wire and in the C++ engine long before they were
   * here, and only here: the browser was never told they existed, so the timeline could neither
   * draw a fade nor let one be dragged, and the only way to set one was to type YAML. Beats
   * rather than the file's timecode, like every other time on this document — a surface measures
   * in the unit it draws in.
   */
  fadeIn?: number;
  fadeOut?: number;
  /**
   * This clip is a RENDER, not a placement — the lane is frozen and this is what stands in for it.
   *
   * Which matters to anything that would edit it: there is no `clips:` entry for a move to
   * rewrite, and a bar-1 render sitting over a real placement at bar 1 means a drag would move
   * material the lane is not even showing. See packages/song/docs/freeze.md.
   */
  frozen?: boolean;
  /**
   * What the PLACEMENT itself said, unmerged — the same `EventDoc` the compiler builds, passed
   * through untouched. Absent when the event stated nothing beyond its `ref` and `start`.
   *
   * Everything else on this clip is the placement and its material already resolved together, and
   * that is one-way: `sourceFrom`/`sourceTo` are the intersection of two windows, a sequence's
   * window is over in `loopStart`/`loopEnd`, and the repeat count was multiplied into `length`. So
   * a surface can DRAW an event from the rest of this object and cannot WRITE one back — which is
   * what made a copy/paste on the timeline drop the trim, the fades and the passes.
   *
   * Read by `clipboard.ts` alone. It is not what the timeline draws from: the resolved numbers
   * above stay the drawing's single source, and this is deliberately beside them rather than
   * instead of them.
   */
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
  /**
   * The FILE second this point pins — what `clip warp` and `clip warp remove` name it by.
   *
   * On the wire because the file↔display mapping is PIECEWISE (the engine pins every interior
   * marker as its own beat point), so a surface cannot invert it from two numbers. It can see
   * the point; this is what lets it name the one it is pointing at.
   */
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
  /**
   * The linear file↔display mapping every second above went through:
   * `display = (file − inPoint) × stretch`, so `file = display / stretch + inPoint`.
   *
   * On the wire because a GESTURE goes the other way. Everything here is in region seconds, which
   * is the right space to DRAW in and the wrong one to command in — `clip warp` names a moment of
   * the SOURCE file. Without this pair a surface would have to rebuild it out of `offset`,
   * `sourceFrom` and the warp ratio, which is a second copy of the one thing the producer already
   * computed (`RegionWaveform.toDisplay` says why that matters).
   */
  sourceMap: { inPoint: number; stretch: number; zeroBeat: number };
  /**
   * The material's own `from`/`to` — the span of the source this clip IS — in the same region
   * seconds as everything above.
   *
   * Sent only when the picture is WIDER than the window, which is the `whole` view: a placed clip
   * is drawn from its in-point, so there the region and the window are the same thing and a band
   * over the whole pane would say nothing. Absent therefore means "nothing to shade", not
   * "untrimmed".
   *
   * Named for the SOURCE rather than plainly `window`, because it is passed straight to a React
   * prop and a prop called `window` shadows the global one inside the component that draws it.
   */
  sourceWindow?: { from: number; to: number };
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
// addresses (e.g. "mixer:vo.jo"); the rest are that module's params, in their own units — dB for the level,
// -1..+1 for the pan.
//
// The three tone bands were here and are not any more. They remain on the MIXER — the plugin has them, the
// module declares them, a panel can bind them and a node file can hold them — but a track no longer carries
// them: a strip's EQ is the mixer module's business, reached where every other module param is, and lifting
// three of its params onto the track meant two places to read one value.
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
  // The channel strip at the end of this track's chain — where its level, pan and tone live now that a track
  // states none of them itself. Absent means the track has NO strip: not "at unity", but nowhere to put a
  // level, which is a thing to say rather than a dead fader to draw.
  mixer?: WebMixer;
  mute: boolean;
  solo: boolean;
  disabled?: boolean; // true ⇒ track is ignored (filtered by the brain); absent when false
  clips: WebClip[];
  // The lane's TAKES — what it was playing before something was recorded over it. Absent on a
  // lane with none. Drawn as rows indented under it; nothing plays them until one is selected
  // (`track take select`). See packages/song/docs/takes.md.
  takes?: WebTake[];
  plugins: WebPlugin[];
  // `docs` / `todos` were here, for the Docs panel. Both are gone with it — a note is a doc
  // module on the graph now (`@studio/doc`). See packages/song/docs/docModules.md.
  // `frozen`, `alternatives` and `alternative` were here, for the timeline's lane header. All
  // three are gone with the fields they came from — see packages/song/docs/trackModules.md.
  // They did not come back HERE: both are facts about the module a lane is, so the timeline's
  // gutter reads them off `WebGraph` (`trackAlternatives`, `frozen`) rather than off a second
  // copy on this document. Putting them back would also cost a clone of the module vocabulary on
  // every 2 s poll of /project-doc, which is memoised per revision and this route is not.
}
// A TAKE (mirrors TakeDoc): an arrangement the lane WAS playing, set aside. Its clips are compiled
// exactly as the lane's own are, so a row of them draws with no special case.
export interface WebTake {
  name?: string;
  clips: WebClip[];
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
// both, and its ruler reads either — see apps/st0/frontend/docs/picture.md.
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
/**
 * One pass over the picture (mirrors VideoPluginDoc) — a video chain's step, compiled.
 *
 * A `shader` carries its GLSL INLINE: the browser cannot open the module's `shaders/` folder, and
 * a page of text is smaller than the route that would serve it. Absent when the node has nothing
 * picked, which draws as a pass that lets its picture through.
 *
 * `audioFrom` names a LANE rather than carrying a number, because the number moves: the engine
 * pushes levels at ~20 Hz and the surface holding that stream is the one that can look one up.
 * See @studio/song's docs/shaders.md.
 */
export interface WebVideoPlugin {
  id: string;
  type: "video_effect" | "video_transition" | "shader";
  name: string;
  enabled: boolean;
  params: Record<string, number>;
  shader?: { name: string; vertex: string; fragment: string };
  audioFrom?: string;
}
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
  // This lane's own run, applied to the layer BEFORE it is composited. Absent on a lane no run
  // starts at, which is every lane in a project that draws no shaders.
  plugins?: WebVideoPlugin[];
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
  | "audioFiles"
  | "baseModules"
  | "categories"
  | "chains"
  | "clipTargets"
  // An automation CURVE of this project, by id — what `node automate` points a param at.
  | "curves"
  | "markerNames"
  | "modules"
  | "moduleAlternatives"
  // A NODE — one of this project's uses of a module, which is what the `node …` verbs address.
  // Separate from `modules` because a `@ref` names a shared definition, and those are edited in
  // the builder rather than by a verb. See packages/song/docs/nodes.md.
  | "nodes"
  // A set list of the REPOSITORY, by name — `_playlists/<name>.yaml`, subfolders kept. The one
  // provider here that reads nothing of the open project, a playlist belonging to the workspace.
  | "playlists"
  | "sequenceFiles"
  // The kinds of SURFACE the editor can draw — a closed set of words, not something read off the
  // project: the file being named is the one the command is about to create.
  | "surfaceTypes"
  | "tracks";
export interface CommandArg {
  name: string;
  kind: ArgClass;
  // What this argument NAMES, when the answer comes off the project. The right-click menu matches
  // on it to offer every command the clicked thing can answer — see st0's contextMenu.ts.
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
  // The song's OUTPUT level in dB — 0 is unity, +6 the top of the fader. The header's fader reads
  // it and `project master` writes it; see @studio/song's docs/masterVolume.md, including why +6
  // is rarely the answer to a quiet mix.
  masterVolume: number;
  tracks: WebTrack[];
  groups: WebGroup[];
  // The metronome enable from settings.yaml — the header button's source of truth; toggling rewrites the file.
  metronome: boolean;
  // …and how loud it clicks, 0.2 … 1. Never 0: silence is the flag above, and the floor is the
  // engine's own (see METRONOME_MIN). What the footer button's right-click slider sits on.
  metronomeLevel: number;
  // Whether any track streams from an algo/ pattern; false == the shell need not poll the pattern clock.
  strudel: boolean;
  // Count-in length in BARS from settings.yaml (0 == none); the engine applies the actual pre-roll.
  countIn: number;
  // Named timeline markers, sorted by beat. Empty when the song has none.
  markers: WebMarker[];
}

// --- PICTURE: the same folder, read again ----------------------------------------
// Nothing here is a beat: a shot is cut against the wall clock. A separate document and not a
// section of WebProject, which is what keeps the frame out of what the C++ engine is handed
// without anything having to strip it on the way.
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
  /** The `RENDER -> VIDEO_OUT` run: passes over the frame the lanes were composited INTO — the
   *  picture's `masterPlugins`. Always sent, empty by default. */
  framePlugins: WebVideoPlugin[];
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
// Moved to @studio/graph-model. Three apps draw chains — st0, pl8's module
// builder and m9 — and only st0 wants the rest of this file, so the graph
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
  projectCount: number; // project folders inside, at any depth (0 for empty)
  isSingleProject: boolean; // the folder itself is a project
}

/** Reply to GET /workspaces on the file service. */
export interface WorkspaceList {
  workspaces: WorkspaceSummary[];
}

/**
 * One workspace on the machine, with the projects it actually holds — what st0's home page
 * lists.
 *
 * The machine answers this, and nothing else does. pl8 kept a bare blobless mirror of every
 * repository to answer the same question from the hosted side; it was a second copy of what the
 * working clone already had, and a worse one — a fetch behind, and blind to a project that is
 * committed but not yet pushed. See apps/st0/frontend/docs/projects.md.
 *
 * `origin` is `remote.origin.url` as git wrote it, normalized; null for a workspace that is not
 * a clone at all. `repoName` is its SHORT name, derived here rather than asked of pl8, because
 * that is the half of a project's address a person reads — and deriving it costs nothing the
 * `origin` has not already paid for.
 *
 * `uniqueName: false` says the short name does NOT identify this workspace *on this machine*: two
 * clones whose origins end in the same name make `/<name>/…` ambiguous, and pl8 refuses such an
 * address (409) rather than picking one.
 *
 * That is only HALF of whether the portable address works, and deliberately the only half this
 * side can answer. The other half is whether pl8's registry knows the repository at all — a
 * `/<name>/…` address is resolved through it, so a clone this machine has and that registry does
 * not is unaddressable that way however unique its name is. The page holds both answers because
 * the page talks to both services; the machine states what it knows and guesses nothing.
 */
export interface MachineWorkspace {
  name: string;
  origin: string | null;
  repoName: string | null;
  uniqueName: boolean;
  isSingleProject: boolean;
  projects: RepoProject[];
}

/** Reply to GET /workspaces/projects on the file service. */
export interface MachineWorkspaceList {
  workspaces: MachineWorkspace[];
}

/** One surface a project declares, named and typed and nothing more — enough to build its
 *  address and to decide whether a given device can drive it. */
export interface SurfaceRef {
  id: string;
  type: string;
}

/**
 * One project on this machine that declares at least one surface, with those surfaces.
 *
 * The identity fields are `MachineWorkspace`'s, repeated per project rather than nested, because
 * this list is read as a flat one: the caller is looking for a SURFACE and the workspace it lives
 * in is a detail of the address. `path` is workspace-relative, `.` for a lone-project clone.
 *
 * `active` is the workspace's `.studio-active` marker — the project this workspace currently has
 * open. One per workspace at a time, which is why it is a flag here and not a filter: a caller
 * that wants only the live ones can say so, and one showing a menu wants to know which row is
 * already up. See apps/st0/frontend/docs/external.md.
 */
export interface SurfacedProject {
  workspace: string;
  repoName: string | null;
  uniqueName: boolean;
  path: string;
  app: ProjectApp;
  active: boolean;
  surfaces: SurfaceRef[];
}

/** Reply to GET /workspaces/surfaces on the file service. Projects declaring none are absent
 *  rather than present and empty.
 *
 *  Not `ProjectSurfaces`, which is @studio/song's — that one is ONE project's surfaces with the
 *  diagnostics from reading them, and this is the machine's list of the projects that have any. */
export interface SurfacedProjectList {
  projects: SurfacedProject[];
}

/**
 * Reply to GET /engine/served on the file service — the project this person's st0 session is
 * actually loaded into on the engine, or `null` when it is holding none.
 *
 * Not the same question as `SurfacedProject.active`, and the difference is the point. That flag is
 * a workspace's `.studio-active` marker, one per workspace and written by whoever opened last; this
 * is the file service's note of what it SENT, one project for the whole account, because a session
 * is per service and per person (packages/engine-protocol/docs/sessions.md). A machine with three
 * markers is still an engine holding one song.
 *
 * `workspace` + `path` rather than an absolute path: those are the two strings every address on
 * this side is built from, and the engine's disk layout is nobody else's business.
 */
export interface ServedProject {
  workspace: string;
  /** Workspace-relative, `.` for a lone-project clone — `SurfacedProject.path`'s spelling. */
  path: string;
}

/** Reply to GET /engine/served. `project: null` means the engine holds nothing for this person —
 *  no project has been opened since the service came up, or the last one was unloaded. */
export interface ServedProjectReply {
  project: ServedProject | null;
}

/** Reply to GET/POST /api/projects/ssh-key on pl8 — the user's PUBLIC deploy key, the one
 * they paste into their git host. pl8 generates the pair and owns the private half; see
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

/**
 * What `POST /stems` answers — the desk asking for ONE record to be prepared.
 *
 * Two fields rather than one job, because a record already separated must start nothing: the
 * desk asks on every load, and the scan flag it asks WITH is a snapshot taken minutes ago. So
 * `ready` is the state of the disk, and `job` is only there when there was work to do. Encoding
 * the first as a job that is instantly done would hand the caller an id nobody can poll.
 */
export interface StemsReply {
  ready: boolean;
  job: SeparateJob | null;
}

/** One project inside a repository: where it is, and which app opens it. The folder's NAME
 *  decides the app — see ./projects.ts. */
export interface RepoProject {
  path: string;
  app: ProjectApp;
}

/**
 * A repository named by its short name — pl8's answer to "what is behind `/<name>/…`".
 *
 * The one thing an editor needs before it can resolve a workspace, and the reason the URI is
 * not in the address bar in the first place.
 */
/**
 * One module LIBRARY a project can reach — a level, where it is, and what is in it.
 *
 * Its own answer beside the file tree, because the tree is the SONG and these are outside it:
 * the workspace's `_modules` and the account's `_libraries` sit beside the project, not in it.
 * Ordered by precedence, nearest first, by whoever answers.
 *
 * `exists: false` with no nodes is a real state and not an absence: a level you could put a
 * module in is worth drawing, so somebody can. Distinguishing it from an empty one matters
 * because only one of the two is fixed by adding a module.
 */
export interface ModuleLibrary {
  /** The `@`-prefixed level a chain writes: `project`, `workspace`, `st0`, `engine`. */
  ns: string;
  /** Workspace-relative, so every other route takes it as-is. EMPTY for `@engine`, which is
   *  the one level with no folder anywhere — see `readOnly`. */
  path: string;
  exists: boolean;
  /**
   * Nothing here can be created, renamed or written.
   *
   * True for `@engine` and only for it. A scanned plugin is a module the engine merely
   * REPORTS: it has no folder, so there is nothing to write into and nothing to open — the
   * rows are a vocabulary you can name in a chain, not files. Giving one a folder is
   * `module own <ref>` (see packages/song/docs/moduleFork.md), which is a different act.
   */
  readOnly?: boolean;
  nodes: FileNode[];
}

export interface RepoRef {
  id: string;
  name: string;
  uri: string;
}

/**
 * One git repository a person has REGISTERED with pl8.
 *
 * The register and nothing more: which repositories exist, and what URI is behind each short
 * name. What is INSIDE one is `MachineWorkspace` above, answered by the machine that holds the
 * working copy — pl8 kept a bare blobless mirror to answer it too, and that copy is gone.
 *
 * So there is no `projects`, no `branch`, and no fetch status here any more: all three
 * described the mirror. What survives is what only a hosted service can hold — a list that
 * belongs to a person rather than to a machine.
 */
export interface RepoSummary {
  id: string;
  uri: string;
  /**
   * The repository's SHORT name — its last path segment without `.git`, which is also what
   * the clone is called on the engine's machine.
   *
   * This is the half of a project's address that a person can read, and it is what pl8 puts
   * in the link: `/<name>/<project>`. Derived from `uri` rather than stored, so the two
   * cannot drift; the URI itself never reaches the address bar, because it carries a host, a
   * port and a user, none of which belong in a bookmark.
   */
  name: string;
  label: string;
  addedAt: string;
}

/**
 * One frozen snapshot a person has shared, as their own Projets section lists them.
 *
 * The AUTHOR's view and nobody else's: `origin` names a repository and a folder on the machine
 * it came from, and the public routes serve none of this — they serve the snapshot's manifest.
 *
 * `token` rides along in the clear because it IS the copy-link button, the same posture
 * `.projects/ssh/` already takes with everybody's deploy key. It is blanked on revocation, so a
 * revoked row cannot be copied back out of the screen it is still drawn on.
 */
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
   * On the wire because "busy" and "busy with Fred's winter.st0" are not the same screen: an
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
