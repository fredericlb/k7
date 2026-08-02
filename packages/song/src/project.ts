// project.ts — song interpretation: a single-file or folder-project song is read into
// a { project, tracks } shape, mapped into a ProjectDoc, with each clip's `source`
// resolved to an ABSOLUTE path (the engine knows nothing about the file's location).

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { assembleFolder, isFolderProject } from "./folder";
import { exportSub, isVideoSource } from "./loader";
import { compileNodeProject } from "./nodeProject";
import type { AssembledClip, AssembledDoc } from "./rawDoc";
import { parsePosition } from "./timecode";

// A named timeline marker from project.yaml's `markers` map; `beat` is that timecode in timeline beats.
export interface Marker {
  tc: string; // the map key — a canonical timecode, e.g. "5:1:1"
  name: string;
  beat: number;
}

// Read a raw `markers` map into sorted Marker[]; unparseable entries are skipped rather than failing the load.
export function parseMarkers(raw: unknown, num: number, den: number): Marker[] {
  if (!raw || typeof raw !== "object") return [];
  const out: Marker[] = [];
  for (const [tc, name] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof name !== "string") continue;
    let beat: number;
    try {
      beat = parsePosition(tc, num, den);
    } catch {
      continue;
    }
    out.push({ tc, name, beat });
  }
  out.sort((a, b) => a.beat - b.beat);
  return out;
}

// Project-level playback/recording settings, carried on every ProjectDoc and defaulted when the file is absent.
export interface SettingsDoc {
  metronome: boolean; // the project's stored click-track default (the engine also has a live toggle)
  countIn: number; // BARS the transport rolls before an armed track records; 0 == immediately
}

/** Bars of count-in a project gets when settings.yaml doesn't say. See parseSettings. */
export const DEFAULT_COUNT_IN = 4;

// Read settings.yaml, defaulting each field so a partial file never fails the load (`count_in` is the on-disk name).
export function parseSettings(raw: unknown): SettingsDoc {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  // 4 when the file says nothing — a take should start with a count, and a project that never mentions
  // count_in gets the usual one rather than none. `count_in: 0` still means "record immediately": it is a
  // stated 0, which `??` leaves alone.
  const n = Number(s.count_in ?? DEFAULT_COUNT_IN);
  return {
    metronome: Boolean(s.metronome ?? false),
    countIn: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0,
  };
}

export interface NoteDoc {
  time: number; // beats, relative to the clip
  duration: number; // beats
  key: number; // MIDI note number
  vel: number; // 0..1
  channel: number;
  rel: number; // release velocity 0..1
}

// Time-stretch for an audio clip: two markers is a linear stretch, more is piecewise (Tracktion's WarpTimeManager).
export interface WarpDoc {
  algorithm: string; // the stretch engine, e.g. "elastique" | "slice"
  markers: [number, number][]; // [timeline beat, source second]
}

export interface ClipDoc {
  id: string;
  type: "audio" | "midi";
  name: string;
  source: string; // audio: absolute path once loaded; midi: ''
  start: number; // beats
  length: number; // beats, 0 == natural length
  offset: number; // audio: source in-point; midi: playStart (beats)
  // The clip file's own window into its SOURCE, in seconds — `from`/`to` in clips/<id>.yaml. Every placement of
  // the clip plays that slice and no more. In seconds, unlike everything around them, because they measure into
  // a file: see AudioClipSchema.
  //
  // Optional, like `disabled`: a clip SYNTHESISED by the compiler — a freeze render, a pattern's clip — has no
  // clip file to be trimmed by, and absent says that better than a zero that has to be read as "no window".
  sourceFrom?: number; // seconds into the file; absent == from its start
  sourceTo?: number; // seconds into the file; absent == to its end
  fadeIn: number; // beats
  fadeOut: number; // beats
  loopStart: number; // midi (beats)
  loopEnd: number; // midi (beats); 0 == no loop
  notes: NoteDoc[]; // midi only
  warp?: WarpDoc; // audio only: time-stretch settings, when the clip carries a `warp`
  // Silenced without being removed — a track's `mute`, at the level of one event. It is
  // carried to the engine rather than filtered out here, because the timeline still has
  // to DRAW it: a disabled event you can't see is a deleted one.
  disabled?: boolean;
}

// One rack sound: a note playing a whole clip ("samples") or a window of the shared source ("slice").
export interface RackSoundDoc {
  symbol: string; // the short label (e.g. "BD") — carried for the engine's sound name
  note: number; // MIDI note 0..127 that triggers this sound
  clip: string; // absolute path to the audio file
  start: number; // seconds into the file (0 for a whole-clip sample)
  length: number; // seconds; 0 == the file's natural length (samples), else the slice length
}

export interface PluginDoc {
  id: string;
  type: string;
  name: string;
  path: string; // resolved .vstpreset to LOAD (the module's own, else the extended module's); '' if none
  irFile?: string; // convolution modules only — an audio file the project owns, unlike `path`'s opaque blob
  namFile?: string; // amp-modeller modules only (a .nam model) — see irFile
  // A DSP-graph module's description, INLINE as JSON rather than a path: the compiler has already read it, and
  // the engine parses no files. Its parameters come from it, so it must reach the plugin's constructor.
  dspGraph?: string;
  presetSave: string; // absolute path where a UI edit saves THIS module's .vstpreset ('' if n/a)
  role: string; // "instrument" | "audioFX" | "noteFX"
  enabled: boolean;
  params: Record<string, number>;
  rack?: RackSoundDoc[]; // a rack instrument's sounds — only a `type: "rack"` module compiles to one
}

// Formats loaded from disk via the scan cache, vs a built-in named by xmlTypeName — mirrors isExternalFormat.
export const EXTERNAL_PLUGIN_FORMATS = new Set([
  "vst3",
  "vst",
  "vst2",
  "au",
  "audiounit",
  "clap",
  "lv2",
  "ladspa",
  "aax",
]);

// Map an authored `plugin: {type, name}` to the engine's older wire form, where `type`
// holds either a built-in's xmlTypeName or an external format. Full mapping table:
// docs/enginePlugin.md. `fallback` is the module name.
export function enginePlugin(
  plugin: { type?: unknown; name?: unknown } | undefined,
  fallback: string,
): { type: string; name: string } {
  const type = String(plugin?.type ?? "");
  const name = plugin?.name != null ? String(plugin.name) : "";
  if (type === "internal") return { type: name, name: fallback };
  if (EXTERNAL_PLUGIN_FORMATS.has(type.toLowerCase()))
    return { type, name: name || fallback };
  return { type, name: name || fallback }; // legacy: `type` is the xmlTypeName itself
}

export interface SendDoc {
  to: string; // destination track id
  level: number;
  enabled: boolean;
}

// A baked automation lane: `points` are [beat, output] in the CURVE's range, which the engine maps onto the param.
export interface AutomationDoc {
  param: string;
  pluginId?: string; // the plugin whose param this drives (a `chain:module` id)
  bipolar?: boolean; // the source curve's polarity (default unipolar)
  points: [number, number][]; // [beat, output]
}

export interface TrackDoc {
  id: string;
  name: string;
  role: string; // "regular" | "effect" | "master"
  contentType: string; // "audio" | "notes" | "audio notes"
  group: string; // the group this belongs to ('' == none) — a group is never a lane, only this pointer plus an entry in `groups`
  generated: boolean; // true for a lane a pattern streams onto: its clips are the scheduler's look-ahead, rewritten every tick
  color: string;
  // No volume and no pan. They were the one part of a track's sound that lived outside its chain — nothing could
  // be placed after them and the graph could not show where they applied. They are a MODULE now (see
  // MixerPlugin), one instance at the end of each track's chain, so a level is a thing you can see and reorder.
  // Mute and solo stay: they are mixer-wide relationships between tracks, not a stage in one track's signal.
  mute: boolean;
  solo: boolean;
  disabled: boolean;
  inputChannels: number[]; // 1-based physical channels; a label is resolved against ~/.lanes first, so the engine only ever sees numbers
  monitor: string; // Tracktion's "off" | "auto" (armed) | "on"; ignored when inputChannels is empty
  inputGain: number; // interface input trim in dB, 0 == unity; ignored when inputChannels is empty
  clips: ClipDoc[];
  plugins: PluginDoc[];
  sends: SendDoc[];
  automation: AutomationDoc[];
  // Authored notes / checklist, carried through for surfaces; the engine ignores both.
  docs?: string;
  todos?: string[];
  // Set while the track is frozen: the render it plays instead of its material, absolute. The engine ignores this
  // too — by the time the doc reaches it the render is already the track's one clip and the plugins are gone (see
  // nodeProject). It is here so a surface can say WHY a lane it can't edit looks the way it does.
  frozen?: string;
}

// A group track: it holds no material, so the engine plays no lane for it, but surfaces draw it over its members.
export interface GroupDoc {
  id: string;
  name: string;
  color: string;
  mute: boolean;
  solo: boolean;
}

// A video clip. Times are SECONDS, not beats — picture is cut against the wall clock, not the bar line.
export interface VideoClipDoc {
  id: string;
  name: string;
  source: string; // absolute path
  start: number; // seconds on the timeline
  length: number; // seconds; 0 == the source's natural length
  sourceFrom: number; // seconds, the in-point INTO the source
}

// A shape drawn straight onto the viewport, in px. A square/text x,y is its top-left, a circle's its CENTRE.
export type ShapeDoc =
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
      w?: number; // optional max width (text condenses to fit)
      color: string;
    };

// A video chain's step, folded onto its track so the renderer applies it per placement; VIDEO_OUT is the sink.
export interface VideoPluginDoc {
  id: string; // "<trackId>:<stepIndex>" — the engine/renderer's per-instance key
  type: "video_effect" | "video_transition"; // mirrors the module's `type`
  name: string; // the module folder name (modules/video_effects/<name>/module.yaml)
  enabled: boolean; // chain step `enabled`; false == bypassed by the renderer
  params: Record<string, number>;
}
// A video-mode lane: "video" links picture and places it at (x,y,w,h), "shape" draws
// parametric shapes. Never reaches the C++ engine (see withoutVideo) — @studio/ui-eyes
// is the only consumer. Already in project.layers draw order.
export interface VideoTrackDoc {
  id: string;
  name: string;
  color: string;
  mute: boolean; // hidden
  kind: "video" | "shape";
  x: number;
  y: number;
  w: number;
  h: number;
  clips: VideoClipDoc[]; // "video" tracks only
  shapes: ShapeDoc[]; // "shape" tracks only
  plugins?: VideoPluginDoc[]; // modelled but not compiled yet — the video-chain -> renderer path
  // No audio link: an AUDIO track's `video_source` inherits these placements, already resolved into its clips by now.
}

export interface ProjectDoc {
  uuid?: string; // stable song id, generated on first `lanes export`; absent until then
  name: string;
  tempo: number;
  sampleRate: number;
  timeSigNumerator: number;
  timeSigDenominator: number;
  // Where a live take lands ('' for a single-file song, which the engine refuses to arm) — the ONE path it is told.
  recordDir: string;
  tracks: TrackDoc[];
  groups: GroupDoc[]; // what the tracks' `group` pointers refer to; the engine ignores it
  strudel: boolean; // whether any track streams from an algo/ pattern — surfaces skip the clock poll when false

  // --- picture (stripped before the engine, see withoutVideo) ---------------
  video: boolean;
  viewport: [number, number]; // px the video tracks draw into; [0,0] when video is off
  fps: number; // frame-by-frame export only (realtime follows the engine clock); default 30
  videoTracks: VideoTrackDoc[]; // ALREADY in project.layers draw order — no consumer re-sorts

  markers: Marker[]; // sorted by beat
  settings: SettingsDoc; // always present, defaulted when settings.yaml is absent
}

// Fold each group's mute/solo onto its members on the way to the engine, which resolves
// both per audio track and knows nothing about groups. OR, not override — see
// docs/mixFolding.md.
export function withGroupMix(doc: ProjectDoc): ProjectDoc {
  if (!doc.groups.length) return doc;
  const byId = new Map(doc.groups.map((g) => [g.id, g]));
  return {
    ...doc,
    tracks: doc.tracks.map((t) => {
      const g = byId.get(t.group);
      if (!g || (!g.mute && !g.solo)) return t;
      return { ...t, mute: t.mute || g.mute, solo: t.solo || g.solo };
    }),
  };
}

// Strip the picture on the way to the engine, which plays sound and has no business
// with a video track. A stated CONTRACT at the one choke point every sender funnels
// through, not a crash it prevents — see docs/mixFolding.md.
export function withoutVideo(doc: ProjectDoc): ProjectDoc {
  const { videoTracks, video, viewport, fps, ...rest } = doc;
  return rest as ProjectDoc;
}

// Read a single-file source into the { project, tracks } shape. Folder projects
// are handled earlier (in loadProject); here the only supported file is YAML.
function readSource(sourcePath: string): AssembledDoc {
  // A .dawproject is a binary ZIP — catch the mixup with an actionable message, not a parse error on binary bytes.
  if (sourcePath.endsWith(".dawproject"))
    throw new Error(
      `'${basename(sourcePath)}' is a .dawproject, not a song file. Convert it first:\n` +
        `  cd ../translator && npm start -- "${sourcePath}" <outDir>\n` +
        `then open <outDir> (a folder project) with the brain.`,
    );
  if (/\.ya?ml$/i.test(sourcePath)) return readYamlSong(sourcePath);
  throw new Error(
    `unsupported song '${basename(sourcePath)}' — use a .yaml file or a folder project`,
  );
}

// Read a single-file song: one YAML document holding `project` and `tracks`.
function readYamlSong(path: string): AssembledDoc {
  const abs = resolve(path);
  const value = parseYaml(readFileSync(abs, "utf8"), { version: "1.2" });
  if (!value || typeof value !== "object")
    throw new Error(`${basename(abs)} is not a song — expected a mapping`);
  return value as AssembledDoc;
}

// Load a .yaml song or a folder into one ProjectDoc, throwing precisely: messages are UX in a text-first tool.
export function loadProject(sourcePath: string): ProjectDoc {
  const abs = resolve(sourcePath);
  if (isFolderProject(abs)) {
    const dir = statSync(abs).isDirectory() ? abs : dirname(abs);
    // A node project (chains.yaml / modules/) is the graph model — compile it down (nodeProject.ts).
    const doc =
      existsSync(join(dir, "chains.yaml")) || existsSync(join(dir, "modules"))
        ? compileNodeProject(dir)
        : mapDoc(assembleFolder(dir), dir);
    // Set here, not in the two compilers, so both agree by not each deciding.
    return { ...doc, recordDir: join(dir, "clips") };
  }
  return mapDoc(readSource(sourcePath), dirname(abs));
}

// Map a plain { project, tracks[] } doc into a ProjectDoc, resolving clip sources against baseDir.
function mapDoc(doc: AssembledDoc, baseDir: string): ProjectDoc {
  const proj = doc.project ?? {};

  const ts = String(proj.timeSignature ?? "4/4");
  const [num, den] = ts.split("/").map((n) => parseInt(n, 10));
  if (!num || !den)
    throw new Error(`timeSignature must look like '4/4', got '${ts}'`);

  const tracks: TrackDoc[] = (doc.tracks ?? []).map((t, i): TrackDoc => {
    if (!t?.id) throw new Error(`track #${i + 1} is missing a required 'id'`);
    return {
      id: String(t.id),
      name: String(t.name ?? t.id),
      role: String(t.role ?? "regular"),
      contentType: String(t.contentType ?? "audio"),
      group: String(t.group ?? ""),
      generated: false, // only the pattern clock makes generated tracks
      inputChannels: (Array.isArray(t.inputChannels) ? t.inputChannels : [])
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0),
      monitor: String(t.monitor ?? "auto"),
      inputGain: Number.isFinite(Number(t.inputGain)) ? Number(t.inputGain) : 0,
      color: String(t.color ?? ""),
      mute: Boolean(t.mute ?? false),
      solo: Boolean(t.solo ?? false),
      disabled: Boolean(t.disabled ?? false),
      clips: (t.clips ?? []).map((c) =>
        mapClip(c, baseDir, `on track '${t.id}'`),
      ),
      plugins: (t.plugins ?? []).map((p): PluginDoc => {
        if (!p?.type)
          throw new Error(`plugin on track '${t.id}' is missing 'type'`);
        return {
          id: String(p.id ?? ""),
          type: String(p.type),
          name: String(p.name ?? ""),
          path: String(p.path ?? ""),
          presetSave: String(p.presetSave ?? ""),
          role: String(p.role ?? ""),
          enabled: Boolean(p.enabled ?? true),
          params: (p.params ?? {}) as Record<string, number>,
        };
      }),
      sends: (t.sends ?? []).map(
        (s): SendDoc => ({
          to: String(s?.to ?? ""),
          level: Number(s?.level ?? 0),
          enabled: Boolean(s?.enabled ?? false),
        }),
      ),
      automation: (t.automation ?? []).map(
        (a): AutomationDoc => ({
          param: String(a?.param ?? ""),
          points: (a?.points ?? []) as [number, number][],
        }),
      ),
    };
  });

  // A single-file song has no group entity, so recover groups from the tracks' pointers, in first-mention order.
  const activeTracks = tracks.filter((t) => !t.disabled);
  const groups: GroupDoc[] = [];
  for (const t of activeTracks)
    if (t.group && !groups.some((g) => g.id === t.group))
      groups.push({
        id: t.group,
        name: t.group,
        color: "",
        mute: false,
        solo: false,
      });

  return {
    uuid: proj.uuid ? String(proj.uuid) : undefined,
    name: String(proj.name ?? "untitled"),
    tempo: Number(proj.tempo ?? 120),
    sampleRate: Number(proj.sampleRate ?? 48000),
    timeSigNumerator: num,
    timeSigDenominator: den,
    recordDir: "", // loadProject sets it for a folder project; a single file can't record
    tracks: activeTracks,
    groups,
    strudel: false, // …nor a pattern lane: algo/ is a folder a single-file song hasn't got
    video: false, // …nor picture, for the same reason (a node project fills these)
    viewport: [0, 0],
    fps: 30,
    videoTracks: [],
    markers: parseMarkers(doc.markers, num, den),
    settings: parseSettings(doc.settings),
  };
}

// Map a clip struct to a ClipDoc: with no explicit `type`, `notes` means MIDI and `source` means audio.
function mapClip(c: AssembledClip, baseDir: string, where: string): ClipDoc {
  const type: "audio" | "midi" =
    c.type === "midi" || (!c.type && c.notes) ? "midi" : "audio";
  if (type === "audio" && !c?.source)
    throw new Error(`audio clip ${where} is missing 'source'`);
  return {
    id: String(c.id ?? ""),
    type,
    name: String(c.name ?? ""),
    source: c.source ? resolve(baseDir, String(c.source)) : "",
    start: Number(c.start ?? 0),
    length: Number(c.length ?? 0),
    offset: Number(c.offset ?? 0),
    ...(Number(c.from ?? 0) > 0 ? { sourceFrom: Number(c.from) } : {}),
    ...(Number(c.to ?? 0) > 0 ? { sourceTo: Number(c.to) } : {}),
    fadeIn: Number(c.fadeIn ?? 0),
    fadeOut: Number(c.fadeOut ?? 0),
    ...(c.disabled ? { disabled: true } : {}),
    loopStart: Number(c.loopStart ?? 0),
    loopEnd: Number(c.loopEnd ?? 0),
    notes: (c.notes ?? []).map(
      (n): NoteDoc => ({
        time: Number(n?.time ?? 0),
        duration: Number(n?.duration ?? 0),
        key: Number(n?.key ?? 0),
        vel: Number(n?.vel ?? 1),
        channel: Number(n?.channel ?? 0),
        rel: Number(n?.rel ?? 1),
      }),
    ),
  };
}

// The audio clip `id` as a standalone, UNPLACED ClipDoc — what lets a surface show its
// waveform before any track references it. Null for a video source (told apart by
// extension, since clips/ holds both kinds identically) or a single-file song.
export function loadAudioClipDoc(dir: string, id: string): ClipDoc | null {
  if (!isFolderProject(dir)) return null;
  const def = exportSub(dir, "clips")?.[id];
  if (!def?.source || isVideoSource(String(def.source))) return null;
  return mapClip({ id, ...def }, dir, `'${id}'`);
}

/**
 * The plugin type a mixer module instantiates. An internal plugin reaches the engine under its DISPLAY name
 * (see enginePlugin), so this is the string a compiled PluginDoc actually carries.
 */
export const MIXER_PLUGIN = "Mixer";

/** The five knobs a strip has, in the order a strip reads them. Also the param names in the module file. */
export const MIXER_PARAMS = ["Volume", "Pan", "Low", "Mid", "High"] as const;

/**
 * The channel strip at the end of a track's chain, or undefined when it has none.
 *
 * The LAST mixer, not the first: a track may legitimately run a strip mid-chain (into a bus, say), and the one
 * that decides what leaves the track is the one nearest the output. A track with none is not "at unity" — it is
 * a track with nowhere to put a level, which is what the surfaces need to say rather than draw a dead fader.
 */
export function trackMixer(t: TrackDoc): PluginDoc | undefined {
  for (let i = t.plugins.length - 1; i >= 0; i--)
    if (t.plugins[i].type === MIXER_PLUGIN) return t.plugins[i];
  return undefined;
}
