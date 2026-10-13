// project.ts — song interpretation: a single-file or folder-project song is read into
// a { project, tracks } shape, mapped into a ProjectDoc, with each clip's `source`
// resolved to an ABSOLUTE path (the engine knows nothing about the file's location).
//
// The doc SHAPES live in @studio/engine-protocol/project — they are the wire, not the
// compiler — and are re-exported here so this stays the one import for code that both
// produces and describes them.

import { statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type {
  AutomationDoc,
  ClipDoc,
  GroupDoc,
  Marker,
  NoteDoc,
  PluginDoc,
  ProjectDoc,
  SendDoc,
  SettingsDoc,
  TrackDoc,
} from "@studio/engine-protocol/project";
import { parsePosition } from "@studio/song-schema/timecode";
import { readClipWarp } from "@studio/song-schema/warpPoints";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { parse as parseYaml } from "yaml";
import { isChainProject } from "./chainProject";
import { assembleFolder, isFolderProject } from "./folder";
import { exportSub, isVideoSource } from "./loader";
import { compileNodeProject } from "./nodeProject";
import type { AssembledClip, AssembledDoc } from "./rawDoc";

export type * from "@studio/engine-protocol/project";

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

/** Bars of count-in a project gets when settings.yaml doesn't say. See parseSettings. */
export const DEFAULT_COUNT_IN = 1;
/** The click's default and floor live on the WIRE side; imported as well as re-exported, as MIXER_PLUGIN below. */
export {
  DEFAULT_METRONOME_LEVEL,
  METRONOME_MIN,
} from "@studio/engine-protocol/build";

import {
  DEFAULT_METRONOME_LEVEL,
  METRONOME_MIN,
} from "@studio/engine-protocol/build";

// Read settings.yaml, defaulting each field so a partial file never fails the load (`count_in` is the on-disk name).
export function parseSettings(raw: unknown): SettingsDoc {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  // One bar when the file says nothing; a stated `count_in: 0` still means "record immediately".
  const n = Number(s.count_in ?? DEFAULT_COUNT_IN);
  // CLAMPED to what the engine honours — 0.2..1 is Tracktion's own bound (see SettingsSchema).
  const lvl = Number(s.metronome_level ?? DEFAULT_METRONOME_LEVEL);
  return {
    metronome: Boolean(s.metronome ?? false),
    metronomeLevel: Number.isFinite(lvl)
      ? Math.min(1, Math.max(METRONOME_MIN, lvl))
      : DEFAULT_METRONOME_LEVEL,
    countIn: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0,
  };
}

// These live in @studio/engine-protocol/build, a leaf a BROWSER can hold; re-exported where callers look.
export {
  EXTERNAL_PLUGIN_FORMATS,
  enginePlugin,
  FAUST_TYPE,
  JSDSP_TYPE,
} from "@studio/engine-protocol/build";
// …and the one plugin type that is NOT on the wire, so it stays in song's own vocabulary.
export { OFFLINE_TYPE } from "@studio/song-schema/moduleTypes";

// Fold each group's mute/solo onto its members — OR, not override, see docs/mixFolding.md.
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

// A ProjectDoc carries no picture: that is its own document (packages/song-video/docs/picture.md).

// Read a single-file source into the { project, tracks } shape — folder projects never reach here.
function readSource(sourcePath: string): AssembledDoc {
  // A .dawproject is a binary ZIP and a .als binary gzip — say so rather than parse-error on bytes.
  if (/\.(dawproject|als)$/i.test(sourcePath))
    throw new Error(
      `'${basename(sourcePath)}' is a foreign project file, not a song file. ` +
        `Import it first (click it in the file tree), then open the folder it produces.`,
    );
  if (/\.(ya?ml|k7x)$/i.test(sourcePath)) return readYamlSong(sourcePath);
  throw new Error(
    `unsupported song '${basename(sourcePath)}' — use a .yaml file or a folder project`,
  );
}

// Read a single-file song: one YAML document holding `project` and `tracks`.
function readYamlSong(path: string): AssembledDoc {
  const abs = resolve(path);
  const value = parseYaml(wsRead(abs), { version: "1.2" });
  if (!value || typeof value !== "object")
    throw new Error(`${basename(abs)} is not a song — expected a mapping`);
  return value as AssembledDoc;
}

// Load a .yaml song or a folder into one ProjectDoc, throwing precisely: messages are UX in a text-first tool.
export function loadProject(sourcePath: string): ProjectDoc {
  const abs = resolve(sourcePath);
  if (isFolderProject(abs)) {
    const dir = statSync(abs).isDirectory() ? abs : dirname(abs);
    // A node project (graph.yaml / modules/) is the graph model — compile it down (nodeProject.ts).
    const doc =
      wsExists(join(dir, GRAPH_FILE)) ||
      wsExists(join(dir, "modules")) ||
      isChainProject(dir)
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
      outputChannels: (Array.isArray(t.outputChannels) ? t.outputChannels : [])
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
    // A FLAT project has no master chain; sent EMPTY rather than left out, or the diff reads "unchanged".
    masterPlugins: [],
    name: String(proj.name ?? "untitled"),
    tempo: Number(proj.tempo ?? 120),
    sampleRate: Number(proj.sampleRate ?? 48000),
    timeSigNumerator: num,
    timeSigDenominator: den,
    // Unity when unsaid, and always present — the engine diffs (docs/masterVolume.md).
    masterVolume: Number(proj.masterVolume ?? 0),
    recordDir: "", // loadProject sets it for a folder project; a single file can't record
    tracks: activeTracks,
    groups,
    markers: parseMarkers(doc.markers, num, den),
    settings: parseSettings(doc.settings),
  };
}

/** The project grid a timecode window needs to become seconds. */
export interface ClipGrid {
  tempo: number;
  num: number;
  den: number;
}

/** A clip's window edge in SECONDS; a timecode needs the grid, and without one is dropped — docs/timecode.md. */
function windowEdge(v: unknown, grid?: ClipGrid): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  if (Number.isFinite(n)) return n > 0 ? n : undefined;
  if (!grid) return undefined;
  try {
    const beats = parsePosition(String(v), grid.num, grid.den);
    return beats > 0 ? (beats * 60) / grid.tempo : undefined;
  } catch {
    return undefined; // a half-typed or legacy edge: no window rather than a wrong one
  }
}

// Map a clip struct to a ClipDoc: with no explicit `type`, `notes` means MIDI and `source` means audio.
function mapClip(
  c: AssembledClip,
  baseDir: string,
  where: string,
  grid?: ClipGrid,
): ClipDoc {
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
    ...(windowEdge(c.from, grid) != null
      ? { sourceFrom: windowEdge(c.from, grid) }
      : {}),
    ...(windowEdge(c.to, grid) != null
      ? { sourceTo: windowEdge(c.to, grid) }
      : {}),
    fadeIn: Number(c.fadeIn ?? 0),
    fadeOut: Number(c.fadeOut ?? 0),
    // The clip's own stretch map, through the same reader the node compiler uses — see docs/warp.md.
    ...(() => {
      const { map, declined } = readClipWarp(
        (c as { warp?: Parameters<typeof readClipWarp>[0] }).warp,
      );
      return map && !declined ? { warp: map } : {};
    })(),
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

// The audio clip `id` as a standalone, UNPLACED ClipDoc — null for a video source or a single-file song.
export function loadAudioClipDoc(
  dir: string,
  id: string,
  // The project's grid, so a TIMECODE window resolves; omitted, such an edge is dropped.
  grid?: ClipGrid,
): ClipDoc | null {
  if (!isFolderProject(dir)) return null;
  const def = exportSub(dir, "clips")?.[id];
  if (!def?.source || isVideoSource(String(def.source))) return null;
  return mapClip({ id, ...def }, dir, `'${id}'`, grid);
}

// Imported as well as re-exported: `export … from` publishes a name without BINDING it, and trackMixer reads it.
import { MIXER_PLUGIN } from "@studio/engine-protocol/build";
import { wsExists, wsRead } from "./yaml/workspaceFile";

export {
  MIXER_PARAMS,
  MIXER_PLUGIN,
  RECORDER_PLUGIN,
  VOLUME_DB,
} from "@studio/engine-protocol/build";

/** The LAST mixer in a track's chain, or undefined — a track with none has nowhere to put a level. */
export function trackMixer(t: TrackDoc): PluginDoc | undefined {
  for (let i = t.plugins.length - 1; i >= 0; i--)
    if (t.plugins[i].type === MIXER_PLUGIN) return t.plugins[i];
  return undefined;
}
