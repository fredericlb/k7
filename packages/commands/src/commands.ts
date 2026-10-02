// commands.ts — the feature registry: one stable SID (module.new, transport.play, …) per
// capability, mapped to a handler that acts through a CommandHost, so the SAME feature
// runs from the web command bar and from `st0 cmd`. Which words invoke a SID lives
// declaratively in commands.yaml (see commandSpec.ts); this file is just the behaviours.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import type {
  AudioDeviceInfo,
  PluginInfo,
} from "@studio/engine-client/engineClient";
import {
  EXTERNAL_PLUGIN_FORMATS,
  METRONOME_MIN,
} from "@studio/engine-protocol/build";
import {
  assemblyMembers,
  createAssembly,
  dissolveAssembly,
  dropNodeFromAssemblies,
  renameNodeInAssemblies,
} from "@studio/song/assemblyEdit";
import { bindModuleCc } from "@studio/song/controllerBind";
import {
  createCurveFile,
  createFlatCurveFile,
  editCurveFile,
  loadCurves,
} from "@studio/song/curves";
import { freezeBlockedBy, freezePlans } from "@studio/song/freeze";
import {
  coldPlacementError,
  isInputModule,
  loadGraph,
  parseChains,
} from "@studio/song/graph";
import { libraryFiles } from "@studio/song/libraryFiles";
import {
  cloneModuleFile,
  createModuleFile,
  createNode,
  createSequenceFile,
  createTrackFile,
  freeNodeName,
  isFileParam,
  loadChains,
  loadModuleRefs,
  loadModules,
  loadProjectRoot,
  nodeNameTaken,
  setLaneOrder,
} from "@studio/song/loader";
import { moduleAssetChoices } from "@studio/song/moduleAssetChoices";
import { materialiseEngineModule } from "@studio/song/moduleFork";
import { createNodeOn } from "@studio/song/nodeOnRef";
import type { ClipDoc, ProjectDoc, TrackDoc } from "@studio/song/project";
import { SHARED_MODULES_PATH } from "@studio/song/sharedFolders";
import { createSurfaceFile, surfacesNaming } from "@studio/song/surfaces";
import { addTrackMixer } from "@studio/song/trackMixerFile";
import { selectModuleAlternative } from "@studio/song-edit/alternativeSwitch";
import { spliceProjectTime } from "@studio/song-edit/insertTime";
import {
  consolidateSequenceMaterial,
  splitSequenceMaterial,
} from "@studio/song-edit/materialCut";
import { addOnset, moveOnset, removeOnset } from "@studio/song-edit/onsets";
import {
  clearChainNodePositions,
  clipFilePath,
  clipOnsets,
  clipWarpMarkers,
  connectChainNodes,
  deleteChainNode,
  disconnectChainNodes,
  insertChainStep,
  laneOfNode,
  moduleAlternatives,
  newModuleAlternative,
  placeChainNode,
  renameChainNode,
  replugChainNodes,
  setChainNodePosition,
  setChainNodePositions,
  setClipOnsets,
  setClipWarp,
  setModuleAsset,
  setModuleAutomationBinding,
  setModuleBase,
  setModuleBypass,
  setModuleCamera,
  setModuleChannel,
  setModuleDevice,
  setModuleExtends,
  setModuleFrozen,
  setModuleInputGain,
  setModuleMix,
  setModuleMonitor,
  setModuleParam,
  setModuleShader,
  setModuleVolume,
  unlinkChainNode,
} from "@studio/song-edit/projectEdit";
import {
  addTap,
  removeTap,
  renameTap,
  setTap,
} from "@studio/song-edit/rackTaps";
import {
  addTrackPlacement,
  addTrackPlacements,
  movePlacementToTrack,
  moveTrackPlacement,
  moveTrackPlacementsInRange,
  removeTrackPlacement,
  resizeTrackPlacement,
  setTrackPlacementDisabled,
  setTrackPlacementFade,
  setTrackPlacementWarp,
  setTrackPlacementWindow,
} from "@studio/song-edit/trackMix";
import { builtinParamsFor } from "@studio/song-schema/builtinParams";
import { renamedInstance } from "@studio/song-schema/instanceName";
import {
  CUE_NODE,
  curveRef,
  isBuiltinOutput,
  isLibraryFileParam,
  LIBRARY_FILE_PARAMS,
  MIX_NODE,
  OUT_NODE,
  RENDER_NODE,
  sharedFamilyOf,
  splitPort,
  VIDEO_OUT_NODE,
} from "@studio/song-schema/moduleTypes";
import {
  beatsToDuration,
  beatsToPosition,
  parseDuration,
  parsePosition,
} from "@studio/song-schema/timecode";
import { orderPosition, reorderTracks } from "@studio/song-schema/trackKind";
import {
  type Placement,
  PlacementSchema,
} from "@studio/song-schema/yaml/placementSchema";
import { withModuleParams } from "./moduleValues";

/** Everything a placement may say beyond WHERE it goes, listed rather than spread — docs/verbs.md. */
const EVENT_FIELDS = [
  "from",
  "to",
  "fadeIn",
  "fadeOut",
  "loop",
  "disabled",
  "warp",
] as const;

import type { RunColdStep } from "@studio/audio-passes/coldPass";
import {
  processWithChain,
  type Scope,
} from "@studio/audio-passes/processChain";
import { DEFAULT_TRIM_DB, trimWindow } from "@studio/audio-probe/trim-gate";
import {
  deleteFileValue,
  setFileValue,
  setQuotedKeyMap,
} from "@studio/song/yaml/edit";
import {
  isProjectFolder,
  moduleFileFor,
  readModuleFile,
} from "@studio/song/yaml/moduleIO";
import { halveLoopsOf } from "@studio/song-edit/sequenceLoops";
import { ASPECTS, aspectSize } from "@studio/song-schema/aspect";
import {
  removeWarpPoint,
  seedWarp,
  setWarpPoint,
} from "@studio/song-schema/warpPoints";
import {
  curvePoints,
  moveCurvePoint,
  removeCurvePoint,
  setCurvePoint,
} from "@studio/song-schema/yaml/curveFile";
import type { GraphFile } from "@studio/song-schema/yaml/graphSchema";
import {
  MASTER_MAX_DB,
  MASTER_MIN_DB,
} from "@studio/song-schema/yaml/projectSchema";
import {
  appendNotes,
  doubleSequence,
  isPlayableNote,
  mapNotesInRegion,
  moveNote,
  type NoteIn,
  type PadEffect,
  removeNote,
  setNoteEffect,
  setNoteTimeRange,
  setNoteVelocity,
  splitNote,
} from "@studio/song-schema/yaml/sequenceFile";
import { allSurfaceTypes } from "@studio/song-schema/yaml/surfaceRegistry";
import { isSurfaceType } from "@studio/song-schema/yaml/surfaceSchema";
import {
  consolidateAudioMaterial,
  splitAudioMaterial,
} from "@studio/take-render/materialRender";
import { freezeUpstreamRender } from "@studio/take-render/render";
import { wavSeconds } from "@studio/take-render/wavLength";
import {
  applyAlternative,
  cancelAlternative,
  commitAndPush,
  type GitEnv,
  newAlternative,
  pull,
  switchAlternative,
} from "./git";
// The verb groups that left this file; they import erased TYPES from here, so no runtime cycle — docs/verbs.md.
import { CONSOLE_VERBS } from "./verbs/console.ts";
import { ENGINE_VERBS } from "./verbs/engine.ts";
import { PICTURE_VERBS } from "./verbs/picture.ts";
import { PLAYLIST_VERBS } from "./verbs/playlist.ts";
import { splitWords } from "./verbs/shared.ts";
import { SYSTEM_VERBS } from "./verbs/system.ts";
import { TRACK_VERBS } from "./verbs/track.ts";

// Where a freeze render lands: one folder for the lot, at the project root — docs/verbs.md.
const FROZEN_DIR = "renders";

export type TransportAction = "play" | "stop" | "toggle" | "rewind" | "panic";

// The environment a feature acts on; `project()` is a getter so the CLI can lazy-load what a command may not need.
export interface CommandHost {
  songPath: string;
  project(): ProjectDoc;
  baseModules: string[]; // plugin module refs a module can extend (for completion)
  log(lines: string[]): void;
  /** Say NO, and why — a refusal is not an error, and the handler `return`s right after; docs/refusal.md. */
  refuse(lines: string[]): void;
  reload(): void | Promise<void>;
  // engine ops (may connect + await):
  transport(a: TransportAction): void | Promise<void>;
  // Toggle a track's arm — the engine owns this state, nothing is written to disk; undefined when it refused.
  arm(track: string): Promise<boolean | undefined>;
  applyProject(p: ProjectDoc): void | Promise<void>; // set + push to engine
  sendProject(p: ProjectDoc): void | Promise<void>;
  listPlugins(filter?: string): void | Promise<void>;
  rescanPlugins(force?: boolean): void | Promise<void>;
  showNativePluginUI(id: string): void | Promise<void>;
  getPlugins(filter?: string): Promise<PluginInfo[]>;
  // The audio interfaces the engine can see, for `module populate`; optional — docs/verbs.md.
  getAudioDevices?(): Promise<AudioDeviceInfo[]>;
  // `system channel type`: group two interface inputs into one stereo device, or take them apart; optional.
  setInputStereo?(channel: number, stereo: boolean): boolean;
  // A clip's source envelope — per-bucket peaks over the whole file, for `event trim`; optional.
  clipEnvelope?(
    clip: string,
  ): Promise<{ peak: number[]; seconds: number } | null>;
  /** Run ONE offline step over one file — the stem separator, today; handed in, docs/verbs.md. */
  runColdStep?: RunColdStep;
  /** What the bound engine's MACHINE separates on, read — or set, given a list — THERE; null with no machine. */
  onnxProviders?(set?: readonly string[]): Promise<string[] | null>;
  /** The chain this MACHINE separates with, as `system stems` wrote it; handed in, docs/verbs.md. */
  stemsChain?: string;
  /** …and the one it makes an instrumental with, as `system instrumental` wrote it. */
  instrumentalChain?: string;
  // Transport config for git, merged over the env: the web host pins GIT_SSH_COMMAND to the deploy key.
  gitEnv?: GitEnv;
  // Where the whole-repo git commands run — the workspace ROOT on the web, since a workspace is one cloned repo.
  repoDir?: string;
  /** Bring the account's libraries to their latest — the FILE SERVICE keeps them, so it is handed in; docs/verbs.md. */
  updateLibraries?(): Promise<
    {
      name: string;
      state: "cloned" | "updated" | "current" | "kept" | "failed";
      note: string;
    }[]
  >;
  // Back up a file the command is about to overwrite, so undo can restore it — docs/verbs.md.
  snapshot?(absPath: string): void;
  /** Send one recorder take to the médiathèque. Handed in, because the bytes are on the ENGINE's
   *  machine and only the file service is there — packages/song/docs/recorderNode.md. */
  saveTake?(file: string, label?: string): Promise<string>;
}

export type SidHandler = (
  args: string,
  host: CommandHost,
) => void | Promise<void>;

// --- helpers reused by handlers + completion providers -----------------------

export interface Sequence {
  name: string;
  trackId: string;
  clipId: string;
  clip: ClipDoc;
}

export function collectSequences(project: ProjectDoc): Sequence[] {
  const out: Sequence[] = [];
  for (const t of project.tracks)
    for (const c of t.clips)
      if (c.type === "midi")
        out.push({
          name: c.name || c.id || `${t.id}:seq`,
          trackId: t.id,
          clipId: c.id,
          clip: c,
        });
  return out;
}

// A note as a name ("C4", "F#3") or a MIDI number, 60 == C4; null on anything unparseable or outside 0..127.
export function parseMidiNote(s: string): number | null {
  const t = s.trim();
  if (/^\d+$/.test(t)) {
    const k = Number(t);
    return k >= 0 && k <= 127 ? k : null;
  }
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(t);
  if (!m) return null;
  const pc: Record<string, number> = {
    c: 0,
    d: 2,
    e: 4,
    f: 5,
    g: 7,
    a: 9,
    b: 11,
  };
  let k = (Number(m[3]) + 1) * 12 + pc[m[1].toLowerCase()];
  if (m[2] === "#") k += 1;
  else if (m[2] === "b") k -= 1;
  return k >= 0 && k <= 127 ? k : null;
}

// A beat value for a note struct, 6 decimals max, mirroring the tracker so drags don't churn the file.
const fmtBeat = (v: number) => String(Math.round(v * 1e6) / 1e6);

/** The first argument off a command line, JSON-quoted or bare, and the rest behind it. The inverse
 *  of the `JSON.stringify` a caller wraps a PATH in — the one spelling a Windows backslash and a
 *  space both survive, where stripping the quotes would leave `C:\\Users`. See docs/verbs.md. */
function firstArg(a: string): { head: string; rest: string } | null {
  const quoted = /^"(?:[^"\\]|\\.)*"/.exec(a);
  if (quoted) {
    try {
      return {
        head: JSON.parse(quoted[0]) as string,
        rest: a.slice(quoted[0].length).trim(),
      };
    } catch {
      return null;
    }
  }
  const bare = /^\S+/.exec(a);
  return bare ? { head: bare[0], rest: a.slice(bare[0].length).trim() } : null;
}

// Rewrite the project's `markers` map with QUOTED keys — unquoted, `2:1:1` is a YAML 1.1 integer; docs/verbs.md.
function writeMarkers(songPath: string, map: Record<string, string>): void {
  setQuotedKeyMap(join(songPath, "project.yaml"), ["markers"], map);
}

// Flip the persisted metronome flag in settings.yaml, the source of truth — so the caller re-sends.
function writeMetronomeSetting(songPath: string, on: boolean): void {
  setFileValue(join(songPath, "settings.yaml"), ["metronome"], on);
}

// …and its LEVEL, kept apart from the flag so turning the click off and back on brings the level back.
function writeMetronomeLevel(songPath: string, level: number): void {
  setFileValue(join(songPath, "settings.yaml"), ["metronome_level"], level);
}

/** The pair the graph DRAWS whether or not graph.yaml states it: a sum straight to its device — packages/song/docs/masterChain.md. */
/** Does this name a node of THIS graph? The five built-in outputs count — they simply have no folder. */
function namesANode(g: ReturnType<typeof loadGraph>, name: string): boolean {
  return (
    isBuiltinOutput(name) ||
    name in g.modules ||
    name in g.moduleRefs ||
    name in g.tracks ||
    // A PICTURE lane is a card too, and `videoTracks` is its own key (packages/song/docs/camera.md).
    name in g.videoTracks
  );
}

/** The names there ARE, for a refusal that can be acted on — one sentence, so the verbs cannot list different sets. */
function knownNodes(g: ReturnType<typeof loadGraph>): string {
  const parts = [`modules: ${Object.keys(g.modules).join(", ") || "none"}`];
  const lanes = Object.keys(g.videoTracks);
  if (lanes.length) parts.push(`picture lanes: ${lanes.join(", ")}`);
  const boxes = Object.keys(g.assemblies);
  if (boxes.length) parts.push(`assemblies: ${boxes.join(", ")}`);
  return parts.join("; ");
}

const isMasterRun = (before: string, after: string): boolean =>
  (before === MIX_NODE && after === OUT_NODE) ||
  (before === RENDER_NODE && after === VIDEO_OUT_NODE);

/** How `before → after` stands in graph.yaml: an arrow, a line to WRITE first, or why it is neither. */
function arrowState(
  songPath: string,
  before: string,
  after: string,
): { ok: true; write: boolean } | { ok: false; error: string } {
  // Read off the SEGMENTS, not the chains — those are derived by following exactly these arrows.
  const file = loadChains(songPath, loadProjectRoot(songPath, true), true) as
    | GraphFile
    | undefined;
  const dests = file?.modules?.[before];
  // A sum feeding nothing yet: the wire to its device is on screen, so it is a wire to splice into.
  if (!dests?.length && isMasterRun(before, after))
    return { ok: true, write: true };
  if (!dests)
    return {
      ok: false,
      error: `no node "${before}" in graph.yaml (nodes: ${
        Object.keys(file?.modules ?? {}).join(", ") || "none"
      })`,
    };
  if (!dests.includes(after))
    return {
      ok: false,
      error: `'${before}' does not feed '${after}' (it feeds: ${dests.join(", ") || "nothing"})`,
    };
  return { ok: true, write: false };
}

/** Does the signal ARRIVING at `node` come off a live interface input? Walks UPSTREAM — docs/verbs.md. */
function runCarriesInput(
  g: ReturnType<typeof loadGraph>,
  node: string,
): boolean {
  const bare = (s: string) => s.split("#")[0];
  const isLive = (name: string): boolean => {
    const b = g.modules[name];
    return !!b && isInputModule(g, b);
  };
  // Who feeds whom: a chain is a linear run, and its `out` is how one chain reaches another.
  const feeders = new Map<string, string[]>();
  const link = (from: string, to: string): void => {
    const at = feeders.get(bare(to));
    if (at) at.push(bare(from));
    else feeders.set(bare(to), [bare(from)]);
  };
  for (const c of Object.values(g.chains)) {
    const run = [...(c.from ? [c.from] : []), ...c.use.map((s) => s.module)];
    for (let i = 1; i < run.length; i++) link(run[i - 1], run[i]);
    const last = run[run.length - 1];
    if (last) for (const o of c.out) link(last, o.to);
  }
  // …then back up from `node`, itself included; `seen` is not an optimisation, a graph may hold a cycle.
  const seen = new Set<string>();
  const stack = [bare(node)];
  while (stack.length) {
    const n = stack.pop() as string;
    if (seen.has(n)) continue;
    seen.add(n);
    if (isLive(n)) return true;
    for (const f of feeders.get(n) ?? []) stack.push(f);
  }
  return false;
}

/** An optional trailing `<x>,<y>` — where the cursor was, so a created node is BORN there; docs/verbs.md. */
function takeSpawnAt(parts: string[]): { x: number; y: number } | null {
  const last = parts[parts.length - 1];
  const m = last ? /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(last) : null;
  if (!m) return null;
  parts.pop();
  return { x: Number(m[1]), y: Number(m[2]) };
}

/** Where a node WIRED TO NOTHING is born when no cursor said: above the origin, clear of the first lane; docs/verbs.md. */
const ORPHAN_AT = { x: 0, y: -30 };

/** …and where a SPLICED one is: halfway between the two ends, which is where its cable ran; null when either is unpinned. */
function midOfArrow(
  positions: Record<string, { x: number; y: number }> | undefined,
  before: string,
  after: string,
): { x: number; y: number } | null {
  const a = positions?.[before.split("#")[0]];
  const b = positions?.[after.split("#")[0]];
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// `playlistFile` lives in verbs/shared.ts, so the split-out verb files import no cycle — docs/verbs.md.

/** Where a `module new`/`node new` target's OWN files would live — the workspace for a real
 *  project, or the folder itself for a template being edited with `at` (no project.yaml). */
function localModuleFolder(
  songPath: string,
  category: string,
  name: string,
): string {
  return isProjectFolder(songPath)
    ? resolve(songPath, SHARED_MODULES_PATH, category, name)
    : join(songPath, "modules", category, name);
}

/** What a module already on disk extends, or "" — read from its own file, not through the loaders. */
function existingExtends(
  songPath: string,
  category: string,
  name: string,
): string {
  const folder = localModuleFolder(songPath, category, name);
  const file = moduleFileFor(folder, `${category}/${name}`, "module");
  if (!file) return "";
  try {
    const ext = readModuleFile(file).value?.extends;
    return typeof ext === "string" ? ext : "";
  } catch {
    return ""; // unreadable: the caller's other checks still apply, and instancing is harmless
  }
}

/** Create the module a `+` picked and hand back its name, or the message to show instead — docs/verbs.md. */
function makeModule(
  songPath: string,
  target: string,
  extendsRef?: string,
): { ref: string; rel: string | null } | { error: string } {
  const segs = target.split("/");
  if (segs.length !== 2 || !segs[0] || !segs[1])
    return { error: `'${target}' is not <category>/<name>` };
  const [category, name] = segs;
  const exists = existsSync(localModuleFolder(songPath, category, name));
  // The picker names a local module by its OWN ref: that is "use it", not "make it inherit itself".
  const own = `${isProjectFolder(songPath) ? "@workspace" : "@project"}/${category}/${name}`;
  if (exists && extendsRef === own) return { ref: name, rel: null };
  // Already there AND told to inherit something else is a real disagreement: a module cannot be re-parented.
  if (exists && extendsRef) {
    const inherits = existingExtends(songPath, category, name);
    if (inherits && inherits !== extendsRef)
      return {
        error: `module '${name}' extends '${inherits}', not '${extendsRef}' — drop the extends-ref to use it as it is`,
      };
  }
  try {
    const rel = exists
      ? null
      : createModuleFile(songPath, category, name, extendsRef);
    return { ref: name, rel };
  } catch (e) {
    return { error: `${(e as Error).message} — nothing was changed` };
  }
}

// The project's plugin instances by module name: an id is "<chain>:<module>", so take the part after the ':'.
export interface PluginModule {
  module: string;
  id: string;
  type: string;
  track: string;
}
export function collectPluginModules(project: ProjectDoc): PluginModule[] {
  const out: PluginModule[] = [];
  for (const t of project.tracks)
    for (const p of t.plugins) {
      const i = p.id.indexOf(":");
      out.push({
        module: i >= 0 ? p.id.slice(i + 1) : p.id,
        id: p.id,
        type: p.type,
        track: t.id,
      });
    }
  return out;
}

// An argument line as words, defined in `verbs/shared.ts` — imported AND re-exported, docs/verbs.md.
export { splitWords };

function uniqueId(base: string, project: ProjectDoc): string {
  const ids = new Set(project.tracks.map((t) => t.id));
  let n = 1;
  while (ids.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** The track + the event sitting at `atTc`, or null with the reason already logged; the three `event` commands share it. */
function resolveEvent(
  h: CommandHost,
  trackArg: string,
  atTc: string,
): {
  track: ProjectDoc["tracks"][number];
  atBeats: number;
  hit: ProjectDoc["tracks"][number]["clips"][number];
  num: number;
  den: number;
  tempo: number; // a resize converts beats into the seconds a clip's window is written in
} | null {
  const p = h.project();
  const track = p.tracks.find((t) => t.id === trackArg || t.name === trackArg);
  if (!track) {
    h.refuse([
      `no track "${trackArg}"${p.tracks.length ? ` — try: ${p.tracks.map((t) => t.id).join(", ")}` : ""}`,
    ]);
    return null;
  }
  const num = p.timeSigNumerator;
  const den = p.timeSigDenominator;
  let atBeats: number;
  try {
    atBeats = parsePosition(atTc, num, den);
  } catch (e) {
    h.refuse([`bad timecode: ${(e as Error).message}`]);
    return null;
  }
  const hit = track.clips.find((c) => Math.abs(c.start - atBeats) < 1e-6);
  if (!hit) {
    h.refuse([`no event on '${track.id}' at ${atTc}`]);
    return null;
  }
  return { track, atBeats, hit, num, den, tempo: p.tempo };
}

// `track new [name]`, falling back to the next free track-N; a lane has no kind — docs/verbs.md.
async function newTrack(arg: string, h: CommandHost): Promise<void> {
  const name = arg.trim().split(/\s+/)[0] ?? "";
  const id = name || uniqueId("track", h.project());
  try {
    const written = createTrackFile(h.songPath, id);
    // …and its STRIP, which a lane with nowhere to wire one is SAID to lack rather than refused for.
    let strip: string[] = [];
    let noStrip = "";
    try {
      strip = addTrackMixer(h.songPath, id, loadGraph(h.songPath)) ?? [];
    } catch (e) {
      noStrip = (e as Error).message;
    }
    h.reload(); // the doc now comes from disk, so the mixer and the engine agree with it
    h.log([
      `+ track ${id} (${[...written, ...strip].join(", ")})`,
      ...(noStrip ? [`no strip: ${noStrip}`] : []),
    ]);
  } catch (e) {
    h.refuse([`track new: ${(e as Error).message}`]);
  }
}

// `track order <track> <where>` — states the WHOLE order, since half of one is not an order; docs/verbs.md.
async function orderTrack(arg: string, h: CommandHost): Promise<void> {
  const [trackArg, whereArg] = splitWords(arg);
  if (!trackArg || !whereArg) {
    h.refuse([
      "usage: track order <track> <position|lane>  (e.g. track order gtr 2, or track order gtr vo.main)",
    ]);
    return;
  }
  const p = h.project();
  // A lane wired on two ports compiles to two engine tracks; the ORDER is the lane's, so both move together.
  const laneOf = (id: string): string => splitPort(id).node;
  const lanes = [...new Set(p.tracks.map((t) => laneOf(t.id)))];
  const named = (a: string): string | null => {
    const hit = p.tracks.find((t) => t.id === a || t.name === a);
    return hit ? laneOf(hit.id) : lanes.includes(a) ? a : null;
  };
  const lane = named(trackArg);
  if (!lane) {
    h.refuse([
      `no track "${trackArg}"${lanes.length ? ` — try: ${lanes.join(", ")}` : ""}`,
    ]);
    return;
  }
  const pos = orderPosition(lanes, named(whereArg) ?? whereArg);
  if (pos === null) {
    h.refuse([
      `'${whereArg}' is neither a position nor a lane of this song — try a number 1..${lanes.length}`,
    ]);
    return;
  }
  try {
    const file = setLaneOrder(
      h.songPath,
      "trackOrder",
      reorderTracks(lanes, lane, pos),
    );
    h.log([
      `${lane} is now lane ${Math.min(Math.max(pos, 1), lanes.length)} of ${lanes.length} (${file})`,
    ]);
  } catch (e) {
    h.refuse([`track order: ${(e as Error).message}`]);
    return;
  }
  await h.reload();
}

/** `sequence note repeat|skip <sequence> <note> <start> <n|off>` — a PAD's two effects, one factory; docs/verbs.md. */
function padEffectCommand(effect: PadEffect): SidHandler {
  return async (arg, h) => {
    const [seqId, noteStr, startStr, nStr] = arg.trim().split(/\s+/);
    if (!seqId || !noteStr || startStr === undefined || nStr === undefined) {
      h.refuse([
        `usage: sequence note ${effect} <sequence> <note> <start> <n|off>`,
      ]);
      return;
    }
    const k = parseMidiNote(noteStr);
    if (k === null) {
      h.refuse([
        `bad note "${noteStr}" — use a name (C4, F#3) or a number 0..127`,
      ]);
      return;
    }
    const t = Number(startStr);
    if (!Number.isFinite(t)) {
      h.refuse(["start must be a number of beats"]);
      return;
    }
    const off = nStr === "off";
    const n = off ? undefined : Number(nStr);
    if (n !== undefined && (!Number.isInteger(n) || n < 2)) {
      h.refuse([
        `${effect} takes a whole number of 2 or more, or "off" — not "${nStr}"`,
      ]);
      return;
    }
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      h.refuse([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    try {
      writeFileSync(file, setNoteEffect(text, k, t, effect, n), "utf8");
    } catch (e) {
      h.refuse([`sequence note ${effect}: ${(e as Error).message}`]);
      return;
    }
    const said = off
      ? `${effect} off`
      : effect === "repeat"
        ? `repeated ×${n}`
        : `silent every ${n} passes`;
    h.log([`${seqId}: ${noteStr} (k${k}) at ${fmtBeat(t)} → ${said}`]);
    await h.reload();
  };
}

/**
 * The four `sequence notes …` verbs: one RECTANGLE, one document pass, one journal entry — which
 * is why they exist beside the eight that address a single note. All five arguments are parsed
 * here and only the EDIT is each verb's own. See @studio/song-schema docs/noteEdits.md.
 */
function regionCommand(
  verb: string,
  /** The trailing argument, or undefined for a verb that wants none (`remove`). */
  value: { name: string; check: (v: number) => string | null } | undefined,
  edit: (v: number) => (n: NoteIn) => NoteIn | null,
): SidHandler {
  const usage = `usage: sequence notes ${verb} <sequence> <loNote> <hiNote> <from> <to>${value ? ` <${value.name}>` : ""}`;
  return async (arg, h) => {
    const [seqId, loStr, hiStr, fromStr, toStr, vStr] = arg.trim().split(/\s+/);
    if (
      !seqId ||
      !loStr ||
      !hiStr ||
      fromStr === undefined ||
      toStr === undefined ||
      (value && vStr === undefined)
    ) {
      h.refuse([usage]);
      return;
    }
    const lo = parseMidiNote(loStr);
    const hi = parseMidiNote(hiStr);
    if (lo === null || hi === null) {
      h.refuse([
        `bad note in "${loStr} ${hiStr}" — use a name (C4, F#3) or a number 0..127`,
      ]);
      return;
    }
    const from = Number(fromStr);
    const to = Number(toStr);
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      h.refuse(["from/to must be numbers (beats)"]);
      return;
    }
    const v = value ? Number(vStr) : 0;
    if (value) {
      if (!Number.isFinite(v)) {
        h.refuse([`${value.name} must be a number`]);
        return;
      }
      const bad = value.check(v);
      if (bad) {
        h.refuse([bad]);
        return;
      }
    }
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      h.refuse([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    let out: { text: string; changed: number };
    try {
      out = mapNotesInRegion(
        text,
        { loKey: Math.min(lo, hi), hiKey: Math.max(lo, hi), from, to },
        edit(v),
      );
    } catch (e) {
      h.refuse([`sequence notes ${verb}: ${(e as Error).message}`]);
      return;
    }
    // An empty rectangle is REFUSED by name, like every other note edit: silence would read as success.
    if (!out.changed) {
      h.refuse([
        `no note between ${loStr} and ${hiStr} from beat ${from} to ${to}`,
      ]);
      return;
    }
    writeFileSync(file, out.text, "utf8");
    h.log([`${seqId}: ${out.changed} note(s) ${verb}d`]);
    await h.reload();
  };
}

// `sequence new [name]` — four empty bars to write into. Place it on a lane with `event new`.
async function newSequence(arg: string, h: CommandHost): Promise<void> {
  const name = arg.trim().split(/\s+/)[0] ?? "";
  const id = name || uniqueId("seq", h.project());
  try {
    const written = createSequenceFile(h.songPath, id);
    h.reload();
    h.log([`+ sequence ${id} (${written.join(", ")})`]);
  } catch (e) {
    h.refuse([`sequence new: ${(e as Error).message}`]);
  }
}

// What a mute/solo can address; a group is a lane too, silenced the same way in `graph.yaml`'s `bypassed:`.
type MixTarget = Pick<TrackDoc, "id" | "name" | "mute">;

/** Silence (or un-silence) a set of lanes and push the result — a lane's mute IS its module's bypass; docs/verbs.md. */
async function setLaneBypass(
  h: CommandHost,
  want: Map<string, boolean>,
  line: string,
): Promise<void> {
  const p = h.project();
  for (const [id, bypassed] of want) setModuleBypass(h.songPath, id, bypassed);
  await h.applyProject({
    ...p,
    tracks: p.tracks.map((x) =>
      want.has(x.id) ? { ...x, mute: want.get(x.id) as boolean } : x,
    ),
    groups: p.groups.map((x) =>
      want.has(x.id) ? { ...x, mute: want.get(x.id) as boolean } : x,
    ),
  });
  h.log([line]);
}

// --- a module's alternatives: read off the module's own FILE, not the compiled doc; docs/verbs.md

/** `node alternative create|copy` — one shape, one difference. */
async function moduleAltAdd(
  a: string,
  h: CommandHost,
  copy: boolean,
): Promise<void> {
  const verb = copy ? "copy" : "create";
  const [module, name] = a.trim().split(/\s+/).filter(Boolean);
  if (!module) {
    h.refuse([`usage: node alternative ${verb} <node> [name]`]);
    return;
  }
  try {
    const made = newModuleAlternative(h.songPath, module, name, { copy });
    h.log([
      `${module}: alternative '${made.name}' — ${copy ? "a copy of the one that was on" : "empty, and running"}`,
    ]);
    await h.reload();
  } catch (e) {
    h.refuse([`node alternative ${verb}: ${(e as Error).message}`]);
  }
}

/** Resolve a `track mute`/`track solo` argument to a lane or a group, or report why not. */
function mixTarget(a: string, h: CommandHost, verb: string): MixTarget | null {
  const id = a.trim().split(/\s+/).filter(Boolean)[0];
  if (!id) {
    h.refuse([`usage: ${verb} <track|group>`]);
    return null;
  }
  const p = h.project();
  const matches = (x: { id: string; name: string }) =>
    x.id === id || x.name === id;
  const target = p.tracks.find(matches) ?? p.groups.find(matches);
  if (!target) {
    h.refuse([`no track "${id}"`]);
    return null;
  }
  return target;
}

// --- the channel strip -------------------------------------------------------

/** `event fadein|fadeout <track> <timecode> <length>` — a POSITION then a DURATION, 0 removes; docs/verbs.md. */
async function fadeCommand(
  a: string,
  h: CommandHost,
  which: "fadeIn" | "fadeOut",
): Promise<void> {
  const verb = which === "fadeIn" ? "event fadein" : "event fadeout";
  const parts = splitWords(a);
  if (parts.length !== 3) {
    h.refuse([
      `usage: ${verb} <track> <timecode> <length>`,
      `       (e.g. ${verb} gtr 2:1:1 0:1 — a length, not a position; 0 removes it)`,
    ]);
    return;
  }
  const [trackArg, atTc, lenTc] = parts;
  const found = resolveEvent(h, trackArg, atTc);
  if (!found) return;
  const { track, atBeats, hit, num, den } = found;
  let beats: number;
  try {
    beats = parseDuration(lenTc, num, den);
  } catch (e) {
    h.refuse([`bad length: ${(e as Error).message}`]);
    return;
  }
  if (beats < 0) {
    h.refuse([`a fade cannot be negative — got ${lenTc}`]);
    return;
  }
  try {
    const done = setTrackPlacementFade(
      h.songPath,
      track.id,
      atBeats,
      num,
      den,
      which,
      beats,
    );
    if (!done) {
      h.refuse([`no event on '${track.id}' at ${atTc}`]);
      return;
    }
    h.log([
      beats > 0
        ? `${track.id}: ${hit.name || hit.id} at ${atTc} ${which === "fadeIn" ? "fades in" : "fades out"} over ${lenTc}`
        : `${track.id}: ${hit.name || hit.id} at ${atTc} no longer ${which === "fadeIn" ? "fades in" : "fades out"}`,
    ]);
    await h.reload();
  } catch (e) {
    h.refuse([`${verb} failed: ${(e as Error).message}`]);
  }
}

/** `event window <track> <at> <from> <to>` — which slice one event plays, in SECONDS of the file; docs/verbs.md. */
async function windowCommand(a: string, h: CommandHost): Promise<void> {
  const parts = splitWords(a);
  if (parts.length !== 4) {
    h.refuse([
      "usage: event window <track> <timecode> <from> <to>",
      "       (from/to in SECONDS of the file, e.g. event window vox 24:1 52.36 69.82)",
    ]);
    return;
  }
  const [trackArg, atTc, fromArg, toArg] = parts;
  const found = resolveEvent(h, trackArg, atTc);
  if (!found) return;
  const { track, atBeats, hit, num, den } = found;
  const from = Number(fromArg);
  const to = Number(toArg);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0) {
    h.refuse([
      `'${fromArg} ${toArg}' is not a window in seconds — two numbers, the first not negative`,
    ]);
    return;
  }
  if (!(to > from)) {
    h.refuse([
      `a window has to run forwards — got ${fromArg} to ${toArg}`,
      "nothing was changed: a window of zero length would play nothing at all",
    ]);
    return;
  }
  try {
    const done = setTrackPlacementWindow(
      h.songPath,
      track.id,
      atBeats,
      num,
      den,
      { from, to },
      // The source's own length, so an edge landing on the file's end is cleared rather than written.
      hit.source ? (wavSeconds(hit.source) ?? 0) : 0,
    );
    if (!done) {
      h.refuse([`no event on '${track.id}' at ${atTc}`]);
      return;
    }
    h.log([
      `${track.id}: ${hit.name || hit.id} at ${atTc} plays ${from.toFixed(3)}s → ${to.toFixed(3)}s of its file`,
    ]);
    await h.reload();
  } catch (e) {
    h.refuse([`event window failed: ${(e as Error).message}`]);
  }
}

/** `track automation add|remove <track> <param>` — a VIEW onto `node automate`; the param is everything after the track. */
async function trackAutomationCommand(
  a: string,
  h: CommandHost,
  mode: "add" | "remove",
): Promise<void> {
  const verb = `track automation ${mode}`;
  const parts = splitWords(a);
  if (parts.length < 2) {
    h.refuse([
      `usage: ${verb} <track> <param>`,
      `       (e.g. ${verb} gtr Filter Freq — the param is everything after the track)`,
    ]);
    return;
  }
  const p = h.project();
  const trackArg = parts[0];
  const param = parts.slice(1).join(" ");
  const track = p.tracks.find((t) => t.id === trackArg || t.name === trackArg);
  if (!track) {
    h.refuse([
      `no track "${trackArg}"${p.tracks.length ? ` — try: ${p.tracks.map((t) => t.id).join(", ")}` : ""}`,
    ]);
    return;
  }

  // Which module on this lane's chain declares that param; the compiled plugins carry the track they landed on.
  const owning = track.plugins.filter((pl) =>
    (builtinParamsFor(pl) ?? []).some((b) => b.name === param),
  );
  if (!owning.length) {
    const known = [
      ...new Set(
        track.plugins.flatMap((pl) =>
          (builtinParamsFor(pl) ?? []).map((b) => b.name),
        ),
      ),
    ].sort();
    h.refuse([
      `no parameter '${param}' on '${track.id}'`,
      known.length
        ? `  it has: ${known.join(", ")}`
        : `  '${track.id}' runs through no module with parameters`,
    ]);
    return;
  }
  if (owning.length > 1) {
    // Two knobs of one name on one chain is a real shape and there is no defensible way to pick — docs/verbs.md.
    const names = owning.map((pl) => moduleOfPluginId(pl.id));
    h.refuse([
      `'${param}' is on ${owning.length} modules of '${track.id}' (${names.join(", ")}) — say which:`,
      `  node automate ${names[0]} ${param} <curve>`,
    ]);
    return;
  }
  const plugin = owning[0];
  const module = moduleOfPluginId(plugin.id);

  try {
    if (mode === "remove") {
      const path = setModuleAutomationBinding(h.songPath, module, param, null);
      await h.reload();
      // The curve FILE stays, and the log is the LAST statement — docs/verbs.md, docs/refusal.md.
      h.log([`${track.id}: ${param} is no longer automated (${path})`]);
    } else {
      await addTrackAutomation(h, track, module, plugin, param);
    }
  } catch (e) {
    h.refuse([`${verb}: ${(e as Error).message}`]);
  }
}

/** The `add` half: create a flat curve where the knob already sits, and bind it — docs/verbs.md. */
async function addTrackAutomation(
  h: CommandHost,
  track: ProjectDoc["tracks"][number],
  module: string,
  plugin: ProjectDoc["tracks"][number]["plugins"][number],
  param: string,
): Promise<void> {
  const p = h.project();
  const meta = (builtinParamsFor(plugin) ?? []).find((b) => b.name === param);
  // Where the knob sits NOW, normalised — a flat curve at the wrong height is an audible jump, so refuse.
  const cur = plugin.params?.[param] ?? meta?.def;
  if (!meta || cur === undefined || !(meta.max > meta.min)) {
    h.refuse([
      `can't tell where '${param}' currently sits, so a flat curve would move it`,
      `  set it once (node param ${module} ${param} <value>), or bind a curve yourself:`,
      `  curve new <name> && node automate ${module} ${param} <name>`,
    ]);
    return;
  }
  const value = (cur - meta.min) / (meta.max - meta.min);
  const id = curveIdFor(track.id, param);
  // The song's end, so the flat line has both ends to grab; a song with no material yet gets one bar.
  const last = Math.max(
    ...p.tracks.flatMap((t) => t.clips.map((c) => c.start + c.length)),
    p.timeSigNumerator,
  );
  const rel = createFlatCurveFile(
    h.songPath,
    id,
    value,
    beatsToPosition(last, p.timeSigNumerator, p.timeSigDenominator),
  );
  const path = setModuleAutomationBinding(
    h.songPath,
    module,
    param,
    curveRef(id),
  );
  await h.reload();
  h.log([
    `${track.id}: ${param} <- ${id} (${rel}), flat at ${Math.round(value * 100)}% (${path})`,
  ]);
}

/** `curve point add|move|remove <curve> …` — addressed by TIME, `value` is 0..1 of the CURVE; docs/verbs.md. */
async function curvePointCommand(
  a: string,
  h: CommandHost,
  mode: "add" | "move" | "remove",
): Promise<void> {
  const verb = `curve point ${mode}`;
  const parts = splitWords(a);
  const want = mode === "remove" ? 2 : 3;
  if (parts.length < want) {
    h.refuse([
      mode === "add"
        ? `usage: ${verb} <curve> <time> <value>   (value 0..1)`
        : mode === "move"
          ? `usage: ${verb} <curve> <time> <newTime> [value]`
          : `usage: ${verb} <curve> <time>`,
    ]);
    return;
  }
  const p = h.project();
  const num = p.timeSigNumerator;
  const den = p.timeSigDenominator;
  const [id, atTc] = parts;
  let atBeats: number;
  try {
    atBeats = parsePosition(atTc, num, den);
  } catch (e) {
    h.refuse([`bad timecode: ${(e as Error).message}`]);
    return;
  }
  const unit = (raw: string | undefined): number | undefined => {
    if (raw === undefined) return undefined;
    const v = Number(raw);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined;
  };
  try {
    const file = join(h.songPath, "curves", `${id}.yaml`);
    const points = curvePoints(readFileSync(file, "utf8"), num, den);
    if (mode === "add") {
      const v = unit(parts[2]);
      if (v === undefined) {
        h.refuse([`'${parts[2]}' is not a value between 0 and 1`]);
        return;
      }
      const had = points.some((pt) => Math.abs(pt.beat - atBeats) < 1e-6);
      const rel = editCurveFile(h.songPath, id, (t) =>
        setCurvePoint(t, atBeats, v, num, den),
      );
      await h.reload();
      h.log([
        `${id}: ${had ? "set the point" : "added a point"} at ${atTc} to ${v} (${rel})`,
      ]);
    } else if (mode === "move") {
      let toBeats: number;
      try {
        toBeats = parsePosition(parts[2], num, den);
      } catch (e) {
        h.refuse([`bad timecode: ${(e as Error).message}`]);
        return;
      }
      const rel = editCurveFile(h.songPath, id, (t) =>
        moveCurvePoint(t, atBeats, toBeats, unit(parts[3]), num, den),
      );
      await h.reload();
      h.log([`${id}: the point at ${atTc} is now at ${parts[2]} (${rel})`]);
    } else {
      // The LAST point is not removable: a curve file with none does not load — docs/verbs.md.
      if (points.length <= 1) {
        h.refuse([
          `'${id}' has one point left, and a curve with none does not load`,
          `  to stop automating, use: track automation remove <track> <param>`,
        ]);
        return;
      }
      const rel = editCurveFile(h.songPath, id, (t) =>
        removeCurvePoint(t, atBeats, num, den),
      );
      await h.reload();
      h.log([`${id}: removed the point at ${atTc} (${rel})`]);
    }
  } catch (e) {
    h.refuse([`${verb}: ${(e as Error).message}`]);
  }
}

/** `project add|remove <at> <length>` — a POSITION then a DURATION; docs/verbs.md, packages/song/docs/insertTime.md. */
async function projectTimeCommand(
  a: string,
  h: CommandHost,
  mode: "insert" | "delete",
): Promise<void> {
  const verb = mode === "insert" ? "project add" : "project remove";
  const parts = splitWords(a);
  if (parts.length !== 2) {
    h.refuse([
      `usage: ${verb} <at> <length>`,
      `       (e.g. ${verb} 5:1:1 1:0 — a position, then a LENGTH)`,
    ]);
    return;
  }
  const p = h.project();
  const num = p.timeSigNumerator;
  const den = p.timeSigDenominator;
  let atBeats: number;
  let lenBeats: number;
  try {
    atBeats = parsePosition(parts[0], num, den);
    lenBeats = parseDuration(parts[1], num, den);
  } catch (e) {
    h.refuse([`bad timecode: ${(e as Error).message}`]);
    return;
  }
  if (!(lenBeats > 0)) {
    h.refuse([`a length of ${parts[1]} moves nothing`]);
    return;
  }
  // Nothing may be pushed before the song's start — the same guard `events move` carries.
  if (mode === "delete" && atBeats < 0) {
    h.refuse(["can't remove time from before the song starts"]);
    return;
  }
  try {
    const r = spliceProjectTime(h.songPath, atBeats, lenBeats, mode);
    if (!r.files.length) {
      h.refuse([
        `nothing at or after ${parts[0]} to ${mode === "insert" ? "push" : "pull"} — the project is unchanged`,
      ]);
      return;
    }
    await h.reload();
    h.log([
      `${mode === "insert" ? "inserted" : "removed"} ${parts[1]} at ${parts[0]}: ` +
        `${r.moved} moved${r.removed ? `, ${r.removed} removed` : ""} across ${r.files.length} file${r.files.length === 1 ? "" : "s"}`,
    ]);
  } catch (e) {
    h.refuse([`${verb}: ${(e as Error).message}`]);
  }
}

/** The module half of a `chain:module` plugin id — the name a chains file and `node automate` use. */
const moduleOfPluginId = (id: string): string => id.slice(id.indexOf(":") + 1);

/** A curve id from a lane and a param. Both may hold characters a filename and a ref may not. */
const curveIdFor = (track: string, param: string): string =>
  `${track}-${param}`.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "");

/** `event status mute|warp <track> <timecode> [on|off|toggle]` — `on` means the NAMED STATE is on; docs/verbs.md. */
async function statusCommand(
  a: string,
  h: CommandHost,
  aspect: "mute" | "warp",
): Promise<void> {
  const verb = `event status ${aspect}`;
  const m = /^(\S+)\s+(\S+)(?:\s+(\S+))?$/.exec(a.trim());
  if (!m) {
    h.refuse([`usage: ${verb} <track> <timecode> [on|off|toggle]`]);
    return;
  }
  const [, trackArg, atTc, stateArg] = m;
  const found = resolveEvent(h, trackArg, atTc);
  if (!found) return;
  const { track, atBeats, hit, num, den } = found;
  const state = (stateArg ?? "toggle").toLowerCase();
  if (!["on", "off", "toggle"].includes(state)) {
    h.refuse([`'${stateArg}' is not on, off or toggle`]);
    return;
  }
  // The NAMED STATE as it stands; `warpOff` is the FILE's negative spelling, turned here once — docs/verbs.md.
  const now = aspect === "mute" ? !!hit.disabled : hit.warpOff !== true;
  const next = state === "toggle" ? !now : state === "on";
  try {
    // Both writers take the state under its own name, so `next` goes to each unchanged.
    const done =
      aspect === "mute"
        ? setTrackPlacementDisabled(
            h.songPath,
            track.id,
            atBeats,
            num,
            den,
            next,
          )
        : setTrackPlacementWarp(h.songPath, track.id, atBeats, num, den, next);
    if (!done) return h.refuse([`no event on '${track.id}' at ${atTc}`]);
    const said =
      aspect === "mute"
        ? next
          ? "muted"
          : "unmuted"
        : next
          ? "warped — follows the clip's map"
          : "unwarped — plays at its own rate";
    h.log([`${track.id}: ${hit.name || hit.id} at ${atTc} ${said}`]);
    await h.reload();
  } catch (e) {
    h.refuse([`${verb} failed: ${(e as Error).message}`]);
  }
}

/** `clip onset add|remove|move <clip> <sec…>` — a correction to the detected onsets, in FILE seconds. */
async function onsetCommand(
  arg: string,
  h: CommandHost,
  op: "add" | "remove" | "move",
): Promise<void> {
  const parts = arg.trim().split(/\s+/).filter(Boolean);
  const [clip, ...times] = parts;
  const want = op === "move" ? 2 : 1;
  const secs = times.slice(0, want).map(Number);
  if (!clip || secs.length < want || secs.some((s) => !Number.isFinite(s))) {
    h.refuse([
      op === "move"
        ? "usage: clip onset move <clip> <from-sec> <to-sec>"
        : `usage: clip onset ${op} <clip> <sec>`,
    ]);
    return;
  }
  const before = clipOnsets(h.songPath, clip);
  // The DETECTED set is not read here: the tolerance in song/onsets.ts is what matches a time to an onset.
  const after =
    op === "add"
      ? addOnset(before, secs[0])
      : op === "remove"
        ? removeOnset(before, [], secs[0])
        : moveOnset(before, [], secs[0], secs[1]);
  try {
    setClipOnsets(h.songPath, clip, after);
  } catch (e) {
    h.refuse([`clip onset ${op}: ${(e as Error).message}`]);
    return;
  }
  const n = (after.added?.length ?? 0) + (after.removed?.length ?? 0);
  h.log([
    n === 0
      ? `${clip}: onsets back to what the engine detects`
      : `${clip}: ${after.added?.length ?? 0} added, ${after.removed?.length ?? 0} removed`,
  ]);
  await h.reload();
}

async function processCommand(
  arg: string,
  h: CommandHost,
  scope: Scope,
): Promise<void> {
  // The target is ONE token and the chain is the rest, so a médiathèque path keeps its slashes unquoted.
  const [target, ...rest] = arg.trim().split(/\s+/).filter(Boolean);
  const chain = rest.join(" ");
  if (!target || !chain) {
    h.refuse([
      `usage: ${scope} process <${scope}${scope === "clip" ? "|path" : ""}> <chain>  ` +
        "(a chain of this project, or @st0/<path>)",
    ]);
    return;
  }
  const { lines, changed } = await processWithChain(
    h.songPath,
    h.project(),
    target,
    chain,
    scope,
    // Back up each render before it's overwritten, so the web host's journal can undo the bounce.
    (abs) => h.snapshot?.(abs),
    // …and how to run an offline step, for a chain that separates rather than treats.
    h.runColdStep,
  );
  h.log(lines);
  // Only when something landed: a run that wrote nothing has nothing to re-read.
  if (changed) await h.reload();
}

/** A module's INTRINSICS — its own fields, set as `node param <node> @<field> <value>`; docs/verbs.md. */
const INTRINSICS: Record<
  string,
  (dir: string, module: string, raw: string) => { path: string; said: string }
> = {
  // One channel or two; whether the rig actually groups a pair is the engine's to know — docs/verbs.md.
  channel: (dir, module, raw) => {
    const channels = raw.split(",").map((s) => Number(s.trim()));
    if (channels.some((n) => !Number.isInteger(n) || n < 1))
      throw new Error(`'${raw}' is not a channel or a pair of them`);
    return {
      path: setModuleChannel(dir, module, channels),
      said: `channel ${channels.join(", ")}`,
    };
  },
  monitor: (dir, module, raw) => {
    if (raw !== "off" && raw !== "auto" && raw !== "on")
      throw new Error(`'${raw}' is not off, auto or on`);
    return { path: setModuleMonitor(dir, module, raw), said: `monitor ${raw}` };
  },
  gain: (dir, module, raw) => {
    const db = Number(raw);
    if (!Number.isFinite(db)) throw new Error(`'${raw}' is not a number of dB`);
    return { path: setModuleInputGain(dir, module, db), said: `gain ${db} dB` };
  },
  /** The engine's dry/wet around an effect, 0 all dry .. 1 all wet — engine/st0-engine/docs/mix.md. */
  mix: (dir, module, raw) => {
    const mix = Number(raw);
    if (!Number.isFinite(mix) || mix < 0 || mix > 1)
      throw new Error(`'${raw}' is not a mix between 0 and 1`);
    return {
      path: setModuleMix(dir, module, mix),
      said: `mix ${Math.round(mix * 100)}% wet`,
    };
  },
  /** The engine's level into and out of the module, in dB — engine/st0-engine/docs/mix.md. */
  "input-volume": (dir, module, raw) =>
    volumeIntrinsic(dir, module, "input", raw),
  "output-volume": (dir, module, raw) =>
    volumeIntrinsic(dir, module, "output", raw),
  /** Which SHADER a shader node runs; `none` clears it, and nothing is checked against the disk — docs/verbs.md. */
  shader: (dir, module, raw) => {
    const name = raw.trim() === "none" ? "" : raw.trim();
    return {
      path: setModuleShader(dir, module, name),
      said: name ? `shader ${name}` : "no shader",
    };
  },
  /** Which CAMERA a live picture node opens, by its LABEL; `default` clears it — docs/camera.md. */
  camera: (dir, module, raw) => {
    const name = raw.trim() === "default" ? "" : raw.trim();
    return {
      path: setModuleCamera(dir, module, name),
      said: name ? `camera ${name}` : "the default camera",
    };
  },
  /** Which MIDI DEVICE a midi-in node records from, by its LABEL; `any` clears it — packages/song/docs/midiIn.md. */
  device: (dir, module, raw) => {
    const name = raw.trim() === "any" ? "" : raw.trim();
    return {
      path: setModuleDevice(dir, module, name),
      said: name ? `MIDI device ${name}` : "any MIDI device",
    };
  },
  /** Which named BASE this module starts from — the opaque `.vstpreset` under its params; docs/verbs.md. */
  base: (dir, module, raw) => {
    const name = raw.trim() === "none" ? "" : raw.trim();
    return {
      path: setModuleBase(dir, module, name),
      said: name ? `base ${name}` : "no base",
    };
  },
};

/** One of the two volume intrinsics: dB, -60..+12, and 0 is no line. */
function volumeIntrinsic(
  dir: string,
  module: string,
  side: "input" | "output",
  raw: string,
): { path: string; said: string } {
  const db = Number(raw);
  if (!Number.isFinite(db) || db < -60 || db > 12)
    throw new Error(`'${raw}' is not a volume between -60 and +12 dB`);
  return {
    path: setModuleVolume(dir, module, side, db),
    said: `${side} volume ${db > 0 ? "+" : ""}${db} dB`,
  };
}

/** Point a FILE-VALUED param at one of the module's own assets, or clear it with `none` — docs/verbs.md. */
async function setFileParam(
  h: CommandHost,
  module: string,
  param: string,
  rawFile: string,
): Promise<void> {
  const file = rawFile.replace(/^"(.*)"$/s, "$1").trim();
  const clearing = file === "none";
  // An empty list means the module has no `assets/` — say that, not "no such file".
  // A library's family when the param names one there: always for `ir`, by an `@` for `model`.
  const family = isLibraryFileParam(param)
    ? LIBRARY_FILE_PARAMS[param]
    : file.startsWith("@")
      ? sharedFamilyOf(param)
      : null;
  if (!clearing && family) {
    // A library's file, by `@<library>/<path>`: the same list the panel's picker offers (packages/song/docs/libraryFiles.md).
    const shared = libraryFiles(family);
    if (!shared.includes(file)) {
      h.refuse([
        shared.length
          ? `no '${file}' in the libraries' ${family}/ — they have: ${shared.slice(0, 8).join(", ")}${shared.length > 8 ? ", …" : ""}`
          : `no library has a ${family}/ folder with a file in it yet`,
      ]);
      return;
    }
  } else if (!clearing) {
    const found = loadModules(h.songPath)[module];
    // Its own assets AND its ancestors': the same answer the panel's picker offers — docs/verbs.md.
    const have = moduleAssetChoices(
      h.songPath,
      found,
      loadModuleRefs(h.songPath),
    );
    if (!have.includes(file)) {
      h.refuse([
        have.length
          ? `no '${file}' in ${module}'s assets — it has: ${have.join(", ")}`
          : `${module} carries no assets — drop the file in modules/<category>/${found?.file ?? module}/assets/`,
      ]);
      return;
    }
  }
  try {
    setModuleAsset(h.songPath, module, param, clearing ? null : file);
    h.log([`${module}: ${clearing ? `${param} cleared` : file}`]);
    await h.reload();
  } catch (e) {
    h.refuse([`node param ${param} failed: ${(e as Error).message}`]);
  }
}

/** A tap's arguments: whitespace-separated, a "quoted" one kept whole — a sample's path holds spaces. */
function splitArgs(a: string): string[] {
  return [...a.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
}

/** Run one tap write, say what it did, and reload — a rack's sounds are built when its plugin is. */
async function tapEdit(
  h: CommandHost,
  write: () => unknown,
  said: string,
): Promise<void> {
  try {
    write();
    h.log([said]);
    await h.reload();
  } catch (e) {
    h.refuse([`node tap: ${(e as Error).message}`]);
  }
}

/** Write one intrinsic and say where it landed — the file may be the workspace's SHARED one; docs/verbs.md. */
async function setIntrinsic(
  h: CommandHost,
  module: string,
  field: string,
  raw: string,
): Promise<void> {
  const write = INTRINSICS[field];
  if (!write) {
    h.refuse([
      `no intrinsic '@${field}' — a module's own fields are ${Object.keys(
        INTRINSICS,
      )
        .map((f) => `@${f}`)
        .join(", ")}`,
    ]);
    return;
  }
  try {
    const { path, said } = write(h.songPath, module, raw);
    h.log([
      `${module}: ${said}` +
        (relative(h.songPath, path).startsWith("..")
          ? " — in the shared library, so every project beside this one sees it"
          : ""),
    ]);
    await h.reload();
  } catch (e) {
    h.refuse([`node param @${field} failed: ${(e as Error).message}`]);
  }
}

/** The OUT node's one parameter, written to `project.masterVolume`; unity is NOT written — packages/song/docs/masterVolume.md. */
async function writeMasterVolume(h: CommandHost, db: number): Promise<boolean> {
  if (db > MASTER_MAX_DB || db < MASTER_MIN_DB) {
    h.refuse([
      `${db} dB is outside the fader — it runs ${MASTER_MIN_DB}..+${MASTER_MAX_DB} dB`,
      ...(db > MASTER_MAX_DB
        ? [
            "a mix that needs more than +12 on its output has its headroom in the STRIPS — see packages/song/docs/masterVolume.md",
          ]
        : []),
    ]);
    return false;
  }
  const file = join(h.songPath, "project.yaml");
  if (db === 0) deleteFileValue(file, ["project", "masterVolume"]);
  else setFileValue(file, ["project", "masterVolume"], db);
  await h.applyProject({ ...h.project(), masterVolume: db });
  return true;
}

/** `node param` on one of the five built-in outputs; only `OUT` carries one, the rest refuse BY NAME — docs/verbs.md. */
async function setBuiltinOutParam(
  h: CommandHost,
  node: string,
  param: string,
  value: number,
): Promise<void> {
  if (node === MIX_NODE) {
    h.refuse([
      `${MIX_NODE} is the mixer's sum and carries no level — the output level is ${OUT_NODE}'s`,
      `try: node param "${OUT_NODE}" Volume ${value}`,
    ]);
    return;
  }
  if (node === RENDER_NODE || node === VIDEO_OUT_NODE) {
    h.refuse([
      `${node} carries no param — the picture's outputs are routing only, and a frame has no level`,
      `the one built-in param is ${OUT_NODE}'s Volume, the song's output level in dB`,
    ]);
    return;
  }
  if (node === CUE_NODE) {
    // A headphone amp has its own knob, and what each feed contributes is the module on its way in.
    h.refuse([
      `${CUE_NODE} carries no level — it is the pair the headphones are plugged into, and that amp has its own knob`,
      `set what a feed CONTRIBUTES instead, on the module wired into ${CUE_NODE}`,
    ]);
    return;
  }
  if (param !== "Volume") {
    h.refuse([
      `${OUT_NODE} has one param, Volume — the song's output level in dB`,
    ]);
    return;
  }
  if (await writeMasterVolume(h, value))
    h.log([`${OUT_NODE}: Volume = ${value}`]);
}

/** The last segment of a module ref — the namespace is deliberately not part of what a use is NAMED after. */
const moduleLeafOf = (ref: unknown): string | null => {
  const s = typeof ref === "string" ? ref.split("/").pop() : null;
  return s || null;
};

/** Follow a node's name onto the module it now extends, or say why it did not move — docs/verbs.md. */
function renameForNewModule(
  h: CommandHost,
  node: string,
  was: string,
  ref: string,
): string | null {
  const to = moduleLeafOf(ref);
  if (!to) return null;
  const dir = h.songPath;
  const next = renamedInstance(
    node,
    was,
    to,
    laneOfNode(dir, node),
    nodeNameTaken(dir),
  );
  if (!next) return null; // not a name this convention made — somebody chose it
  // A mapping is the one place outside the chains where this name is a REFERENCE, and nothing writes one back.
  const mapped = surfacesNaming(dir, node);
  if (mapped.length)
    return `${node}: kept its name — ${mapped.length > 1 ? "surfaces" : "surface"} ${mapped.join(", ")} name it, and a mapping is not rewritten`;
  try {
    const { rewired } = renameChainNode(dir, node, next);
    // A box's member is a reference this CAN write back, unlike a surface mapping above — so it does.
    const boxes = renameNodeInAssemblies(dir, node, next);
    return (
      `${node} → ${next}, following the module it now extends` +
      (rewired.length ? ` (rewired ${rewired.join(", ")})` : "") +
      (boxes.length ? ` (followed in ${boxes.join(", ")})` : "")
    );
  } catch (e) {
    return `${node}: kept its name — ${(e as Error).message}`;
  }
}

// --- SID registry ------------------------------------------------------------

export const SID_HANDLERS: Record<string, SidHandler> = {
  // A track IS its file: write it, then reload, so what plays is what is on disk — docs/verbs.md.
  "track.new": async (a, h) => newTrack(a, h),
  "track.order": async (a, h) => orderTrack(a, h),
  "sequence.new": async (a, h) => newSequence(a, h),

  // Bounce material through a chain and keep the result — `scope` is all that differs; docs/processChain.md.
  "track.process": (a, h) => processCommand(a, h, "track"),
  "clip.process": (a, h) => processCommand(a, h, "clip"),

  // --- a clip's onsets: corrections to what the engine detected, kept as a DIFF (song/onsets.ts)

  /** event trim <track> <at> [gate-dB] — cut the silence off both ends of ONE event's WINDOW; docs/verbs.md. */
  "event.trim": async (a, h) => {
    const parts = splitWords(a);
    if (parts.length < 2 || parts.length > 3) {
      h.refuse([
        "usage: event trim <track> <timecode> [gate-dB]  (e.g. event trim vox 24:1 -40)",
      ]);
      return;
    }
    const [trackArg, atTc, gateArg] = parts;
    const gate = gateArg === undefined ? DEFAULT_TRIM_DB : Number(gateArg);
    if (!Number.isFinite(gate) || gate > 0) {
      h.refuse([
        `'${gateArg}' is not a gate in dBFS — a negative number, e.g. -40`,
      ]);
      return;
    }
    const found = resolveEvent(h, trackArg, atTc);
    if (!found) return;
    const { track, atBeats, hit, num, den } = found;
    if (!h.clipEnvelope) {
      h.refuse([
        "this host cannot read a clip's envelope — `event trim` needs the engine, which builds it",
      ]);
      return;
    }
    const env = await h.clipEnvelope(hit.id);
    if (!env) {
      h.refuse([
        `${hit.name || hit.id}: no envelope yet — the engine builds it on first read`,
      ]);
      return;
    }
    // The bound is what this EVENT plays; `sourceTo` absent is "to the end of the file", as measured.
    const within = {
      from: hit.sourceFrom ?? 0,
      to: hit.sourceTo && hit.sourceTo > 0 ? hit.sourceTo : env.seconds,
    };
    const win = trimWindow(env.peak, env.seconds, gate, within);
    if (!win) {
      h.refuse([
        `${hit.name || hit.id}: nothing above ${gate} dB in what this event plays — the gate is too high, or the take is silent`,
        "nothing was changed: a window of zero length would play nothing at all",
      ]);
      return;
    }
    try {
      const done = setTrackPlacementWindow(
        h.songPath,
        track.id,
        atBeats,
        num,
        den,
        win,
        env.seconds,
      );
      if (!done) {
        h.refuse([`no event on '${track.id}' at ${atTc}`]);
        return;
      }
    } catch (e) {
      h.refuse([`event trim failed: ${(e as Error).message}`]);
      return;
    }
    h.log([
      `${track.id}: ${hit.name || hit.id} at ${atTc} keeps ${win.from.toFixed(2)}s → ${win.to.toFixed(2)}s of ${env.seconds.toFixed(2)}s (gate ${gate} dB)`,
    ]);
    await h.reload();
  },

  /** clip warp <clip> <sec> <beat> — pin a moment of the source to a beat; one verb places and moves, docs/verbs.md. */
  "clip.warp": async (a, h) => {
    const [clip, secStr, beatStr] = a.trim().split(/\s+/).filter(Boolean);
    if (!clip || secStr === undefined || beatStr === undefined) {
      h.refuse([
        "usage: clip warp <clip> <sec> <beat>  (e.g. clip warp break 1.94 4)",
      ]);
      return;
    }
    const [sec, beat] = [secStr, beatStr].map(Number);
    if (![sec, beat].every(Number.isFinite) || sec < 0 || beat < 0) {
      h.refuse(["sec and beat must be numbers, counted from zero"]);
      return;
    }
    let markers = clipWarpMarkers(h.songPath, clip);
    if (!markers) {
      // Seeding needs the clip's span in BOTH units: beats from the document, seconds from the envelope.
      const doc = h.project();
      const found = doc.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === clip);
      const env = await h.clipEnvelope?.(clip);
      const beats = found?.length ?? 0;
      if (!beats || !env?.seconds) {
        h.refuse([
          `${clip}: no stretch map, and no length to seed one from`,
          "a clip has to be placed on a lane, and its envelope read, before it can be warped",
        ]);
        return;
      }
      markers = seedWarp(beats, env.seconds);
    }
    try {
      const next = setWarpPoint(markers, sec, beat);
      h.snapshot?.(clipFilePath(h.songPath, clip));
      setClipWarp(h.songPath, clip, next);
      h.log([`${clip}: ${sec}s → beat ${beat} (${next.length} points)`]);
    } catch (e) {
      h.refuse([`clip warp: ${(e as Error).message}`]);
      return;
    }
    await h.reload();
  },

  /** clip warp remove <clip> <sec> — drop one stretch point. Never below two: see removeWarpPoint. */
  "clip.warpRemove": async (a, h) => {
    const [clip, secStr] = a.trim().split(/\s+/).filter(Boolean);
    if (!clip || secStr === undefined) {
      h.refuse(["usage: clip warp remove <clip> <sec>"]);
      return;
    }
    const sec = Number(secStr);
    if (!Number.isFinite(sec)) {
      h.refuse(["sec must be a number — seconds into the source file"]);
      return;
    }
    const markers = clipWarpMarkers(h.songPath, clip);
    if (!markers) {
      h.refuse([`${clip}: no stretch map to remove a point from`]);
      return;
    }
    try {
      const next = removeWarpPoint(markers, sec);
      h.snapshot?.(clipFilePath(h.songPath, clip));
      setClipWarp(h.songPath, clip, next);
      h.log([`${clip}: dropped the point at ${sec}s (${next.length} left)`]);
    } catch (e) {
      h.refuse([`clip warp remove: ${(e as Error).message}`]);
      return;
    }
    await h.reload();
  },

  "clip.onset.add": (a, h) => onsetCommand(a, h, "add"),
  "clip.onset.remove": (a, h) => onsetCommand(a, h, "remove"),
  "clip.onset.move": (a, h) => onsetCommand(a, h, "move"),

  // --- mixer (shared: TUI + CLI/web) — persisted to the track's file ----------
  "track.mute": async (a, h) => {
    const t = mixTarget(a, h, "mute");
    if (!t) return;
    const bypassed = !t.mute;
    await setLaneBypass(
      h,
      new Map([[t.id, bypassed]]),
      `${t.id}: ${bypassed ? "muted" : "unmuted"}`,
    );
  },
  /** Solo, as PROJECT STATE — `soloed:` at project.yaml's root, resolved by the ENGINE; docs/verbs.md. */
  "track.solo": async (a, h) => {
    const t = mixTarget(a, h, "solo");
    if (!t) return;
    const p = h.project();
    const cur = (loadProjectRoot(h.songPath).soloed ?? []).map(String);
    const on = !cur.includes(t.id);
    const next = on ? [...cur, t.id] : cur.filter((x) => x !== t.id);
    const file = join(h.songPath, "project.yaml");
    if (next.length) setFileValue(file, ["soloed"], next);
    else deleteFileValue(file, ["soloed"]);
    const unmute = on && t.mute;
    if (unmute) setModuleBypass(h.songPath, t.id, false);
    const soloSet = new Set(next);
    await h.applyProject({
      ...p,
      tracks: p.tracks.map((x) => ({
        ...x,
        solo: soloSet.has(x.id) || soloSet.has(x.group),
        ...(unmute && x.id === t.id ? { mute: false } : {}),
      })),
      groups: p.groups.map((g) => ({
        ...g,
        solo: soloSet.has(g.id),
        ...(unmute && g.id === t.id ? { mute: false } : {}),
      })),
    });
    h.log([
      `${t.id}: solo ${on ? "on" : "off"}` +
        (next.length ? ` — soloed: ${next.join(", ")}` : ""),
    ]);
  },
  // A lane's level, alternatives and freeze are `node` verbs — a lane IS a module; docs/verbs.md.

  // event move <track> <timecode> <newTimecode> — a surgical rewrite of that placement's `start:` alone.
  "event.move": async (a, h) => {
    const m = /^(\S+)\s+(\S+)\s+(\S+)(?:\s+(\S+))?$/.exec(a.trim());
    if (!m) {
      h.refuse([
        "usage: event move <track> <timecode> <newTimecode> [<toTrack>]  (e.g. event move drums 2:1:1 3:1:1)",
      ]);
      return;
    }
    const [, trackArg, fromTc, toTc, toTrackArg] = m;
    const p = h.project();
    const track = p.tracks.find(
      (t) => t.id === trackArg || t.name === trackArg,
    );
    if (!track) {
      h.refuse([
        `no track "${trackArg}"${p.tracks.length ? ` — try: ${p.tracks.map((t) => t.id).join(", ")}` : ""}`,
      ]);
      return;
    }
    const num = p.timeSigNumerator;
    const den = p.timeSigDenominator;
    let fromBeats: number;
    try {
      fromBeats = parsePosition(fromTc, num, den);
      parsePosition(toTc, num, den); // validate the destination too, before touching disk
    } catch (e) {
      h.refuse([`bad timecode: ${(e as Error).message}`]);
      return;
    }
    // Identify the event in the compiled project first, for a clear message and no no-op write.
    const hit = track.clips.find((c) => Math.abs(c.start - fromBeats) < 1e-6);
    if (!hit) {
      h.refuse([`no event on '${track.id}' at ${fromTc}`]);
      return;
    }
    // A move BETWEEN lanes is refused only when the destination has nowhere to put THIS event — docs/verbs.md.
    let dest = track;
    if (toTrackArg) {
      const d = p.tracks.find(
        (t) => t.id === toTrackArg || t.name === toTrackArg,
      );
      if (!d) {
        h.refuse([`no track "${toTrackArg}"`]);
        return;
      }
      const takes = hit.type === "midi" ? "notes" : "audio";
      if (!d.contentType.includes(takes)) {
        h.refuse([
          `can't move onto '${d.id}': this event is ${takes} and '${d.id}' takes ${d.contentType}`,
        ]);
        return;
      }
      // A generated lane declares no `clips` and the schema refuses one — caught here, since the write precedes the reload.
      if (d.generated) {
        h.refuse([
          `can't move onto '${d.id}': it is generated by an algo pattern and holds no placements`,
        ]);
        return;
      }
      dest = d;
    }
    try {
      const ok =
        dest.id === track.id
          ? moveTrackPlacement(h.songPath, track.id, fromBeats, toTc, num, den)
          : movePlacementToTrack(
              h.songPath,
              track.id,
              dest.id,
              fromBeats,
              toTc,
              num,
              den,
            );
      if (!ok) {
        h.refuse([`no event on '${track.id}' at ${fromTc}`]);
        return;
      }
      h.log([
        dest.id === track.id
          ? `${track.id}: moved ${hit.name || hit.id} ${fromTc} → ${toTc}`
          : `moved ${hit.name || hit.id} ${track.id} ${fromTc} → ${dest.id} ${toTc}`,
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`event move failed: ${(e as Error).message}`]);
    }
  },

  /** events move <tracks> <from> <to> <by> — the bulk form, one undo step and one reload; docs/verbs.md. */
  "events.move": async (a, h) => {
    const m = /^(\S+)\s+(\S+)\s+(\S+)\s+([+-]\S+)$/.exec(a.trim());
    if (!m) {
      h.refuse([
        "usage: events move <tracks> <from> <to> <+/-delta>  (e.g. events move drums,bass 2:1 4:4 +1:0)",
      ]);
      return;
    }
    const [, tracksArg, fromTc, toTc, byArg] = m;
    const p = h.project();
    // "all" is every lane that can hold a placement; naming a generated lane is refused rather than skipped.
    const tracks: typeof p.tracks = [];
    if (tracksArg.toLowerCase() === "all")
      tracks.push(...p.tracks.filter((t) => !t.generated));
    else
      for (const name of new Set(tracksArg.split(",").filter(Boolean))) {
        const t = p.tracks.find((x) => x.id === name || x.name === name);
        if (!t) {
          h.refuse([
            `no track "${name}"${p.tracks.length ? ` — try: ${p.tracks.map((x) => x.id).join(", ")}` : ""}`,
          ]);
          return;
        }
        if (t.generated) {
          h.refuse([
            `can't move events on '${t.id}': it is generated by an algo pattern and holds no placements`,
          ]);
          return;
        }
        tracks.push(t);
      }
    const num = p.timeSigNumerator;
    const den = p.timeSigDenominator;
    let fromBeats: number;
    let toBeats: number;
    let deltaBeats: number;
    try {
      fromBeats = parsePosition(fromTc, num, den);
      toBeats = parsePosition(toTc, num, den);
      // The delta is a DURATION wearing a sign, so "+1:0" means one bar whatever the bar is.
      deltaBeats =
        (byArg[0] === "-" ? -1 : 1) * parseDuration(byArg.slice(1), num, den);
    } catch (e) {
      h.refuse([`bad timecode: ${(e as Error).message}`]);
      return;
    }
    if (toBeats < fromBeats) [fromBeats, toBeats] = [toBeats, fromBeats];
    if (deltaBeats === 0) {
      h.refuse(["nothing to do: the delta is zero"]);
      return;
    }
    // Count the hits off the compiled project first: a clear refusal beats a partial write.
    const hits = tracks.map((t) => ({
      t,
      starts: t.clips
        .map((c) => c.start)
        .filter((s) => s >= fromBeats - 1e-6 && s <= toBeats + 1e-6),
    }));
    const all = hits.flatMap((x) => x.starts);
    if (!all.length) {
      h.refuse([
        `no events between ${fromTc} and ${toTc} on ${tracks.map((t) => t.id).join(", ")}`,
      ]);
      return;
    }
    if (Math.min(...all) + deltaBeats < -1e-6) {
      h.refuse([`can't move by ${byArg}: it would push an event before 1:1:1`]);
      return;
    }
    try {
      let moved = 0;
      const touched: string[] = [];
      for (const { t, starts } of hits) {
        if (!starts.length) continue;
        const n = moveTrackPlacementsInRange(
          h.songPath,
          t.id,
          fromBeats,
          toBeats,
          deltaBeats,
          num,
          den,
        );
        moved += n;
        if (n) touched.push(t.id);
      }
      h.log([
        `moved ${moved} event${moved === 1 ? "" : "s"} on ${touched.join(", ")} by ${byArg}`,
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`events move failed: ${(e as Error).message}`]);
    }
  },

  // A placement is a REFERENCE: `event remove` drops it and the clip in clips/ stays.
  "event.statusMute": (a, h) => statusCommand(a, h, "mute"),
  "event.statusWarp": (a, h) => statusCommand(a, h, "warp"),
  "event.fadeIn": (a, h) => fadeCommand(a, h, "fadeIn"),
  "event.window": windowCommand,
  "event.fadeOut": (a, h) => fadeCommand(a, h, "fadeOut"),
  "curve.point.add": (a, h) => curvePointCommand(a, h, "add"),
  "curve.point.move": (a, h) => curvePointCommand(a, h, "move"),
  "curve.point.remove": (a, h) => curvePointCommand(a, h, "remove"),
  "project.time.add": (a, h) => projectTimeCommand(a, h, "insert"),
  "project.time.remove": (a, h) => projectTimeCommand(a, h, "delete"),
  "track.automation.add": (a, h) => trackAutomationCommand(a, h, "add"),
  "track.automation.remove": (a, h) => trackAutomationCommand(a, h, "remove"),

  // event resize <track> <timecode> <newStart> <newEnd> — both ends, one edit.
  "event.resize": async (a, h) => {
    const m = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/.exec(a.trim());
    if (!m) {
      h.refuse([
        "usage: event resize <track> <timecode> <newStart> <newEnd>  (the new END position, not a length)",
      ]);
      return;
    }
    const [, trackArg, atTc, startTc, endTc] = m;
    const found = resolveEvent(h, trackArg, atTc);
    if (!found) return;
    const { track, atBeats, hit, num, den, tempo } = found;
    let startBeats: number;
    let endBeats: number;
    try {
      startBeats = parsePosition(startTc, num, den);
      endBeats = parsePosition(endTc, num, den);
    } catch (e) {
      h.refuse([`bad timecode: ${(e as Error).message}`]);
      return;
    }
    // A zero or negative length would still validate, so refuse rather than write an event that plays nothing.
    if (endBeats <= startBeats) {
      h.refuse([`the end (${endTc}) must be after the start (${startTc})`]);
      return;
    }
    try {
      const done = resizeTrackPlacement(
        h.songPath,
        track.id,
        atBeats,
        num,
        den,
        startBeats,
        endBeats,
        tempo,
      );
      if (!done) return h.refuse([`no event on '${track.id}' at ${atTc}`]);
      const span = beatsToDuration(endBeats - startBeats, num, den);
      h.log([
        `${track.id}: ${hit.name || hit.id} -> ${startTc}..${endTc} (${span})` +
          (done.loops > 1 ? ` × ${done.loops}` : ""),
        // The EVENT's own window, clamped inside the material's from/to — packages/song/docs/clipResize.md.
        `  this event only — ${done.material} keeps its own from/to`,
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`event resize failed: ${(e as Error).message}`]);
    }
  },

  /** event split <track> <timecode> <at> — cut the MATERIAL in two, leaving what was cut on disk; docs/verbs.md. */
  "event.split": async (a, h) => {
    const m = /^(\S+)\s+(\S+)\s+(\S+)$/.exec(a.trim());
    if (!m) {
      h.refuse(["usage: event split <track> <timecode> <at>  (where to cut)"]);
      return;
    }
    const [, trackArg, atTc, cutTc] = m;
    const found = resolveEvent(h, trackArg, atTc);
    if (!found) return;
    const { track, atBeats, hit, num, den } = found;
    let cutBeats: number;
    try {
      cutBeats = parsePosition(cutTc, num, den);
    } catch (e) {
      h.refuse([`bad timecode: ${(e as Error).message}`]);
      return;
    }
    try {
      if (hit.type === "audio") {
        const bin = findEngineBinary();
        if (!bin)
          return h.refuse([
            "event split: no engine on this machine — cutting audio means rendering two files",
          ]);
        const done = splitAudioMaterial(
          bin,
          h.songPath,
          h.project(),
          track.id,
          atBeats,
          cutBeats,
          num,
          den,
        );
        if (!done) return h.refuse([`no event on '${track.id}' at ${atTc}`]);
        h.log([
          `${track.id}: ${done.from} split at ${cutTc}, into two rendered clips`,
          `  ${done.head.file} (${+done.head.seconds.toFixed(3)}s) and ${done.tail.file} (${+done.tail.seconds.toFixed(3)}s)`,
          `  '${done.from}' is untouched — another lane may still be playing it`,
        ]);
      } else {
        const done = splitSequenceMaterial(
          h.songPath,
          track.id,
          atBeats,
          cutBeats,
          num,
          den,
        );
        if (!done) return h.refuse([`no event on '${track.id}' at ${atTc}`]);
        h.log([
          `${track.id}: ${done.from} split at ${cutTc}, into two sequences`,
          `  ${done.head.file} (${done.head.notes} notes) and ${done.tail.file} (${done.tail.notes})`,
          `  '${done.from}' is untouched — another lane may still be playing it`,
        ]);
      }
      await h.reload();
    } catch (e) {
      h.refuse([`event split failed: ${(e as Error).message}`]);
    }
  },

  /** selection consolidate <tracks> <from> <to> — one material over a range, ONE lane, gaps survive; docs/verbs.md. */
  "selection.consolidate": async (a, h) => {
    const m = /^(\S+)\s+(\S+)\s+(\S+)$/.exec(a.trim());
    if (!m) {
      h.refuse(["usage: selection consolidate <track> <from> <to>"]);
      return;
    }
    const [, tracksArg, fromTc, toTc] = m;
    const ids = [...new Set(tracksArg.split(",").filter(Boolean))];
    if (ids.length !== 1)
      return h.refuse([
        `selection consolidate takes ONE track — ${ids.length ? ids.join(", ") : "none"} given; a rectangle over several has no single file to write`,
      ]);
    const found = resolveEvent(h, ids[0], fromTc);
    if (!found) return;
    const { track, atBeats: fromBeats, hit, num, den } = found;
    let toBeats: number;
    try {
      toBeats = parsePosition(toTc, num, den);
    } catch (e) {
      h.refuse([`bad timecode: ${(e as Error).message}`]);
      return;
    }
    try {
      if (hit.type === "audio") {
        const bin = findEngineBinary();
        if (!bin)
          return h.refuse([
            "selection consolidate: no engine on this machine — consolidating audio means rendering a file",
          ]);
        const done = consolidateAudioMaterial(
          bin,
          h.songPath,
          h.project(),
          track.id,
          fromBeats,
          toBeats,
          num,
          den,
        );
        if (!done) return h.refuse([`nothing on '${track.id}' in that range`]);
        h.log([
          `${track.id}: ${done.replaced} event(s) consolidated into ${done.written.file}`,
          `  ${+done.written.seconds.toFixed(3)}s rendered from ${done.from.join(", ")}`,
        ]);
      } else {
        const done = consolidateSequenceMaterial(
          h.songPath,
          track.id,
          fromBeats,
          toBeats,
          num,
          den,
        );
        if (!done) return h.refuse([`nothing on '${track.id}' in that range`]);
        h.log([
          `${track.id}: ${done.replaced} event(s) consolidated into ${done.written.file}`,
          `  ${done.written.notes} notes, from ${done.from.join(", ")}`,
        ]);
      }
      await h.reload();
    } catch (e) {
      h.refuse([`selection consolidate failed: ${(e as Error).message}`]);
    }
  },

  /** event add <track> <clip> <timecode> — the one ADDITIVE verb of this family; docs/verbs.md. */
  "event.add": async (a, h) => {
    const m = /^(\S+)\s+(\S+)\s+(\S+)$/.exec(a.trim());
    if (!m) {
      h.refuse([
        "usage: event add <track> <clip> <timecode>  (e.g. event add gtr gtr_3.1_260814T143012 3:1)",
      ]);
      return;
    }
    const [, trackArg, clipArg, atTc] = m;
    const p = h.project();
    const track = p.tracks.find(
      (t) => t.id === trackArg || t.name === trackArg,
    );
    if (!track) {
      h.refuse([
        `no track "${trackArg}"${p.tracks.length ? ` — try: ${p.tracks.map((t) => t.id).join(", ")}` : ""}`,
      ]);
      return;
    }
    // A timecode this cannot read would be written verbatim and break the next load.
    try {
      parsePosition(atTc, p.timeSigNumerator, p.timeSigDenominator);
    } catch (e) {
      h.refuse([`bad timecode: ${(e as Error).message}`]);
      return;
    }
    if (!existsSync(join(h.songPath, "clips", `${clipArg}.yaml`))) {
      h.refuse([
        `no clip "${clipArg}" — clips/${clipArg}.yaml does not exist`,
        "a placement naming no clip stops the project loading, so this refuses rather than writes it",
      ]);
      return;
    }
    try {
      addTrackPlacement(h.songPath, track.id, clipArg, atTc);
      h.log([`${track.id}: added ${clipArg} at ${atTc}`]);
      await h.reload();
    } catch (e) {
      h.refuse([`event add failed: ${(e as Error).message}`]);
    }
  },

  /** `graph pin <JSON {node: {x,y}}>` — record where the graph drew itself, one batched write; docs/verbs.md. */
  "graph.pin": async (a, h) => {
    const payload = a.trim();
    if (!payload) {
      h.refuse([
        'usage: graph pin <JSON {node: {x,y}}>  (e.g. graph pin {"reverb":{"x":420,"y":180}})',
      ]);
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(payload);
    } catch (e) {
      h.refuse([`bad positions JSON: ${(e as Error).message}`]);
      return;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      h.refuse(["positions payload must be a JSON object of node -> {x,y}"]);
      return;
    }
    const at: Record<string, { x: number; y: number }> = {};
    for (const [node, v] of Object.entries(raw as Record<string, unknown>)) {
      const p = v as { x?: unknown; y?: unknown };
      const x = Number(p?.x);
      const y = Number(p?.y);
      if (!node || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      at[node] = { x, y };
    }
    if (!Object.keys(at).length) {
      h.refuse(["no usable {x,y} in the payload"]);
      return;
    }
    try {
      const path = setChainNodePositions(h.songPath, at);
      h.log([`pinned ${Object.keys(at).length} node(s) (${path})`]);
    } catch (e) {
      h.refuse([`graph pin: ${(e as Error).message}`]);
    }
  },

  /** events add <JSON […]> — a paste's receiving half: checked whole, then written once per lane; docs/verbs.md. */
  "events.add": async (a, h) => {
    const payload = a.trim();
    if (!payload) {
      h.refuse([
        'usage: events add <JSON [{track,ref,start,from?,to?,fadeIn?,fadeOut?,loop?,disabled?,warp?}]>  (e.g. events add [{"track":"gtr","ref":"riff","start":"3:1"}])',
      ]);
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(payload);
    } catch (e) {
      h.refuse([`bad events JSON: ${(e as Error).message}`]);
      return;
    }
    if (!Array.isArray(raw) || !raw.length) {
      h.refuse([
        "events payload must be a non-empty JSON array of {track,ref,start}",
      ]);
      return;
    }
    const items = raw as Record<string, unknown>[];
    const p = h.project();
    const num = p.timeSigNumerator;
    const den = p.timeSigDenominator;
    // Lane id -> its placements, collected while everything is still checkable.
    const byTrack = new Map<string, Placement[]>();
    for (const [i, it] of items.entries()) {
      const where = `events add [${i}]`;
      const lane = it.track;
      const ref = it.ref;
      const start = it.start;
      if (
        typeof lane !== "string" ||
        typeof ref !== "string" ||
        typeof start !== "string"
      ) {
        h.refuse([`${where}: needs a string track, ref and start`]);
        return;
      }
      const track = p.tracks.find((t) => t.id === lane || t.name === lane);
      if (!track) {
        h.refuse([`${where}: no track "${lane}"`]);
        return;
      }
      if (track.generated) {
        h.refuse([
          `${where}: '${track.id}' is generated by an algo pattern and holds no placements`,
        ]);
        return;
      }
      // A timecode this cannot read would be written verbatim and break the next load.
      try {
        parsePosition(start, num, den);
      } catch (e) {
        h.refuse([`${where}: bad timecode — ${(e as Error).message}`]);
        return;
      }
      // The same refusal `event add` makes: a placement the compiler cannot resolve fails the WHOLE song.
      if (
        !existsSync(join(h.songPath, "clips", `${ref}.yaml`)) &&
        !existsSync(join(h.songPath, "sequences", `${ref}.yaml`))
      ) {
        h.refuse([
          `${where}: no clip or sequence "${ref}" — a placement naming neither stops the project loading`,
        ]);
        return;
      }
      // The rest of the placement's vocabulary, checked against the `.strict()` schema — docs/verbs.md.
      const parsed = PlacementSchema.safeParse({
        ref,
        start,
        ...Object.fromEntries(
          EVENT_FIELDS.filter((k) => it[k] !== undefined).map((k) => [
            k,
            it[k],
          ]),
        ),
      });
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        h.refuse([
          `${where}: ${first.path.join(".") || "placement"} — ${first.message}`,
        ]);
        return;
      }
      // The two timecodes the schema can only check the SHAPE of: `1:0` matches the pattern and is no position.
      for (const k of ["fadeIn", "fadeOut"] as const) {
        const v = parsed.data[k];
        if (v === undefined) continue;
        try {
          parsePosition(v, num, den);
        } catch (e) {
          h.refuse([`${where}: bad ${k} — ${(e as Error).message}`]);
          return;
        }
      }
      const list = byTrack.get(track.id) ?? [];
      list.push(parsed.data);
      byTrack.set(track.id, list);
    }
    try {
      for (const [id, list] of byTrack)
        addTrackPlacements(h.songPath, id, list);
      const n = items.length;
      h.log([
        `added ${n} event${n === 1 ? "" : "s"} on ${[...byTrack.keys()].join(", ")}`,
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`events add failed: ${(e as Error).message}`]);
    }
  },

  "event.remove": async (a, h) => {
    const m = /^(\S+)\s+(\S+)$/.exec(a.trim());
    if (!m) {
      h.refuse([
        "usage: event remove <track> <timecode>  (e.g. event remove drums 2:1:1)",
      ]);
      return;
    }
    const [, trackArg, atTc] = m;
    const p = h.project();
    const track = p.tracks.find(
      (t) => t.id === trackArg || t.name === trackArg,
    );
    if (!track) {
      h.refuse([
        `no track "${trackArg}"${p.tracks.length ? ` — try: ${p.tracks.map((t) => t.id).join(", ")}` : ""}`,
      ]);
      return;
    }
    const num = p.timeSigNumerator;
    const den = p.timeSigDenominator;
    let atBeats: number;
    try {
      atBeats = parsePosition(atTc, num, den);
    } catch (e) {
      h.refuse([`bad timecode: ${(e as Error).message}`]);
      return;
    }
    // Named from the compiled project before the edit — afterwards the placement is gone and there is nothing to name.
    const hit = track.clips.find((c) => Math.abs(c.start - atBeats) < 1e-6);
    if (!hit) {
      h.refuse([`no event on '${track.id}' at ${atTc}`]);
      return;
    }
    try {
      if (!removeTrackPlacement(h.songPath, track.id, atBeats, num, den)) {
        h.refuse([`no event on '${track.id}' at ${atTc}`]);
        return;
      }
      h.log([`${track.id}: removed ${hit.name || hit.id} at ${atTc}`]);
      await h.reload();
    } catch (e) {
      h.refuse([`event remove failed: ${(e as Error).message}`]);
    }
  },

  "sequence.list": (_a, h) => {
    const seqs = collectSequences(h.project());
    if (!seqs.length) h.log(["no sequences — add one with: sequence new"]);
    else
      h.log(
        seqs.map(
          (s) =>
            `  ${s.name}  (${s.trackId}, ${s.clip.notes.length} notes, ${s.clip.length} beats)`,
        ),
      );
  },

  // Add one MIDI note: `note` is a name or number, start/end are beats, and onsets clamp to >= 0 (#Note forbids < 0).
  "sequence.addNote": async (arg, h) => {
    const [seqId, noteStr, startStr, endStr] = arg.trim().split(/\s+/);
    if (!seqId || !noteStr || startStr === undefined) {
      h.refuse(["usage: sequence note new <sequence> <note> <start> [end]"]);
      return;
    }
    const k = parseMidiNote(noteStr);
    if (k === null) {
      h.refuse([
        `bad note "${noteStr}" — use a name (C4, F#3) or a number 0..127`,
      ]);
      return;
    }
    const t = Math.max(0, Number(startStr));
    const end = endStr !== undefined ? Number(endStr) : t + 1;
    if (!Number.isFinite(t) || !Number.isFinite(end)) {
      h.refuse(["start/end must be numbers (beats)"]);
      return;
    }
    const d = end > t ? end - t : 1;
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      h.refuse([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    writeFileSync(file, appendNotes(text, [{ t, d, k }]), "utf8");
    h.log([
      `added ${noteStr} (k${k}) ${fmtBeat(t)}..${fmtBeat(end)} → ${seqId}`,
    ]);
    await h.reload();
  },

  /** sequence note timerange … — move a note, stretch it, or both; one verb, two grips, docs/verbs.md. */
  "sequence.noteTimeRange": async (arg, h) => {
    const [seqId, noteStr, startStr, newStartStr, newEndStr] = arg
      .trim()
      .split(/\s+/);
    if (!seqId || !noteStr || !startStr || !newStartStr || !newEndStr) {
      h.refuse([
        "usage: sequence note timerange <sequence> <note> <start> <newStart> <newEnd>",
      ]);
      return;
    }
    const k = parseMidiNote(noteStr);
    if (k === null) {
      h.refuse([
        `bad note "${noteStr}" — use a name (C4, F#3) or a number 0..127`,
      ]);
      return;
    }
    const [t, nt, ne] = [startStr, newStartStr, newEndStr].map(Number);
    if (![t, nt, ne].every(Number.isFinite)) {
      h.refuse(["start, newStart and newEnd must be numbers (beats)"]);
      return;
    }
    if (ne <= nt) {
      h.refuse([
        `a note has to end after it starts — ${nt} → ${ne} is nothing`,
      ]);
      return;
    }
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      h.refuse([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    try {
      h.snapshot?.(file);
      writeFileSync(file, setNoteTimeRange(text, k, t, nt, ne - nt), "utf8");
    } catch (e) {
      h.refuse([`sequence note timerange: ${(e as Error).message}`]);
      return;
    }
    h.log([
      `${seqId}: ${noteStr} (k${k}) ${fmtBeat(t)} → ${fmtBeat(nt)}, length ${fmtBeat(ne - nt)}`,
    ]);
    await h.reload();
  },

  /** sequence note move … — the same note somewhere else, its length and velocity riding along (moveNote). */
  "sequence.moveNote": async (arg, h) => {
    const [seqId, noteStr, startStr, toStr, toStartStr] = arg
      .trim()
      .split(/\s+/);
    if (
      !seqId ||
      !noteStr ||
      startStr === undefined ||
      !toStr ||
      toStartStr === undefined
    ) {
      h.refuse([
        "usage: sequence note move <sequence> <note> <start> <newNote> <newStart>",
      ]);
      return;
    }
    const k = parseMidiNote(noteStr);
    const nk = parseMidiNote(toStr);
    if (k === null || nk === null) {
      h.refuse([
        `bad note "${k === null ? noteStr : toStr}" — use a name (C4, F#3) or a number 0..127`,
      ]);
      return;
    }
    const t = Number(startStr);
    const nt = Number(toStartStr);
    if (!Number.isFinite(t) || !Number.isFinite(nt)) {
      h.refuse(["start and newStart (beats) must be numbers"]);
      return;
    }
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      h.refuse([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    try {
      writeFileSync(file, moveNote(text, k, t, nk, nt), "utf8");
    } catch (e) {
      h.refuse([`sequence note move: ${(e as Error).message}`]);
      return;
    }
    h.log([
      `${seqId}: ${noteStr} (k${k}) ${fmtBeat(t)} → ${toStr} (k${nk}) ${fmtBeat(nt)}`,
    ]);
    await h.reload();
  },

  /** sequence note split … — cut one note in two at beat `at`, its velocity riding onto both halves; docs/verbs.md. */
  "sequence.splitNote": async (arg, h) => {
    const [seqId, noteStr, startStr, atStr] = arg.trim().split(/\s+/);
    if (!seqId || !noteStr || startStr === undefined || atStr === undefined) {
      h.refuse(["usage: sequence note split <sequence> <note> <start> <at>"]);
      return;
    }
    const k = parseMidiNote(noteStr);
    if (k === null) {
      h.refuse([
        `bad note "${noteStr}" — use a name (C4, F#3) or a number 0..127`,
      ]);
      return;
    }
    const [t, at] = [startStr, atStr].map(Number);
    if (![t, at].every(Number.isFinite)) {
      h.refuse(["start and at must be numbers (beats)"]);
      return;
    }
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      h.refuse([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    try {
      h.snapshot?.(file);
      writeFileSync(file, splitNote(text, k, t, at), "utf8");
    } catch (e) {
      h.refuse([`sequence note split: ${(e as Error).message}`]);
      return;
    }
    h.log([
      `${seqId}: ${noteStr} (k${k}) split at ${fmtBeat(at)} — two notes now`,
    ]);
    await h.reload();
  },

  "sequence.removeNote": async (arg, h) => {
    const [seqId, noteStr, startStr] = arg.trim().split(/\s+/);
    if (!seqId || !noteStr || startStr === undefined) {
      h.refuse(["usage: sequence note remove <sequence> <note> <start>"]);
      return;
    }
    const k = parseMidiNote(noteStr);
    if (k === null) {
      h.refuse([
        `bad note "${noteStr}" — use a name (C4, F#3) or a number 0..127`,
      ]);
      return;
    }
    const t = Number(startStr);
    if (!Number.isFinite(t)) {
      h.refuse(["start (beats) must be a number"]);
      return;
    }
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      h.refuse([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    try {
      writeFileSync(file, removeNote(text, k, t), "utf8");
    } catch (e) {
      h.refuse([`sequence note remove: ${(e as Error).message}`]);
      return;
    }
    h.log([`${seqId}: ${noteStr} (k${k}) at ${fmtBeat(t)} removed`]);
    await h.reload();
  },

  /** sequence double … — twice as long, playing twice; the writer is `doubleSequence`, docs/verbs.md. */
  "sequence.double": async (arg, h) => {
    const seqId = arg.trim().split(/\s+/)[0];
    if (!seqId) {
      h.refuse(["usage: sequence double <sequence>"]);
      return;
    }
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      h.refuse([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    // 4/4 when the doc states none: the bar is what a window rounds to, and every surface here reads it that way.
    const p = h.project();
    let next: string;
    try {
      next = doubleSequence(
        text,
        p.timeSigNumerator || 4,
        p.timeSigDenominator || 4,
      );
    } catch (e) {
      h.refuse([`sequence double: ${(e as Error).message}`]);
      return;
    }
    h.snapshot?.(file);
    writeFileSync(file, next, "utf8");
    // …and half as many passes wherever it is LOOPED, so four bars of it stay four bars — docs/verbs.md.
    const loops = halveLoopsOf(h.songPath, seqId, (f) => h.snapshot?.(f));
    h.log([
      `${seqId}: doubled — twice as long, its notes played twice`,
      ...(loops.halved
        ? [`${loops.halved} placement(s) now loop half as many times`]
        : []),
      // Named one by one: a placement that did NOT follow is one whose length just changed.
      ...loops.kept.map(
        (k) =>
          `${k.lane} at ${k.start} still loops ${k.loop}× and is now twice as long — ` +
          (k.why === "odd"
            ? "an odd number of passes cannot be halved"
            : "it states a window of its own, which did not grow"),
      ),
    ]);
    await h.reload();
  },

  "sequence.noteRepeat": padEffectCommand("repeat"),
  "sequence.noteSkip": padEffectCommand("skip"),

  "sequence.notesRemove": regionCommand("remove", undefined, () => () => null),
  /**
   * Transposing CLAMPS onto the keyboard rather than dropping what falls off it — the engine's own
   * `transpose` node does the same, and for the sharper reason: a dropped note leaves its note-off
   * behind and hangs the voice (engine/st0-engine DspGraph.cpp). A paste, which is not an edit of notes
   * that exist, drops instead and says so.
   */
  "sequence.notesTranspose": regionCommand(
    "transpose",
    {
      name: "semitones",
      check: (v) =>
        Number.isInteger(v) ? null : "semitones must be a whole number",
    },
    (v) => (n) => ({ ...n, k: Math.max(0, Math.min(127, n.k + v)) }),
  ),
  /** Quantizing moves the ONSET and keeps the length: stretching too would be two edits under one verb. */
  "sequence.notesQuantize": regionCommand(
    "quantize",
    {
      name: "grid",
      check: (v) => (v > 0 ? null : "the grid has to be more than 0 beats"),
    },
    (v) => (n) => ({ ...n, t: Math.max(0, Math.round(n.t / v) * v) }),
  ),
  /** Absolute, and 1 CLEARS the field, so a run of notes set to full leaves a file that never mentions velocity. */
  "sequence.notesVelocity": regionCommand(
    "velocity",
    {
      name: "velocity",
      check: (v) => (v >= 0 && v <= 1 ? null : "velocity is 0..1"),
    },
    (v) => (n) => ({
      ...n,
      ...(v === 1 ? { v: undefined } : { v: Math.round(v * 100) / 100 }),
    }),
  ),

  /** Set ONE note's velocity, 0..1, clamped rather than refused; a velocity of 1 CLEARS the field — docs/verbs.md. */
  "sequence.noteVelocity": async (arg, h) => {
    const [seqId, noteStr, startStr, velStr] = arg.trim().split(/\s+/);
    if (!seqId || !noteStr || startStr === undefined || velStr === undefined) {
      h.refuse([
        "usage: sequence note velocity <sequence> <note> <start> <velocity 0..1>",
      ]);
      return;
    }
    const k = parseMidiNote(noteStr);
    if (k === null) {
      h.refuse([
        `bad note "${noteStr}" — use a name (C4, F#3) or a number 0..127`,
      ]);
      return;
    }
    const t = Number(startStr);
    const raw = Number(velStr);
    if (!Number.isFinite(t) || !Number.isFinite(raw)) {
      h.refuse(["start (beats) and velocity (0..1) must be numbers"]);
      return;
    }
    // Two decimals: the drag reads a pixel, and a file full of 0.7333333333 is noise in a diff.
    const v = Math.round(Math.max(0, Math.min(1, raw)) * 100) / 100;
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      h.refuse([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    try {
      writeFileSync(
        file,
        setNoteVelocity(text, k, t, v === 1 ? undefined : v),
        "utf8",
      );
    } catch (e) {
      h.refuse([`sequence note velocity: ${(e as Error).message}`]);
      return;
    }
    h.log([`${seqId}: ${noteStr} (k${k}) at ${fmtBeat(t)} → velocity ${v}`]);
    await h.reload();
  },

  // Append a BATCH of already-timed notes — web MIDI recording's commit half, one write and one reload.
  "sequence.recordNotes": async (arg, h) => {
    const trimmed = arg.trim();
    const sp = trimmed.search(/\s/);
    if (sp < 0) {
      h.refuse(["usage: sequence note add <sequence> <notesJSON>"]);
      return;
    }
    const seqId = trimmed.slice(0, sp);
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed.slice(sp + 1));
    } catch (e) {
      h.refuse([`bad notes JSON: ${(e as Error).message}`]);
      return;
    }
    if (!Array.isArray(raw)) {
      h.refuse(["notes payload must be a JSON array of {t,d,k,v?}"]);
      return;
    }
    const notes = raw as {
      t?: number;
      d?: number;
      k?: number;
      v?: number;
      repeat?: number;
      skip?: number;
    }[];
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      h.refuse([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    // A pad's effects come through a PASTE, so they are checked rather than trusted — packages/song/docs/padEffects.md.
    const effect = (v: unknown): number | undefined =>
      typeof v === "number" && Number.isInteger(v) && v >= 2 ? v : undefined;
    const playable = notes.filter(isPlayableNote).map((n) => ({
      ...n,
      t: Math.max(0, n.t),
      // A velocity of 1 is what the engine applies anyway, so writing it says nothing.
      v: typeof n.v === "number" && n.v >= 0 && n.v < 1 ? n.v : undefined,
      repeat: effect(n.repeat),
      skip: effect(n.skip),
    }));
    if (!playable.length) {
      h.refuse(["no valid notes to record"]);
      return;
    }
    writeFileSync(file, appendNotes(text, playable), "utf8");
    h.log([`recorded ${playable.length} note(s) → ${seqId}`]);
    await h.reload();
  },

  /** project master <dB> — the SAME write as `node param "OUT" Volume <dB>`, kept as its own verb; docs/verbs.md. */
  "project.master": async (a, h) => {
    const raw = a.trim();
    const db = Number(raw);
    if (!raw || !Number.isFinite(db)) {
      h.refuse(["usage: project master <dB>  (0 is unity, -100..+6)"]);
      return;
    }
    if (!(await writeMasterVolume(h, db))) return;
    h.log([
      db === 0
        ? "master at unity (0 dB) — the line is removed, which is what unity means"
        : `master ${db > 0 ? "+" : ""}${db} dB`,
    ]);
  },

  // Add or move a named marker, stored under a CANONICAL timecode so `5` and `5:1:1` are the same marker.
  "project.marker.create": async (arg, h) => {
    const trimmed = arg.trim();
    const sp = trimmed.search(/\s/);
    const tcRaw = sp === -1 ? "" : trimmed.slice(0, sp);
    const name = sp === -1 ? "" : trimmed.slice(sp + 1).trim();
    if (!tcRaw || !name) {
      h.refuse([
        "usage: create marker <timecode> <name>  (e.g. create marker 5:1:1 Chorus)",
      ]);
      return;
    }
    const p = h.project();
    const num = p.timeSigNumerator;
    const den = p.timeSigDenominator;
    let beat: number;
    try {
      beat = parsePosition(tcRaw, num, den);
    } catch (e) {
      h.refuse([`bad timecode: ${(e as Error).message}`]);
      return;
    }
    const tc = beatsToPosition(beat, num, den); // canonical key
    // Rebuild the map from the loaded set minus this spot (so a repeat renames it), kept in beat order for a tidy file.
    const all = [
      ...p.markers.filter((m) => m.tc !== tc),
      { tc, name, beat },
    ].sort((a, b) => a.beat - b.beat);
    writeMarkers(
      h.songPath,
      Object.fromEntries(all.map((m) => [m.tc, m.name])),
    );
    h.log([`marker "${name}" @ ${tc}`]);
    await h.reload();
  },

  // Remove every marker with this name — names are the handle a user knows, timecodes only the storage key.
  "project.marker.delete": async (arg, h) => {
    const name = arg.trim();
    if (!name) {
      h.refuse(["usage: project marker delete <name>"]);
      return;
    }
    const p = h.project();
    const kept = p.markers.filter((m) => m.name !== name);
    if (kept.length === p.markers.length) {
      h.refuse([`no marker named "${name}"`]);
      return;
    }
    writeMarkers(
      h.songPath,
      Object.fromEntries(kept.map((m) => [m.tc, m.name])),
    );
    h.log([`deleted marker "${name}"`]);
    await h.reload();
  },

  // --- what this MACHINE is, and what the REPOSITORY holds: the two groups that left, docs/verbs.md
  ...SYSTEM_VERBS,
  ...PLAYLIST_VERBS,
  // …and the song's PICTURE, which had a mouse and no verbs at all — docs/picture.md.
  ...PICTURE_VERBS,
  // …and the lane's DUPLICATE verbs, which copy a chain where `track new` makes one from scratch.
  ...TRACK_VERBS,
  // …and a module's ENGINES, which a node picks between — packages/song/docs/engines.md.
  ...ENGINE_VERBS,
  // …and the project's summing CONSOLE — packages/song/docs/console.md.
  ...CONSOLE_VERBS,

  // The external UI of ONE INSTANCE — the argument names a node, since a module with no instance has no window.
  "node.externalUi": async (a, h) => {
    const name = a.trim();
    // Only an external plugin (VST, AU, CLAP…) has a window of its own; a built-in or a jsdsp one has none.
    const modules = collectPluginModules(h.project()).filter((b) =>
      EXTERNAL_PLUGIN_FORMATS.has(b.type.toLowerCase()),
    );
    if (!name) {
      h.refuse([
        modules.length
          ? `open which? ${modules.map((b) => b.module).join(", ")}`
          : "no external plugins in this project",
      ]);
      return;
    }
    const match =
      modules.find((b) => b.module === name) ??
      modules.find((b) => b.module.toLowerCase() === name.toLowerCase());
    if (!match) {
      h.refuse([
        `no external plugin module '${name}'${modules.length ? ` — try: ${modules.map((b) => b.module).join(", ")}` : ""}`,
      ]);
      return;
    }
    await h.showNativePluginUI(match.id);
    h.log([`opening ${match.module} (${match.type}) on ${match.track}…`]);
  },

  /** `node record save <file> [name]` — send a recorder's take to the médiathèque's recordings
   *  zone. The FILE and not the node: a node has a stack of takes and the card knows which one is
   *  on top, so naming it here would be a second answer to that. See docs/recorderNode.md. */
  "node.record.save": async (a, h) => {
    // The path comes JSON-quoted, since a take's is absolute and on Windows full of backslashes.
    const m = firstArg(a.trim());
    if (!m) {
      h.refuse(["usage: node record save <take-file> [name]"]);
      return;
    }
    const { head: file, rest: label } = m;
    if (!h.saveTake) {
      // Never silent: this host has no médiathèque behind it, which is a fact about WHERE the
      // command ran rather than about the take.
      h.refuse([
        "this surface cannot save a take — it runs nowhere near the recording",
      ]);
      return;
    }
    try {
      const at = await h.saveTake(file, label || undefined);
      h.log([`saved ${at}`]);
    } catch (e) {
      h.refuse([`could not save the take: ${(e as Error).message}`]);
    }
  },

  // `node bypass` writes into graph.yaml's `bypassed` list, not the module file — docs/verbs.md.
  "node.bypass": async (a, h) => {
    const m = /^(\S+)(?:\s+(on|off|true|false))?$/.exec(a.trim());
    if (!m) {
      h.refuse(["usage: node bypass <node> [on|off]"]);
      return;
    }
    const [, module, state] = m;
    // graph.yaml alone, not loadGraph — one file instead of 220 ms of compile; docs/verbs.md.
    const allChains = parseChains(
      loadChains(h.songPath, loadProjectRoot(h.songPath, true), true),
    );
    // A module belongs to exactly one chain, so there is no "used in two chains, say which" to answer.
    const hit = Object.entries(allChains).find(([, c]) =>
      c.use.some((s) => s.module === module),
    );
    if (!hit) {
      h.refuse([`no module "${module}" in any chain`]);
      return;
    }
    const [chain, c] = hit;
    // `enabled` defaults to true, so "currently on" is anything but an explicit false.
    const isOn = c.use.find((s) => s.module === module)?.enabled !== false;
    const bypass = state == null ? isOn : state === "on" || state === "true";
    try {
      // `bypass` is already the state wanted, and setModuleBypass takes the state wanted — do not negate it.
      setModuleBypass(h.songPath, module, bypass);
      h.log([`${chain}: ${module} ${bypass ? "bypassed" : "active"}`]);
      // Persist, then push the mutated doc rather than reloading — docs/verbs.md.
      const p = h.project();
      const pluginId = `${chain}:${module}`;
      let found = false;
      const np: ProjectDoc = {
        ...p,
        tracks: p.tracks.map((t) => ({
          ...t,
          plugins: t.plugins.map((pl) => {
            if (pl.id !== pluginId) return pl;
            found = true;
            return { ...pl, enabled: !bypass }; // PluginDoc.enabled means "not bypassed"
          }),
        })),
      };
      // An io module or a dangling step has no plugin to diff, so it falls back to the full reload.
      if (found) await h.applyProject(np);
      else await h.reload();
    } catch (e) {
      h.refuse([`bypass failed: ${(e as Error).message}`]);
    }
  },

  // A module's own fields and its file-valued params are all `node param` — docs/verbs.md.

  /** The three alternative verbs, one operation each on ONE module's file, all ending in a reload; docs/verbs.md. */
  "node.alt.select": async (a, h) => {
    const [module, name] = a.trim().split(/\s+/).filter(Boolean);
    if (!module) {
      h.refuse(["usage: node alternative select <node> [name]"]);
      return;
    }
    try {
      const { names, current } = moduleAlternatives(h.songPath, module);
      if (!name) {
        // The list is the useful answer to "which ones are there?", so a bare call says it.
        h.log([
          names.length > 1
            ? `${module}: ${names.map((n) => (n === current ? `[${n}]` : n)).join("  ")}`
            : `${module} has one set of settings — 'node alternative create ${module}' starts a second`,
        ]);
        return;
      }
      const { values } = selectModuleAlternative(h.songPath, module, name);
      h.log([`${module}: running alternative '${name}'`]);
      // Two sets differing in numbers alone reach the engine as a diff of the held doc, not a recompile.
      const np =
        values &&
        withModuleParams(h.project(), module, values.params, values.whole);
      if (np) await h.applyProject(np);
      else await h.reload();
    } catch (e) {
      h.refuse([`node alternative: ${(e as Error).message}`]);
    }
  },

  /** A rack node's taps — note, sample, add, insert, rename, remove — each one write to the NODE's file and a reload; docs/verbs.md. */
  "node.tap.note": async (a, h) => {
    const [node, symbol, raw] = splitArgs(a);
    const note = Number(raw);
    if (!node || !symbol || !Number.isInteger(note) || note < 0 || note > 127)
      return h.refuse(["usage: node tap note <node> <symbol> <0-127>"]);
    await tapEdit(
      h,
      () => setTap(h.songPath, node, symbol, { note }),
      `${node}: ${symbol} on note ${note}`,
    );
  },
  "node.tap.sample": async (a, h) => {
    const [node, symbol, file] = splitArgs(a);
    if (!node || !symbol || !file)
      return h.refuse([
        "usage: node tap sample <node> <symbol> <@library/path | none>",
      ]);
    const clearing = file === "none";
    // The libraries' samples and this project's own, by the name the tap's picker offered.
    if (!clearing && !libraryFiles("samples", h.songPath).includes(file))
      return h.refuse([
        `no '${file}' in the libraries' or the project's samples/ — drop it into one first`,
      ]);
    await tapEdit(
      h,
      () =>
        setTap(h.songPath, node, symbol, { sample: clearing ? null : file }),
      `${node}: ${symbol} ${clearing ? "has no sample" : `plays ${file}`}`,
    );
  },
  "node.tap.add": async (a, h) => {
    const [node, symbol] = splitArgs(a);
    if (!node) return h.refuse(["usage: node tap add <node> [symbol]"]);
    try {
      const made = addTap(h.songPath, node, symbol);
      h.log([
        `${node}: tap ${made.symbol} on note ${made.note} — pick its sample`,
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`node tap add: ${(e as Error).message}`]);
    }
  },
  "node.tap.insert": async (a, h) => {
    const [node, side, beside, symbol] = splitArgs(a);
    if (!node || (side !== "before" && side !== "after") || !beside)
      return h.refuse([
        "usage: node tap insert <node> <before|after> <tap> [symbol]",
      ]);
    try {
      const made = addTap(h.songPath, node, symbol, { symbol: beside, side });
      h.log([
        `${node}: tap ${made.symbol} on note ${made.note}, ${side} ${beside} — pick its sample`,
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`node tap insert: ${(e as Error).message}`]);
    }
  },
  "node.tap.rename": async (a, h) => {
    const [node, symbol, name] = splitArgs(a);
    if (!node || !symbol || !name)
      return h.refuse(["usage: node tap rename <node> <symbol> <new name>"]);
    await tapEdit(
      h,
      () => renameTap(h.songPath, node, symbol, name),
      `${node}: tap ${symbol} is now ${name}`,
    );
  },
  "node.tap.remove": async (a, h) => {
    const [node, symbol] = splitArgs(a);
    if (!node || !symbol)
      return h.refuse(["usage: node tap remove <node> <symbol>"]);
    await tapEdit(
      h,
      () => removeTap(h.songPath, node, symbol),
      `${node}: tap ${symbol} removed`,
    );
  },

  "node.alt.create": (a, h) => moduleAltAdd(a, h, false),
  "node.alt.copy": (a, h) => moduleAltAdd(a, h, true),

  /** Freeze at a module — a TOGGLE; everything upstream is bounced to one wav, packages/song/docs/freeze.md. */
  "node.freeze": async (a, h) => {
    const module = a.trim().split(/\s+/).filter(Boolean)[0];
    if (!module) {
      h.refuse(["usage: node freeze <node>"]);
      return;
    }
    const g = loadGraph(h.songPath);
    const isLane = (n: string) => !!g.tracks[n];
    const current = g.modules[module]?.frozen;
    if (typeof current === "string" && current) {
      // Unfreeze: the attribute goes and so does the render, which the next `project commit` would stage.
      setModuleFrozen(h.songPath, module, null);
      rmSync(join(h.songPath, current), { force: true });
      h.log([`${module}: unfrozen — everything upstream is live again`]);
      await h.reload();
      return;
    }
    const why = freezeBlockedBy(g.chains, module);
    if (why) {
      h.refuse([`freeze: ${why}`]);
      return;
    }
    const render = `${FROZEN_DIR}/${module.replace(/[:/]/g, "-")}.wav`;
    const plan = freezePlans(g.chains, [[module, render]], isLane)[0];
    // A stopped strudel lane has no clips at all, so the render would be a file of silence — say so.
    const generated = [...plan.lanes].filter(
      (n) => g.tracks[n]?.type === "strudel",
    );
    if (generated.length) {
      h.refuse([
        `freeze: '${generated[0]}' is a strudel lane — its material only exists while it plays, so it can't be baked`,
      ]);
      return;
    }
    const p = h.project();
    // The track the render will play ON, decided by the COMPILER rather than guessed — docs/verbs.md.
    const owner = isLane(module)
      ? module
      : p.tracks.find((t) =>
          t.plugins.some(
            (pl) => pl.id.slice(pl.id.indexOf(":") + 1) === module,
          ),
        )?.id;
    if (!owner) {
      h.refuse([
        `freeze: '${module}' compiles to no plugin, so there is no signal at it to render`,
      ]);
      return;
    }
    const engine = findEngineBinary();
    if (!engine) {
      h.refuse([
        "freeze failed: st0-engine binary not found (build the engine)",
      ]);
      return;
    }
    // Stopped first: a freeze that lands mid-playback swaps a track's contents under a rolling transport.
    await h.transport("stop");
    const out = join(h.songPath, render);
    mkdirSync(dirname(out), { recursive: true });
    try {
      freezeUpstreamRender(engine, p, plan, out);
    } catch (e) {
      h.refuse([`freeze failed: ${(e as Error).message}`]);
      return;
    }
    setModuleFrozen(h.songPath, module, render);
    const inside = plan.lanes.size + plan.modules.size - 1;
    h.log([
      `${module}: frozen to ${render}${inside ? ` (${inside} node${inside > 1 ? "s" : ""} upstream baked in)` : ""} — everything downstream stays live`,
    ]);
    await h.reload();
  },

  /** node param <node> <param> <value> — node, param and value may each be quoted; docs/verbs.md. */
  "node.param": async (a, h) => {
    const m = /^("[^"]*"|\S+)\s+("[^"]*"|.+?)\s+("[^"]*"|\S+)$/.exec(a.trim());
    if (!m) {
      h.refuse([
        'usage: node param <node> <param> <value>  (e.g. node param synth "Filter Freq" 69)',
      ]);
      return;
    }
    const [, rawModule, rawParam, quotedValue] = m;
    const unquote = (s: string) => s.replace(/^"(.*)"$/s, "$1").trim();
    const module = unquote(rawModule);
    const param = unquote(rawParam);
    // Unquoted for EVERY branch below, not just the file one: `Number('"5"')` is NaN.
    const rawValue = unquote(quotedValue);
    // An INTRINSIC — the module's own field rather than a plugin's parameter; packages/song/docs/intrinsics.md.
    if (param.startsWith("@")) {
      await setIntrinsic(h, module, param.slice(1), rawValue);
      return;
    }
    // …and a FILE-valued one (`model`, `onnx`), whose value is a filename read at BUILD time — setFileParam.
    if (isFileParam(param) || isLibraryFileParam(param)) {
      await setFileParam(h, module, param, rawValue);
      return;
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      h.refuse([`"${rawValue}" is not a number — a param value is numeric`]);
      return;
    }
    // …and one of the four BUILT-IN outputs, answered before the lookup below would misreport it.
    if (isBuiltinOutput(module)) {
      await setBuiltinOutParam(h, module, param, value);
      return;
    }
    const p = h.project();
    const modules = collectPluginModules(p);
    const matches = modules.filter((b) => b.module === module);
    if (!matches.length) {
      h.refuse([
        `no plugin module '${module}'${modules.length ? ` — try: ${[...new Set(modules.map((b) => b.module))].join(", ")}` : ""}`,
      ]);
      return;
    }
    try {
      // Write the file first — it is the source of truth — then patch the engine in place with one PluginParamChanged.
      setModuleParam(h.songPath, module, param, value);
      const np: ProjectDoc = {
        ...p,
        tracks: p.tracks.map((t) => ({
          ...t,
          // One module in two chains is TWO PluginDocs, so patch every one: the first alone leaves the other stale.
          plugins: t.plugins.map((pl) =>
            matches.some((x) => x.id === pl.id)
              ? { ...pl, params: { ...pl.params, [param]: value } }
              : pl,
          ),
        })),
      };
      await h.applyProject(np);
      h.log([`${module}: ${param} = ${value}`]);
    } catch (e) {
      h.refuse([`node param failed: ${(e as Error).message}`]);
    }
  },

  // module cc <module> <param> <channel> <cc> — bind a MIDI control, or `none` to unbind; docs/verbs.md.
  "module.cc": async (a, h) => {
    const usage =
      "usage: module cc <module> <param> <channel 1-16> <cc 0-127>  (e.g. module cc synth Cutoff 1 74)\n" +
      "       module cc <module> <param> none            — unbind";
    const trimmed = a.trim();
    const unbind = /^(\S+)\s+(.+?)\s+none$/i.exec(trimmed);
    const bind = /^(\S+)\s+(.+?)\s+(\d+)\s+(\d+)$/.exec(trimmed);
    const m = unbind ?? bind;
    if (!m) {
      h.refuse([usage]);
      return;
    }
    const module = m[1];
    const param = m[2].replace(/^"(.*)"$/s, "$1").trim();
    const binding = unbind ? null : { ch: Number(m[3]), cc: Number(m[4]) };
    if (binding && (binding.ch < 1 || binding.ch > 16)) {
      h.refuse([`channel ${binding.ch} is not 1-16`, usage]);
      return;
    }
    if (binding && (binding.cc < 0 || binding.cc > 127)) {
      h.refuse([`cc ${binding.cc} is not 0-127`, usage]);
      return;
    }
    try {
      const { rel, ref } = bindModuleCc(h.songPath, module, param, binding);
      h.log([
        binding
          ? `${module}: ${param} <- ch${binding.ch} cc${binding.cc}  (${rel})`
          : `${module}: ${param} unbound  (${rel})`,
        // The map is the MODULE's, so it plays for every use of it.
        `${ref}'s map — shared by every node of it`,
      ]);
    } catch (e) {
      h.refuse([`module cc failed: ${(e as Error).message}`]);
    }
  },

  /** node automate <module> <param> <curve> [trigger] — point a parameter at a curve; `none` unbinds, docs/verbs.md. */
  "node.automate": async (a, h) => {
    const parts = splitWords(a);
    if (parts.length < 3) {
      h.refuse([
        "usage: node automate <module> <param> <curve> [trigger]",
        "       (e.g. node automate osc Filter Freq sweep)",
      ]);
      return;
    }
    const module = parts[0];
    // The last word is the curve unless the one before it is ALSO a known module — that is a trigger.
    const known = new Set(
      collectPluginModules(h.project()).map((b) => b.module),
    );
    const hasTrigger = parts.length >= 4 && known.has(parts[parts.length - 1]);
    const trigger = hasTrigger ? parts[parts.length - 1] : undefined;
    const curve = parts[parts.length - (hasTrigger ? 2 : 1)];
    const param = parts.slice(1, parts.length - (hasTrigger ? 2 : 1)).join(" ");
    if (!param) {
      h.refuse([
        "node automate: no parameter named between the module and the curve",
      ]);
      return;
    }
    try {
      const path = setModuleAutomationBinding(
        h.songPath,
        module,
        param,
        curve === "none" ? null : curveRef(curve),
        trigger,
      );
      await h.reload();
      h.log([
        curve === "none"
          ? `${module}: ${param} is no longer automated (${path})`
          : `${module}: ${param} <- ${curve}${trigger ? `, fired by ${trigger}` : ""}`,
      ]);
    } catch (e) {
      h.refuse([`node automate: ${(e as Error).message}`]);
    }
  },

  "curve.create": async (a, h) => {
    const name = a.trim();
    if (!name) {
      h.refuse(["usage: curve new <name>  (e.g. curve new sweep)"]);
      return;
    }
    try {
      const rel = createCurveFile(h.songPath, name);
      h.reload(); // the editor's file tree and the `curve` completions both read the folder
      h.log([`created ${rel}`]);
    } catch (e) {
      h.refuse([`curve new: ${(e as Error).message}`]);
    }
  },

  /** project surface new <type> [id] — declare a special view; no layout argument, docs/verbs.md. */
  "project.surface.create": async (a, h) => {
    // Spelled from the OPEN registry, not by hand: a usage string that omits the word you wanted
    // is worse than none, and a plugin's type completes like a builtin's.
    const usage = `usage: project surface new <${allSurfaceTypes().join("|")}> [id]  (e.g. project surface new turntables desk)`;
    const [type, id] = a.trim().split(/\s+/);
    // Narrowed rather than cast, so the list in the message cannot drift from the list the parser accepts.
    if (!type || !isSurfaceType(type)) {
      h.refuse([type ? `unknown surface type '${type}'` : usage, usage]);
      return;
    }
    try {
      const rel = createSurfaceFile(h.songPath, type, id || type);
      // The surface list decides the panes, so the shell has to re-read: this command's effect IS the layout.
      h.reload();
      h.log([`created ${rel}`]);
    } catch (e) {
      h.refuse([`project surface new: ${(e as Error).message}`, usage]);
    }
  },

  // One-shot format repairs are scripts under packages/song/scripts/, not rows in every palette.

  /** module new <category>/<name> [extends-ref] — scaffold a module, and only that; docs/verbs.md. */
  "module.create": async (a, h) => {
    const usage = "usage: module new <category>/<name> [extends-ref]";
    const [target, extendsRef, ...extra] = a
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!target || extra.length) {
      h.refuse([usage]);
      return;
    }
    const made = makeModule(h.songPath, target, extendsRef);
    if ("error" in made) {
      h.refuse([`module new failed: ${made.error}`, usage]);
      return;
    }
    const { rel } = made;
    // A chain names a NODE, never this — say so, since the next act is always the same one.
    const next = `use it with \`node new ${target} <node-name>\``;
    if (!rel) return h.refuse([`${target} is already here`, next]);
    h.log([
      `created ${rel} — add an inline plugin/rack (or an \`extends\`) to give it a sound`,
      next,
    ]);
    await h.reload();
  },

  /** node new <category>/<name>|<@ref> [<node-name>] [<extends-ref>] [x,y] — one USE of a module, AND its place in the graph; docs/verbs.md. */
  "node.new": async (a, h) => {
    const usage =
      "usage: node new <category>/<name>|<@module-ref> [<node-name>] [<extends-ref>] [x,y]";
    const parts = a.trim().split(/\s+/).filter(Boolean);
    // Born where the cursor was — the web sends the click, so a new node never asks the layout.
    const at = takeSpawnAt(parts);
    if (parts.length < 1 || parts.length > 3) {
      h.refuse([usage]);
      return;
    }
    const [target, ...rest] = parts;
    // A whole ref: the node extends it as it stands, with no workspace module scaffolded over it.
    if (target.startsWith("@")) {
      if (rest.length > 1 || rest.some((p) => p.includes("/"))) {
        h.refuse([usage]);
        return;
      }
      const leaf = target.split("/").pop() ?? "";
      const node = rest[0] ?? freeNodeName(h.songPath, leaf);
      try {
        const rel = createNodeOn(h.songPath, target, node);
        placeChainNode(h.songPath, node);
        setChainNodePosition(h.songPath, node, at ?? ORPHAN_AT);
        h.log([
          `created ${rel} on ${target} — in the graph, wired to nothing yet`,
        ]);
        await h.reload();
      } catch (e) {
        h.refuse([`node new failed: ${(e as Error).message}`]);
      }
      return;
    }
    const segs = target.split("/");
    if (segs.length !== 2 || !segs[0] || !segs[1]) {
      h.refuse([`'${target}' is not <category>/<name>`, usage]);
      return;
    }
    const [category, module] = segs;
    // Refs carry a slash, node names never do ([A-Za-z0-9_-]+): that is the whole distinction,
    // and it makes the ref's POSITION free — `… @engine/… name` and `… name @engine/…` both parse.
    const ref = rest.find((p) => p.includes("/"));
    const named = rest.find((p) => !p.includes("/"));
    if (rest.length > (ref && named ? 2 : 1)) {
      h.refuse([usage]);
      return;
    }
    // Nobody said what to call it: `<module>_<n>`, and no lane prefix — docs/verbs.md.
    const node = named ?? freeNodeName(h.songPath, module);
    try {
      // A CATALOGUE pick has no local folder yet: the ref scaffolds it on the way in, so the
      // gesture stays ONE command instead of a `module new` run ahead of it. A module already
      // there is not an error — the ordinary second pick of the same thing (docs/verbs.md).
      if (ref) {
        const made = makeModule(h.songPath, target, ref);
        if ("error" in made) {
          h.refuse([`node new failed: ${made.error}`, usage]);
          return;
        }
      }
      const rel = createNode(h.songPath, category, module, node);
      placeChainNode(h.songPath, node);
      // No cursor behind the line: a fresh layout would drop something wired to nothing anywhere, so this verb answers instead.
      setChainNodePosition(h.songPath, node, at ?? ORPHAN_AT);
      h.log([
        ref
          ? `created ${rel} on module ${category}/${module} from ${ref} — in the graph, wired to nothing yet`
          : `created ${rel} — in the graph, wired to nothing yet`,
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`node new failed: ${(e as Error).message}`]);
    }
  },

  /** assembly new <ref> <name> [x,y] — a templated box of nodes, wiring and all; docs/assemblies.md. */
  "assembly.new": async (a, h) => {
    const usage = "usage: assembly new <template-ref> <name> [x,y]";
    const parts = a.trim().split(/\s+/).filter(Boolean);
    const at = takeSpawnAt(parts);
    if (parts.length !== 2) {
      h.refuse([usage]);
      return;
    }
    const [ref, name] = parts;
    try {
      const { file, members } = createAssembly(
        h.songPath,
        ref,
        name,
        at ?? undefined,
      );
      h.log([
        `created ${file} — ${Object.keys(members).length} nodes, drawn as one box`,
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`assembly new failed: ${(e as Error).message}`]);
    }
  },

  /** assembly delete <name> — the record AND every node it holds, each spliced out like `node delete`. */
  "assembly.delete": async (a, h) => {
    const name = a.trim().split(/\s+/).filter(Boolean)[0];
    if (!name) {
      h.refuse(["usage: assembly delete <name>"]);
      return;
    }
    try {
      const members = assemblyMembers(h.songPath, name);
      // The record goes FIRST: each delete below asks the assemblies which boxes hold the node.
      const file = dissolveAssembly(h.songPath, name);
      const removed: string[] = [];
      for (const node of members) {
        // A member with no file left is one somebody already deleted — not a reason to stop halfway.
        try {
          removed.push(...deleteChainNode(h.songPath, node).removed);
        } catch {}
      }
      h.log([`deleted ${file} and ${removed.length} of its files`]);
      await h.reload();
    } catch (e) {
      h.refuse([`assembly delete failed: ${(e as Error).message}`]);
    }
  },

  /** assembly dissolve <name> — the record only; every node stays on the graph, wired as it was. */
  "assembly.dissolve": async (a, h) => {
    const name = a.trim().split(/\s+/).filter(Boolean)[0];
    if (!name) {
      h.refuse(["usage: assembly dissolve <name>"]);
      return;
    }
    try {
      const members = assemblyMembers(h.songPath, name);
      const file = dissolveAssembly(h.songPath, name);
      h.log([
        `dropped ${file} — its ${members.length} nodes are on the graph, untouched`,
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`assembly dissolve failed: ${(e as Error).message}`]);
    }
  },

  // No verb deletes a module: its files are the file tree's to remove — docs/verbs.md.

  /** node delete <node> — the node's file, its preset and its place in the graph; the module is untouched. */
  "node.delete": async (a, h) => {
    const node = a.trim().split(/\s+/).filter(Boolean)[0];
    if (!node) {
      h.refuse(["usage: node delete <node>"]);
      return;
    }
    try {
      const { rewired, removed } = deleteChainNode(h.songPath, node);
      // …and out of any box holding it, which loses its record once it has no members left.
      dropNodeFromAssemblies(h.songPath, node);
      h.log([
        `deleted ${removed.join(", ")}` +
          (rewired.length
            ? ` — rejoined what fed it: ${rewired.join(", ")}`
            : ""),
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`node delete failed: ${(e as Error).message}`]);
    }
  },

  // graph unlink <node> — out of the signal path, files untouched, so it goes back with `node insert`.
  "graph.unlink": async (a, h) => {
    const node = a.trim().split(/\s+/).filter(Boolean)[0];
    if (!node) {
      h.refuse(["usage: graph unlink <node>"]);
      return;
    }
    try {
      const { rewired } = unlinkChainNode(h.songPath, node);
      h.log([
        `unlinked ${node}` +
          (rewired.length
            ? ` and rejoined what fed it: ${rewired.join(", ")}`
            : " — nothing fed it, so there was nothing to rejoin") +
          "; it stays in the graph, wired to nothing",
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`graph unlink failed: ${(e as Error).message}`]);
    }
  },

  // module own <ref> — give an engine module a folder here, and repoint the chains at it (see moduleFork.ts).
  "module.own": async (a, h) => {
    const ref = a.trim().split(/\s+/).filter(Boolean)[0];
    if (!ref) {
      h.refuse(["usage: module own <@engine/…>"]);
      return;
    }
    try {
      const r = materialiseEngineModule(h.songPath, ref);
      h.log([
        `${r.ref} is now ${r.path}` +
          (r.chains.length ? `, played by ${r.chains.join(", ")}` : ""),
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`module own failed: ${(e as Error).message}`]);
    }
  },

  /** node replace <node> <extends-ref> — ONE edit to the node's `extends`, then its NAME follows; docs/verbs.md. */
  "node.replace": async (a, h) => {
    const usage = "usage: node replace <node> <extends-ref>";
    const [key, ref] = a.trim().split(/\s+/).filter(Boolean);
    if (!key || !ref) {
      h.refuse([usage]);
      return;
    }
    try {
      // What it extended BEFORE, read first because `setModuleExtends` is about to overwrite it.
      const was = moduleLeafOf(loadModules(h.songPath)[key]?.extends);
      const { rel, dropped, alternative } = setModuleExtends(
        h.songPath,
        key,
        ref,
      );
      h.log([
        `${key}${alternative ? `, alternative '${alternative}'` : ""}: extends ${ref} (${rel})` +
          (dropped.length ? ` — dropped its own ${dropped.join(", ")}` : ""),
      ]);
      // A SET repointed leaves the node's name alone: it names every set, and the first is still the old module.
      const renamed =
        was && !alternative ? renameForNewModule(h, key, was, ref) : null;
      await h.reload();
      if (renamed) h.log([renamed]);
    } catch (e) {
      h.refuse([`node replace failed: ${(e as Error).message}`]);
    }
  },

  "module.clone": async (a, h) => {
    const usage = "usage: clone module <category>/<name> <newName>";
    const args = a.trim().split(/\s+/);
    if (args.length !== 2 || !args[0] || !args[1]) {
      h.refuse([usage]);
      return;
    }
    const [target, newName] = args;
    const segs = target.split("/");
    if (segs.length !== 2 || !segs[0] || !segs[1]) {
      h.refuse([`'${target}' is not <category>/<name>`, usage]);
      return;
    }
    const [category, name] = segs;
    try {
      const rel = cloneModuleFile(h.songPath, category, name, newName);
      h.log([`cloned ${target} → ${rel}`]);
      await h.reload();
    } catch (e) {
      h.refuse([`clone module failed: ${(e as Error).message}`]);
    }
  },

  // The graph and timeline describers have CLI entries of their own, not palette rows — commands.yaml.

  /** node insert <before> <after> <node> [x,y] — splice a node that EXISTS into an arrow; docs/verbs.md. */
  "node.insert": async (a, h) => {
    const usage =
      "usage: node insert <before> <after> <node> [x,y] (the two ends of one graph arrow, then the node to splice between them)";
    const parts = a.trim().split(/\s+/).filter(Boolean);
    const at = takeSpawnAt(parts);
    if (parts.length < 3) {
      h.refuse([usage]);
      return;
    }
    const [before, after, node] = parts;
    let g: ReturnType<typeof loadGraph>;
    try {
      g = loadGraph(h.songPath);
    } catch (e) {
      h.refuse([`node insert: ${(e as Error).message}`]);
      return;
    }
    const arrow = arrowState(h.songPath, before, after);
    if (!arrow.ok) {
      h.refuse([arrow.error]);
      return;
    }
    // A real node: a shared module is named by its ref and lives in moduleRefs until a chain uses it.
    if (!(node in g.modules) && !(node in g.moduleRefs)) {
      h.refuse([
        `no node "${node}" in this project (nodes: ${Object.keys(g.modules).join(", ") || "none"}) — create one with \`node new\``,
      ]);
      return;
    }
    const cold = coldPlacementError(
      g,
      g.modules[node] ?? g.moduleRefs[node],
      node,
      before,
    );
    if (cold) {
      h.refuse([cold]);
      return;
    }
    try {
      // The master run drawn but never written: state the line, then splice into it — one command, as the `+` promises.
      if (arrow.write) connectChainNodes(h.songPath, before, after);
      insertChainStep(h.songPath, before, after, node);
      // Born where the `+` was clicked; from a typed line, on the cable it was spliced into — the same place, said twice.
      const born = at ?? midOfArrow(g.positions, before, after);
      if (born) setChainNodePosition(h.songPath, node, born);
      h.log([`inserted ${node} between ${before} and ${after}`]);
      await h.reload();
    } catch (e) {
      h.refuse([`node insert failed: ${(e as Error).message}`]);
    }
  },

  // Creating a node is `node new`'s and wiring one is `node insert`'s — docs/verbs.md.

  /** graph organize — hand EVERY node back to the layout, the ONLY reorganizing operation; docs/verbs.md. */
  "graph.organize": async (_a, h) => {
    try {
      clearChainNodePositions(h.songPath);
      h.log(["graph reorganized — every node handed back to the layout"]);
      await h.reload();
    } catch (e) {
      h.refuse([`graph organize failed: ${(e as Error).message}`]);
    }
  },

  /** graph move <node> <x> <y> — pin a node into graph.yaml's `positions:`; `auto` hands it back, docs/verbs.md. */
  "graph.move": async (a, h) => {
    const usage =
      "usage: graph move <node> <x> <y> (world px), or `graph move <node> auto`";
    const parts = a.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      h.refuse([usage]);
      return;
    }
    const [name, xArg, yArg] = parts;
    let g: ReturnType<typeof loadGraph>;
    try {
      g = loadGraph(h.songPath);
    } catch (e) {
      h.refuse([`graph move: ${(e as Error).message}`]);
      return;
    }
    // Everything on the graph is a NODE and every node can be put somewhere; the curves read is best-effort.
    const curves = (() => {
      try {
        return loadCurves(h.songPath);
      } catch {
        return {};
      }
    })();
    // An ASSEMBLY is drawn as a card and pinned like one, though it is no key of `modules:` —
    // one flat key space, so its name sits in `positions:` beside every node's (docs/assemblies.md).
    if (
      !isBuiltinOutput(name) &&
      !(name in g.modules) &&
      !(name in g.tracks) &&
      // A picture lane is a CARD on the graph like any other, and `videoTracks` is its own key.
      !(name in g.videoTracks) &&
      !(name in g.assemblies) &&
      !(name in curves)
    ) {
      h.refuse([`no node "${name}" in this project (${knownNodes(g)})`]);
      return;
    }
    try {
      if (xArg.toLowerCase() === "auto") {
        setChainNodePosition(h.songPath, name, null);
        h.log([`${name}: back to the layout`]);
      } else {
        const x = Number(xArg);
        const y = Number(yArg);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          h.refuse([usage]);
          return;
        }
        // Negative is allowed, and is the point: a node belongs above the first track as readily as below it.
        setChainNodePosition(h.songPath, name, { x, y });
        h.log([`${name}: pinned at ${Math.round(x)},${Math.round(y)}`]);
      }
      await h.reload();
    } catch (e) {
      h.refuse([`graph move failed: ${(e as Error).message}`]);
    }
  },

  /** graph chain connect <from> <to> — the patch-cable gesture; either end may carry `#port` (packages/song/docs/ports.md). */
  "graph.chain.connect": async (a, h) => {
    const usage =
      "usage: graph chain connect <from> <to> — each a node, optionally name#port (e.g. graph chain connect gtr reverb)";
    const parts = a.trim().split(/\s+/).filter(Boolean);
    if (parts.length !== 2) {
      h.refuse([usage]);
      return;
    }
    const [from, to] = parts;
    const base = (s: string) => s.split("#")[0];
    if (base(from) === base(to)) {
      h.refuse([`can't connect '${base(from)}' to itself`]);
      return;
    }
    let g: ReturnType<typeof loadGraph>;
    try {
      g = loadGraph(h.songPath);
    } catch (e) {
      h.refuse([`graph chain connect: ${(e as Error).message}`]);
      return;
    }
    if (base(from) === "OUT") {
      h.refuse(["OUT is the sink — it has no output to connect from"]);
      return;
    }
    // A lane MAY be fed, by exactly one thing: a run carrying a live interface input — docs/verbs.md.
    if (base(to) in g.tracks && !runCarriesInput(g, base(from))) {
      h.refuse([
        `'${base(to)}' is a track — only a live input's signal lands on a lane`,
      ]);
      return;
    }
    const known = (name: string) => namesANode(g, name);
    for (const end of [from, to])
      if (!known(base(end))) {
        h.refuse([`no node "${base(end)}" in this project (${knownNodes(g)})`]);
        return;
      }
    try {
      connectChainNodes(h.songPath, from, to);
      h.log([`connected ${from} → ${to}`]);
      await h.reload();
    } catch (e) {
      h.refuse([`graph chain connect failed: ${(e as Error).message}`]);
    }
  },

  /** graph chain disconnect <from> <to> — pull ONE cable out; no graph load, the file's own refusal IS the check. */
  "graph.chain.disconnect": async (a, h) => {
    const parts = a.trim().split(/\s+/).filter(Boolean);
    if (parts.length !== 2) {
      h.refuse([
        "usage: graph chain disconnect <from> <to> — each a node, optionally name#port",
      ]);
      return;
    }
    const [from, to] = parts;
    try {
      disconnectChainNodes(h.songPath, from, to);
      h.log([`disconnected ${from} → ${to}`]);
      await h.reload();
    } catch (e) {
      h.refuse([`graph chain disconnect failed: ${(e as Error).message}`]);
    }
  },

  /** graph chain replug <from> <to> <newFrom> <newTo> — move one end of an arrow in ONE write, one undo step. */
  "graph.chain.replug": async (a, h) => {
    const usage =
      "usage: graph chain replug <from> <to> <newFrom> <newTo> — the arrow from→to becomes newFrom→newTo";
    const parts = a.trim().split(/\s+/).filter(Boolean);
    if (parts.length !== 4) {
      h.refuse([usage]);
      return;
    }
    const [from, to, newFrom, newTo] = parts;
    if (from === newFrom && to === newTo) {
      h.refuse(["nothing moved — the cable is where it was"]);
      return;
    }
    const base = (s: string) => s.split("#")[0];
    if (base(newFrom) === base(newTo)) {
      h.refuse([`can't connect '${base(newFrom)}' to itself`]);
      return;
    }
    let g: ReturnType<typeof loadGraph>;
    try {
      g = loadGraph(h.songPath);
    } catch (e) {
      h.refuse([`graph chain replug: ${(e as Error).message}`]);
      return;
    }
    if (base(newFrom) === "OUT") {
      h.refuse(["OUT is the sink — it has no output to connect from"]);
      return;
    }
    if (base(newTo) in g.tracks) {
      h.refuse([`'${base(newTo)}' is a track — a source; nothing can feed it`]);
      return;
    }
    const known = (name: string) => namesANode(g, name);
    for (const end of [newFrom, newTo])
      if (!known(base(end))) {
        h.refuse([`no node "${base(end)}" in this project (${knownNodes(g)})`]);
        return;
      }
    try {
      replugChainNodes(h.songPath, from, to, newFrom, newTo);
      h.log([`replugged: ${from} → ${to} is now ${newFrom} → ${newTo}`]);
      await h.reload();
    } catch (e) {
      h.refuse([`graph chain replug failed: ${(e as Error).message}`]);
    }
  },

  // --- recording — the one lane edit that writes NO file, so it sits under `transport`, docs/verbs.md
  "transport.arm": async (a, h) => {
    const id = a.trim().split(/\s+/).filter(Boolean)[0];
    if (!id) {
      h.refuse(["usage: transport arm <track>"]);
      return;
    }
    const p = h.project();
    const matches = (x: { id: string; name: string }) =>
      x.id === id || x.name === id;
    const t = p.tracks.find(matches);
    if (!t) {
      h.refuse([
        p.groups.some(matches)
          ? `"${id}" is a group — arm takes a track (a group carries no input)`
          : `no track "${id}"`,
      ]);
      return;
    }
    // The rule: no input, no arm. A track with nothing feeding it would record silence, so say why instead of arming it.
    if (!t.inputChannels.length) {
      h.refuse([`"${t.id}" has no input — nothing to record`]);
      return;
    }
    if (!p.recordDir) {
      h.refuse([
        `"${p.name}" is a single-file song — it has no clips/ to record into`,
      ]);
      return;
    }
    // undefined == the engine refused or never answered; the host has already said which, and knows more than this.
    const armed = await h.arm(t.id);
    if (armed !== undefined)
      h.log([`${t.id}: ${armed ? "armed" : "disarmed"}`]);
  },

  "transport.play": (_a, h) => h.transport("play"),
  "transport.stop": (_a, h) => h.transport("stop"),
  "transport.toggle": (_a, h) => h.transport("toggle"),
  "transport.rewind": (_a, h) => h.transport("rewind"),
  // Not a transport MOVE: it stops and then tells every plugin to let go — docs/panic.md.
  "transport.panic": (_a, h) => h.transport("panic"),
  // Toggle the metronome: a PROJECT setting, so it rewrites settings.yaml and re-sends. The click is remembered.
  "transport.metronome": async (_a, h) => {
    const p = h.project();
    const on = !p.settings.metronome;
    const np: ProjectDoc = { ...p, settings: { ...p.settings, metronome: on } };
    try {
      writeMetronomeSetting(h.songPath, on);
      await h.applyProject(np);
      h.log([`metronome ${on ? "on" : "off"}`]);
    } catch (e) {
      h.refuse([`metronome failed: ${(e as Error).message}`]);
    }
  },
  /** `transport metronome volume <0.2..1>` — a PROJECT setting; the 0.2 floor is Tracktion's, docs/verbs.md. */
  "transport.metronomeVolume": async (a, h) => {
    const arg = a.trim();
    const v = Number(arg);
    if (!arg || !Number.isFinite(v)) {
      h.refuse(["usage: transport metronome volume <0.2..1>"]);
      return;
    }
    if (v < METRONOME_MIN || v > 1) {
      h.refuse([
        `the click's level runs ${METRONOME_MIN} to 1 — ${arg} is outside it` +
          (v < METRONOME_MIN
            ? "; to silence it use `transport metronome`, which is the switch"
            : ""),
      ]);
      return;
    }
    // Two decimals: a slider reads a pixel, and a file full of 0.6333333 is noise in a diff.
    const level = Math.round(v * 100) / 100;
    const p = h.project();
    const np: ProjectDoc = {
      ...p,
      settings: { ...p.settings, metronomeLevel: level },
    };
    try {
      writeMetronomeLevel(h.songPath, level);
      await h.applyProject(np);
      h.log([`metronome level ${level}`]);
    } catch (e) {
      h.refuse([`metronome volume failed: ${(e as Error).message}`]);
    }
  },
  /** `project aspect <ratio>` — the FRAME's shape, written as `project.viewport`'s pixel size.
   *  A ratio and not a size: a person picks 16:9, and 1920×1080 is what that means here. See
   *  packages/song/docs/picture.md. */
  "project.aspect": async (a, h) => {
    const want = aspectSize(a.trim());
    if (!want) {
      h.refuse([
        `"${a.trim()}" is not a frame shape — ${ASPECTS.map((x) => x.name).join(" or ")}`,
      ]);
      return;
    }
    const file = join(h.songPath, "project.yaml");
    // The third element is the EXPORT fps and is nobody's business here: read it back and keep it,
    // or a project that stated one silently loses it on a shape change.
    const now = loadProjectRoot(h.songPath).project?.viewport as
      | number[]
      | undefined;
    const fps = now && now.length > 2 ? Number(now[2]) : null;
    // RESHAPE the frame, do not resize it: the long edge is kept, so a 1280×720 project asked for
    // 9:16 becomes 720×1280 rather than jumping to 1080×1920. Picking the shape you are already
    // on then writes back what you had, instead of quietly changing your resolution.
    const long = now?.[0] && now?.[1] ? Math.max(now[0], now[1]) : 0;
    const [vw, vh] = !long
      ? [want.w, want.h]
      : want.w >= want.h
        ? [long, Math.round((long * want.h) / want.w)]
        : [Math.round((long * want.w) / want.h), long];
    setFileValue(
      file,
      ["project", "viewport"],
      fps && fps > 0 ? [vw, vh, fps] : [vw, vh],
    );
    h.log([`frame is ${want.name} (${vw}×${vh})`]);
    h.reload?.();
  },

  "project.reload": async (_a, h) => {
    await h.reload();
  },

  // commit <message> — stage, commit and push the whole repo. The message is the trailing line, so no quoting.
  "project.commit": async (a, h) => {
    const message = a.trim();
    if (!message) {
      h.refuse(["usage: commit <message>"]);
      return;
    }
    const dir = h.repoDir ?? h.songPath;
    if (!dir) {
      h.refuse(["no repository"]);
      return;
    }
    try {
      const r = commitAndPush(dir, message, h.gitEnv);
      if (r.nothingToCommit) {
        h.refuse(["nothing to commit — the project is clean"]);
        return;
      }
      const files = `${r.changed} file${r.changed === 1 ? "" : "s"}`;
      const head = `committed ${r.sha} (${files}) — ${message}`;
      // A failed push is not a failed commit: say it landed locally and why it didn't reach the remote.
      h.log(
        r.pushed
          ? [head, "pushed"]
          : [head, `push failed (commit is local): ${r.pushError}`],
      );
    } catch (e) {
      h.refuse([`commit failed: ${(e as Error).message}`]);
    }
  },

  // pull — `--ff-only`, so a diverged branch fails with git's own message instead of a half-merged tree.
  "project.pull": async (_a, h) => {
    const dir = h.repoDir ?? h.songPath;
    if (!dir) {
      h.refuse(["no repository"]);
      return;
    }
    try {
      const r = pull(dir, h.gitEnv);
      h.log([r.upToDate ? "already up to date" : `pulled — ${r.summary}`]);
      if (!r.upToDate && h.songPath) await h.reload();
    } catch (e) {
      h.refuse([`pull failed: ${(e as Error).message}`]);
    }
  },

  // project libraries update — the ACCOUNT's libraries, not the workspace: the file service keeps them.
  "project.libraries.update": async (_a, h) => {
    if (!h.updateLibraries) {
      h.refuse([
        "the libraries are kept by the file service — update them from st0",
      ]);
      return;
    }
    const results = await h.updateLibraries();
    if (!results.length) {
      h.refuse(["this account has no libraries — add one on st0's home page"]);
      return;
    }
    h.log(results.map((r) => `${r.name}: ${r.note}`));
    // The modules a song resolves through `@<library>/…` just moved, so what is open is out of date.
    if (
      results.some((r) => r.state === "updated" || r.state === "cloned") &&
      h.songPath
    )
      await h.reload();
  },

  // --- alternatives: all four act on the REPO, since an alternative is a branch of the whole clone
  "project.alt.new": async (a, h) => {
    const name = a.trim().split(/\s+/)[0] ?? "";
    if (!name) return h.refuse(["usage: project alternative new <name>"]);
    const dir = h.repoDir ?? h.songPath;
    if (!dir) return h.refuse(["no repository"]);
    try {
      const from = newAlternative(dir, name, h.gitEnv);
      h.log([`alternative '${name}' started from '${from}' — you are on it`]);
      await h.reload();
    } catch (e) {
      h.refuse([`alternative new failed: ${(e as Error).message}`]);
    }
  },
  "project.alt.apply": async (_a, h) => {
    const dir = h.repoDir ?? h.songPath;
    if (!dir) return h.refuse(["no repository"]);
    try {
      const { alt, parent, wip } = applyAlternative(dir, h.gitEnv);
      h.log(
        [
          // The wip commit is named, like `switch` names it: nobody asked for it, so its name is the way back.
          wip ? `committed work in progress as "${wip}"` : null,
          `applied '${alt}' into '${parent}' — you are on '${parent}'`,
        ].filter(Boolean) as string[],
      );
      await h.reload();
    } catch (e) {
      h.refuse([`alternative apply failed: ${(e as Error).message}`]);
    }
  },
  "project.alt.cancel": async (_a, h) => {
    const dir = h.repoDir ?? h.songPath;
    if (!dir) return h.refuse(["no repository"]);
    try {
      const { alt, parent } = cancelAlternative(dir, h.gitEnv);
      h.log([`dropped '${alt}'s changes — you are on '${parent}'`]);
      await h.reload();
    } catch (e) {
      h.refuse([`alternative cancel failed: ${(e as Error).message}`]);
    }
  },
  "project.alt.switch": async (a, h) => {
    const name = a.trim().split(/\s+/)[0] ?? "";
    if (!name) return h.refuse(["usage: project alternative switch <name>"]);
    const dir = h.repoDir ?? h.songPath;
    if (!dir) return h.refuse(["no repository"]);
    try {
      const { from, wip } = switchAlternative(dir, name, h.gitEnv);
      h.log([
        wip
          ? `committed work in progress on '${from}' as "${wip}", now on '${name}'`
          : `now on '${name}'`,
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`alternative switch failed: ${(e as Error).message}`]);
    }
  },
};

/** Add a plugin's verb: the SID it dispatches under and the behaviour that runs. The catalogue
 *  half is `registerCommandSpec`'s (commandSpec.ts) — a plugin contributes BOTH, through
 *  `@studio/st0-sdk`'s installer, which calls the two in one move. A SID that is already spoken
 *  for is refused, never shadowed: one SID, one behaviour. */
export function registerCommand(c: { sid: string; handler: SidHandler }): void {
  if (SID_HANDLERS[c.sid])
    throw new Error(`command '${c.sid}' already has a handler`);
  SID_HANDLERS[c.sid] = c.handler;
}
