// dawproject.ts — the DAWproject -> k7 song mapper: unzip in memory, parse
// project.xml, project it onto the neutral shape in model.ts. NO disk I/O — it returns
// the song plus every asset entry for the caller to write. Deliberately lossy where
// k7 can't represent something yet (plugin state, automation). See docs/import.md.

import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";
import type {
  ClipOut,
  NoteOut,
  PluginOut,
  SendOut,
  TrackOut,
  Translation,
  WarpOut,
} from "./model.js";

// Re-exported so `@studio/translator/dawproject` type imports resolve from here too.
export type * from "./model.js";

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

  // Walked once for the whole document: a reference may point forwards, and every track may use it.
  const byId = new Map<string, Referenced>();
  indexById(project, byId, "Project");

  let sampleRate = 0;
  const audioClipsByTrack = new Map<string, ClipOut[]>();
  const warnings: string[] = [];
  let audioClips = 0,
    midiClips = 0,
    notes = 0;

  // --- arrangement: flatten each track's lanes into clips ---

  // `Lanes` is array-forced, so Arrangement.Lanes is one element whose `.Lanes` are the per-track groups.
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
        byId,
        tempo,
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

/** One element the document defines under an id, and the tag it was written as. */
interface Referenced {
  tag: string;
  node: any;
}

/**
 * Every element carrying an `id`, by that id. DAWproject writes one clip's content ONCE and places
 * it several times — a drum groove dropped at eight bars is eight `<Clip reference="idN"/>` and one
 * `<Notes id="idN">`. Without this index those clips carry nothing and are dropped; the notes are
 * in the file, we simply did not follow the pointer. See docs/import.md.
 */
function indexById(
  node: unknown,
  out: Map<string, Referenced>,
  tag = "",
): void {
  if (Array.isArray(node)) {
    for (const v of node) indexById(v, out, tag);
    return;
  }
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  const id = str(o["@_id"]);
  // First writer wins: an id is unique in the document, and a duplicate is not ours to resolve.
  if (id && tag && !out.has(id)) out.set(id, { tag, node: o });
  for (const [k, v] of Object.entries(o))
    if (!k.startsWith("@_")) indexById(v, out, k);
}

/** The three tags a clip's content can be — anything else referenced is not content, and says so. */
const CONTENT_TAGS = new Set(["Notes", "Audio", "Clips"]);

/**
 * A clip with its referenced content read in, or the clip itself. The placement's own attributes
 * are untouched: `time`, `duration` and the loop are THIS placement's, and only the content is
 * shared — which is why the notes are copied per clip rather than pointed at.
 */
function withReferenced(clip: any, ctx: CollectCtx): any {
  if (clip.Notes || clip.Clips || findAudio(clip)) return clip;
  const ref = str(clip["@_reference"]);
  if (!ref) return clip;
  const target = ctx.byId.get(ref);
  if (!target || !CONTENT_TAGS.has(target.tag)) return clip;
  return { ...clip, [target.tag]: target.node };
}

interface CollectCtx {
  trackId: string;
  onSampleRate: (sr: number | undefined) => void;
  warn: (msg: string) => void;
  /** What the document defines under each id — see `indexById`. */
  byId: Map<string, Referenced>;
  /** The project tempo, which turns a seconds in-point into beats. */
  tempo: number;
}

// Flatten a clip list into absolute-positioned leaves, clamped to their container — see docs/import.md.
function collectClips(
  clips: any[],
  baseStart: number,
  basePlayStart: number,
  bounds: { start: number; end: number } | null,
  out: ClipOut[],
  ctx: CollectCtx,
  parentDisabled = false,
): void {
  for (const raw of clips) {
    // Content written elsewhere and pointed at is read in here, so the branches below see one shape.
    const clip = withReferenced(raw, ctx);
    const time = num(clip["@_time"]);
    const rawStart = baseStart + (time - basePlayStart);
    let start = rawStart;
    const duration = num(clip["@_duration"]);
    let end = start + duration;
    if (bounds) {
      start = Math.max(start, bounds.start);
      end = Math.min(end, bounds.end);
    }
    const length = round(Math.max(0, end - start));
    // Clamped to nothing: this clip lies outside the window its container plays, so this placement
    // does not play it. Emitting it anyway put a pile of zero-length clips on the lane, reading as
    // overlaps the source project never had — 48 of 124 on one real export. See docs/import.md.
    if (length <= 0) continue;
    // An unwarped leaf counts its in-point in SECONDS; this model counts beats — see docs/import.md.
    const playStart =
      clip["@_contentTimeUnit"] === "seconds"
        ? (num(clip["@_playStart"]) * ctx.tempo) / 60
        : num(clip["@_playStart"]);
    // The head the container's window cuts off is material this placement skips — see docs/import.md.
    const offset = numOrUndef(playStart + (start - rawStart));
    // A disabled container silences everything under it, as the source DAW does.
    const disabled = parentDisabled || clip["@_enable"] === "false";

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
        offset,
        ...(disabled ? { disabled } : {}),
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
        offset,
        ...(disabled ? { disabled } : {}),
        fadeIn: fadeOrUndef(clip["@_fadeInTime"]),
        fadeOut: fadeOrUndef(clip["@_fadeOutTime"]),
        warp: warpOf(findWarps(clip), audio),
      });
    } else if (nested.length) {
      // Container: recurse into its child timeline, anchored at its UNCLAMPED start.
      collectClips(
        nested,
        rawStart,
        num(clip["@_playStart"]),
        { start, end },
        out,
        ctx,
        disabled,
      );
    } else {
      // Nothing we recognise: report it with its child tags, so an unhandled clip shape surfaces rather than vanishes.
      const kids = Object.keys(clip).filter((k) => !k.startsWith("@_"));
      const label = str(clip["@_name"]) ?? "(unnamed)";
      const ref = str(clip["@_reference"]);
      const target = ref ? ctx.byId.get(ref) : undefined;
      // Three different faults, and only the last is ours: a dangling id, an id that is not
      // content, and a clip that genuinely holds nothing.
      const why = !ref
        ? `no audio/notes/nested clips (children: ${kids.length ? kids.join(", ") : "none"})`
        : target
          ? `its content points at id "${ref}", which is a <${target.tag}> and not clip content`
          : `its content points at id "${ref}", which this file does not define`;
      ctx.warn(
        `track ${ctx.trackId}: dropped clip "${label}" @beat ${round(start)} — ${why}`,
      );
    }
  }
}

// Locate the <Audio> in an audio leaf: three shapes occur in the wild — see docs/import.md.
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

// A <Warps> block -> a WarpOut; undefined below two markers, one being unable to define a stretch.
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
