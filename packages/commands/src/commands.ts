// commands.ts — the feature registry: one stable SID (module.new, transport.play, …) per
// capability, mapped to a handler that acts through a CommandHost, so the SAME feature
// runs from the web command bar and from `pistes cmd`. Which words invoke a SID lives
// declaratively in commands.yaml (see commandSpec.ts); this file is just the behaviours.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, parse, relative } from "node:path";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import type {
  AudioDeviceInfo,
  PluginInfo,
} from "@studio/engine-client/engineClient";
import { migrateChains } from "@studio/song/chainsMigrate";
import { createCurveFile } from "@studio/song/curves";
import {
  describeGraph,
  describeTrackGraph,
  loadGraph,
  parseChains,
  resolveTrack,
} from "@studio/song/graph";
import {
  cloneModuleFile,
  createModuleFile,
  createModuleInstance,
  createTrackFile,
  listLibrary,
  loadChains,
  loadProjectRoot,
} from "@studio/song/loader";
import { materialiseEngineModule } from "@studio/song/moduleFork";
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
  deleteModule,
  insertChainStep,
  placeChainNode,
  replaceModuleInChains,
  setModuleAsset,
  setModuleBypass,
  setModuleMonitor,
  setModuleParam,
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
  setTrackFields,
  setTrackPlacementDisabled,
  type TrackFields,
} from "@studio/song/trackMix";
import { migrateModuleUis } from "@studio/song/uiMigrate";
import type { ChainsFile } from "@studio/song/yaml/chainsSchema";
import { setFileValue } from "@studio/song/yaml/edit";
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
import { freezeTrackRender } from "./render";
import { describeTimeline, describeTrack } from "./timeline";

// Where a freeze render lands: beside the track's own file, named for it. `tracks/melody.wav` sits next to
// `tracks/melody.yaml`, so which render belongs to which track needs no explaining.
const FROZEN_DIR = "tracks";

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
  // instance per input of the one in use. Optional: a host with no engine link simply
  // populates the plugin modules and says the inputs were skipped.
  getAudioDevices?(): Promise<AudioDeviceInfo[]>;
  // Transport config for git, merged over the env: the web host pins GIT_SSH_COMMAND to the user's deploy key,
  // the CLI leaves it to the machine's own config.
  gitEnv?: GitEnv;
  // Where the whole-repo git commands run — the workspace ROOT on the web, since a workspace is one cloned repo.
  repoDir?: string;
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
  const dests = file?.tracks?.[before] ?? file?.modules?.[before];
  if (!dests)
    return `no node "${before}" in chains.yaml (nodes: ${
      [
        ...Object.keys(file?.tracks ?? {}),
        ...Object.keys(file?.modules ?? {}),
      ].join(", ") || "none"
    })`;
  if (!dests.includes(after))
    return `'${before}' does not feed '${after}' (it feeds: ${dests.join(", ") || "nothing"})`;
  return null;
}

/**
 * Sort the two trailing optionals — `[extends-ref] [instance-name]` — by SHAPE rather than by position.
 *
 * A ref is a path (`@engine/audio/amp/nam`, `audio/nam`); an instance name is one segment, letters/digits/_/-
 * only, which createModuleInstance enforces. So the slash tells them apart, and it has to: the picker writes no
 * ref for a module the project already has, and the instance the user then types landed in the ref slot — which
 * came back as "module 'echo' already exists, drop the extends-ref" about a ref they never wrote.
 */
function splitOptionals(rest: (string | undefined)[]): {
  extendsRef?: string;
  instance?: string;
} {
  const args = rest.filter((a): a is string => !!a);
  const isRef = (s: string) => s.includes("/") || s.startsWith("@");
  if (args.length > 1) return { extendsRef: args[0], instance: args[1] };
  if (!args.length) return {};
  return isRef(args[0]) ? { extendsRef: args[0] } : { instance: args[0] };
}

/**
 * Create the module a `+` picked and hand back the name chains.yaml should use, or the message to show instead.
 *
 * The picker offers two kinds of thing and this handles both: something from the CATALOGUE (no local folder yet
 * — create one extending it) and a module this project already has (instance it, do not recreate it). Existing
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
  const { extendsRef, instance } = splitOptionals(rest);
  const segs = target.split("/");
  if (segs.length !== 2 || !segs[0] || !segs[1])
    return { error: `'${target}' is not <category>/<name>` };
  const [category, name] = segs;
  const exists = existsSync(join(songPath, "modules", category, name));
  if (exists && extendsRef)
    return {
      error: `module '${name}' already exists — drop the extends-ref to instance it instead`,
    };
  try {
    const rel = exists
      ? null
      : createModuleFile(songPath, category, name, extendsRef);
    if (instance) createModuleInstance(songPath, category, name, instance);
    return { ref: instance ? `${name}:${instance}` : name, rel };
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
  return { track, atBeats, hit, num, den };
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

// What a mixer edit can address. A group is authored as a track and shares mute/solo, but has no lane of its own.
type MixTarget = Pick<TrackDoc, "id" | "name" | "mute" | "solo">;

// The mixer's own subset of the writable track fields. `frozen` is written the same way but is not a mixer move:
// it names a file rather than setting a level, it can be null (the unfreeze), and mixMutate spreads what it gets
// straight onto a TrackDoc, where a null would not belong.
type MixFields = Omit<TrackFields, "frozen">;

// A mixer edit: resolve the track (or group), compute its new fields, write them to its file, then re-send.
// `groups: true` opts a verb in — only mute/solo, which fold onto the members; gain/pan would write a dead field.
async function mixMutate(
  a: string,
  h: CommandHost,
  verb: string,
  fields: (t: MixTarget, args: string[]) => MixFields,
  describe: (t: MixTarget, f: MixFields) => string,
  { groups = false }: { groups?: boolean } = {},
): Promise<void> {
  const [id, ...rest] = a.trim().split(/\s+/).filter(Boolean);
  if (!id) {
    h.log([`usage: ${verb} <${groups ? "track|group" : "track"}> …`]);
    return;
  }
  const p = h.project();
  const matches = (x: { id: string; name: string }) =>
    x.id === id || x.name === id;
  const t = p.tracks.find(matches);
  const g = groups ? p.groups.find(matches) : undefined;
  const target: MixTarget | undefined = t ?? g;
  if (!target) {
    // Naming a group a verb can't take is a different mistake from naming nothing — say which, or you hunt a typo.
    h.log([
      !groups && p.groups.some(matches)
        ? `"${id}" is a group — ${verb} takes a track (a group carries mute/solo only)`
        : `no track "${id}"`,
    ]);
    return;
  }
  try {
    const f = fields(target, rest);
    // Persist, then push the mutated doc as a cheap diff rather than reloading the project, so mixer moves stay snappy.
    const np: ProjectDoc = t
      ? {
          ...p,
          tracks: p.tracks.map((x) => (x.id === t.id ? { ...x, ...f } : x)),
        }
      : {
          ...p,
          groups: p.groups.map((x) =>
            x.id === target.id
              ? { ...x, mute: f.mute ?? x.mute, solo: f.solo ?? x.solo }
              : x,
          ),
        };
    setTrackFields(h.songPath, target.id, f);
    await h.applyProject(np);
    h.log([describe(target, f)]);
  } catch (e) {
    h.log([`${verb} failed: ${(e as Error).message}`]);
  }
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

// --- SID registry ------------------------------------------------------------

export const SID_HANDLERS: Record<string, SidHandler> = {
  // A track IS its file. These used to hand a doc built in memory to applyProject, which
  // caches it and tells the engine — so a strip appeared in the mixer and nothing was
  // written, and the track vanished on the next reload. Write the file, then reload, so
  // what plays is what is on disk.
  "track.new.audio": async (a, h) => newTrack(a, h, "audio"),
  "track.new.midi": async (a, h) => newTrack(a, h, "midi"),

  // Peak-normalize one project-relative audio file to -1 dBFS, writing <name>_norm beside it; re-running is idempotent.
  "clip.normalize": async (arg, h) => {
    const rel = arg.trim().replace(/\\/g, "/");
    if (!rel) {
      h.log([
        "usage: clip normalize <track|path>  (a track, or a project-relative audio file)",
      ]);
      return;
    }

    // A TRACK normalises all its clips TOGETHER against the loudest peak, so they keep their balance — one by one
    // would flatten exactly the dynamics between takes that make a track sound played rather than assembled.
    const track = h
      .project()
      .tracks.find((t) => t.id === rel || t.name === rel);
    const sources = track
      ? [
          ...new Set(
            track.clips
              .filter((c) => c.type === "audio" && c.source)
              .map((c) => c.source),
          ),
        ]
      : [join(h.songPath, rel)];
    if (track && !sources.length) {
      h.log([`'${track.id}' has no audio clips to normalize`]);
      return;
    }
    const missing = sources.filter((s) => !existsSync(s));
    if (missing.length) {
      h.log([
        track
          ? `missing source(s) on '${track.id}': ${missing.map((m) => relative(h.songPath, m).replace(/\\/g, "/")).join(", ")}`
          : `file not found: ${rel}`,
      ]);
      return;
    }

    const outFor = (s: string) => {
      const p = parse(s);
      return join(p.dir, `${p.name.replace(/_norm$/, "")}_norm${p.ext}`);
    };

    const engine = findEngineBinary();
    if (!engine) {
      h.log([
        "normalize failed: studio-moteur binary not found (build the engine)",
      ]);
      return;
    }
    // Target peak for -1 dBFS.
    const target = 10 ** (-1 / 20); // ≈ 0.8913
    // Every (in,out) pair in ONE invocation — that is what makes the gain shared.
    const pairs = sources.flatMap((s) => [s, outFor(s)]);
    try {
      execFileSync(engine, ["--normalize", String(target), ...pairs], {
        encoding: "utf8",
      });
    } catch (e) {
      h.log([`normalize failed: ${(e as Error).message.split("\n")[0]}`]);
      return;
    }
    const show = (s: string) => relative(h.songPath, s).replace(/\\/g, "/");
    h.log([
      track
        ? `normalized ${sources.length} clip(s) on '${track.id}' with one shared gain (-1 dBFS): ${sources.map((s) => show(outFor(s))).join(", ")}`
        : `normalized ${rel} → ${show(outFor(sources[0]))} (-1 dBFS)`,
    ]);
    await h.reload();
  },

  // --- mixer (shared: TUI + CLI/web) — persisted to the track's file ----------
  "track.mute": (a, h) =>
    mixMutate(
      a,
      h,
      "mute",
      (t) => ({ mute: !t.mute }),
      (t, f) => `${t.id}: ${f.mute ? "muted" : "unmuted"}`,
      { groups: true },
    ),
  "track.solo": (a, h) =>
    mixMutate(
      a,
      h,
      "solo",
      (t) => ({ solo: !t.solo }),
      (t, f) => `${t.id}: solo ${f.solo ? "on" : "off"}`,
      { groups: true },
    ),
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

  // track freeze <track> — bounce the track through its own modules and play THAT until it is unfrozen again.
  // A toggle, like mute and solo, because it is the same kind of thing: one state of one track, flipped.
  "track.freeze": async (a, h) => {
    const id = a.trim().split(/\s+/).filter(Boolean)[0];
    if (!id) {
      h.log(["usage: track freeze <track>"]);
      return;
    }
    const p = h.project();
    const track = p.tracks.find((t) => t.id === id || t.name === id);
    if (!track) {
      h.log([
        p.groups.some((g) => g.id === id || g.name === id)
          ? `"${id}" is a group — freeze takes a track (a group computes nothing of its own to render)`
          : `no track "${id}"`,
      ]);
      return;
    }
    // A strudel lane's material is streamed by PatternClock while the transport rolls; a stopped one has no clips
    // at all, so its render would be a file of silence. Said plainly rather than discovered as an empty freeze.
    if (track.generated) {
      h.log([
        `'${track.id}' is a strudel track — its material only exists while it plays, so it can't be frozen`,
      ]);
      return;
    }

    const render = join(h.songPath, FROZEN_DIR, `${track.id}.wav`);
    if (track.frozen) {
      // Unfreeze: the attribute goes, and so does the render. Leaving it would mean a dead file in the project's
      // own folder, staged by the next `project commit` and stale the moment a module changes.
      setTrackFields(h.songPath, track.id, { frozen: null });
      rmSync(render, { force: true });
      h.log([`${track.id}: unfrozen — its modules are live again`]);
      await h.reload();
      return;
    }

    const engine = findEngineBinary();
    if (!engine) {
      h.log([
        "freeze failed: studio-moteur binary not found (build the engine)",
      ]);
      return;
    }
    // Stopped first: the render runs in its own engine process, but it reads the same sources the live one is
    // playing, and a freeze that lands mid-playback swaps the track's contents under a rolling transport.
    await h.transport("stop");
    try {
      freezeTrackRender(engine, p, track.name, render);
    } catch (e) {
      h.log([`freeze failed: ${(e as Error).message}`]);
      return;
    }
    setTrackFields(h.songPath, track.id, {
      frozen: `${FROZEN_DIR}/${track.id}.wav`,
    });
    const modules = track.plugins.length;
    h.log([
      `${track.id}: frozen to ${FROZEN_DIR}/${track.id}.wav${modules ? ` (${modules} module${modules > 1 ? "s" : ""} baked in)` : ""} — gain, pan and sends stay live`,
    ]);
    await h.reload();
  },

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
    const { track, atBeats, hit, num, den } = found;
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
      const lengthTc = beatsToDuration(endBeats - startBeats, num, den);
      if (
        !resizeTrackPlacement(
          h.songPath,
          track.id,
          atBeats,
          num,
          den,
          startTc,
          lengthTc,
        )
      )
        return h.log([`no event on '${track.id}' at ${atTc}`]);
      h.log([
        `${track.id}: ${hit.name || hit.id} -> ${startTc}..${endTc} (${lengthTc})`,
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
  // The interface in use is shown here but only CHOSEN from the CLI (`pistes config --set interface`).
  "channels.list": (_a, h) => {
    const p = loadPreferences();
    const f = formatChannels(p);
    h.log([
      `audio device: ${formatAudioDevice(p.audioDevice)}  (change: pistes config --set interface)`,
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
   * The file it writes may be the workspace's SHARED one — `module populate` files one io/IN instance per
   * interface channel there, beside the `channel:` that says which channel it is. Whether that input is audible
   * belongs with it: both describe the desk, not the song. Said out loud in the log, because it is the one thing
   * here that reaches past this project.
   */
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

  // Point a module at a library file (`none` clears it); `with:` says which asset. Not patchable into the running
  // engine — both plugins load their file when BUILT — so it writes and reloads. Changing a cabinet isn't a knob drag.
  "module.asset": async (a, h) => {
    const m = /^(\S+)\s+(\S+)\s+(.+)$/.exec(a.trim());
    if (!m) {
      h.log([
        "usage: module <ir|nam> <module> <file>  (e.g. module ir cab ir/marshall-1960a.wav, or `none` to clear)",
      ]);
      return;
    }
    const [, kind, module, rawFile] = m;
    const file = rawFile.replace(/^"(.*)"$/s, "$1").trim();
    const clearing = file === "none";
    // An empty library usually means no `libraries_from` — say that, not "no such file", which misdirects the search.
    if (!clearing) {
      const have = listLibrary(h.songPath, kind);
      if (!have.includes(file)) {
        h.log([
          have.length
            ? `no '${file}' in the library — it has: ${have.join(", ")}`
            : `the project's library has no '${kind}/' folder (set project.libraries_from, e.g. "../_library")`,
        ]);
        return;
      }
    }
    try {
      setModuleAsset(h.songPath, module, kind, clearing ? null : file);
      h.log([`${module}: ${clearing ? `${kind} cleared` : file}`]);
      await h.reload();
    } catch (e) {
      h.log([`module ${kind} failed: ${(e as Error).message}`]);
    }
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
          `  '${s.module}' was used in ${s.instances.length} chains — split into ${s.instances.join(", ")}`,
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
      "usage: module new <category>/<name> [extends-ref] [instance-name]";
    // Two optional args, both filled by the graph's module picker: the ref this module INHERITS, and an instance to
    // create in the same breath — a chain step names `module:instance`, so the picker always asks for one.
    const [target, extendsRef, instance] = a
      .trim()
      .split(/\s+/)
      .filter(Boolean);
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
      // The instance comes AFTER the module, whose folder it needs. A failure leaves the module and says so.
      if (instance) {
        const irel = createModuleInstance(h.songPath, category, name, instance);
        log.push(
          `created ${irel} — use it in a chain as {module: "${name}:${instance}"}`,
        );
      }
      h.log(log);
      await h.reload();
    } catch (e) {
      h.log([`create module failed: ${(e as Error).message}`]);
    }
  },

  // module instance new — an `<instance>` file in an existing module folder, which it inherits automatically, so it
  // is scaffolded EMPTY and states only what it changes. Chains name it "<name>:<instance>".
  "module.instance": async (a, h) => {
    const usage =
      "usage: module instance new <category>/<name> <instance-name>";
    const args = a.trim().split(/\s+/).filter(Boolean);
    if (args.length !== 2) {
      h.log([usage]);
      return;
    }
    const [target, instance] = args;
    const segs = target.split("/");
    if (segs.length !== 2 || !segs[0] || !segs[1]) {
      h.log([`'${target}' is not <category>/<name>`, usage]);
      return;
    }
    const [category, module] = segs;
    try {
      const rel = createModuleInstance(h.songPath, category, module, instance);
      h.log([
        `created ${rel} — use it in a chain as {module: "${module}:${instance}"}`,
      ]);
      await h.reload();
    } catch (e) {
      h.log([`module instance new failed: ${(e as Error).message}`]);
    }
  },

  // clone module — copy a module folder (file, .vstpreset, rack audio) into the same category under a new name.
  // module delete <name|name:instance> — the file, and the graph closed back up around it.
  "module.delete": async (a, h) => {
    const key = a.trim().split(/\s+/).filter(Boolean)[0];
    if (!key) {
      h.log(["usage: module delete <module|module:instance>"]);
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
   * module insert <before> <after> <category>/<name> [extends-ref] [instance]
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
      "usage: module insert <before> <after> <category>/<name> [extends-ref] [instance]";
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
   * module place <category>/<name> [extends-ref] [instance]
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
    const usage =
      "usage: module place <category>/<name> [extends-ref] [instance]";
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
    // The block must be a real instance: the engine would reject a dangling ref, so catch it with an actionable message.
    // A shared module is named by its ref and lives in moduleRefs until a chain uses it.
    if (!(block in g.modules) && !(block in g.moduleRefs)) {
      h.log([
        `no module "${block}" in this project (modules: ${Object.keys(g.modules).join(", ") || "none"})`,
      ]);
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
