// dawproject.ts — the DAWproject -> pistes song mapper: unzip in memory, parse
// project.xml, project it onto pistes's song schema. NO disk I/O — it returns the song
// plus every asset entry for the caller to write. Deliberately lossy where pistes can't
// represent something yet (warps, plugin state, automation). See docs/import.md.

import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";

// --- the emitted song schema (mirrors brain/src/project.ts) ------------------

export interface NoteOut {
  time: number; // beats, relative to the clip
  duration: number; // beats
  key: number; // MIDI note number
  vel: number; // 0..1
  channel: number;
  rel: number; // release velocity 0..1
}

export interface ClipOut {
  type: "audio" | "midi";
  name?: string;
  source?: string; // audio only: relative path e.g. "audio/foo.wav"
  start: number; // beats, arrangement position
  length: number; // beats
  offset?: number; // audio: source in-point (beats); midi: playStart
  fadeIn?: number; // beats
  fadeOut?: number; // beats
  loopStart?: number; // midi
  loopEnd?: number; // midi
  notes?: NoteOut[]; // midi only
  warp?: WarpOut; // audio only: time-stretch / warp settings (from <Warps>)
}

// A clip's warp, from a DAWproject <Warps> block: `markers` maps a TIMELINE beat to a SOURCE second, two being
// a linear stretch and more piecewise. Times are (beats, seconds) — the only combination this project uses.
export interface WarpOut {
  algorithm?: string;
  markers: [number, number][]; // [timeline beat, source second]
}

export interface SendOut {
  to: string; // resolved destination track id
  level: number;
  enabled: boolean;
}

export interface PluginOut {
  type: string; // "builtin" | "vst3" | "vst2" | "clap" | "au" ...
  name: string;
  role?: string; // "instrument" | "audioFX" | "noteFX"
  enabled: boolean;
  path?: string; // relative path to a preset/state, if any
  params?: Record<string, number>; // text param dump (paramID -> value), filled by the engine-backed resolver
  paramsComplete?: boolean; // true when `params` fully capture the state -> the opaque preset can be dropped
}

export interface TrackOut {
  id: string;
  name: string;
  role?: string; // "regular" | "effect" | "master"
  contentType?: string; // "audio" | "notes" | "audio notes"
  color?: string;
  volume?: number; // linear
  pan?: number; // 0..1 normalized
  mute?: boolean;
  plugins?: PluginOut[];
  sends?: SendOut[];
  clips?: ClipOut[];
}

export interface Song {
  project: {
    name: string;
    tempo: number;
    sampleRate: number;
    timeSignature: string;
  };
  tracks: TrackOut[];
}

export interface Translation {
  song: Song;
  files: Record<string, Uint8Array>; // asset entries to write (audio/*, plugins/*)
  stats: {
    tracks: number;
    audioClips: number;
    midiClips: number;
    notes: number;
    assets: number;
  };
  warnings: string[]; // clips the mapper couldn't classify and dropped
}

// --- small attribute helpers -------------------------------------------------

const num = (v: unknown, dflt = 0): number => {
  const n =
    typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : dflt;
};
const bool = (v: unknown): boolean => v === "true" || v === true;
const str = (v: unknown): string | undefined =>
  v == null ? undefined : String(v);
// Trim float noise (fade/note times carry ~17 digits) without lying about beats.
const round = (n: number, p = 6): number => {
  const f = 10 ** p;
  return Math.round(n * f) / f;
};
const asArray = <T>(v: T | T[] | undefined): T[] =>
  v == null ? [] : Array.isArray(v) ? v : [v];

// Tags that always model a collection — forced to arrays, so one child and many are handled the same way.
const ARRAY_TAGS = new Set([
  "Track",
  "Lanes",
  "Clip",
  "Note",
  "Send",
  "BuiltinDevice",
  "Vst3Plugin",
  "Vst2Plugin",
  "ClapPlugin",
  "AuPlugin",
]);

const DEVICE_TAGS: Record<string, string> = {
  BuiltinDevice: "builtin",
  Vst3Plugin: "vst3",
  Vst2Plugin: "vst2",
  ClapPlugin: "clap",
  AuPlugin: "au",
};

// --- main entry --------------------------------------------------------------

export function parseDawproject(
  zipBytes: Uint8Array,
  fallbackName: string,
): Translation {
  const entries = unzipSync(zipBytes);

  const projectXml = entries["project.xml"];
  if (!projectXml)
    throw new Error("not a dawproject: project.xml missing from the archive");
  const dec = new TextDecoder();

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) => ARRAY_TAGS.has(name),
  });

  const doc = parser.parse(dec.decode(projectXml));
  const project = doc.Project ?? {};
  const meta = entries["metadata.xml"]
    ? parser.parse(dec.decode(entries["metadata.xml"]))
    : {};

  // --- transport / header ---
  const transport = project.Transport ?? {};
  const tempo = num(transport.Tempo?.["@_value"], 120);
  const tsNum = num(transport.TimeSignature?.["@_numerator"], 4);
  const tsDen = num(transport.TimeSignature?.["@_denominator"], 4);
  const title = str(meta.MetaData?.Title);
  const name = title && title.length ? title : fallbackName;

  // --- structure: tracks + a channel-id -> track-id map for send targets ---
  const structTracks = asArray<any>(project.Structure?.Track);
  const channelToTrack = new Map<string, string>();
  for (const t of structTracks) {
    const chId = str(t.Channel?.["@_id"]);
    if (chId) channelToTrack.set(chId, String(t["@_id"]));
  }

  let sampleRate = 0;
  const audioClipsByTrack = new Map<string, ClipOut[]>();
  const warnings: string[] = [];
  let audioClips = 0,
    midiClips = 0,
    notes = 0;

  // --- arrangement: flatten each track's lanes into clips ---
  // `Lanes` is array-forced, so Arrangement.Lanes is a one-element array; its `.Lanes` are the per-track groups.
  for (const outer of asArray<any>(project.Arrangement?.Lanes))
    for (const laneGroup of asArray<any>(outer.Lanes)) {
      const trackId = str(laneGroup["@_track"]);
      if (!trackId) continue;
      const out: ClipOut[] = [];
      const ctx: CollectCtx = {
        trackId,
        onSampleRate: (sr) => {
          if (sr && !sampleRate) sampleRate = sr;
        },
        warn: (msg) => warnings.push(msg),
      };
      collectClips(asArray<any>(laneGroup.Clips?.Clip), 0, 0, null, out, ctx);
      for (const c of out) {
        if (c.type === "audio") audioClips++;
        else {
          midiClips++;
          notes += c.notes?.length ?? 0;
        }
      }
      if (out.length) audioClipsByTrack.set(trackId, out);
    }

  // --- assemble tracks ---
  const tracks: TrackOut[] = structTracks.map((t) => {
    const ch = t.Channel ?? {};
    const plugins = mapDevices(ch.Devices);
    const sends = asArray<any>(ch.Sends?.Send).map((s): SendOut => {
      const dest = str(s["@_destination"]);
      return {
        to: (dest && channelToTrack.get(dest)) || dest || "",
        level: num(s.Volume?.["@_value"]),
        enabled: bool(s.Enable?.["@_value"]),
      };
    });
    const track: TrackOut = {
      id: String(t["@_id"]),
      name: str(t["@_name"]) ?? String(t["@_id"]),
      role: str(ch["@_role"]),
      contentType: str(t["@_contentType"]),
      color: str(t["@_color"]),
      clips: audioClipsByTrack.get(String(t["@_id"])),
    };
    if (ch.Volume) track.volume = round(num(ch.Volume["@_value"], 1));
    if (ch.Pan) track.pan = round(num(ch.Pan["@_value"], 0.5));
    if (ch.Mute) track.mute = bool(ch.Mute["@_value"]);
    if (plugins.length) track.plugins = plugins;
    if (sends.length) track.sends = sends;
    return track;
  });

  const assets: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(entries))
    if (
      path !== "project.xml" &&
      path !== "metadata.xml" &&
      !path.endsWith("/")
    )
      assets[path] = bytes;

  return {
    song: {
      project: {
        name,
        tempo,
        sampleRate: sampleRate || 48000,
        timeSignature: `${tsNum}/${tsDen}`,
      },
      tracks,
    },
    files: assets,
    stats: {
      tracks: tracks.length,
      audioClips,
      midiClips,
      notes,
      assets: Object.keys(assets).length,
    },
    warnings,
  };
}

// Map a Channel/Devices node to plugin refs, grouped by device-tag; cross-type chain order isn't preserved (v1).
function mapDevices(devices: any): PluginOut[] {
  if (!devices) return [];
  const out: PluginOut[] = [];
  for (const [tag, type] of Object.entries(DEVICE_TAGS))
    for (const d of asArray<any>(devices[tag]))
      out.push({
        type,
        name: str(d["@_deviceName"]) ?? str(d["@_name"]) ?? type,
        role: str(d["@_deviceRole"]),
        enabled: bool(d.Enabled?.["@_value"]),
        path: str(d.State?.["@_path"]),
      });
  return out;
}

interface CollectCtx {
  trackId: string;
  onSampleRate: (sr: number | undefined) => void;
  warn: (msg: string) => void;
}

// Flatten a clip list into absolute-positioned leaves: <Notes> is MIDI, an <Audio> file audio, nested <Clips> a
// container establishing a child timeline. Leaves are clamped to their container's window, and a clip matching
// none of these is dropped — reported via ctx.warn so it isn't silent.
function collectClips(
  clips: any[],
  baseStart: number,
  basePlayStart: number,
  bounds: { start: number; end: number } | null,
  out: ClipOut[],
  ctx: CollectCtx,
): void {
  for (const clip of clips) {
    const time = num(clip["@_time"]);
    let start = baseStart + (time - basePlayStart);
    const duration = num(clip["@_duration"]);
    let end = start + duration;
    if (bounds) {
      start = Math.max(start, bounds.start);
      end = Math.min(end, bounds.end);
    }
    const length = round(Math.max(0, end - start));

    const notesArr = asArray<any>(clip.Notes?.Note);
    const audio = findAudio(clip);
    const nested = asArray<any>(clip.Clips?.Clip);

    if (notesArr.length || clip.Notes) {
      // MIDI leaf.
      out.push({
        type: "midi",
        name: str(clip["@_name"]),
        start: round(start),
        length,
        offset: numOrUndef(clip["@_playStart"]),
        loopStart: numOrUndef(clip["@_loopStart"]),
        loopEnd: numOrUndef(clip["@_loopEnd"]),
        notes: notesArr.map(
          (n): NoteOut => ({
            time: round(num(n["@_time"])),
            duration: round(num(n["@_duration"])),
            key: num(n["@_key"]),
            vel: round(num(n["@_vel"], 1), 4),
            channel: num(n["@_channel"]),
            rel: round(num(n["@_rel"], 1), 4),
          }),
        ),
      });
    } else if (audio) {
      // Audio leaf.
      ctx.onSampleRate(numOrUndef(audio["@_sampleRate"]));
      out.push({
        type: "audio",
        source: str(audio.File?.["@_path"]),
        start: round(start),
        length,
        offset: numOrUndef(clip["@_playStart"]),
        fadeIn: fadeOrUndef(clip["@_fadeInTime"]),
        fadeOut: fadeOrUndef(clip["@_fadeOutTime"]),
        warp: warpOf(findWarps(clip), audio),
      });
    } else if (nested.length) {
      // Container: recurse into its child timeline.
      collectClips(
        nested,
        start,
        num(clip["@_playStart"]),
        { start, end },
        out,
        ctx,
      );
    } else {
      // Nothing we recognise: report it with its child tags, so an unhandled clip shape surfaces rather than vanishes.
      const kids = Object.keys(clip).filter((k) => !k.startsWith("@_"));
      const label = str(clip["@_name"]) ?? "(unnamed)";
      ctx.warn(
        `track ${ctx.trackId}: dropped clip "${label}" @beat ${round(start)} — ` +
          `no audio/notes/nested clips (children: ${kids.length ? kids.join(", ") : "none"})`,
      );
    }
  }
}

// Locate the <Audio> in an audio leaf. Three shapes occur in the wild: directly under the <Clip>, inside a
// <Warps> when time-stretched, or that same pair nested in a <Lanes> lane.
function findAudio(clip: any): any | undefined {
  if (clip.Audio) return clip.Audio;
  if (clip.Warps?.Audio) return clip.Warps.Audio;
  for (const l of asArray<any>(clip.Lanes)) {
    const audio = l.Warps?.Audio ?? l.Audio;
    if (audio) return audio;
  }
  return undefined;
}

// The <Warps> wrapper of a stretched clip (findAudio returns the <Audio> inside it); a bounced clip has none.
function findWarps(clip: any): any | undefined {
  if (clip.Warps) return clip.Warps;
  for (const l of asArray<any>(clip.Lanes)) if (l.Warps) return l.Warps;
  return undefined;
}

// A <Warps> block -> a WarpOut: the source DAW's algorithm plus its [timeline beat, source second] markers.
// Undefined below two markers — one can't define a stretch, so it means the same as "not warped".
function warpOf(warps: any, audio: any): WarpOut | undefined {
  if (!warps) return undefined;
  const markers = asArray<any>(warps.Warp).map((w): [number, number] => [
    round(num(w["@_time"])),
    round(num(w["@_contentTime"])),
  ]);
  if (markers.length < 2) return undefined;
  return { algorithm: str(audio?.["@_algorithm"]), markers };
}

const numOrUndef = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  const n = num(v);
  return n === 0 ? undefined : round(n);
};
const fadeOrUndef = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  const n = round(num(v));
  return n === 0 ? undefined : n;
};
