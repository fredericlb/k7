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
import { migrateChains } from "@studio/song/chainsMigrate";
import { bindModuleCc } from "@studio/song/controllerBind";
import { createCurveFile } from "@studio/song/curves";
import { freezeBlockedBy, freezePlans } from "@studio/song/freeze";
import {
  coldPlacementError,
  describeGraph,
  describeTrackGraph,
  loadGraph,
  parseChains,
  resolveTrack,
} from "@studio/song/graph";
import {
  cloneModuleFile,
  createModuleFile,
  createNode,
  createTrackFile,
  FILE_PARAMS,
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
import { trackMixer } from "@studio/song/project";
import {
  clipOnsets,
  deleteModule,
  insertChainStep,
  moduleAlternatives,
  newModuleAlternative,
  placeChainNode,
  replaceModuleInChains,
  selectModuleAlternative,
  setClipOnsets,
  setModuleAsset,
  setModuleBypass,
  setModuleChannel,
  setModuleFrozen,
  setModuleMonitor,
  setModuleParam,
  unlinkChainNode,
} from "@studio/song/projectEdit";
import {
  beatsToDuration,
  beatsToPosition,
  parsePosition,
} from "@studio/song/timecode";
import {
  MAX_GAIN_DB,
  MIN_GAIN_DB,
  movePlacementToTrack,
  moveTrackPlacement,
  panToLabel,
  removeTrackPlacement,
  resizeTrackPlacement,
  setTrackPlacementDisabled,
} from "@studio/song/trackMix";
import { migrateModuleUis } from "@studio/song/uiMigrate";
import type { ChainsFile } from "@studio/song/yaml/chainsSchema";
import { setFileValue } from "@studio/song/yaml/edit";
import { moduleFileFor, readModuleFile } from "@studio/song/yaml/moduleIO";
import { appendNotes, isPlayableNote } from "@studio/song/yaml/sequenceFile";
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
import { describeTimeline, describeTrack } from "./timeline";

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
 * Why `before → after` is not an arrow in chains.yaml, or null when it is.
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
    | ChainsFile
    | undefined;
  const dests = file?.modules?.[before];
  if (!dests)
    return `no node "${before}" in chains.yaml (nodes: ${
      Object.keys(file?.modules ?? {}).join(", ") || "none"
    })`;
  if (!dests.includes(after))
    return `'${before}' does not feed '${after}' (it feeds: ${dests.join(", ") || "nothing"})`;
  return null;
}

/**
 * Sort the two trailing optionals — `[extends-ref] [node-name]` — by SHAPE rather than by position.
 *
 * A ref is a path (`@engine/audio/amp/nam`, `audio/nam`); a node name is one segment, letters/digits/_/-
 * only, which createNode enforces. So the slash tells them apart, and it has to: the picker writes no
 * ref for a module the project already has, and the node the user then types landed in the ref slot — which
 * came back as "module 'echo' already exists, drop the extends-ref" about a ref they never wrote.
 */
function splitOptionals(rest: (string | undefined)[]): {
  extendsRef?: string;
  node?: string;
} {
  const args = rest.filter((a): a is string => !!a);
  const isRef = (s: string) => s.includes("/") || s.startsWith("@");
  if (args.length > 1) return { extendsRef: args[0], node: args[1] };
  if (!args.length) return {};
  return isRef(args[0]) ? { extendsRef: args[0] } : { node: args[0] };
}

/**
 * The cold refusal for a `module insert`, asked BEFORE anything is written.
 *
 * The module being placed may not exist yet, so this asks what it WILL BE: the project module
 * `<category>/<name>` if it is already there, else the ref it is about to extend — which is
 * where the coldness comes from in the case that matters, a use of the médiathèque's normalise.
 * Either way the answer is on disk now, which is what lets a refusal leave nothing behind.
 */
function coldInsertError(
  songPath: string,
  target: string,
  rest: (string | undefined)[],
  before: string,
): string | null {
  const segs = target.split("/");
  if (segs.length !== 2 || !segs[0] || !segs[1]) return null; // makeModule reports the shape
  const g = loadGraph(songPath);
  const ref = moduleRefOf(segs[0], segs[1]);
  const { extendsRef } = splitOptionals(rest);
  const module =
    g.moduleRefs[ref] ??
    g.moduleRefs[`@project/${ref}`] ??
    (extendsRef ? g.moduleRefs[extendsRef] : undefined);
  return coldPlacementError(g, module, target, before);
}

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
 * Create the module a `+` picked and hand back the name chains.yaml should use, or the message to show instead.
 *
 * The picker offers two kinds of thing and this handles both: something from the CATALOGUE (no local folder yet
 * — create one extending it) and a module this project already has (node it, do not recreate it). Existing
 * plus an `extends-ref` is neither, and is reported rather than silently ignored.
 *
 * Shared by `module insert` and `module place`: the two differ only in what they do with the name afterwards,
 * and having written the creation twice is how the two would drift.
 */
function makeModule(
  songPath: string,
  target: string,
  ...rest: (string | undefined)[]
): { ref: string; rel: string | null } | { error: string } {
  const { extendsRef, node } = splitOptionals(rest);
  const segs = target.split("/");
  if (segs.length !== 2 || !segs[0] || !segs[1])
    return { error: `'${target}' is not <category>/<name>` };
  const [category, name] = segs;
  const exists = existsSync(join(songPath, "modules", category, name));
  if (exists && extendsRef) {
    // Naming a NODE makes the ref redundant rather than contradictory: "use the module
    // that is already there, under this name". Refusing that was a dead end, because the two
    // optionals are positional once both are given — there was no way to name the node
    // without also passing a ref, and passing one is what the refusal was about.
    const inherits = existingExtends(songPath, category, name);
    if (!node)
      return {
        error: `module '${name}' already exists — add a node name to use it, or drop the extends-ref`,
      };
    // …unless it names a DIFFERENT parent, which is a real disagreement and not redundancy:
    // the module cannot be re-parented by instancing it, so acting would ignore what was typed.
    if (inherits && inherits !== extendsRef)
      return {
        error: `module '${name}' extends '${inherits}', not '${extendsRef}' — drop the extends-ref to node it as it is`,
      };
  }
  try {
    const rel = exists
      ? null
      : createModuleFile(songPath, category, name, extendsRef);
    if (node) createNode(songPath, category, name, node);
    // A node is named by its FILE alone now — `nodes/<node>.yaml` — so the chain
    // says that and nothing about the module it uses.
    return { ref: node ? node : name, rel };
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
// silenced the same way, by name, in `chains.yaml`'s `bypassed:`.
type MixTarget = Pick<TrackDoc, "id" | "name" | "mute">;

/**
 * Silence (or un-silence) a set of lanes, and push the result.
 *
 * A lane's mute IS its module's bypass — one state, in the one place a bypass is written
 * (packages/song/docs/trackModules.md). `track mute` and `track solo` are both this: mute toggles
 * the lane named, solo bypasses every OTHER one. Nothing is stored for solo, which is why it is
 * spelled as the set of mutes it produces rather than as a flag of its own.
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

/** `module alternative create|copy` — one shape, one difference. */
async function moduleAltAdd(
  a: string,
  h: CommandHost,
  copy: boolean,
): Promise<void> {
  const verb = copy ? "copy" : "create";
  const [module, name] = a.trim().split(/\s+/).filter(Boolean);
  if (!module) {
    h.log([`usage: module alternative ${verb} <module> [name]`]);
    return;
  }
  try {
    const made = newModuleAlternative(h.songPath, module, name, { copy });
    h.log([
      `${module}: alternative '${made.name}' — ${copy ? "a copy of the one that was on" : "empty, and running"}`,
    ]);
    await h.reload();
  } catch (e) {
    h.log([`module alternative ${verb}: ${(e as Error).message}`]);
  }
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

const clampDb = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x));
/** The tone bands' range, matching MixerPlugin's. */
const EQ_DB = 18;

/**
 * Set one knob on a track's strip.
 *
 * The value goes to the MIXER MODULE at the end of the chain, not to the track file: a track states no level of
 * its own any more. A track without a strip is refused rather than silently given one — where a mixer belongs in
 * a chain is a routing decision, and guessing it here would put a fader somewhere nobody asked for.
 */
async function stripParam(
  a: string,
  h: CommandHost,
  verb: string,
  param: string,
  parse: (v: number) => number,
  describe: (v: number) => string,
): Promise<void> {
  const [id, ...rest] = a.trim().split(/\s+/).filter(Boolean);
  if (!id) {
    h.log([`usage: ${verb} <track> …`]);
    return;
  }
  const p = h.project();
  const t = p.tracks.find((x) => x.id === id || x.name === id);
  if (!t) {
    h.log([`no track "${id}"`]);
    return;
  }
  const mixer = trackMixer(t);
  if (!mixer) {
    h.log([
      `${t.id} has no mixer module — add one at the end of its chain to give it a ${verb}`,
    ]);
    return;
  }
  try {
    const value = parse(Number(rest[0]));
    setModuleParam(h.songPath, mixer.name, param, value);
    // Push the mutated doc rather than reloading, so a fader drag stays snappy — the same trick mixMutate uses.
    const np: ProjectDoc = {
      ...p,
      tracks: p.tracks.map((x) =>
        x.id === t.id
          ? {
              ...x,
              plugins: x.plugins.map((pl) =>
                pl.id === mixer.id
                  ? { ...pl, params: { ...pl.params, [param]: value } }
                  : pl,
              ),
            }
          : x,
      ),
    };
    await h.applyProject(np);
    h.log([`${t.id}: ${describe(value)}`]);
  } catch (e) {
    h.log([`${verb} failed: ${(e as Error).message}`]);
  }
}

const eqBand = (a: string, h: CommandHost, verb: string, param: string) =>
  stripParam(
    a,
    h,
    verb,
    param,
    (v) => {
      if (!Number.isFinite(v)) throw new Error(`${verb} <track> <dB>`);
      return clampDb(v, -EQ_DB, EQ_DB);
    },
    (db) => `${verb} ${db > 0 ? "+" : ""}${db.toFixed(1)} dB`,
  );

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
  );
  h.log(lines);
  if (changed) await h.reload();
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
   * Solo, derived: bypass every OTHER lane, or lift it when they already are.
   *
   * Nothing on disk says "soloed" — a lane carries no flag and `chains.yaml` has no second list
   * beside `bypassed:`. Solo IS the set of mutes it produces, which is why turning it off simply
   * un-bypasses everything: there is no prior state to restore, and inventing a memory of one
   * would be a second source of truth for what you can already see.
   */
  "track.solo": async (a, h) => {
    const t = mixTarget(a, h, "solo");
    if (!t) return;
    const p = h.project();
    const others = [...p.tracks, ...p.groups].filter((x) => x.id !== t.id);
    const on = others.some((x) => !x.mute) || t.mute;
    await setLaneBypass(
      h,
      new Map([
        [t.id, false],
        ...others.map((x) => [x.id, on] as [string, boolean]),
      ]),
      `${t.id}: solo ${on ? "on" : "off"}`,
    );
  },
  "track.gain": (a, h) =>
    stripParam(
      a,
      h,
      "gain",
      "Volume",
      (v) => {
        if (!Number.isFinite(v)) throw new Error("gain <track> <dB>");
        return clampDb(v, MIN_GAIN_DB, MAX_GAIN_DB);
      },
      (db) => `gain ${db <= MIN_GAIN_DB ? "-inf" : db.toFixed(1)} dB`,
    ),
  "track.pan": (a, h) =>
    stripParam(
      a,
      h,
      "pan",
      "Pan",
      (v) => {
        if (!Number.isFinite(v)) throw new Error("pan <track> <-1..1>");
        return clampDb(v, -1, 1);
      },
      (x) => `pan ${panToLabel((x + 1) / 2)}`,
    ),
  // The strip's tone stack — three gains at fixed frequencies (see MixerPlugin). One verb per band rather than
  // one taking a band name: each is its own thing to bind a key or a knob to.
  "track.low": (a, h) => eqBand(a, h, "low", "Low"),
  "track.mid": (a, h) => eqBand(a, h, "mid", "Mid"),
  "track.high": (a, h) => eqBand(a, h, "high", "High"),

  // `track alternative select|create|copy` and `track freeze` were here. Both are module verbs
  // now, because a lane IS a module: `module alternative *` and `module freeze` reach a lane and
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
        // The window is the MATERIAL's, so this edit reaches every placement of it. Said out
        // loud rather than left to be discovered: nothing else in the song announces itself
        // changing under you. See @studio/song's docs/clipResize.md.
        `  ${done.material} windowed` +
          (done.sharedWith
            ? ` — also resizes ${done.sharedWith} other placement(s) of '${done.ref}'`
            : ""),
      ]);
      await h.reload();
    } catch (e) {
      h.log([`event resize failed: ${(e as Error).message}`]);
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
  "marker.create": async (arg, h) => {
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
  "marker.delete": async (arg, h) => {
    const name = arg.trim();
    if (!name) {
      h.log(["usage: marker delete <name>"]);
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

  "plugin.list": async (a, h) => {
    await h.listPlugins(a.trim() || undefined);
  },
  "plugin.rescan": async (_a, h) => {
    h.log(["rescanning plugins… (first scan can take a while)"]);
    await h.rescanPlugins();
  },

  // --- channel labels (global user preferences) -------------------------------
  // The interface in use is shown here but CHOSEN in the médiathèque's « État du moteur »,
  // which both switches the engine and writes this file (engine/moteur/docs/audioDevice.md).
  "channels.list": (_a, h) => {
    const p = loadPreferences();
    const f = formatChannels(p);
    h.log([
      `audio device: ${formatAudioDevice(p.audioDevice)}  (change: médiathèque → État du moteur)`,
      `in:  ${f.in || "(none — set with: channel in <ch> <label>)"}`,
      `out: ${f.out || "(none — set with: channel out <ch> <label>)"}`,
    ]);
  },
  "channels.set": (a, h) => {
    // channel <in|out> <chans> <label…>   e.g. channel in 3+4 synth
    const m = a.trim().match(/^(in|out)\s+(\S+)\s+(.+)$/i);
    if (!m)
      return h.log([
        "usage: channel set <in|out> <chans> <label>   e.g. channel set in 3+4 synth",
      ]);
    const dir = m[1].toLowerCase() as "in" | "out";
    const ch = parseChannels(m[2]);
    if (!ch.length)
      return h.log([`bad channels '${m[2]}' — use e.g. 1 or 3+4`]);
    setChannelLabel(dir, ch, m[3].trim());
    h.log([`${dir} ${ch.join("+")} = ${m[3].trim()}`]);
  },
  "channels.clear": (a, h) => {
    // channel clear <in|out> <chans>
    const m = a.trim().match(/^(in|out)\s+(\S+)/i);
    if (!m) return h.log(["usage: channel clear <in|out> <chans>"]);
    const dir = m[1].toLowerCase() as "in" | "out";
    const ch = parseChannels(m[2]);
    if (!ch.length) return h.log([`bad channels '${m[2]}'`]);
    clearChannelLabel(dir, ch);
    h.log([`cleared ${dir} ${ch.join("+")}`]);
  },
  "plugin.open": async (a, h) => {
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

  // module param <module> <param> <value>: the param is read as everything BETWEEN module and value, since engine
  // display names contain spaces. module bypass writes the module's name into chains.yaml's `bypassed` list, not
  // into the module file — a module's own file is what it IS, and being switched off is where it sits.
  "module.bypass": async (a, h) => {
    const m = /^(\S+)(?:\s+(on|off|true|false))?$/.exec(a.trim());
    if (!m) {
      h.log(["usage: module bypass <module> [on|off]"]);
      return;
    }
    const [, module, state] = m;
    // chains.yaml alone, not loadGraph: the only question here is which chain holds this module and whether it is
    // on, and that is one file. loadGraph also reads every module, clip, sequence and curve in the song — 220 ms
    // on a real project, spent to answer a question chains.yaml already answers in one. Still the derived chains
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
      // fall back to the full reload, which is what makes their chains.yaml edit take effect at all.
      if (found) await h.applyProject(np);
      else await h.reload();
    } catch (e) {
      h.log([`bypass failed: ${(e as Error).message}`]);
    }
  },

  /**
   * module monitor <module> <off|auto|on> — is this live input audible?
   *
   * A module FIELD, not a param: an io module runs no plugin, so there is nothing to send a value to and nothing
   * to patch. The engine learns it by rebuilding the track's input, which is what the reload is for.
   *
   * The file it writes may be the workspace's SHARED one — `module populate` files one io/IN node per
   * interface channel there, beside the `channel:` that says which channel it is. Whether that input is audible
   * belongs with it: both describe the desk, not the song. Said out loud in the log, because it is the one thing
   * here that reaches past this project.
   */
  /**
   * module channel <module> <n>[,<n2>] — which interface input this live input listens on.
   *
   * A module FIELD like `monitor`, written into the module's own file and possibly the workspace's
   * shared one, for the same reason: which socket a guitar is in describes the desk, not the song.
   *
   * One channel or two, and two only ever means a pair the interface actually groups — `findWaveInput`
   * matches a device on its exact channel list, so a set the rig does not offer resolves to nothing and
   * plays as silence. Nothing here can check that (the rig is the engine's to know); the graph's IN panel
   * only ever offers sets that exist, and this refuses the shapes that could never be one.
   */
  "module.channel": async (a, h) => {
    const usage =
      "usage: module channel <module> <n>[,<n2>]  (e.g. module channel ge_rythm-in 1,2)";
    const [module, spec] = a.trim().split(/\s+/).filter(Boolean);
    if (!module || !spec) {
      h.log([usage]);
      return;
    }
    const channels = spec.split(",").map((s) => Number(s.trim()));
    if (channels.some((n) => !Number.isInteger(n) || n < 1)) {
      h.log([`'${spec}' is not a channel or a pair of them`, usage]);
      return;
    }
    try {
      const path = setModuleChannel(h.songPath, module, channels);
      h.log([
        `${module}: channel ${channels.join(", ")}` +
          (relative(h.songPath, path).startsWith("..")
            ? " — in the shared library, so every project beside this one sees it"
            : ""),
      ]);
      await h.reload();
    } catch (e) {
      h.log([`module channel failed: ${(e as Error).message}`]);
    }
  },

  "module.monitor": async (a, h) => {
    const usage = "usage: module monitor <module> <off|auto|on>";
    const [module, state] = a.trim().split(/\s+/).filter(Boolean);
    if (!module || !state) {
      h.log([usage]);
      return;
    }
    if (state !== "off" && state !== "auto" && state !== "on") {
      h.log([`'${state}' is not off, auto or on`, usage]);
      return;
    }
    try {
      const path = setModuleMonitor(h.songPath, module, state);
      h.log([
        `${module}: monitor ${state}` +
          (relative(h.songPath, path).startsWith("..")
            ? " — in the shared library, so every project beside this one sees it"
            : ""),
      ]);
      await h.reload();
    } catch (e) {
      h.log([`module monitor failed: ${(e as Error).message}`]);
    }
  },

  // Point a file-valued param at one of the module's own assets (`none` clears it). Not patchable into the running
  // engine — the plugin loads its file when BUILT — so it writes and reloads. Swapping an amp model isn't a knob drag.
  "module.asset": async (a, h) => {
    const m = /^(\S+)\s+(\S+)\s+(.+)$/.exec(a.trim());
    if (!m) {
      h.log([
        `usage: module <${FILE_PARAMS.join("|")}> <module> <file>  (e.g. module nam amp jcm800.nam, or \`none\` to clear)`,
      ]);
      return;
    }
    const [, param, module, rawFile] = m;
    const file = rawFile.replace(/^"(.*)"$/s, "$1").trim();
    const clearing = file === "none";
    // An empty list means the module has no `assets/` — say that, not "no such file", which
    // sends you looking through a directory that isn't there. The files live in the module,
    // so there is one place to look and nothing to declare anywhere.
    if (!clearing) {
      const found = loadModules(h.songPath)[module];
      // Its own assets AND its ancestors' — the same answer the panel's picker offers, so the
      // command cannot refuse a file the picker just showed. It could: a song points at a shared
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
      h.log([`module ${param} failed: ${(e as Error).message}`]);
    }
  },

  /**
   * The three alternative verbs, one operation each on ONE module's file.
   *
   * All of them end in `h.reload()` rather than `applyProject` with a patched doc: a set may
   * change any field — the plugin, the panel, a lane's whole clip list — so there is nothing
   * cheap to diff, and re-reading is both simpler and what the engine has to be told anyway.
   * See packages/song/docs/alternatives.md.
   */
  "module.alt.select": async (a, h) => {
    const [module, name] = a.trim().split(/\s+/).filter(Boolean);
    if (!module) {
      h.log(["usage: module alternative select <module> [name]"]);
      return;
    }
    try {
      const { names, current } = moduleAlternatives(h.songPath, module);
      if (!name) {
        // The list is the useful answer to "which ones are there?", so a bare call says it.
        h.log([
          names.length > 1
            ? `${module}: ${names.map((n) => (n === current ? `[${n}]` : n)).join("  ")}`
            : `${module} has one set of settings — 'module alternative create ${module}' starts a second`,
        ]);
        return;
      }
      selectModuleAlternative(h.songPath, module, name);
      h.log([`${module}: running alternative '${name}'`]);
      await h.reload();
    } catch (e) {
      h.log([`module alternative: ${(e as Error).message}`]);
    }
  },

  "module.alt.create": (a, h) => moduleAltAdd(a, h, false),
  "module.alt.copy": (a, h) => moduleAltAdd(a, h, true),

  /**
   * Freeze at a module — a TOGGLE, because a freeze has exactly two states and the file says
   * which one it is in.
   *
   * Everything upstream of the module, itself included, is bounced to one wav and plays as that
   * wav until it is thawed. The refusals are the interesting half and all come before the engine
   * is even looked for: see packages/song/docs/freeze.md.
   */
  "module.freeze": async (a, h) => {
    const module = a.trim().split(/\s+/).filter(Boolean)[0];
    if (!module) {
      h.log(["usage: module freeze <module>"]);
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

  "module.param": async (a, h) => {
    const m = /^(\S+)\s+(.+?)\s+(\S+)$/.exec(a.trim());
    if (!m) {
      h.log([
        'usage: module param <module> <param> <value>  (e.g. module param synth "Filter Freq" 69)',
      ]);
      return;
    }
    const [, module, rawParam, rawValue] = m;
    const param = rawParam.replace(/^"(.*)"$/s, "$1").trim();
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
      h.log([`module param failed: ${(e as Error).message}`]);
    }
  },

  // module cc <module> <param> <channel> <cc> — bind a MIDI control to a param, or
  // `module cc <module> <param> none` to unbind. The param is read as everything BETWEEN the
  // module and the trailing numbers, since plugin display names contain spaces (as in module.param).
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

  // ui migrate moves the `ui:` blocks still living inside module files out into a `ui.yaml` beside each (see uiMigrate.ts).
  // Both trees at once — this project's modules and the shared `_modules` beside it — because a panel is keyed
  // by ref, and leaving half of them inline would mean two places to look for the same thing.
  "ui.migrate": async (_a, h) => {
    const r = migrateModuleUis(h.songPath);
    if (r.moved.length)
      h.log([
        `moved ${r.moved.length} panel(s):`,
        ...r.moved.map((m) => `  ${m}`),
      ]);
    else h.log(["no inline `ui:` left — nothing to move"]);
    if (r.errors.length)
      h.log(["not moved:", ...r.errors.map((e) => `  ${e}`)]);
    if (r.moved.length) await h.reload();
  },

  // chains migrate rewrites a pre-segments chains.yaml (see chainsMigrate.ts). Re-runnable: a file already in
  // the new shape is left alone, so running it twice costs a read.
  "chains.migrate": async (_a, h) => {
    const r = migrateChains(h.songPath);
    if (!r.changed) {
      h.log([
        r.errors.length
          ? `chains migrate: ${r.errors.join("; ")}`
          : "chains.yaml is already segments — nothing to migrate",
      ]);
      return;
    }
    h.log([
      "migrated chains.yaml to segments (the old file is beside it as chains.yaml.bak)",
      // A split is the one change that touches more than the routing file, so it is said
      // outright rather than left for the reader to notice a new module file.
      ...r.split.map(
        (s) =>
          `  '${s.module}' was used in ${s.nodes.length} chains — split into ${s.nodes.join(", ")}`,
      ),
      ...r.created.map((c) => `  created ${c}`),
      ...r.notes.map((n) => `  note: ${n}`),
      ...r.errors.map((e) => `  ! ${e}`),
    ]);
    await h.reload();
  },

  // module new <category>/<name> scaffolds a BARE module; the author adds an inline plugin, rack or `extends`.
  "module.create": async (a, h) => {
    const usage =
      "usage: module new <category>/<name> [extends-ref] [node-name]";
    // Two optional args, both filled by the graph's module picker: the ref this module INHERITS, and a node to
    // create in the same breath — a chain step names `module:node`, so the picker always asks for one.
    const [target, extendsRef, node] = a.trim().split(/\s+/).filter(Boolean);
    if (!target) {
      h.log([usage]);
      return;
    }
    // "<category>/<name>", exactly two segments: guessing a category would put the module where nobody asked.
    const segs = target.split("/");
    if (segs.length !== 2 || !segs[0] || !segs[1]) {
      h.log([`'${target}' is not <category>/<name>`, usage]);
      return;
    }
    const [category, name] = segs;
    try {
      // createModuleFile validates `extendsRef` and throws on a typo — worth surfacing: a bad `extends` won't compile.
      const rel = createModuleFile(h.songPath, category, name, extendsRef);
      const log = [
        extendsRef
          ? `created ${rel} extending ${extendsRef}`
          : `created ${rel} — add an inline plugin/rack (or an \`extends\`) to give it a sound`,
      ];
      // The node comes AFTER the module, whose folder it needs. A failure leaves the module and says so.
      if (node) {
        const irel = createNode(h.songPath, category, name, node);
        log.push(`created ${irel} — use it in a chain as {module: "${node}"}`);
      }
      h.log(log);
      await h.reload();
    } catch (e) {
      h.log([`create module failed: ${(e as Error).message}`]);
    }
  },

  // node new — one USE of an existing module, as `nodes/<node>.yaml`. It names what it uses with
  // `extends` and states only what it changes; chains name it by its FILENAME alone.
  "node.new": async (a, h) => {
    const usage = "usage: node new <category>/<name> <node-name>";
    const args = a.trim().split(/\s+/).filter(Boolean);
    if (args.length !== 2) {
      h.log([usage]);
      return;
    }
    const [target, node] = args;
    const segs = target.split("/");
    if (segs.length !== 2 || !segs[0] || !segs[1]) {
      h.log([`'${target}' is not <category>/<name>`, usage]);
      return;
    }
    const [category, module] = segs;
    try {
      const rel = createNode(h.songPath, category, module, node);
      h.log([`created ${rel} — use it in a chain as {module: "${node}"}`]);
      await h.reload();
    } catch (e) {
      h.log([`node new failed: ${(e as Error).message}`]);
    }
  },

  // clone module — copy a module folder (file, .vstpreset, rack audio) into the same category under a new name.
  // module delete <name|name:node> — the file, and the graph closed back up around it.
  "module.delete": async (a, h) => {
    const key = a.trim().split(/\s+/).filter(Boolean)[0];
    if (!key) {
      h.log(["usage: module delete <module|module:node>"]);
      return;
    }
    try {
      const { removed, rewired } = deleteModule(h.songPath, key);
      h.log([
        `deleted ${removed}` +
          (rewired.length
            ? ` and rejoined what fed it: ${rewired.join(", ")}`
            : ""),
      ]);
      await h.reload();
    } catch (e) {
      h.log([`delete module failed: ${(e as Error).message}`]);
    }
  },

  // node unlink <node> — out of the signal path, files untouched. The splice is
  // removeNode's; what this adds is that nothing is deleted, so it goes back with `chain add`.
  "node.unlink": async (a, h) => {
    const node = a.trim().split(/\s+/).filter(Boolean)[0];
    if (!node) {
      h.log(["usage: node unlink <node>"]);
      return;
    }
    try {
      const { rewired } = unlinkChainNode(h.songPath, node);
      h.log([
        `unlinked ${node}` +
          (rewired.length
            ? ` and rejoined what fed it: ${rewired.join(", ")}`
            : " — nothing fed it, so there was nothing to rejoin") +
          "; its files are untouched",
      ]);
      await h.reload();
    } catch (e) {
      h.log([`node unlink failed: ${(e as Error).message}`]);
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

  // module replace <name> <category/name> [extends-ref] — swap what a chain step IS, keeping where it sits.
  //
  // Not delete-then-create: that loses the position. The chain is rewritten in place, so the new module lands
  // exactly where the old one was, in every chain that named it. What it keeps is the NAME the chains use;
  // everything the old module carried — params, ui, preset — goes, because it belonged to the old module.
  "module.replace": async (a, h) => {
    const usage =
      "usage: module replace <module> <category>/<name> [extends-ref]";
    const [key, target, extendsRef] = a.trim().split(/\s+/).filter(Boolean);
    if (!key || !target) {
      h.log([usage]);
      return;
    }
    const segs = target.split("/");
    if (segs.length !== 2 || !segs[0] || !segs[1]) {
      h.log([`'${target}' is not <category>/<name>`, usage]);
      return;
    }
    const [category, name] = segs;
    // The new module FIRST: if it cannot be created, the old one is still there and still wired up.
    let rel: string;
    try {
      rel = createModuleFile(h.songPath, category, name, extendsRef);
    } catch (e) {
      h.log([`replace failed: ${(e as Error).message} — '${key}' left alone`]);
      return;
    }
    try {
      const { removed, rewired } = replaceModuleInChains(h.songPath, key, name);
      h.log([
        `created ${rel}, replaced '${key}' with '${name}'` +
          (rewired.length
            ? ` (fed by ${rewired.join(", ")})`
            : " (it was wired to nothing)") +
          `; removed ${removed}`,
      ]);
      await h.reload();
    } catch (e) {
      h.log([`created ${rel}, but the swap failed: ${(e as Error).message}`]);
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

  "graph.inspect": (a, h) => {
    let g;
    try {
      g = loadGraph(h.songPath);
    } catch (e) {
      h.log([`project inspect graph: ${(e as Error).message}`]);
      return;
    }
    const track = a.trim();
    const header = `${g.project.name}  ·  ${Object.keys(g.chains).length} chains · ${Object.keys(g.tracks).length} tracks`;
    let body: string[];
    if (track) {
      const id = resolveTrack(g, track);
      if (!id) {
        h.log([
          `no track matching '${track}' (tracks: ${Object.keys(g.tracks).join(", ") || "none"})`,
        ]);
        return;
      }
      body = [
        `chains for track '${id}':`,
        ...describeTrackGraph(g, id).map((l) => "  " + l),
      ];
    } else {
      body = ["graph:", ...describeGraph(g).map((l) => "  " + l)];
    }
    h.log([header, ...body, ...g.warnings.map((w) => `! ${w}`)]);
  },

  /**
   * module insert <before> <after> <category>/<name> [extends-ref] [node]
   *
   * The graph's `+` in ONE command. It used to be two — `module new`, then `chain add` — sent as two HTTP calls
   * with a full project recompile between them, purely because the frontend had to learn the new module's name
   * before it could name it in a chain. Here that name is known: this command chose it.
   *
   * It also skips the loadGraph `chain add` needs (~250 ms on a real song): the arrow is a question about
   * chains.yaml alone, and the module's existence needs no checking because we just created it.
   *
   * No chain to name any more: `before → after` IS an edge in the file, so there is nothing left for a chain
   * name to disambiguate — and the index arithmetic that used to place the step went with it.
   */
  "module.insert": async (a, h) => {
    const usage =
      "usage: module insert <before> <after> <category>/<name> [extends-ref] [node]";
    const parts = a.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 3) {
      h.log([usage]);
      return;
    }
    const [before, after, target, ...rest] = parts;

    // The arrow, from chains.yaml alone — checked BEFORE the module is created, so a bad
    // drop leaves nothing behind.
    try {
      const arrow = arrowError(h.songPath, before, after);
      if (arrow) {
        h.log([arrow]);
        return;
      }
    } catch (e) {
      h.log([`module insert: ${(e as Error).message}`]);
      return;
    }

    // …and the cold rule, for the same reason and in the same place: a module that cannot go here
    // must not leave a folder behind. Asked of what is being placed BEFORE it exists — the
    // coldness is a fact about the module or about what it extends, both readable now.
    try {
      const cold = coldInsertError(h.songPath, target, rest, before);
      if (cold) {
        h.log([cold]);
        return;
      }
    } catch (e) {
      h.log([`module insert: ${(e as Error).message}`]);
      return;
    }

    // The module FIRST: a chain naming something that does not exist is a project that will not load, so the
    // file has to be there before the reference is written.
    const made = makeModule(h.songPath, target, ...rest);
    if ("error" in made) {
      h.log([`module insert failed: ${made.error}`, usage]);
      return;
    }
    const { ref, rel } = made;
    try {
      insertChainStep(h.songPath, before, after, ref);
      h.log([
        `${rel ? `created ${rel}; ` : ""}inserted ${ref} between ${before} and ${after}`,
      ]);
      await h.reload();
    } catch (e) {
      // The module exists and is fine; only the wiring failed. Say which, or it reads as a total failure.
      h.log([
        `${rel ? `created ${rel}, but ` : ""}the chain insert failed: ${(e as Error).message}`,
      ]);
      await h.reload();
    }
  },

  /**
   * module place <category>/<name> [extends-ref] [node]
   *
   * The same as `module insert`, minus the arrow: the module is created and written into chains.yaml wired to
   * NOTHING. That is a state the file can now hold (`modules: { x: [] }`), and it is what a right-click on empty
   * canvas asks for — put this here, I'll connect it in a moment.
   *
   * It is a real node from that instant, not a sketch: it shows in the graph, it is named in the file, and the
   * compiler skips it because it is on no path. The alternative — creating the module and leaving chains.yaml
   * alone — makes a folder nothing mentions, which is the shape a module takes when you have FORGOTTEN it.
   */
  "module.place": async (a, h) => {
    const usage = "usage: module place <category>/<name> [extends-ref] [node]";
    const [target, ...rest] = a.trim().split(/\s+/).filter(Boolean);
    if (!target) {
      h.log([usage]);
      return;
    }
    const made = makeModule(h.songPath, target, ...rest);
    if ("error" in made) {
      h.log([`module place failed: ${made.error}`, usage]);
      return;
    }
    const { ref, rel } = made;
    try {
      placeChainNode(h.songPath, ref);
      h.log([
        `${rel ? `created ${rel}; ` : ""}placed ${ref} — wired to nothing yet`,
      ]);
      await h.reload();
    } catch (e) {
      // The module exists and is fine; only the placement failed. Say which, or it reads as a total failure.
      h.log([
        `${rel ? `created ${rel}, but ` : ""}the placement failed: ${(e as Error).message}`,
      ]);
      await h.reload();
    }
  },

  // chain add <before> <after> <module> — splice an EXISTING module into the arrow between two nodes.
  "chain.addModule": async (a, h) => {
    const usage =
      "usage: chain add <before> <after> <module> (the two ends of one graph arrow, then the module to insert between them)";
    const parts = a.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 3) {
      h.log([usage]);
      return;
    }
    const [before, after, block] = parts;
    let g;
    try {
      g = loadGraph(h.songPath);
    } catch (e) {
      h.log([`chain add: ${(e as Error).message}`]);
      return;
    }
    const arrow = arrowError(h.songPath, before, after);
    if (arrow) {
      h.log([arrow]);
      return;
    }
    // The block must be a real node: the engine would reject a dangling ref, so catch it with an actionable message.
    // A shared module is named by its ref and lives in moduleRefs until a chain uses it.
    if (!(block in g.modules) && !(block in g.moduleRefs)) {
      h.log([
        `no module "${block}" in this project (modules: ${Object.keys(g.modules).join(", ") || "none"})`,
      ]);
      return;
    }
    // A COLD module only works on audio already on disk — refused before the file is touched.
    const cold = coldPlacementError(
      g,
      g.modules[block] ?? g.moduleRefs[block],
      block,
      before,
    );
    if (cold) {
      h.log([cold]);
      return;
    }
    try {
      insertChainStep(h.songPath, before, after, block);
      h.log([`inserted ${block} between ${before} and ${after}`]);
      await h.reload();
    } catch (e) {
      h.log([`chain add failed: ${(e as Error).message}`]);
    }
  },

  // The arrangement as text, read off the compiled project — so it reports what would actually sound.
  "timeline.inspect": (a, h) => {
    let p: ProjectDoc;
    try {
      p = h.project();
    } catch (e) {
      h.log([`project inspect timeline: ${(e as Error).message}`]);
      return;
    }
    const track = a.trim();
    const clips = p.tracks.reduce((n, t) => n + t.clips.length, 0);
    const header = `${p.name}  ·  ${p.tracks.length} tracks · ${clips} clips`;
    if (!track) {
      h.log([header, "timeline:", ...describeTimeline(p).map((l) => "  " + l)]);
      return;
    }
    const t = p.tracks.find((x) => x.id === track || x.name === track);
    if (!t) {
      h.log([
        `no track matching '${track}' (tracks: ${p.tracks.map((x) => x.id).join(", ") || "none"})`,
      ]);
      return;
    }
    h.log([
      header,
      ...describeTrack(t, p.timeSigNumerator, p.timeSigDenominator).map(
        (l) => "  " + l,
      ),
    ]);
  },

  // --- recording — the one track edit that writes NO file ---------------------
  // Arming is session state that dies with the engine, so there is nothing to write. The two checks here are the
  // SONG's: does the track exist, and does it declare an input. The engine re-checks and adds what only it knows.
  "track.rec": async (a, h) => {
    const id = a.trim().split(/\s+/).filter(Boolean)[0];
    if (!id) {
      h.log(["usage: track rec <track>"]);
      return;
    }
    const p = h.project();
    const matches = (x: { id: string; name: string }) =>
      x.id === id || x.name === id;
    const t = p.tracks.find(matches);
    if (!t) {
      h.log([
        p.groups.some(matches)
          ? `"${id}" is a group — rec takes a track (a group carries no input)`
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
      h.log([`${t.id}: rec ${armed ? "armed" : "disarmed"}`]);
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
