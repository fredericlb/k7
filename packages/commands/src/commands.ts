// commands.ts — the feature registry: one stable SID (module.new, transport.play, …) per
// capability, mapped to a handler that acts through a CommandHost, so the SAME feature
// runs from the web command bar and from `l8 cmd`. Which words invoke a SID lives
// declaratively in commands.yaml (see commandSpec.ts); this file is just the behaviours.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import type {
  AudioDeviceInfo,
  PluginInfo,
} from "@studio/engine-client/engineClient";
import { bindModuleCc } from "@studio/song/controllerBind";
import { createCurveFile, loadCurves } from "@studio/song/curves";
import { freezeBlockedBy, freezePlans } from "@studio/song/freeze";
import { coldPlacementError, loadGraph, parseChains } from "@studio/song/graph";
import {
  cloneModuleFile,
  createModuleFile,
  createNode,
  createTrackFile,
  isFileParam,
  loadChains,
  loadModuleRefs,
  loadModules,
  loadProjectRoot,
  moduleRefOf,
} from "@studio/song/loader";
import { moduleAssetChoices } from "@studio/song/moduleAssetChoices";
import { materialiseEngineModule } from "@studio/song/moduleFork";
import { addOnset, moveOnset, removeOnset } from "@studio/song/onsets";
import {
  clearChannelLabel,
  formatAudioDevice,
  formatChannels,
  loadPreferences,
  parseChannels,
  setChannelLabel,
} from "@studio/song/preferences";
import type { ClipDoc, ProjectDoc, TrackDoc } from "@studio/song/project";
import { loadAudioClipDoc, trackMixer } from "@studio/song/project";
import {
  clearChainNodePositions,
  clipFilePath,
  clipOnsets,
  clipWarpMarkers,
  connectChainNodes,
  deleteChainNode,
  disconnectChainNodes,
  insertChainStep,
  moduleAlternatives,
  newModuleAlternative,
  placeChainNode,
  replugChainNodes,
  selectModuleAlternative,
  setChainNodePosition,
  setClipOnsets,
  setClipWarp,
  setClipWindow,
  setModuleAsset,
  setModuleBypass,
  setModuleChannel,
  setModuleExtends,
  setModuleFrozen,
  setModuleInputGain,
  setModuleMonitor,
  setModuleParam,
  unlinkChainNode,
} from "@studio/song/projectEdit";
import {
  beatsToDuration,
  beatsToPosition,
  parseDuration,
  parsePosition,
} from "@studio/song/timecode";
import {
  addTrackPlacement,
  keepTrackTake,
  movePlacementToTrack,
  moveTrackPlacement,
  moveTrackPlacementsInRange,
  removeTrackPlacement,
  removeTrackTake,
  resizeTrackPlacement,
  selectTrackTake,
  setTrackPlacementDisabled,
  trackTakes,
} from "@studio/song/trackMix";
import {
  removeWarpPoint,
  seedWarp,
  setWarpPoint,
} from "@studio/song/warpPoints";
import { deleteFileValue, setFileValue } from "@studio/song/yaml/edit";
import type { GraphFile } from "@studio/song/yaml/graphSchema";
import { moduleFileFor, readModuleFile } from "@studio/song/yaml/moduleIO";
import {
  appendNotes,
  isPlayableNote,
  moveNote,
  removeNote,
  setNoteTimeRange,
  setNoteVelocity,
} from "@studio/song/yaml/sequenceFile";
import {
  applyAlternative,
  cancelAlternative,
  commitAndPush,
  type GitEnv,
  newAlternative,
  pull,
  switchAlternative,
} from "./git";
import { DEFAULT_PEAK, normalizeInPlace } from "./normalize";
import { processWithChain, type Scope } from "./processChain";
import { freezeUpstreamRender } from "./render";
import { DEFAULT_TRIM_DB, trimWindow } from "./trimGate";

// Where a freeze render lands: one folder for the lot, at the project root. NOT beside the
// module's own file — a node's folder is `nodes/`, shared by every node in the song,
// and a module from a catalogue has a folder shared by every song. A render belongs to THIS
// project, so it lives where the project can see all of them at once.
const FROZEN_DIR = "renders";

export type TransportAction = "play" | "stop" | "toggle" | "rewind";

// The environment a feature acts on, implemented by the CLI and the web backend. `project()` is a getter, so the
// CLI can lazy-load rather than compile a project the command may not need.
export interface CommandHost {
  songPath: string;
  project(): ProjectDoc;
  baseModules: string[]; // plugin module refs a module can extend (for completion)
  log(lines: string[]): void;
  reload(): void | Promise<void>;
  // engine ops (may connect + await):
  transport(a: TransportAction): void | Promise<void>;
  // Toggle a track's arm, resolving to the resulting state — undefined when the engine refused and already said why.
  // The engine owns this state; nothing is written to disk.
  arm(track: string): Promise<boolean | undefined>;
  applyProject(p: ProjectDoc): void | Promise<void>; // set + push to engine
  sendProject(p: ProjectDoc): void | Promise<void>;
  listPlugins(filter?: string): void | Promise<void>;
  rescanPlugins(force?: boolean): void | Promise<void>;
  showNativePluginUI(id: string): void | Promise<void>;
  getPlugins(filter?: string): Promise<PluginInfo[]>;
  // The audio interfaces the engine can see, for `module populate` — it files one io/IN
  // node per input of the one in use. Optional: a host with no engine link simply
  // populates the plugin modules and says the inputs were skipped.
  getAudioDevices?(): Promise<AudioDeviceInfo[]>;
  // A clip's source envelope — per-bucket peaks over the file's whole duration, for `clip trim`,
  // which has to know where the sound is before it can cut what is not. Optional for the reason
  // above: building it needs the engine (it decodes and downsamples into the `.cache` sidecar), so
  // a host without one refuses the trim by name rather than guessing at a window.
  clipEnvelope?(
    clip: string,
  ): Promise<{ peak: number[]; seconds: number } | null>;
  // Transport config for git, merged over the env: the web host pins GIT_SSH_COMMAND to the user's deploy key,
  // the CLI leaves it to the machine's own config.
  gitEnv?: GitEnv;
  // Where the whole-repo git commands run — the workspace ROOT on the web, since a workspace is one cloned repo.
  repoDir?: string;
  // Back up a file the command is about to overwrite (an absolute path), so undo can restore it.
  // The web host wires this to its edit journal; the CLI leaves it undefined and simply overwrites.
  snapshot?(absPath: string): void;
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

// Rewrite the project's `markers` map. Keys are QUOTED: unquoted, `2:1:1` is a YAML 1.1 sexagesimal integer.
function writeMarkers(songPath: string, map: Record<string, string>): void {
  setFileValue(join(songPath, "project.yaml"), ["markers"], map);
}

// Flip the persisted metronome flag in settings.yaml (a FLAT file), creating it when a project has none.
// That file is the source of truth — the engine reads it off the compiled doc, so the caller re-sends.
function writeMetronomeSetting(songPath: string, on: boolean): void {
  setFileValue(join(songPath, "settings.yaml"), ["metronome"], on);
}

/**
 * Why `before → after` is not an arrow in graph.yaml, or null when it is.
 *
 * Read off the SEGMENTS rather than the derived chains: the file states the edges outright, so the check is a
 * lookup instead of a walk — and the message can list what the node actually feeds, which is the next thing
 * anyone asks.
 */
function arrowError(
  songPath: string,
  before: string,
  after: string,
): string | null {
  const file = loadChains(songPath, loadProjectRoot(songPath, true), true) as
    | GraphFile
    | undefined;
  const dests = file?.modules?.[before];
  if (!dests)
    return `no node "${before}" in graph.yaml (nodes: ${
      Object.keys(file?.modules ?? {}).join(", ") || "none"
    })`;
  if (!dests.includes(after))
    return `'${before}' does not feed '${after}' (it feeds: ${dests.join(", ") || "nothing"})`;
  return null;
}

/**
 * An optional trailing `<x>,<y>` — where the cursor was when the web asked, so a created
 * node is BORN there instead of asking the layout. Pulled off the argument list before any
 * other parsing: the comma makes it unmistakable for a ref or a node name, which is the
 * whole reason for the spelling. Clamped to the world's origin like every pin.
 */
function takeSpawnAt(parts: string[]): { x: number; y: number } | null {
  const last = parts[parts.length - 1];
  const m = last ? /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(last) : null;
  if (!m) return null;
  parts.pop();
  return { x: Math.max(0, Number(m[1])), y: Math.max(0, Number(m[2])) };
}

// `splitOptionals` was here — it told an `[extends-ref]` from a `[node-name]` by SHAPE, because
// `module new` took both and they were positional. `module new` writes a module and nothing else
// now, so there is one optional left and nothing to disambiguate.

// `coldInsertError` was here: the cold rule asked of a module that did not exist yet, since
// `node insert` created one. It takes a node that IS there now, so the general
// `coldPlacementError` answers directly.

/** What a module already on disk extends, or "" — read from its own file rather than through
 *  the loaders, which walk every library to answer a question about one known folder. */
function existingExtends(
  songPath: string,
  category: string,
  name: string,
): string {
  const folder = join(songPath, "modules", category, name);
  const file = moduleFileFor(folder, `${category}/${name}`, "module");
  if (!file) return "";
  try {
    const ext = readModuleFile(file).value?.extends;
    return typeof ext === "string" ? ext : "";
  } catch {
    return ""; // unreadable: the caller's other checks still apply, and instancing is harmless
  }
}

/**
 * Create the module a `+` picked and hand back its name, or the message to show instead.
 *
 * The picker offers two kinds of thing and this handles both: something from the CATALOGUE (no local folder yet
 * — create one extending it) and a module this project already has (leave it alone, do not recreate it).
 *
 * It does NOT make a node. `module new` writes a module and stops: what a chain names is a node, and creating
 * one is `node new`'s — which also puts it in the graph, since a node with no entry there is drawn nowhere.
 * Bundling the two here is what made "create a module" and "start using it" one act that could not be had
 * separately.
 */
function makeModule(
  songPath: string,
  target: string,
  extendsRef?: string,
): { ref: string; rel: string | null } | { error: string } {
  const segs = target.split("/");
  if (segs.length !== 2 || !segs[0] || !segs[1])
    return { error: `'${target}' is not <category>/<name>` };
  const [category, name] = segs;
  const exists = existsSync(join(songPath, "modules", category, name));
  // Already there AND told to inherit something else: a real disagreement, not redundancy — a
  // module cannot be re-parented by asking for it again, so acting would ignore what was typed.
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

function uniqueId(base: string, project: ProjectDoc): string {
  const ids = new Set(project.tracks.map((t) => t.id));
  let n = 1;
  while (ids.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** The track + the event sitting at `atTc`, or null with the reason already logged.
 *  The three `event` commands all need exactly this lookup. */
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
    h.log([
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
    h.log([`bad timecode: ${(e as Error).message}`]);
    return null;
  }
  const hit = track.clips.find((c) => Math.abs(c.start - atBeats) < 1e-6);
  if (!hit) {
    h.log([`no event on '${track.id}' at ${atTc}`]);
    return null;
  }
  return { track, atBeats, hit, num, den, tempo: p.tempo };
}

// `track new <kind> [name]`. Falls back to the next free <kind>-N when unnamed.
async function newTrack(
  arg: string,
  h: CommandHost,
  kind: "audio" | "midi",
): Promise<void> {
  const name = arg.trim().split(/\s+/)[0] ?? "";
  const id = name || uniqueId(kind, h.project());
  try {
    const written = createTrackFile(h.songPath, id, kind);
    h.reload(); // the doc now comes from disk, so the mixer and the engine agree with it
    h.log([`+ ${kind} track ${id} (${written.join(", ")})`]);
  } catch (e) {
    h.log([`track new ${kind}: ${(e as Error).message}`]);
  }
}

// What a mute/solo can address. A group is a lane too — one that carries no signal — and both are
// silenced the same way, by name, in `graph.yaml`'s `bypassed:`.
type MixTarget = Pick<TrackDoc, "id" | "name" | "mute">;

/**
 * Silence (or un-silence) a set of lanes, and push the result.
 *
 * A lane's mute IS its module's bypass — one state, in the one place a bypass is written
 * (packages/song/docs/trackModules.md). `track mute` is this; solo stopped being — it is
 * project state now (`soloed:` in project.yaml, see track.solo below), not a set of mutes.
 *
 * The doc is mutated and pushed rather than reloaded, so a mixer move stays snappy.
 */
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

// --- a module's alternatives (see packages/song/docs/alternatives.md) ---------
//
// The names are read off the module's own FILE rather than off the compiled doc: an alternative
// may change any field, so the doc carries the chosen one collapsed in and has nothing left to
// say about the others.

/** `node alternative create|copy` — one shape, one difference. */
async function moduleAltAdd(
  a: string,
  h: CommandHost,
  copy: boolean,
): Promise<void> {
  const verb = copy ? "copy" : "create";
  const [module, name] = a.trim().split(/\s+/).filter(Boolean);
  if (!module) {
    h.log([`usage: node alternative ${verb} <node> [name]`]);
    return;
  }
  try {
    const made = newModuleAlternative(h.songPath, module, name, { copy });
    h.log([
      `${module}: alternative '${made.name}' — ${copy ? "a copy of the one that was on" : "empty, and running"}`,
    ]);
    await h.reload();
  } catch (e) {
    h.log([`node alternative ${verb}: ${(e as Error).message}`]);
  }
}

/**
 * Resolve `<track> <n>` for the two take verbs, or say what is wrong with it.
 *
 * The count is read off the FILE rather than off the compiled project, so a take can still be
 * deleted on a lane the compiler is currently refusing — the file is what these two verbs write.
 */
function takeTarget(
  a: string,
  h: CommandHost,
  verb: string,
): { track: { id: string }; n: number } | null {
  const [idArg, nArg] = a.trim().split(/\s+/).filter(Boolean);
  if (!idArg || nArg === undefined) {
    h.log([`usage: track take ${verb} <track> <n>`]);
    return null;
  }
  const p = h.project();
  const track = p.tracks.find((t) => t.id === idArg || t.name === idArg);
  if (!track) {
    h.log([`no track "${idArg}"`]);
    return null;
  }
  const n = Number(nArg);
  if (!Number.isInteger(n) || n < 1) {
    h.log([`take numbers count from 1 — "${nArg}" is not one`]);
    return null;
  }
  const have = trackTakes(h.songPath, track.id).length;
  if (n > have) {
    h.log([
      have
        ? `${track.id} has ${have} take${have > 1 ? "s" : ""} — no take ${n}`
        : `${track.id} has no takes`,
    ]);
    return null;
  }
  return { track, n };
}

/** Resolve a `track mute`/`track solo` argument to a lane or a group, or report why not. */
function mixTarget(a: string, h: CommandHost, verb: string): MixTarget | null {
  const id = a.trim().split(/\s+/).filter(Boolean)[0];
  if (!id) {
    h.log([`usage: ${verb} <track|group>`]);
    return null;
  }
  const p = h.project();
  const matches = (x: { id: string; name: string }) =>
    x.id === id || x.name === id;
  const target = p.tracks.find(matches) ?? p.groups.find(matches);
  if (!target) {
    h.log([`no track "${id}"`]);
    return null;
  }
  return target;
}

// --- the channel strip -------------------------------------------------------

/**
 * `track process` / `clip process`: bounce material through a chain and keep the result.
 *
 * One implementation, two commands, because the only thing that differs is what the first
 * argument may name — and that difference is worth a command each, since it is the promise the
 * noun makes. See processChain.ts and docs/processChain.md.
 */
/**
 * `<scope> normalize <target> [peak]` — the material brought to a peak, over itself.
 *
 * `peak` is linear (1.0 == full scale) and optional; the default leaves a decibel of headroom, for the
 * reason DEFAULT_PEAK gives. A reload follows because the FILES changed under the compiler — the clip
 * definitions did not, so nothing else would notice.
 */
async function normalizeCommand(
  arg: string,
  h: CommandHost,
  scope: Scope,
): Promise<void> {
  const [target, peakArg] = arg.trim().split(/\s+/).filter(Boolean);
  if (!target) {
    h.log([
      `usage: ${scope} normalize <${scope}> [peak 0–1, default ${DEFAULT_PEAK}]`,
    ]);
    return;
  }
  const peak = peakArg === undefined ? DEFAULT_PEAK : Number(peakArg);
  if (!Number.isFinite(peak)) {
    h.log([`'${peakArg}' is not a peak — a number over 0 and at most 1`]);
    return;
  }
  const { lines, changed } = normalizeInPlace(
    h.songPath,
    h.project(),
    target,
    scope,
    findEngineBinary(),
    peak,
    // The same journal hook the bounce uses, so this is one Ctrl+Z away.
    (abs) => h.snapshot?.(abs),
    // A clip is measured AND gained inside its own `from`/`to`: the operation acts on the
    // material the event is, and the take around it keeps its bytes. A track names files, not
    // events, so its scope stays the whole file.
    scope === "clip" ? clipWindow(h, target) : null,
  );
  h.log(lines);
  if (changed) await h.reload();
}

/**
 * The interval a clip PLAYS, in file seconds — its `from`/`to` resolved the way the compiler
 * resolves them (timecode spelling included), or null when it states none.
 *
 * This is what bounds `clip trim` and `clip normalize`: an operation launched on an event acts on
 * the material that event IS, not on the rest of the take around it. `to` comes back as Infinity
 * when only `from` is stated — each caller clamps it to what it knows the file to be.
 */
function clipWindow(
  h: CommandHost,
  clip: string,
): { from: number; to: number } | null {
  const p = h.project();
  const doc = loadAudioClipDoc(h.songPath, clip, {
    tempo: p.tempo,
    num: p.timeSigNumerator,
    den: p.timeSigDenominator,
  });
  if (!doc || (doc.sourceFrom == null && doc.sourceTo == null)) return null;
  return {
    from: doc.sourceFrom ?? 0,
    to: doc.sourceTo ?? Number.POSITIVE_INFINITY,
  };
}

/**
 * `clip onset add|remove|move <clip> <sec…>` — a correction to the detected onsets, in FILE seconds.
 *
 * A time within ONSET_MATCH_S of an existing one is understood as that one, which is what lets a person
 * type an approximate second and lets a re-detection keep answering the same correction. Adding where a
 * removal sits cancels the removal rather than stacking on it, and vice versa — see song/onsets.ts.
 */
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
    h.log([
      op === "move"
        ? "usage: clip onset move <clip> <from-sec> <to-sec>"
        : `usage: clip onset ${op} <clip> <sec>`,
    ]);
    return;
  }
  const before = clipOnsets(h.songPath, clip);
  // The DETECTED set is not read here: the tolerance in song/onsets.ts is what matches a time to an onset,
  // so a caller that knows the exact detected time gets an exact record and one that guesses still lands.
  const after =
    op === "add"
      ? addOnset(before, secs[0])
      : op === "remove"
        ? removeOnset(before, [], secs[0])
        : moveOnset(before, [], secs[0], secs[1]);
  try {
    setClipOnsets(h.songPath, clip, after);
  } catch (e) {
    h.log([`clip onset ${op}: ${(e as Error).message}`]);
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
  // The target is ONE token and the chain is the rest, so a médiathèque path keeps its slashes
  // without needing quotes. Both are required — a bounce with no chain would be a copy.
  const [target, ...rest] = arg.trim().split(/\s+/).filter(Boolean);
  const chain = rest.join(" ");
  if (!target || !chain) {
    h.log([
      `usage: ${scope} process <${scope}${scope === "clip" ? "|path" : ""}> <chain>  ` +
        "(a chain of this project, or @st0/<path>)",
    ]);
    return;
  }
  const { lines, changed } = processWithChain(
    h.songPath,
    h.project(),
    target,
    chain,
    scope,
    // Back up each render before it's overwritten, so the web host's journal can undo the bounce.
    (abs) => h.snapshot?.(abs),
  );
  h.log(lines);
  // Only when something landed: the clip files changed under the compiler, and nothing else
  // would tell it. A run that wrote nothing has nothing to re-read.
  if (changed) await h.reload();
}

/**
 * A module's INTRINSICS — its own fields, set as `node param <node> @<field> <value>`.
 *
 * Each takes the value as TYPED and answers with what to say about it, or throws the sentence
 * that says why it cannot. They are a table rather than a verb apiece (`module channel`,
 * `module monitor`) because from the outside they are one act — set this control on this
 * module — and the `@` is the whole of the difference from a plugin param: a param is sent to a
 * running plugin, a field is written into the file and read when the module is BUILT.
 *
 * That is also what makes them reachable from a widget: a `bind: "@channel"` in a module's
 * `ui.yaml` needs no command of its own, and the day a fourth field is bindable it needs no
 * verb either — one line here. See packages/song/docs/intrinsics.md.
 */
const INTRINSICS: Record<
  string,
  (dir: string, module: string, raw: string) => { path: string; said: string }
> = {
  // One channel or two, and two only ever means a pair the interface actually groups —
  // `findWaveInput` matches a device on its exact channel list, so a set the rig does not offer
  // resolves to nothing and plays as silence. Nothing here can check that (the rig is the
  // engine's to know); the graph's IN panel only ever offers sets that exist, and this refuses
  // the shapes that could never be one.
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
};

/**
 * Point a FILE-VALUED param at one of the module's own assets, or clear it with `none`.
 *
 * `nam` and `onnx` (moduleTypes' FILE_PARAMS) are params like any other — they land in `params:`
 * beside the numbers — but their value is a filename, so two things differ. It is checked
 * against the assets the module actually carries, and it is NOT patched into the running engine:
 * a plugin loads its file when it is BUILT, so this writes and reloads. Swapping an amp model is
 * not a knob drag.
 *
 * They had a verb apiece (`module nam`), and the second one never got written: the asset picker
 * sends `${param} …` for whichever param it was opened on, so picking an `.onnx` reached a
 * command that did not exist. One branch here answers both, and the next one costs nothing.
 */
async function setFileParam(
  h: CommandHost,
  module: string,
  param: string,
  rawFile: string,
): Promise<void> {
  const file = rawFile.replace(/^"(.*)"$/s, "$1").trim();
  const clearing = file === "none";
  // An empty list means the module has no `assets/` — say that, not "no such file", which
  // sends you looking through a directory that isn't there. The files live in the module,
  // so there is one place to look and nothing to declare anywhere.
  if (!clearing) {
    const found = loadModules(h.songPath)[module];
    // Its own assets AND its ancestors': the same answer the panel's picker offers, so the
    // command cannot refuse a file the picker just showed. It could — a song points at a shared
    // amp with a thin local module that extends it, and only the shared folder holds the files.
    const have = moduleAssetChoices(
      h.songPath,
      found,
      loadModuleRefs(h.songPath),
    );
    if (!have.includes(file)) {
      h.log([
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
    h.log([`node param ${param} failed: ${(e as Error).message}`]);
  }
}

/**
 * Write one intrinsic, and say where it landed.
 *
 * The file may be the workspace's SHARED one — `module populate` files one io/IN node per
 * interface channel there, beside the `channel:` that says which channel it is — so the reach
 * of the write is said out loud. Nothing else here writes past the project on a click.
 *
 * Reloaded rather than patched into the running engine: a field is read when the module is
 * built, so the engine learns it by rebuilding the track's input.
 */
async function setIntrinsic(
  h: CommandHost,
  module: string,
  field: string,
  raw: string,
): Promise<void> {
  const write = INTRINSICS[field];
  if (!write) {
    h.log([
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
    h.log([`node param @${field} failed: ${(e as Error).message}`]);
  }
}

// --- SID registry ------------------------------------------------------------

export const SID_HANDLERS: Record<string, SidHandler> = {
  // A track IS its file. These used to hand a doc built in memory to applyProject, which
  // caches it and tells the engine — so a strip appeared in the mixer and nothing was
  // written, and the track vanished on the next reload. Write the file, then reload, so
  // what plays is what is on disk.
  "track.new.audio": async (a, h) => newTrack(a, h, "audio"),
  "track.new.midi": async (a, h) => newTrack(a, h, "midi"),

  // Bounce material through a chain and keep the result: the render lands beside the source and the
  // clip files are pointed at it. The mechanism (and the reasoning) is processChain.ts; the two
  // commands differ only in what their first argument may name, which is what `scope` carries.
  "track.process": (a, h) => processCommand(a, h, "track"),
  "clip.process": (a, h) => processCommand(a, h, "clip"),

  // Peak-normalise the material itself, in place and undoably — the engine has always known how, and
  // until now nothing asked it. See normalize.ts for why in place is safe and why it is WAV only.
  "track.normalize": (a, h) => normalizeCommand(a, h, "track"),
  "clip.normalize": (a, h) => normalizeCommand(a, h, "clip"),

  // --- a clip's onsets ---------------------------------------------------------
  // Corrections to what the engine detected, kept as a DIFF so they outlive a re-detection at another
  // sensitivity (song/onsets.ts). Three verbs rather than one that takes a list: each is a thing a person
  // does, each is one line in the file, and each is one entry in the undo journal.
  /**
   * clip trim <clip> [gate-dB] — cut the silence off both ends.
   *
   * It moves the clip's WINDOW (`from`/`to` in its sidecar), it does not touch the audio. A take's
   * head is the tail of a count-in and the player settling; its foot is a room and a hand leaving a
   * string. Both are things you stop PLAYING, not things you want destroyed — and a window is one
   * line to put back, where a rewritten wav is a restore from the undo journal.
   *
   * The gate is in dBFS and defaults to −40: below a room's floor on any usable take, above true
   * digital silence. Where it lands is `trimWindow`'s decision and is tested there — BOUNDED to
   * the window the clip already has, so a re-trim refines it and never reaches back into material
   * an earlier trim removed (undo is how that comes back, deliberately).
   */
  "clip.trim": async (a, h) => {
    const [clip, gateArg] = a.trim().split(/\s+/).filter(Boolean);
    if (!clip) {
      h.log([
        "usage: clip trim <clip> [gate-dB]  (e.g. clip trim prise-01 -40)",
      ]);
      return;
    }
    const gate = gateArg === undefined ? DEFAULT_TRIM_DB : Number(gateArg);
    if (!Number.isFinite(gate) || gate > 0) {
      h.log([
        `'${gateArg}' is not a gate in dBFS — a negative number, e.g. -40`,
      ]);
      return;
    }
    if (!h.clipEnvelope) {
      h.log([
        "this host cannot read a clip's envelope — `clip trim` needs the engine, which builds it",
      ]);
      return;
    }
    const env = await h.clipEnvelope(clip);
    if (!env) {
      h.log([`${clip}: no envelope yet — the engine builds it on first read`]);
      return;
    }
    const win = trimWindow(env.peak, env.seconds, gate, clipWindow(h, clip));
    if (!win) {
      h.log([
        `${clip}: nothing above ${gate} dB in its window — the gate is too high, or the take is silent`,
        "nothing was changed: a window of zero length would play nothing at all",
      ]);
      return;
    }
    try {
      // Snapshot BEFORE the write, so undo has the window the clip HAD. The clip's own file is
      // what changes — the audio is untouched, which is the whole point.
      h.snapshot?.(clipFilePath(h.songPath, clip));
      setClipWindow(h.songPath, clip, win.from, win.to);
    } catch (e) {
      h.log([`clip trim failed: ${(e as Error).message}`]);
      return;
    }
    h.log([
      `${clip}: kept ${win.from.toFixed(2)}s → ${win.to.toFixed(2)}s of ${env.seconds.toFixed(2)}s (gate ${gate} dB)`,
    ]);
    await h.reload();
  },

  /**
   * clip warp <clip> <sec> <beat> — pin a moment of the source to a beat.
   *
   * One verb places and moves, because from the waveform they are one gesture: you drag a mark to
   * a beat, and whether one was already there is not something you decide beforehand.
   *
   * A clip with no map gets its two anchors seeded from its own length. Seeding alone changes no
   * sound — an identity two-point warp is skipped by the engine — so the FIRST call on an unwarped
   * clip writes a map and a point in one go, which is what makes the gesture whole.
   */
  "clip.warp": async (a, h) => {
    const [clip, secStr, beatStr] = a.trim().split(/\s+/).filter(Boolean);
    if (!clip || secStr === undefined || beatStr === undefined) {
      h.log([
        "usage: clip warp <clip> <sec> <beat>  (e.g. clip warp break 1.94 4)",
      ]);
      return;
    }
    const [sec, beat] = [secStr, beatStr].map(Number);
    if (![sec, beat].every(Number.isFinite) || sec < 0 || beat < 0) {
      h.log(["sec and beat must be numbers, counted from zero"]);
      return;
    }
    let markers = clipWarpMarkers(h.songPath, clip);
    if (!markers) {
      // Seeding needs the clip's own span in BOTH units: beats from the document, seconds from the
      // envelope. Without them there is nothing to anchor and the map cannot be invented.
      const doc = h.project();
      const found = doc.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === clip);
      const env = await h.clipEnvelope?.(clip);
      const beats = found?.length ?? 0;
      if (!beats || !env?.seconds) {
        h.log([
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
      h.log([`clip warp: ${(e as Error).message}`]);
      return;
    }
    await h.reload();
  },

  /** clip warp remove <clip> <sec> — drop one stretch point. Never below two: see removeWarpPoint. */
  "clip.warpRemove": async (a, h) => {
    const [clip, secStr] = a.trim().split(/\s+/).filter(Boolean);
    if (!clip || secStr === undefined) {
      h.log(["usage: clip warp remove <clip> <sec>"]);
      return;
    }
    const sec = Number(secStr);
    if (!Number.isFinite(sec)) {
      h.log(["sec must be a number — seconds into the source file"]);
      return;
    }
    const markers = clipWarpMarkers(h.songPath, clip);
    if (!markers) {
      h.log([`${clip}: no stretch map to remove a point from`]);
      return;
    }
    try {
      const next = removeWarpPoint(markers, sec);
      h.snapshot?.(clipFilePath(h.songPath, clip));
      setClipWarp(h.songPath, clip, next);
      h.log([`${clip}: dropped the point at ${sec}s (${next.length} left)`]);
    } catch (e) {
      h.log([`clip warp remove: ${(e as Error).message}`]);
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
  /**
   * Solo, as PROJECT STATE: `soloed:` at project.yaml's root lists the soloed lanes — several
   * at once — and the ENGINE resolves it across the mixer (any soloed track silences every
   * non-soloed one; applySoloMute). The compiler folds a group's entry onto its members.
   *
   * It used to be DERIVED — bypass every other lane — which rewrote N files to say one fact,
   * could not hold two solos at once, and read in graph.yaml as a wall of mutes nobody wrote.
   * Now one list says it, and turning the last solo off deletes the key: absent means what it
   * always means here, the default.
   *
   * Soloing a MUTED lane still lifts its mute, as the old gesture did — asking to hear a lane
   * is one act. The doc is mutated and pushed rather than reloaded, so the mixer stays snappy,
   * with the same fold the compiler applies.
   */
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
  /**
   * Swap take `n` onto the track — and what the track was playing becomes take `n`.
   *
   * An EXCHANGE, not a load, which is what makes listening to another take free: nothing is
   * lost, and running it again puts everything back. See packages/song/docs/takes.md.
   */
  "track.take.select": async (a, h) => {
    const t = takeTarget(a, h, "select");
    if (!t) return;
    try {
      selectTrackTake(h.songPath, t.track.id, t.n);
      h.log([
        `${t.track.id}: playing take ${t.n} — what was there is now take ${t.n}`,
      ]);
      await h.reload();
    } catch (e) {
      h.log([`track take select failed: ${(e as Error).message}`]);
    }
  },
  /**
   * Keep what the track is playing, and delete every take of it — the end of choosing.
   *
   * Named for the decision rather than for what it removes: you have listened round the takes
   * (each listen is a `select`, which leaves the one you liked ON the track), and this is the
   * button that says that one. Nothing names a take here, because the choice was already made
   * by whichever is playing.
   */
  "track.take.keep": async (a, h) => {
    const id = a.trim().split(/\s+/).filter(Boolean)[0];
    if (!id) {
      h.log(["usage: track take keep <track>"]);
      return;
    }
    const track = h.project().tracks.find((t) => t.id === id || t.name === id);
    if (!track) {
      h.log([`no track "${id}"`]);
      return;
    }
    try {
      const gone = keepTrackTake(h.songPath, track.id);
      h.log([
        gone
          ? `${track.id}: kept what it plays, deleted ${gone} take${gone > 1 ? "s" : ""}`
          : `${track.id} has no takes`,
      ]);
      if (gone) await h.reload();
    } catch (e) {
      h.log([`track take keep failed: ${(e as Error).message}`]);
    }
  },
  /** Delete take `n`, and the events it held — a take is where they live. */
  "track.take.delete": async (a, h) => {
    const t = takeTarget(a, h, "delete");
    if (!t) return;
    try {
      removeTrackTake(h.songPath, t.track.id, t.n);
      h.log([`${t.track.id}: take ${t.n} deleted`]);
      await h.reload();
    } catch (e) {
      h.log([`track take delete failed: ${(e as Error).message}`]);
    }
  },
  // `track gain` and `track pan` were here, and are `node param <mixer node> Volume|Pan`
  // now. A track states no level of its own — the value always went to the MIXER MODULE at the
  // end of its chain — so two verbs addressed one module's params by the wrong noun, and every
  // other param on that same module already answered to `node param`.

  // `track alternative select|create|copy` and `track freeze` were here. Both are module verbs
  // now, because a lane IS a module: `node alternative *` and `node freeze` reach a lane and
  // a reverb by the same name. See packages/song/docs/trackModules.md.

  // event move <track> <timecode> <newTimecode> — a surgical rewrite of that placement's `start:` alone.
  "event.move": async (a, h) => {
    const m = /^(\S+)\s+(\S+)\s+(\S+)(?:\s+(\S+))?$/.exec(a.trim());
    if (!m) {
      h.log([
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
      h.log([
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
      h.log([`bad timecode: ${(e as Error).message}`]);
      return;
    }
    // Identify the event in the compiled project first, for a clear message and no no-op write.
    const hit = track.clips.find((c) => Math.abs(c.start - fromBeats) < 1e-6);
    if (!hit) {
      h.log([`no event on '${track.id}' at ${fromTc}`]);
      return;
    }
    // A destination track makes this a move BETWEEN lanes, refused unless both carry the same kind of material.
    let dest = track;
    if (toTrackArg) {
      const d = p.tracks.find(
        (t) => t.id === toTrackArg || t.name === toTrackArg,
      );
      if (!d) {
        h.log([`no track "${toTrackArg}"`]);
        return;
      }
      if (d.contentType !== track.contentType) {
        h.log([
          `can't move onto '${d.id}': it holds ${d.contentType}, '${track.id}' holds ${track.contentType}`,
        ]);
        return;
      }
      // A generated lane declares no `clips` and the schema refuses one — caught here, since the write precedes the reload.
      if (d.generated) {
        h.log([
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
        h.log([`no event on '${track.id}' at ${fromTc}`]);
        return;
      }
      h.log([
        dest.id === track.id
          ? `${track.id}: moved ${hit.name || hit.id} ${fromTc} → ${toTc}`
          : `moved ${hit.name || hit.id} ${track.id} ${fromTc} → ${dest.id} ${toTc}`,
      ]);
      await h.reload();
    } catch (e) {
      h.log([`event move failed: ${(e as Error).message}`]);
    }
  },

  /**
   * events move <tracks> <from> <to> <by> — the bulk form of `event move`: every placement
   * STARTING in [from, to] (both inclusive), on each named lane, moved by the signed
   * duration `by` (+1:0 is a bar right in 4/4, -0:1 a beat left).
   *
   * One command on purpose, not a loop of `event move` lines: the whole gesture is then one
   * undo step and one reload — and the addresses are collected before any write, where a
   * loop's later lines would address a project its earlier lines already changed.
   */
  "events.move": async (a, h) => {
    const m = /^(\S+)\s+(\S+)\s+(\S+)\s+([+-]\S+)$/.exec(a.trim());
    if (!m) {
      h.log([
        "usage: events move <tracks> <from> <to> <+/-delta>  (e.g. events move drums,bass 2:1 4:4 +1:0)",
      ]);
      return;
    }
    const [, tracksArg, fromTc, toTc, byArg] = m;
    const p = h.project();
    // "all" is every lane that can hold a placement; naming a generated lane is refused,
    // because refusing what was asked for beats silently doing less than asked.
    const tracks: typeof p.tracks = [];
    if (tracksArg.toLowerCase() === "all")
      tracks.push(...p.tracks.filter((t) => !t.generated));
    else
      for (const name of new Set(tracksArg.split(",").filter(Boolean))) {
        const t = p.tracks.find((x) => x.id === name || x.name === name);
        if (!t) {
          h.log([
            `no track "${name}"${p.tracks.length ? ` — try: ${p.tracks.map((x) => x.id).join(", ")}` : ""}`,
          ]);
          return;
        }
        if (t.generated) {
          h.log([
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
      h.log([`bad timecode: ${(e as Error).message}`]);
      return;
    }
    if (toBeats < fromBeats) [fromBeats, toBeats] = [toBeats, fromBeats];
    if (deltaBeats === 0) {
      h.log(["nothing to do: the delta is zero"]);
      return;
    }
    // Count the hits off the compiled project first: a clear refusal beats a partial write,
    // and the earliest hit is what a negative delta must not push before 1:1:1.
    const hits = tracks.map((t) => ({
      t,
      starts: t.clips
        .map((c) => c.start)
        .filter((s) => s >= fromBeats - 1e-6 && s <= toBeats + 1e-6),
    }));
    const all = hits.flatMap((x) => x.starts);
    if (!all.length) {
      h.log([
        `no events between ${fromTc} and ${toTc} on ${tracks.map((t) => t.id).join(", ")}`,
      ]);
      return;
    }
    if (Math.min(...all) + deltaBeats < -1e-6) {
      h.log([`can't move by ${byArg}: it would push an event before 1:1:1`]);
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
      h.log([`events move failed: ${(e as Error).message}`]);
    }
  },

  // event remove <track> <timecode> — drop that placement, addressed exactly as `event move` addresses it.
  // The clip itself stays: a placement is a REFERENCE, and an unplaced clip in clips/ is still yours.
  // event disable <track> <timecode> [on|off|toggle]
  "event.disable": async (a, h) => {
    const m = /^(\S+)\s+(\S+)(?:\s+(\S+))?$/.exec(a.trim());
    if (!m) {
      h.log(["usage: event disable <track> <timecode> [on|off|toggle]"]);
      return;
    }
    const [, trackArg, atTc, stateArg] = m;
    const found = resolveEvent(h, trackArg, atTc);
    if (!found) return;
    const { track, atBeats, hit, num, den } = found;
    const state = (stateArg ?? "toggle").toLowerCase();
    if (!["on", "off", "toggle"].includes(state)) {
      h.log([`'${stateArg}' is not on, off or toggle`]);
      return;
    }
    // "on" means DISABLED — the command is `event disable`, so its `on` is its own verb,
    // not the event's. Toggling reads the current flag off the compiled clip.
    const next = state === "toggle" ? !hit.disabled : state === "on";
    try {
      if (
        !setTrackPlacementDisabled(
          h.songPath,
          track.id,
          atBeats,
          num,
          den,
          next,
        )
      )
        return h.log([`no event on '${track.id}' at ${atTc}`]);
      h.log([
        `${track.id}: ${hit.name || hit.id} at ${atTc} ${next ? "disabled" : "enabled"}`,
      ]);
      await h.reload();
    } catch (e) {
      h.log([`event disable failed: ${(e as Error).message}`]);
    }
  },

  // event resize <track> <timecode> <newStart> <newEnd> — both ends, one edit.
  "event.resize": async (a, h) => {
    const m = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/.exec(a.trim());
    if (!m) {
      h.log([
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
      h.log([`bad timecode: ${(e as Error).message}`]);
      return;
    }
    // A zero or negative length would be an event that exists and plays nothing — refuse
    // rather than write it, since the file would still validate.
    if (endBeats <= startBeats) {
      h.log([`the end (${endTc}) must be after the start (${startTc})`]);
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
      if (!done) return h.log([`no event on '${track.id}' at ${atTc}`]);
      const span = beatsToDuration(endBeats - startBeats, num, den);
      h.log([
        `${track.id}: ${hit.name || hit.id} -> ${startTc}..${endTc} (${span})` +
          (done.loops > 1 ? ` × ${done.loops}` : ""),
        // The edit is the EVENT's own window, clamped inside the material's `from`/`to` — the
        // most restrictive pair wins, so other placements of the material are untouched, and
        // reaching OUTSIDE the material's window is its own edit (`clip trim`, its pane), not
        // this one's. See @studio/song's docs/clipResize.md.
        `  this event only — ${done.material} keeps its own from/to`,
      ]);
      await h.reload();
    } catch (e) {
      h.log([`event resize failed: ${(e as Error).message}`]);
    }
  },

  /**
   * event add <track> <clip> <timecode> — put an existing clip on a lane.
   *
   * The one ADDITIVE verb of this family, and named for what it makes: the clip already exists and
   * is not touched, a placement is a REFERENCE to it, and the same material may sit on several
   * tracks at once. Which is also why nothing here checks whether it is placed elsewhere already.
   *
   * The clip is named, not addressed by position — there is no event yet to address. It is checked
   * against the project's own list rather than the filesystem, because a placement naming a clip
   * the compiler cannot resolve fails the whole song, and refusing the edit beats writing a file
   * that no longer loads (the same rule `addTakeToTrack` follows for the .wav).
   */
  "event.add": async (a, h) => {
    const m = /^(\S+)\s+(\S+)\s+(\S+)$/.exec(a.trim());
    if (!m) {
      h.log([
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
      h.log([
        `no track "${trackArg}"${p.tracks.length ? ` — try: ${p.tracks.map((t) => t.id).join(", ")}` : ""}`,
      ]);
      return;
    }
    // A timecode this cannot read would be written verbatim and break the next load.
    try {
      parsePosition(atTc, p.timeSigNumerator, p.timeSigDenominator);
    } catch (e) {
      h.log([`bad timecode: ${(e as Error).message}`]);
      return;
    }
    if (!existsSync(join(h.songPath, "clips", `${clipArg}.yaml`))) {
      h.log([
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
      h.log([`event add failed: ${(e as Error).message}`]);
    }
  },

  "event.remove": async (a, h) => {
    const m = /^(\S+)\s+(\S+)$/.exec(a.trim());
    if (!m) {
      h.log([
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
      h.log([
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
      h.log([`bad timecode: ${(e as Error).message}`]);
      return;
    }
    // Named from the compiled project before the edit — afterwards the placement is gone and there is nothing to name.
    const hit = track.clips.find((c) => Math.abs(c.start - atBeats) < 1e-6);
    if (!hit) {
      h.log([`no event on '${track.id}' at ${atTc}`]);
      return;
    }
    try {
      if (!removeTrackPlacement(h.songPath, track.id, atBeats, num, den)) {
        h.log([`no event on '${track.id}' at ${atTc}`]);
        return;
      }
      h.log([`${track.id}: removed ${hit.name || hit.id} at ${atTc}`]);
      await h.reload();
    } catch (e) {
      h.log([`event remove failed: ${(e as Error).message}`]);
    }
  },

  "sequence.list": (_a, h) => {
    const seqs = collectSequences(h.project());
    if (!seqs.length) h.log(["no sequences — add one with: track new midi"]);
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
      h.log(["usage: sequence note new <sequence> <note> <start> [end]"]);
      return;
    }
    const k = parseMidiNote(noteStr);
    if (k === null) {
      h.log([
        `bad note "${noteStr}" — use a name (C4, F#3) or a number 0..127`,
      ]);
      return;
    }
    const t = Math.max(0, Number(startStr));
    const end = endStr !== undefined ? Number(endStr) : t + 1;
    if (!Number.isFinite(t) || !Number.isFinite(end)) {
      h.log(["start/end must be numbers (beats)"]);
      return;
    }
    const d = end > t ? end - t : 1;
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      h.log([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    writeFileSync(file, appendNotes(text, [{ t, d, k }]), "utf8");
    h.log([
      `added ${noteStr} (k${k}) ${fmtBeat(t)}..${fmtBeat(end)} → ${seqId}`,
    ]);
    await h.reload();
  },

  /**
   * Set ONE note's velocity, addressed by key and start — what the roll's velocity drag commits.
   *
   * 0..1, the units the file states (NoteSchema's `v`), clamped rather than refused: the drag hands
   * over a pixel position, and a gesture that ran past the top of a note means "full". A velocity of
   * 1 CLEARS the field instead of writing the schema's own default into a file that never mentioned
   * it — the same rule `alternative:` follows going back to the first set.
   */
  /**
   * sequence note timerange <sequence> <note> <start> <newStart> <newEnd> — move a note, stretch
   * it, or both.
   *
   * One verb for the two gestures, because on the roll they are one gesture with two grips: the
   * body moves the note, an edge stretches it. Two verbs would be two answers to "which note is
   * this", and they would eventually disagree. The note is addressed by key and by where it starts
   * NOW, exactly as the velocity drag addresses it — a pitch and a place are what a roll can point
   * at, and a note has no id of its own.
   *
   * The file states a LENGTH, so the subtraction happens here: the caller says where the note
   * should end, which is what it dragged, and nothing downstream has to work out whether the end
   * moved because the note grew or because it slid.
   */
  "sequence.noteTimeRange": async (arg, h) => {
    const [seqId, noteStr, startStr, newStartStr, newEndStr] = arg
      .trim()
      .split(/\s+/);
    if (!seqId || !noteStr || !startStr || !newStartStr || !newEndStr) {
      h.log([
        "usage: sequence note timerange <sequence> <note> <start> <newStart> <newEnd>",
      ]);
      return;
    }
    const k = parseMidiNote(noteStr);
    if (k === null) {
      h.log([
        `bad note "${noteStr}" — use a name (C4, F#3) or a number 0..127`,
      ]);
      return;
    }
    const [t, nt, ne] = [startStr, newStartStr, newEndStr].map(Number);
    if (![t, nt, ne].every(Number.isFinite)) {
      h.log(["start, newStart and newEnd must be numbers (beats)"]);
      return;
    }
    if (ne <= nt) {
      h.log([`a note has to end after it starts — ${nt} → ${ne} is nothing`]);
      return;
    }
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      h.log([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    try {
      h.snapshot?.(file);
      writeFileSync(file, setNoteTimeRange(text, k, t, nt, ne - nt), "utf8");
    } catch (e) {
      h.log([`sequence note timerange: ${(e as Error).message}`]);
      return;
    }
    h.log([
      `${seqId}: ${noteStr} (k${k}) ${fmtBeat(t)} → ${fmtBeat(nt)}, length ${fmtBeat(ne - nt)}`,
    ]);
    await h.reload();
  },

  /**
   * sequence note move <sequence> <note> <start> <newNote> <newStart> — the same note, put
   * somewhere else: its length and its velocity ride along (see moveNote). The step
   * sequencer's ctrl-drag runs this.
   */
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
      h.log([
        "usage: sequence note move <sequence> <note> <start> <newNote> <newStart>",
      ]);
      return;
    }
    const k = parseMidiNote(noteStr);
    const nk = parseMidiNote(toStr);
    if (k === null || nk === null) {
      h.log([
        `bad note "${k === null ? noteStr : toStr}" — use a name (C4, F#3) or a number 0..127`,
      ]);
      return;
    }
    const t = Number(startStr);
    const nt = Number(toStartStr);
    if (!Number.isFinite(t) || !Number.isFinite(nt)) {
      h.log(["start and newStart (beats) must be numbers"]);
      return;
    }
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      h.log([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    try {
      writeFileSync(file, moveNote(text, k, t, nk, nt), "utf8");
    } catch (e) {
      h.log([`sequence note move: ${(e as Error).message}`]);
      return;
    }
    h.log([
      `${seqId}: ${noteStr} (k${k}) ${fmtBeat(t)} → ${toStr} (k${nk}) ${fmtBeat(nt)}`,
    ]);
    await h.reload();
  },

  // Remove one note, addressed by key and start like every note edit — the step sequencer's
  // button-off. Same shape as noteVelocity below: resolve the file, rewrite, say what happened.
  "sequence.removeNote": async (arg, h) => {
    const [seqId, noteStr, startStr] = arg.trim().split(/\s+/);
    if (!seqId || !noteStr || startStr === undefined) {
      h.log(["usage: sequence note remove <sequence> <note> <start>"]);
      return;
    }
    const k = parseMidiNote(noteStr);
    if (k === null) {
      h.log([
        `bad note "${noteStr}" — use a name (C4, F#3) or a number 0..127`,
      ]);
      return;
    }
    const t = Number(startStr);
    if (!Number.isFinite(t)) {
      h.log(["start (beats) must be a number"]);
      return;
    }
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      h.log([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    try {
      writeFileSync(file, removeNote(text, k, t), "utf8");
    } catch (e) {
      h.log([`sequence note remove: ${(e as Error).message}`]);
      return;
    }
    h.log([`${seqId}: ${noteStr} (k${k}) at ${fmtBeat(t)} removed`]);
    await h.reload();
  },

  "sequence.noteVelocity": async (arg, h) => {
    const [seqId, noteStr, startStr, velStr] = arg.trim().split(/\s+/);
    if (!seqId || !noteStr || startStr === undefined || velStr === undefined) {
      h.log([
        "usage: sequence note velocity <sequence> <note> <start> <velocity 0..1>",
      ]);
      return;
    }
    const k = parseMidiNote(noteStr);
    if (k === null) {
      h.log([
        `bad note "${noteStr}" — use a name (C4, F#3) or a number 0..127`,
      ]);
      return;
    }
    const t = Number(startStr);
    const raw = Number(velStr);
    if (!Number.isFinite(t) || !Number.isFinite(raw)) {
      h.log(["start (beats) and velocity (0..1) must be numbers"]);
      return;
    }
    // Two decimals: the drag reads a pixel, and a file full of 0.7333333333 is noise in a diff.
    const v = Math.round(Math.max(0, Math.min(1, raw)) * 100) / 100;
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      h.log([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    try {
      writeFileSync(
        file,
        setNoteVelocity(text, k, t, v === 1 ? undefined : v),
        "utf8",
      );
    } catch (e) {
      h.log([`sequence note velocity: ${(e as Error).message}`]);
      return;
    }
    h.log([`${seqId}: ${noteStr} (k${k}) at ${fmtBeat(t)} → velocity ${v}`]);
    await h.reload();
  },

  // Append a BATCH of already-timed notes — the commit half of web MIDI recording, one write and one reload for the
  // whole take. Same inline structs the piano roll authors, so a recorded sequence looks hand-entered.
  "sequence.recordNotes": async (arg, h) => {
    const trimmed = arg.trim();
    const sp = trimmed.search(/\s/);
    if (sp < 0) {
      h.log(["usage: sequence note add <sequence> <notesJSON>"]);
      return;
    }
    const seqId = trimmed.slice(0, sp);
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed.slice(sp + 1));
    } catch (e) {
      h.log([`bad notes JSON: ${(e as Error).message}`]);
      return;
    }
    if (!Array.isArray(raw)) {
      h.log(["notes payload must be a JSON array of {t,d,k,v?}"]);
      return;
    }
    const notes = raw as { t?: number; d?: number; k?: number; v?: number }[];
    const file = join(h.songPath, "sequences", `${seqId}.yaml`);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      h.log([`no sequence file: sequences/${seqId}.yaml`]);
      return;
    }
    const playable = notes.filter(isPlayableNote).map((n) => ({
      ...n,
      t: Math.max(0, n.t),
      // A velocity of 1 is what the engine applies anyway, so writing it says nothing.
      v: typeof n.v === "number" && n.v >= 0 && n.v < 1 ? n.v : undefined,
    }));
    if (!playable.length) {
      h.log(["no valid notes to record"]);
      return;
    }
    writeFileSync(file, appendNotes(text, playable), "utf8");
    h.log([`recorded ${playable.length} note(s) → ${seqId}`]);
    await h.reload();
  },

  // Add or move a named marker, stored under a CANONICAL timecode so `5` and `5:1:1` are the same marker.
  "project.marker.create": async (arg, h) => {
    const trimmed = arg.trim();
    const sp = trimmed.search(/\s/);
    const tcRaw = sp === -1 ? "" : trimmed.slice(0, sp);
    const name = sp === -1 ? "" : trimmed.slice(sp + 1).trim();
    if (!tcRaw || !name) {
      h.log([
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
      h.log([`bad timecode: ${(e as Error).message}`]);
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
      h.log(["usage: project marker delete <name>"]);
      return;
    }
    const p = h.project();
    const kept = p.markers.filter((m) => m.name !== name);
    if (kept.length === p.markers.length) {
      h.log([`no marker named "${name}"`]);
      return;
    }
    writeMarkers(
      h.songPath,
      Object.fromEntries(kept.map((m) => [m.tc, m.name])),
    );
    h.log([`deleted marker "${name}"`]);
    await h.reload();
  },

  // The MACHINE's plugin cache, not this song's modules — hence `system`. The optional word is
  // a format filter, which is what `module list vst` used to be as a verb of its own.
  "system.plugins.list": async (a, h) => {
    await h.listPlugins(a.trim() || undefined);
  },
  "system.plugins.scan": async (_a, h) => {
    h.log(["rescanning plugins… (first scan can take a while)"]);
    await h.rescanPlugins();
  },

  // --- channel labels (global user preferences) -------------------------------
  // The interface in use is shown here but CHOSEN in the médiathèque's « État du moteur »,
  // which both switches the engine and writes this file (engine/moteur/docs/audioDevice.md).
  "system.channel.list": (_a, h) => {
    const p = loadPreferences();
    const f = formatChannels(p);
    h.log([
      `audio device: ${formatAudioDevice(p.audioDevice)}  (change: médiathèque → État du moteur)`,
      `in:  ${f.in || "(none — set with: channel in <ch> <label>)"}`,
      `out: ${f.out || "(none — set with: channel out <ch> <label>)"}`,
    ]);
  },
  "system.channel.set": (a, h) => {
    // channel <in|out> <chans> <label…>   e.g. channel in 3+4 synth
    const m = a.trim().match(/^(in|out)\s+(\S+)\s+(.+)$/i);
    if (!m)
      return h.log([
        "usage: system channel set <in|out> <chans> <label>   e.g. system channel set in 3+4 synth",
      ]);
    const dir = m[1].toLowerCase() as "in" | "out";
    const ch = parseChannels(m[2]);
    if (!ch.length)
      return h.log([`bad channels '${m[2]}' — use e.g. 1 or 3+4`]);
    setChannelLabel(dir, ch, m[3].trim());
    h.log([`${dir} ${ch.join("+")} = ${m[3].trim()}`]);
  },
  "system.channel.clear": (a, h) => {
    // system channel clear <in|out> <chans>
    const m = a.trim().match(/^(in|out)\s+(\S+)/i);
    if (!m) return h.log(["usage: system channel clear <in|out> <chans>"]);
    const dir = m[1].toLowerCase() as "in" | "out";
    const ch = parseChannels(m[2]);
    if (!ch.length) return h.log([`bad channels '${m[2]}'`]);
    clearChannelLabel(dir, ch);
    h.log([`cleared ${dir} ${ch.join("+")}`]);
  },
  // The external UI of ONE INSTANCE: the plugin's own window, drawn by the plugin on the
  // engine's machine. The argument names a node in this project's chains, which is what a
  // window can be opened for — a module with no instance loaded has none.
  "node.externalUi": async (a, h) => {
    const name = a.trim();
    const modules = collectPluginModules(h.project());
    if (!name) {
      h.log([
        modules.length
          ? `open which? ${modules.map((b) => b.module).join(", ")}`
          : "no plugins in this project",
      ]);
      return;
    }
    const match =
      modules.find((b) => b.module === name) ??
      modules.find((b) => b.module.toLowerCase() === name.toLowerCase());
    if (!match) {
      h.log([
        `no plugin module '${name}'${modules.length ? ` — try: ${modules.map((b) => b.module).join(", ")}` : ""}`,
      ]);
      return;
    }
    await h.showNativePluginUI(match.id);
    h.log([`opening ${match.module} (${match.type}) on ${match.track}…`]);
  },

  // node param <node> <param> <value>: the param is read as everything BETWEEN module and value, since engine
  // display names contain spaces. node bypass writes the module's name into graph.yaml's `bypassed` list, not
  // into the module file — a module's own file is what it IS, and being switched off is where it sits.
  "node.bypass": async (a, h) => {
    const m = /^(\S+)(?:\s+(on|off|true|false))?$/.exec(a.trim());
    if (!m) {
      h.log(["usage: node bypass <node> [on|off]"]);
      return;
    }
    const [, module, state] = m;
    // graph.yaml alone, not loadGraph: the only question here is which chain holds this module and whether it is
    // on, and that is one file. loadGraph also reads every module, clip, sequence and curve in the song — 220 ms
    // on a real project, spent to answer a question graph.yaml already answers in one. Still the derived chains
    // rather than the compiled doc, so a module that is an io node or names nothing on disk is found too: bypass
    // is the one verb that still works on a dangling reference.
    const allChains = parseChains(
      loadChains(h.songPath, loadProjectRoot(h.songPath, true), true),
    );
    // A module belongs to exactly one chain now — it is named once in the file — so the
    // "used in two chains, say which" branch this used to need is simply gone.
    const hit = Object.entries(allChains).find(([, c]) =>
      c.use.some((s) => s.module === module),
    );
    if (!hit) {
      h.log([`no module "${module}" in any chain`]);
      return;
    }
    const [chain, c] = hit;
    // `enabled` defaults to true, so "currently on" is anything but an explicit false.
    const isOn = c.use.find((s) => s.module === module)?.enabled !== false;
    const bypass = state == null ? isOn : state === "on" || state === "true";
    try {
      // `bypass` is already the state we want, and setModuleBypass takes the state we
      // want — negating it here wrote the opposite of what the log line then reported, so
      // toggling an active module did nothing at all (it "re-enabled" what was already on).
      setModuleBypass(h.songPath, module, bypass);
      h.log([`${chain}: ${module} ${bypass ? "bypassed" : "active"}`]);
      // Persist, then push the mutated doc rather than reloading — the same trade mixMutate makes for a fader,
      // and for the same reason: a reload recompiles the whole song (another ~230 ms) to change one boolean. The
      // engine already treats an enabled-flip as a live setEnabled on the plugin, never a rebuild, so the diff
      // this produces is exactly one cheap call.
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
      // An io module or a dangling step has no plugin in the compiled doc, so there is nothing to diff — those
      // fall back to the full reload, which is what makes their graph.yaml edit take effect at all.
      if (found) await h.applyProject(np);
      else await h.reload();
    } catch (e) {
      h.log([`bypass failed: ${(e as Error).message}`]);
    }
  },

  // `module.channel` and `module.monitor` were here, a verb per field — "is this input
  // audible", "which socket is it on". Both are `node param <node> @<field> <value>` now:
  // see `INTRINSICS` and `setIntrinsic`, which is where their validation, their reload and
  // their shared-library message went.

  // `module.asset` was here, reached by one verb per file-valued param (`module nam`). It is
  // `node param <node> nam <file>` now — see `setFileParam`, which the param handler calls
  // when the name is one of FILE_PARAMS.

  /**
   * The three alternative verbs, one operation each on ONE module's file.
   *
   * All of them end in `h.reload()` rather than `applyProject` with a patched doc: a set may
   * change any field — the plugin, the panel, a lane's whole clip list — so there is nothing
   * cheap to diff, and re-reading is both simpler and what the engine has to be told anyway.
   * See packages/song/docs/alternatives.md.
   */
  "node.alt.select": async (a, h) => {
    const [module, name] = a.trim().split(/\s+/).filter(Boolean);
    if (!module) {
      h.log(["usage: node alternative select <node> [name]"]);
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
      selectModuleAlternative(h.songPath, module, name);
      h.log([`${module}: running alternative '${name}'`]);
      await h.reload();
    } catch (e) {
      h.log([`node alternative: ${(e as Error).message}`]);
    }
  },

  "node.alt.create": (a, h) => moduleAltAdd(a, h, false),
  "node.alt.copy": (a, h) => moduleAltAdd(a, h, true),

  /**
   * Freeze at a module — a TOGGLE, because a freeze has exactly two states and the file says
   * which one it is in.
   *
   * Everything upstream of the module, itself included, is bounced to one wav and plays as that
   * wav until it is thawed. The refusals are the interesting half and all come before the engine
   * is even looked for: see packages/song/docs/freeze.md.
   */
  "node.freeze": async (a, h) => {
    const module = a.trim().split(/\s+/).filter(Boolean)[0];
    if (!module) {
      h.log(["usage: node freeze <node>"]);
      return;
    }
    const g = loadGraph(h.songPath);
    const isLane = (n: string) => !!g.tracks[n];
    const current = g.modules[module]?.frozen;
    if (typeof current === "string" && current) {
      // Unfreeze: the attribute goes, and so does the render. Leaving it would mean a dead file in
      // the project's own folder, staged by the next `project commit` and stale the moment a
      // module changes.
      setModuleFrozen(h.songPath, module, null);
      rmSync(join(h.songPath, current), { force: true });
      h.log([`${module}: unfrozen — everything upstream is live again`]);
      await h.reload();
      return;
    }
    const why = freezeBlockedBy(g.chains, module);
    if (why) {
      h.log([`freeze: ${why}`]);
      return;
    }
    const render = `${FROZEN_DIR}/${module.replace(/[:/]/g, "-")}.wav`;
    const plan = freezePlans(g.chains, [[module, render]], isLane)[0];
    // A strudel lane's material is streamed by PatternClock while the transport rolls; a stopped
    // one has no clips at all, so the render would be a file of silence. Said plainly rather than
    // discovered as an empty freeze.
    const generated = [...plan.lanes].filter(
      (n) => g.tracks[n]?.type === "strudel",
    );
    if (generated.length) {
      h.log([
        `freeze: '${generated[0]}' is a strudel lane — its material only exists while it plays, so it can't be baked`,
      ]);
      return;
    }
    const p = h.project();
    // The track the render will play ON, decided by the COMPILER rather than guessed: a lane is
    // its own track, and a module is on whichever track its chain compiled onto. A module with no
    // plugin in the doc (an io module, an offline pass) has no output to take a render at.
    const owner = isLane(module)
      ? module
      : p.tracks.find((t) =>
          t.plugins.some(
            (pl) => pl.id.slice(pl.id.indexOf(":") + 1) === module,
          ),
        )?.id;
    if (!owner) {
      h.log([
        `freeze: '${module}' compiles to no plugin, so there is no signal at it to render`,
      ]);
      return;
    }
    const engine = findEngineBinary();
    if (!engine) {
      h.log([
        "freeze failed: studio-moteur binary not found (build the engine)",
      ]);
      return;
    }
    // Stopped first: the render runs in its own engine process, but it reads the same sources the
    // live one is playing, and a freeze that lands mid-playback swaps a track's contents under a
    // rolling transport.
    await h.transport("stop");
    const out = join(h.songPath, render);
    mkdirSync(dirname(out), { recursive: true });
    try {
      freezeUpstreamRender(engine, p, plan, out);
    } catch (e) {
      h.log([`freeze failed: ${(e as Error).message}`]);
      return;
    }
    setModuleFrozen(h.songPath, module, render);
    const inside = plan.lanes.size + plan.modules.size - 1;
    h.log([
      `${module}: frozen to ${render}${inside ? ` (${inside} node${inside > 1 ? "s" : ""} upstream baked in)` : ""} — everything downstream stays live`,
    ]);
    await h.reload();
  },

  "node.param": async (a, h) => {
    // The NODE may be quoted as the param may: a node is named by its file, and a file may carry
    // a space. It could not be addressed at all before — `\S+` stopped at the space and the whole
    // line failed to match — which the graph's own fader now walks into, since it names the mixer
    // node it found rather than a name someone typed.
    const m = /^("[^"]*"|\S+)\s+(.+?)\s+(\S+)$/.exec(a.trim());
    if (!m) {
      h.log([
        'usage: node param <node> <param> <value>  (e.g. node param synth "Filter Freq" 69)',
      ]);
      return;
    }
    const [, rawModule, rawParam, rawValue] = m;
    const unquote = (s: string) => s.replace(/^"(.*)"$/s, "$1").trim();
    const module = unquote(rawModule);
    const param = unquote(rawParam);
    // An INTRINSIC: `@channel`, `@monitor`, `@gain` — the module's own field rather than a
    // plugin's parameter. Same verb because it is the same act from the outside (set this
    // control on this module), and the `@` is the whole of the difference: a plugin param is
    // sent to a running plugin, a field is written into the file and read at BUILD time. See
    // packages/song/docs/intrinsics.md.
    if (param.startsWith("@")) {
      await setIntrinsic(h, module, param.slice(1), rawValue);
      return;
    }
    // …and a FILE-valued one: `nam`, `onnx`. A param like any other — it lands in `params:` —
    // whose value is a filename the module carries rather than a number, and which the engine
    // reads when it BUILDS the plugin. See setFileParam.
    if (isFileParam(param)) {
      await setFileParam(h, module, param, rawValue);
      return;
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      h.log([`"${rawValue}" is not a number — a param value is numeric`]);
      return;
    }
    const p = h.project();
    const modules = collectPluginModules(p);
    const matches = modules.filter((b) => b.module === module);
    if (!matches.length) {
      h.log([
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
      h.log([`node param failed: ${(e as Error).message}`]);
    }
  },

  // module cc <module> <param> <channel> <cc> — bind a MIDI control to a param, or
  // `module cc <module> <param> none` to unbind. The param is read as everything BETWEEN the
  // module and the trailing numbers, since plugin display names contain spaces (as in node.param).
  //
  // Writes a file and nothing else: the binding is played by the BROWSER's Web MIDI, so there is
  // no engine state to patch and no project to re-apply. The reload the caller does afterwards is
  // what carries the new map to the graph.
  "module.cc": async (a, h) => {
    const usage =
      "usage: module cc <module> <param> <channel 1-16> <cc 0-127>  (e.g. module cc synth Cutoff 1 74)\n" +
      "       module cc <module> <param> none            — unbind";
    const trimmed = a.trim();
    const unbind = /^(\S+)\s+(.+?)\s+none$/i.exec(trimmed);
    const bind = /^(\S+)\s+(.+?)\s+(\d+)\s+(\d+)$/.exec(trimmed);
    const m = unbind ?? bind;
    if (!m) {
      h.log([usage]);
      return;
    }
    const module = m[1];
    const param = m[2].replace(/^"(.*)"$/s, "$1").trim();
    const binding = unbind ? null : { ch: Number(m[3]), cc: Number(m[4]) };
    if (binding && (binding.ch < 1 || binding.ch > 16)) {
      h.log([`channel ${binding.ch} is not 1-16`, usage]);
      return;
    }
    if (binding && (binding.cc < 0 || binding.cc > 127)) {
      h.log([`cc ${binding.cc} is not 0-127`, usage]);
      return;
    }
    try {
      const { rel, ref } = bindModuleCc(h.songPath, module, param, binding);
      h.log([
        binding
          ? `${module}: ${param} <- ch${binding.ch} cc${binding.cc}  (${rel})`
          : `${module}: ${param} unbound  (${rel})`,
        // The map is the MODULE's, so it plays for every use of it — say so rather than let it be found.
        `${ref}'s map — shared by every node of it`,
      ]);
    } catch (e) {
      h.log([`module cc failed: ${(e as Error).message}`]);
    }
  },

  // curve new <name> scaffolds curves/<name>.yaml — an LFO, the one shape with defaults
  // worth having (see createCurveFile). Binding it is a separate step: a module's
  // `automation:` names the curve, so the curve has to exist first.
  "curve.create": async (a, h) => {
    const name = a.trim();
    if (!name) {
      h.log(["usage: curve new <name>  (e.g. curve new sweep)"]);
      return;
    }
    try {
      const rel = createCurveFile(h.songPath, name);
      h.reload(); // the editor's file tree and the `curve` completions both read the folder
      h.log([`created ${rel}`]);
    } catch (e) {
      h.log([`curve new: ${(e as Error).message}`]);
    }
  },

  // `ui.migrate` and `chains.migrate` were here. Both are scripts now — see
  // packages/song/scripts/migrateUis.ts and migrateChains.ts, which call the same functions.

  /**
   * module new <category>/<name> [extends-ref] — scaffold a module, and only that.
   *
   * The optional arg is the ref this module INHERITS, filled by the graph's module picker when
   * the pick comes from a catalogue rather than from this project.
   *
   * It used to take a node name too and make one in the same breath, which is why the picker
   * could send one line. It does not: a module and a USE of it are two things, and a chain names
   * the use. `node new` makes those, and puts them in the graph. A module that is already there
   * is not an error — it is the ordinary second pick of the same thing.
   */
  "module.create": async (a, h) => {
    const usage = "usage: module new <category>/<name> [extends-ref]";
    const [target, extendsRef, ...extra] = a
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!target || extra.length) {
      h.log([usage]);
      return;
    }
    const made = makeModule(h.songPath, target, extendsRef);
    if ("error" in made) {
      h.log([`module new failed: ${made.error}`, usage]);
      return;
    }
    const { ref, rel } = made;
    h.log([
      rel
        ? `created ${rel} — add an inline plugin/rack (or an \`extends\`) to give it a sound`
        : `${target} is already here`,
      // A chain names a NODE, never this — say so, since the next act is always the same one.
      `use it with \`node new ${target} <node-name>\``,
    ]);
    await h.reload();
  },

  /**
   * node new <category>/<name> <node-name> [x,y] — one USE of an existing module, as
   * `nodes/<node>.yaml`, AND its place in the graph.
   *
   * It names what it uses with `extends` and states only what it changes; chains name it by its
   * FILENAME alone.
   *
   * The placing is not a convenience. A node file with no entry in `graph.yaml` is loaded and
   * drawn NOWHERE — the graph's blocks come off the chains, so creating one used to leave a node
   * that existed on disk and was on no screen, waiting for a second command to become real.
   * Every node is in the graph; `modules: { x: [] }` is what says so, and it is a state the file
   * already holds.
   */
  "node.new": async (a, h) => {
    const usage = "usage: node new <category>/<name> <node-name> [x,y]";
    const parts = a.trim().split(/\s+/).filter(Boolean);
    // Born where the cursor was — the web sends the click, so a new node never asks the layout.
    const at = takeSpawnAt(parts);
    if (parts.length !== 2) {
      h.log([usage]);
      return;
    }
    const [target, node] = parts;
    const segs = target.split("/");
    if (segs.length !== 2 || !segs[0] || !segs[1]) {
      h.log([`'${target}' is not <category>/<name>`, usage]);
      return;
    }
    const [category, module] = segs;
    try {
      const rel = createNode(h.songPath, category, module, node);
      placeChainNode(h.songPath, node);
      if (at) setChainNodePosition(h.songPath, node, at);
      h.log([`created ${rel} — in the graph, wired to nothing yet`]);
      await h.reload();
    } catch (e) {
      h.log([`node new failed: ${(e as Error).message}`]);
    }
  },

  // `module.delete` was here — the file, and the graph closed back up around it. Gone with its
  // verb: a module's files are the file tree's to remove, and taking a node out of the signal
  // path without deleting anything is `graph unlink` below.

  // graph unlink <node> — out of the signal path, files untouched. The splice is
  // removeNode's; what this adds is that nothing is deleted, so it goes back with `node insert`.
  /**
   * node delete <node> — the node's file, its preset, and its place in the graph.
   *
   * The splice is `graph unlink`'s: what fed it is rejoined to what it fed, so a run does not
   * go quiet. What this adds is that the files GO — which is why it is a different verb and not
   * a flag. The module it uses is untouched.
   */
  "node.delete": async (a, h) => {
    const node = a.trim().split(/\s+/).filter(Boolean)[0];
    if (!node) {
      h.log(["usage: node delete <node>"]);
      return;
    }
    try {
      const { rewired, removed } = deleteChainNode(h.songPath, node);
      h.log([
        `deleted ${removed.join(", ")}` +
          (rewired.length
            ? ` — rejoined what fed it: ${rewired.join(", ")}`
            : ""),
      ]);
      await h.reload();
    } catch (e) {
      h.log([`node delete failed: ${(e as Error).message}`]);
    }
  },

  "graph.unlink": async (a, h) => {
    const node = a.trim().split(/\s+/).filter(Boolean)[0];
    if (!node) {
      h.log(["usage: graph unlink <node>"]);
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
      h.log([`graph unlink failed: ${(e as Error).message}`]);
    }
  },

  // module own <ref> — give an engine module a folder here, and repoint the chains at it (see moduleFork.ts).
  "module.own": async (a, h) => {
    const ref = a.trim().split(/\s+/).filter(Boolean)[0];
    if (!ref) {
      h.log(["usage: module own <@engine/…>"]);
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
      h.log([`module own failed: ${(e as Error).message}`]);
    }
  },

  /**
   * node replace <node> <extends-ref> — point a node at another module.
   *
   * ONE edit, to one line: the node's `extends`. Everything that is not what it IS survives —
   * the name, so every chain step keeps its place and nothing is rewired; the file, so its
   * position on the graph and its panel stay put. What goes is what described the old thing
   * (`plugin`, `params`, `rack`), and the log says which, because a field disappearing from a
   * file somebody hand-wrote should never be discovered later.
   *
   * It used to CREATE a module — `<category>/<name>` plus an optional extends — and rewrite the
   * chains onto the new name. That answered a different question ("put a new module where this
   * one sits"), and from the node's context menu it asked for two things when the only one worth
   * naming is the replacement.
   */
  "node.replace": async (a, h) => {
    const usage = "usage: node replace <node> <extends-ref>";
    const [key, ref] = a.trim().split(/\s+/).filter(Boolean);
    if (!key || !ref) {
      h.log([usage]);
      return;
    }
    try {
      const { rel, dropped } = setModuleExtends(h.songPath, key, ref);
      h.log([
        `${key}: extends ${ref} (${rel})` +
          (dropped.length ? ` — dropped its own ${dropped.join(", ")}` : ""),
      ]);
      await h.reload();
    } catch (e) {
      h.log([`node replace failed: ${(e as Error).message}`]);
    }
  },

  "module.clone": async (a, h) => {
    const usage = "usage: clone module <category>/<name> <newName>";
    const args = a.trim().split(/\s+/);
    if (args.length !== 2 || !args[0] || !args[1]) {
      h.log([usage]);
      return;
    }
    const [target, newName] = args;
    const segs = target.split("/");
    if (segs.length !== 2 || !segs[0] || !segs[1]) {
      h.log([`'${target}' is not <category>/<name>`, usage]);
      return;
    }
    const [category, name] = segs;
    try {
      const rel = cloneModuleFile(h.songPath, category, name, newName);
      h.log([`cloned ${target} → ${rel}`]);
      await h.reload();
    } catch (e) {
      h.log([`clone module failed: ${(e as Error).message}`]);
    }
  },

  // `graph.inspect` was here — the routing as text, and `timeline.inspect` below it for the
  // arrangement. Two READERS, and the only place either was reachable from the app was a
  // right-click that offered nothing else. Both describers keep their own CLI entry
  // (`@studio/song`'s graph.ts and this package's timeline.ts), so what went is the palette row.

  /**
   * node insert <before> <after> <node> [x,y] — splice a node that EXISTS into an arrow.
   *
   * It used to create the module too, from a `<category>/<name>`, and that is what made it read
   * as a duplicate of `chain add` — which did this same splice on a node that was already there.
   * They were one act told apart by whether a file had to be written first. Creating is
   * `module new`'s and `node new`'s; this wires.
   *
   * The arrow is validated from graph.yaml alone, and a COLD module is refused here rather than
   * halfway through: it works only on audio already on disk, so where it sits is the question.
   */
  "node.insert": async (a, h) => {
    const usage =
      "usage: node insert <before> <after> <node> [x,y] (the two ends of one graph arrow, then the node to splice between them)";
    const parts = a.trim().split(/\s+/).filter(Boolean);
    const at = takeSpawnAt(parts);
    if (parts.length < 3) {
      h.log([usage]);
      return;
    }
    const [before, after, node] = parts;
    let g: ReturnType<typeof loadGraph>;
    try {
      g = loadGraph(h.songPath);
    } catch (e) {
      h.log([`node insert: ${(e as Error).message}`]);
      return;
    }
    const arrow = arrowError(h.songPath, before, after);
    if (arrow) {
      h.log([arrow]);
      return;
    }
    // A real node: the engine would refuse a dangling ref, so catch it with an actionable
    // message. A shared module is named by its ref and lives in moduleRefs until a chain uses it.
    if (!(node in g.modules) && !(node in g.moduleRefs)) {
      h.log([
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
      h.log([cold]);
      return;
    }
    try {
      insertChainStep(h.songPath, before, after, node);
      // Born where the `+` was clicked, same rule as `node new`.
      if (at) setChainNodePosition(h.songPath, node, at);
      h.log([`inserted ${node} between ${before} and ${after}`]);
      await h.reload();
    } catch (e) {
      h.log([`node insert failed: ${(e as Error).message}`]);
    }
  },

  // `node.place` was here — `modules: { x: [] }` for a node that existed and was in no chain.
  // `node new` places what it makes and `graph unlink` leaves what it unlinks, so the state it
  // repaired is one nothing reaches any more. Moving a node is `graph move`.

  // `chain.addModule` was here — `chain add <before> <after> <module>`, an existing module
  // spliced into an arrow. That is `node insert` now, which stopped creating; the two were one
  // act told apart only by whether a file had to be written first.

  /**
   * graph organize — hand EVERY node back to the layout: the pins come off in one write and
   * dagre speaks again on the next draw. Deliberately the ONLY reorganizing operation: an
   * edit keeps every card where it stands (the renderer holds them), so the picture moves
   * exactly when somebody asks it to.
   */
  "graph.organize": async (_a, h) => {
    try {
      clearChainNodePositions(h.songPath);
      h.log(["graph reorganized — every node handed back to the layout"]);
      await h.reload();
    } catch (e) {
      h.log([`graph organize failed: ${(e as Error).message}`]);
    }
  },

  /**
   * graph move <node> <x> <y> — pin a node where a drag (or a hand) put it, into
   * graph.yaml's `positions:`. The layout only places what has no pin, so this is the one
   * write behind "modules stay where you moved them"; `auto` hands the node back. Cosmetic
   * on purpose — nothing about the signal reads it — which is why a bad node name is still
   * refused: a pin nothing can ever match would sit in the file for ever.
   */
  "graph.move": async (a, h) => {
    const usage =
      "usage: graph move <node> <x> <y> (world px), or `graph move <node> auto`";
    const parts = a.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      h.log([usage]);
      return;
    }
    const [name, xArg, yArg] = parts;
    let g: ReturnType<typeof loadGraph>;
    try {
      g = loadGraph(h.songPath);
    } catch (e) {
      h.log([`graph move: ${(e as Error).message}`]);
      return;
    }
    // Everything on the graph is a NODE, and every node can be put somewhere: a module or a
    // track by its chains name, a curve by its curve id, the sink by "OUT" — which is already
    // in g.modules, being an io module like any other. The curves are a best-effort read: an
    // unreadable curves/ costs the acceptance, not a crash.
    const curves = (() => {
      try {
        return loadCurves(h.songPath);
      } catch {
        return {};
      }
    })();
    if (!(name in g.modules) && !(name in g.tracks) && !(name in curves)) {
      h.log([
        `no node "${name}" in this project (modules: ${
          Object.keys(g.modules).join(", ") || "none"
        })`,
      ]);
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
          h.log([usage]);
          return;
        }
        // Clamped to the world's origin — the fit frames 0.., and a negative pin would sit
        // outside every frame the camera can be asked for.
        setChainNodePosition(h.songPath, name, {
          x: Math.max(0, x),
          y: Math.max(0, y),
        });
        h.log([
          `${name}: pinned at ${Math.max(0, Math.round(x))},${Math.max(0, Math.round(y))}`,
        ]);
      }
      await h.reload();
    } catch (e) {
      h.log([`graph move failed: ${(e as Error).message}`]);
    }
  },

  /**
   * graph chain connect <from> <to> — draw a NEW arrow between two placed nodes: the graph's
   * patch-cable gesture, and how a new chain begins. Either end may carry `#port`, spelt
   * exactly as graph.yaml spells it (packages/song/docs/ports.md).
   *
   * Unlike `node insert` there is no existing arrow to validate against — the checks are the
   * ends themselves: both must be nodes this project knows, the sink has no output, and a
   * track is a source nothing can feed.
   */
  "graph.chain.connect": async (a, h) => {
    const usage =
      "usage: graph chain connect <from> <to> — each a node, optionally name#port (e.g. graph chain connect gtr reverb)";
    const parts = a.trim().split(/\s+/).filter(Boolean);
    if (parts.length !== 2) {
      h.log([usage]);
      return;
    }
    const [from, to] = parts;
    const base = (s: string) => s.split("#")[0];
    if (base(from) === base(to)) {
      h.log([`can't connect '${base(from)}' to itself`]);
      return;
    }
    let g: ReturnType<typeof loadGraph>;
    try {
      g = loadGraph(h.songPath);
    } catch (e) {
      h.log([`graph chain connect: ${(e as Error).message}`]);
      return;
    }
    if (base(from) === "OUT") {
      h.log(["OUT is the sink — it has no output to connect from"]);
      return;
    }
    if (base(to) in g.tracks) {
      h.log([`'${base(to)}' is a track — a source; nothing can feed it`]);
      return;
    }
    const known = (name: string) =>
      name === "OUT" ||
      name in g.modules ||
      name in g.moduleRefs ||
      name in g.tracks;
    for (const end of [from, to])
      if (!known(base(end))) {
        h.log([
          `no node "${base(end)}" in this project (modules: ${
            Object.keys(g.modules).join(", ") || "none"
          })`,
        ]);
        return;
      }
    try {
      connectChainNodes(h.songPath, from, to);
      h.log([`connected ${from} → ${to}`]);
      await h.reload();
    } catch (e) {
      h.log([`graph chain connect failed: ${(e as Error).message}`]);
    }
  },

  /**
   * graph chain disconnect <from> <to> — pull ONE cable out: the mirror of `graph chain connect`, and
   * what a lifted cable dropped on the canvas runs. No graph load: the file's own "does
   * not feed" refusal IS the validation, and it names what the node actually feeds.
   */
  "graph.chain.disconnect": async (a, h) => {
    const parts = a.trim().split(/\s+/).filter(Boolean);
    if (parts.length !== 2) {
      h.log([
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
      h.log([`graph chain disconnect failed: ${(e as Error).message}`]);
    }
  },

  /**
   * graph chain replug <from> <to> <newFrom> <newTo> — move one end of an existing arrow, in ONE
   * write: the re-plug gesture, and one undo step however the ends are respelt. The old
   * pair must be an arrow (the file refuses otherwise) and the new pair passes the same
   * checks `graph chain connect` makes, because it is one.
   */
  "graph.chain.replug": async (a, h) => {
    const usage =
      "usage: graph chain replug <from> <to> <newFrom> <newTo> — the arrow from→to becomes newFrom→newTo";
    const parts = a.trim().split(/\s+/).filter(Boolean);
    if (parts.length !== 4) {
      h.log([usage]);
      return;
    }
    const [from, to, newFrom, newTo] = parts;
    if (from === newFrom && to === newTo) {
      h.log(["nothing moved — the cable is where it was"]);
      return;
    }
    const base = (s: string) => s.split("#")[0];
    if (base(newFrom) === base(newTo)) {
      h.log([`can't connect '${base(newFrom)}' to itself`]);
      return;
    }
    let g: ReturnType<typeof loadGraph>;
    try {
      g = loadGraph(h.songPath);
    } catch (e) {
      h.log([`graph chain replug: ${(e as Error).message}`]);
      return;
    }
    if (base(newFrom) === "OUT") {
      h.log(["OUT is the sink — it has no output to connect from"]);
      return;
    }
    if (base(newTo) in g.tracks) {
      h.log([`'${base(newTo)}' is a track — a source; nothing can feed it`]);
      return;
    }
    const known = (name: string) =>
      name === "OUT" ||
      name in g.modules ||
      name in g.moduleRefs ||
      name in g.tracks;
    for (const end of [newFrom, newTo])
      if (!known(base(end))) {
        h.log([`no node "${base(end)}" in this project`]);
        return;
      }
    try {
      replugChainNodes(h.songPath, from, to, newFrom, newTo);
      h.log([`replugged: ${from} → ${to} is now ${newFrom} → ${newTo}`]);
      await h.reload();
    } catch (e) {
      h.log([`graph chain replug failed: ${(e as Error).message}`]);
    }
  },

  // --- recording — the one lane edit that writes NO file ----------------------
  // Arming is session state that dies with the engine, so there is nothing to write, which is why it sits under
  // `transport` and not `track`: it names a lane but it is a message to the engine, like play and stop. The two
  // checks here are the SONG's — does the track exist, does it declare an input. The engine re-checks and adds
  // what only it knows.
  "transport.arm": async (a, h) => {
    const id = a.trim().split(/\s+/).filter(Boolean)[0];
    if (!id) {
      h.log(["usage: transport arm <track>"]);
      return;
    }
    const p = h.project();
    const matches = (x: { id: string; name: string }) =>
      x.id === id || x.name === id;
    const t = p.tracks.find(matches);
    if (!t) {
      h.log([
        p.groups.some(matches)
          ? `"${id}" is a group — arm takes a track (a group carries no input)`
          : `no track "${id}"`,
      ]);
      return;
    }
    // The rule: no input, no arm. A track with nothing feeding it would record silence, so say why instead of arming it.
    if (!t.inputChannels.length) {
      h.log([`"${t.id}" has no input — nothing to record`]);
      return;
    }
    if (!p.recordDir) {
      h.log([
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
      h.log([`metronome failed: ${(e as Error).message}`]);
    }
  },
  "project.reload": async (_a, h) => {
    await h.reload();
  },

  // commit <message> — stage, commit and push the whole repo. The message is the trailing line, so no quoting.
  "project.commit": async (a, h) => {
    const message = a.trim();
    if (!message) {
      h.log(["usage: commit <message>"]);
      return;
    }
    const dir = h.repoDir ?? h.songPath;
    if (!dir) {
      h.log(["no repository"]);
      return;
    }
    try {
      const r = commitAndPush(dir, message, h.gitEnv);
      if (r.nothingToCommit) {
        h.log(["nothing to commit — the project is clean"]);
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
      h.log([`commit failed: ${(e as Error).message}`]);
    }
  },

  // pull — `--ff-only`, so a diverged branch fails with git's own message instead of a half-merged tree.
  "project.pull": async (_a, h) => {
    const dir = h.repoDir ?? h.songPath;
    if (!dir) {
      h.log(["no repository"]);
      return;
    }
    try {
      const r = pull(dir, h.gitEnv);
      h.log([r.upToDate ? "already up to date" : `pulled — ${r.summary}`]);
      if (!r.upToDate && h.songPath) await h.reload();
    } catch (e) {
      h.log([`pull failed: ${(e as Error).message}`]);
    }
  },

  // --- alternatives ---------------------------------------------------------
  // All four act on the REPO, like commit and pull: a workspace is a cloned repo and an
  // alternative is a branch of the whole thing, not of one song folder.
  "project.alt.new": async (a, h) => {
    const name = a.trim().split(/\s+/)[0] ?? "";
    if (!name) return h.log(["usage: project alternative new <name>"]);
    const dir = h.repoDir ?? h.songPath;
    if (!dir) return h.log(["no repository"]);
    try {
      const from = newAlternative(dir, name, h.gitEnv);
      h.log([`alternative '${name}' started from '${from}' — you are on it`]);
      await h.reload();
    } catch (e) {
      h.log([`alternative new failed: ${(e as Error).message}`]);
    }
  },
  "project.alt.apply": async (_a, h) => {
    const dir = h.repoDir ?? h.songPath;
    if (!dir) return h.log(["no repository"]);
    try {
      const { alt, parent, wip } = applyAlternative(dir, h.gitEnv);
      h.log(
        [
          // The wip commit is named, like `switch` names it: it is a commit the user did not ask for, and the
          // only way back to those edits on their own is knowing what it was called.
          wip ? `committed work in progress as "${wip}"` : null,
          `applied '${alt}' into '${parent}' — you are on '${parent}'`,
        ].filter(Boolean) as string[],
      );
      await h.reload();
    } catch (e) {
      h.log([`alternative apply failed: ${(e as Error).message}`]);
    }
  },
  "project.alt.cancel": async (_a, h) => {
    const dir = h.repoDir ?? h.songPath;
    if (!dir) return h.log(["no repository"]);
    try {
      const { alt, parent } = cancelAlternative(dir, h.gitEnv);
      h.log([`dropped '${alt}'s changes — you are on '${parent}'`]);
      await h.reload();
    } catch (e) {
      h.log([`alternative cancel failed: ${(e as Error).message}`]);
    }
  },
  "project.alt.switch": async (a, h) => {
    const name = a.trim().split(/\s+/)[0] ?? "";
    if (!name) return h.log(["usage: project alternative switch <name>"]);
    const dir = h.repoDir ?? h.songPath;
    if (!dir) return h.log(["no repository"]);
    try {
      const { from, wip } = switchAlternative(dir, name, h.gitEnv);
      h.log([
        wip
          ? `committed work in progress on '${from}' as "${wip}", now on '${name}'`
          : `now on '${name}'`,
      ]);
      await h.reload();
    } catch (e) {
      h.log([`alternative switch failed: ${(e as Error).message}`]);
    }
  },
};
