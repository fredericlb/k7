// project.ts — song interpretation: a single-file or folder-project song is read into
// a { project, tracks } shape, mapped into a ProjectDoc, with each clip's `source`
// resolved to an ABSOLUTE path (the engine knows nothing about the file's location).
//
// The doc SHAPES live in @studio/engine-protocol/project — they are the wire, not the
// compiler — and are re-exported here so this stays the one import for code that both
// produces and describes them.

import { GRAPH_FILE } from "./yaml/graphSchema";
import { existsSync, readFileSync, statSync } from "node:fs";
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
import { parse as parseYaml } from "yaml";
import { assembleFolder, isFolderProject } from "./folder";
import { exportSub, isVideoSource } from "./loader";
import { compileNodeProject } from "./nodeProject";
import type { AssembledClip, AssembledDoc } from "./rawDoc";
import { parsePosition } from "./timecode";
import { DEFAULT_PROJECT_MODE } from "./yaml/projectSchema";

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

// Read settings.yaml, defaulting each field so a partial file never fails the load (`count_in` is the on-disk name).
export function parseSettings(raw: unknown): SettingsDoc {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  // One bar when the file says nothing — a take should start with a count, and a project that never
  // mentions count_in gets the usual one rather than none. `count_in: 0` still means "record
  // immediately": it is a stated 0, which `??` leaves alone.
  const n = Number(s.count_in ?? DEFAULT_COUNT_IN);
  return {
    metronome: Boolean(s.metronome ?? false),
    countIn: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0,
  };
}

// Both now live in @studio/engine-protocol/build — they map onto the WIRE, and a browser
// needs them without this module's filesystem imports. Re-exported here, where every
// caller already looks.
export {
  EXTERNAL_PLUGIN_FORMATS,
  enginePlugin,
  JSDSP_TYPE,
} from "@studio/engine-protocol/build";
// …and the one plugin type that is NOT on the wire, so it stays in song's own vocabulary.
export { OFFLINE_TYPE } from "./moduleTypes";

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

/**
 * Drop every lane's takes on the way to the engine.
 *
 * A take is what a lane WAS playing — the arrangement set aside, not something to play — so the
 * engine has no use for it and no business diffing it. It is compiled onto the document anyway
 * because a surface draws it with the same clip extents the arrangement has, and one compiler
 * producing both is what keeps the two identical. This is where the two readers part.
 */
export function withoutTakes(doc: ProjectDoc): ProjectDoc {
  if (!doc.tracks.some((t) => t.takes?.length)) return doc;
  return {
    ...doc,
    tracks: doc.tracks.map(({ takes, ...t }) => t),
  };
}

// A ProjectDoc carries no picture, so nothing here strips one on the way to the engine.
// Picture is its own document, from its own compile of the same folder — videoDoc.ts, and
// docs/picture.md for why.

// Read a single-file source into the { project, tracks } shape. Folder projects
// are handled earlier (in loadProject); here the only supported file is YAML.
function readSource(sourcePath: string): AssembledDoc {
  // A .dawproject is a binary ZIP and a .als binary gzip — catch the mixup with an actionable message,
  // not a parse error on binary bytes. Importing is what turns either into a folder project.
  if (/\.(dawproject|als)$/i.test(sourcePath))
    throw new Error(
      `'${basename(sourcePath)}' is a foreign project file, not a song file. ` +
        `Import it first (click it in the file tree), then open the folder it produces.`,
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
    // A node project (graph.yaml / modules/) is the graph model — compile it down (nodeProject.ts).
    const doc =
      existsSync(join(dir, GRAPH_FILE)) || existsSync(join(dir, "modules"))
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
    // Always an arrangement: `live` is a FOLDER's shape, declared in project.yaml's root, and a
    // single-file song has no such root to declare it in. Nothing can author one.
    mode: DEFAULT_PROJECT_MODE,
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

/**
 * A clip's window edge, in SECONDS. A bare number already is one; a TIMECODE is a position in the
 * file and needs the project's grid to become one (see AudioClipSchema).
 *
 * Without a grid a timecode is dropped, which is what this did for EVERY caller until the drawing
 * needed it: `Number("2:1")` is `NaN`, so the musical spelling — the one an imported song is full
 * of — silently produced a clip with no window at all. `nodeProject` had its own resolver and was
 * right; this path had none and was quietly wrong.
 */
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
export function loadAudioClipDoc(
  dir: string,
  id: string,
  // The project's grid, so a TIMECODE window resolves. Omitted, such an edge is dropped — which is
  // all this could ever do before, and is why the callers that draw the window now pass one.
  grid?: ClipGrid,
): ClipDoc | null {
  if (!isFolderProject(dir)) return null;
  const def = exportSub(dir, "clips")?.[id];
  if (!def?.source || isVideoSource(String(def.source))) return null;
  return mapClip({ id, ...def }, dir, `'${id}'`, grid);
}

// The mixer's vocabulary moved to @studio/engine-protocol/build — a leaf the BROWSER can hold,
// which m9 needs to put a level on a deck without dragging a YAML parser and `node:fs` in for
// two strings. Imported as well as re-exported: `export … from` re-publishes a name without
// binding it locally, and `trackMixer` below reads MIXER_PLUGIN. Re-exported because this is
// where every existing importer looks, the same arrangement `readPluginBlock` has.
import { MIXER_PLUGIN } from "@studio/engine-protocol/build";

export {
  MIXER_PARAMS,
  MIXER_PLUGIN,
  VOLUME_DB,
} from "@studio/engine-protocol/build";

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
