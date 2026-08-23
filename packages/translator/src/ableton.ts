// ableton.ts — the Ableton Live (.als) -> st0 song mapper: gunzip in memory, parse the
// LiveSet, project it onto the neutral shape in model.ts. NO disk I/O — a .als does not
// embed its audio, so sample bytes come from the caller's `readSample`. Deliberately lossy
// where Live has no portable form (native devices, sends, Session view). See docs/import.md.

import { XMLParser } from "fast-xml-parser";
import { gunzipSync } from "fflate";
import type {
  ClipOut,
  NoteOut,
  PluginOut,
  Song,
  TrackOut,
  Translation,
} from "./model.js";

export interface AlsOptions {
  // Resolve a Live sample reference to bytes, null when unreachable: the CALLER owns the path policy.
  readSample?: (ref: SampleRef) => Uint8Array | null;
}

// What a <SampleRef><FileRef> gave us, before policy: `relative` when Live set one, `absolute` always.
export interface SampleRef {
  name: string;
  relative?: string;
  absolute?: string;
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
// Trim float noise (Live writes ~17 digits) without lying about beats.
const round = (n: number, p = 6): number => {
  const f = 10 ** p;
  return Math.round(n * f) / f;
};
const asArray = <T>(v: T | T[] | undefined): T[] =>
  v == null ? [] : Array.isArray(v) ? v : [v];

// Live nests every scalar as <Volume><Manual Value="0.85"/></Volume>. One walker for all of them.
const val = (node: any, ...path: string[]): unknown => {
  let cur = node;
  for (const key of path) {
    if (cur == null) return undefined;
    cur = Array.isArray(cur) ? cur[0]?.[key] : cur[key];
  }
  return Array.isArray(cur) ? cur[0]?.["@_Value"] : cur?.["@_Value"];
};

// Tags that always model a collection — forced to arrays, so one child and many are handled the same way.
const ARRAY_TAGS = new Set([
  "AudioTrack",
  "MidiTrack",
  "ReturnTrack",
  "GroupTrack",
  "AudioClip",
  "MidiClip",
  "KeyTrack",
  "MidiNoteEvent",
  "WarpMarker",
  "ClipSlot",
  "PluginDevice",
  "AuPluginDevice",
  "PluginFloatParameter",
]);

// Live's own devices carry no portable state, so they are reported and skipped — see docs/import.md.
const NATIVE_DEVICE =
  /Device$|^(Eq8|Compressor2|Reverb|Operator|Wavetable|AutoFilter|Delay|Saturator|Limiter|GlueCompressor|MultibandDynamics|Echo|Roar|Drift|Meld)$/;
const NOT_A_DEVICE = /^(MixerDevice|.*DeviceChain|DevicesListWrapper|Devices)$/;
// Racks are containers: the plugins inside DO cross over, only the rack's own structure is lost.
const RACK_DEVICE = /GroupDevice$/;

// Live packs the time signature into one integer, 201 -> 4/4 — see docs/import.md.
export function decodeTimeSignature(v: number): string {
  if (!Number.isFinite(v) || v < 0) return "4/4";
  const numerator = (v % 99) + 1;
  const denominator = 2 ** Math.floor(v / 99);
  return `${numerator}/${denominator}`;
}

// --- main entry --------------------------------------------------------------

export function parseAls(
  bytes: Uint8Array,
  fallbackName: string,
  opts: AlsOptions = {},
): Translation {
  // A .als is gzip, always. Checking the magic turns "invalid distance" from fflate into a real message.
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b)
    throw new Error(
      "not an Ableton Live set: the file is not gzip-compressed (an .als always is)",
    );
  let xml: string;
  try {
    xml = new TextDecoder().decode(gunzipSync(bytes));
  } catch (e) {
    throw new Error(`could not decompress the .als: ${(e as Error).message}`);
  }
  return mapLiveSet(xml, fallbackName, opts);
}

// Split from parseAls so the mapping is testable on hand-written XML, with no binary fixture.
export function mapLiveSet(
  xml: string,
  fallbackName: string,
  opts: AlsOptions = {},
): Translation {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) => ARRAY_TAGS.has(name),
  });
  const doc = parser.parse(xml);
  const root = doc.Ableton;
  if (!root)
    throw new Error("not an Ableton Live set: no <Ableton> root element");

  const warnings: string[] = [];
  const creator = str(root["@_Creator"]) ?? "unknown";
  const major = num(root["@_MinorVersion"]?.toString().split(".")[0], 0);
  // MinorVersion leads with the real product version ("12.0_12402"); MajorVersion is the schema's, and stuck at 5.
  if (major !== 11 && major !== 12)
    throw new Error(
      `unsupported Ableton version: "${creator}" — this importer handles Live 11 and 12`,
    );

  const live = root.LiveSet ?? {};
  // Live 12 renamed the master track to MainTrack; 11 still says MasterTrack.
  const mainTrack = live.MainTrack ?? live.MasterTrack;
  const mainMixer = mainTrack?.DeviceChain?.Mixer;
  const tempo = round(num(val(mainMixer, "Tempo", "Manual"), 120));
  const timeSignature = decodeTimeSignature(
    num(val(mainMixer, "TimeSignature", "Manual"), 201),
  );

  const files: Record<string, Uint8Array> = {};
  const ctx: MapCtx = {
    opts,
    files,
    warnings,
    tempo,
    audioClips: 0,
    midiClips: 0,
    notes: 0,
    sessionClips: 0,
    sampleRate: 0,
    missingSamples: new Set(),
    nativeDevices: new Set(),
    racks: new Set(),
    usedNames: new Set(),
  };

  const src = live.Tracks ?? {};
  const tracks: TrackOut[] = [];
  for (const t of asArray<any>(src.MidiTrack))
    tracks.push(mapTrack(t, "notes", ctx));
  for (const t of asArray<any>(src.AudioTrack))
    tracks.push(mapTrack(t, "audio", ctx));

  // v1 carries neither sends nor groups, so their tracks would arrive as orphans — say so instead.
  const returns = asArray<any>(src.ReturnTrack).length;
  if (returns)
    warnings.push(
      `${returns} return track(s) ignored — sends are not imported yet`,
    );
  const groups = asArray<any>(src.GroupTrack).length;
  if (groups)
    warnings.push(
      `${groups} group track(s) flattened — grouping is not imported yet`,
    );
  if (ctx.sessionClips)
    warnings.push(
      `${ctx.sessionClips} Session view clip(s) ignored — only the Arrangement is imported`,
    );
  for (const d of ctx.nativeDevices)
    warnings.push(
      `Ableton device "${d}" skipped — it has no portable form outside Live`,
    );
  for (const r of ctx.racks)
    warnings.push(
      `rack "${r}" flattened — the plugins inside are carried, its structure is not`,
    );
  for (const s of ctx.missingSamples)
    warnings.push(`sample not imported: ${s}`);

  const song: Song = {
    project: {
      name: fallbackName,
      tempo,
      sampleRate: ctx.sampleRate || 48000,
      timeSignature,
    },
    tracks,
  };

  return {
    song,
    files,
    stats: {
      tracks: tracks.length,
      audioClips: ctx.audioClips,
      midiClips: ctx.midiClips,
      notes: ctx.notes,
      assets: Object.keys(files).length,
    },
    warnings,
  };
}

interface MapCtx {
  opts: AlsOptions;
  files: Record<string, Uint8Array>;
  warnings: string[];
  tempo: number; // needed to read an unwarped clip's region, which Live writes in seconds
  audioClips: number;
  midiClips: number;
  notes: number;
  sessionClips: number;
  sampleRate: number;
  missingSamples: Set<string>;
  nativeDevices: Set<string>;
  racks: Set<string>;
  usedNames: Set<string>;
}

function mapTrack(
  t: any,
  contentType: "audio" | "notes",
  ctx: MapCtx,
): TrackOut {
  const id = String(t["@_Id"] ?? "");
  const name = str(val(t, "Name", "EffectiveName")) || `track ${id}`;
  const mixer = t.DeviceChain?.Mixer;

  const track: TrackOut = { id, name, role: "regular", contentType };
  const volume = val(mixer, "Volume", "Manual");
  if (volume != null) track.volume = round(num(volume, 1));
  const pan = val(mixer, "Pan", "Manual");
  // Live pans -1..1; the model wants 0..1.
  if (pan != null) track.pan = round((num(pan, 0) + 1) / 2);
  const speaker = val(mixer, "Speaker", "Manual");
  // Speaker is the track's ON state: true means audible, so mute is its inverse.
  if (speaker != null) track.mute = !bool(speaker);

  const clips = collectArrangementClips(t, ctx);
  if (clips.length) track.clips = clips;
  const plugins = mapDevices(
    t.DeviceChain?.DeviceChain?.Devices,
    contentType,
    ctx,
  );
  if (plugins.length) track.plugins = plugins;
  return track;
}

// Where Live keeps clips moved between versions and track kinds, so walk rather than hard-code — docs/import.md.
function collectArrangementClips(track: any, ctx: MapCtx): ClipOut[] {
  const out: ClipOut[] = [];
  const walk = (node: any, inSession: boolean): void => {
    if (node == null || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("@_")) continue;
      const session = inSession || key === "ClipSlotList" || key === "ClipSlot";
      if (key === "AudioClip" || key === "MidiClip") {
        for (const clip of asArray<any>(child)) {
          if (session) {
            ctx.sessionClips++;
            continue;
          }
          const mapped =
            key === "AudioClip"
              ? mapAudioClip(clip, ctx)
              : mapMidiClip(clip, ctx);
          if (mapped) out.push(mapped);
        }
        continue;
      }
      if (Array.isArray(child)) for (const c of child) walk(c, session);
      else walk(child, session);
    }
  };
  walk(track, false);
  out.sort((a, b) => a.start - b.start);
  return out;
}

// The arrangement placement, shared by both clip kinds. CurrentStart/CurrentEnd are absolute beats.
function clipWindow(clip: any): { start: number; length: number } {
  const start = num(val(clip, "CurrentStart"), num(clip["@_Time"]));
  const end = num(val(clip, "CurrentEnd"), start);
  return { start: round(start), length: round(Math.max(0, end - start)) };
}

/** Where the clip starts reading its material: <Loop> holds two different things by the brace — docs/import.md. */
function materialStart(clip: any): number {
  return bool(val(clip, "Loop", "LoopOn"))
    ? num(val(clip, "Loop", "StartRelative"), 0)
    : num(val(clip, "Loop", "LoopStart"), 0);
}

function mapAudioClip(clip: any, ctx: MapCtx): ClipOut | null {
  const { start, length } = clipWindow(clip);
  const sampleRef = clip.SampleRef;
  const ref = readSampleRef(sampleRef);
  const out: ClipOut = { type: "audio", start, length };
  const name = str(val(clip, "Name"));
  if (name) out.name = name;

  const sr = num(val(sampleRef, "DefaultSampleRate"), 0);
  if (sr > 0 && !ctx.sampleRate) ctx.sampleRate = sr;

  if (ref) {
    const bytes = ctx.opts.readSample?.(ref) ?? null;
    if (bytes) {
      const key = `audio/${uniqueName(ref.name, ctx.usedNames)}`;
      ctx.files[key] = bytes;
      out.source = key;
    } else {
      ctx.missingSamples.add(ref.relative || ref.absolute || ref.name);
    }
  }

  // An UNWARPED clip's region is in SECONDS, and only IsWarped tells it apart — see docs/import.md.
  const warped = bool(val(clip, "IsWarped"));
  const toBeats = (v: number): number => (warped ? v : (v * ctx.tempo) / 60);

  const offset = toBeats(materialStart(clip));
  if (offset) out.offset = round(offset);
  const fadeIn = num(val(clip, "Fades", "FadeInLength"), 0);
  if (fadeIn > 0) out.fadeIn = round(toBeats(fadeIn));
  const fadeOut = num(val(clip, "Fades", "FadeOutLength"), 0);
  if (fadeOut > 0) out.fadeOut = round(toBeats(fadeOut));

  // <WarpMarker BeatTime SecTime> is exactly the model's [timeline beat, source second] pair.
  if (warped) {
    const markers = asArray<any>(clip.WarpMarkers?.WarpMarker)
      .map((m): [number, number] => [
        round(num(m["@_BeatTime"])),
        round(num(m["@_SecTime"])),
      ])
      .sort((a, b) => a[0] - b[0]);
    if (markers.length >= 2) out.warp = { markers };
  }

  ctx.audioClips++;
  return out;
}

function mapMidiClip(clip: any, ctx: MapCtx): ClipOut | null {
  const { start, length } = clipWindow(clip);
  const out: ClipOut = { type: "midi", start, length };
  const name = str(val(clip, "Name"));
  if (name) out.name = name;

  // MIDI is always in beats, and the loop brace is deliberately NOT carried — see docs/import.md.
  const offset = materialStart(clip);
  if (offset) out.offset = round(offset);

  // The pitch lives on the KeyTrack, not on the event — the one structural surprise of Live's MIDI.
  const notes: NoteOut[] = [];
  for (const kt of asArray<any>(clip.Notes?.KeyTracks?.KeyTrack)) {
    const key = num(val(kt, "MidiKey"), -1);
    if (key < 0) continue;
    for (const ev of asArray<any>(kt.Notes?.MidiNoteEvent))
      notes.push({
        time: round(num(ev["@_Time"])),
        duration: round(num(ev["@_Duration"])),
        key,
        vel: round(num(ev["@_Velocity"], 100) / 127),
        channel: 0,
        rel: round(num(ev["@_OffVelocity"], 64) / 127),
      });
  }
  notes.sort((a, b) => a.time - b.time || a.key - b.key);
  if (notes.length) out.notes = notes;
  ctx.notes += notes.length;
  ctx.midiClips++;
  return out;
}

// Only a <SampleRef>'s FileRef is audio; a bare one points at a device preset or a VST binary.
function readSampleRef(sampleRef: any): SampleRef | null {
  const fileRef = sampleRef?.FileRef;
  if (!fileRef) return null;
  const relative = str(val(fileRef, "RelativePath")) || undefined;
  const absolute = str(val(fileRef, "Path")) || undefined;
  const name =
    str(val(fileRef, "Name")) ||
    (relative || absolute || "").split(/[/\\]/).pop() ||
    "";
  if (!name) return null;
  return { name, relative, absolute };
}

function uniqueName(name: string, used: Set<string>): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let candidate = name;
  for (let n = 2; used.has(candidate); n++) candidate = `${stem}-${n}${ext}`;
  used.add(candidate);
  return candidate;
}

// Live's <Buffer> hex is wrapped across lines and indented; strip everything non-hex before decoding.
function decodeHex(text: string): Uint8Array | null {
  const clean = text.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length < 2) return null;
  const bytes = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  return bytes;
}

// Map a track's Devices to plugin refs; Live gives no explicit instrument/FX role — see docs/import.md.
function mapDevices(
  devices: any,
  contentType: "audio" | "notes",
  ctx: MapCtx,
): PluginOut[] {
  if (!devices) return [];
  const out: PluginOut[] = [];

  // Walk into racks and flatten them away: only the plugins a rack holds can cross over.
  const found: { tag: string; node: any }[] = [];
  const walk = (node: any): void => {
    if (node == null || typeof node !== "object") return;
    for (const [tag, child] of Object.entries(node)) {
      if (tag.startsWith("@_")) continue;
      if (tag === "PluginDevice" || tag === "AuPluginDevice") {
        for (const d of asArray<any>(child)) found.push({ tag, node: d });
        continue;
      }
      if (!NOT_A_DEVICE.test(tag) && NATIVE_DEVICE.test(tag))
        (RACK_DEVICE.test(tag) ? ctx.racks : ctx.nativeDevices).add(tag);
      if (Array.isArray(child)) for (const c of child) walk(c);
      else walk(child);
    }
  };
  walk(devices);

  for (const { tag, node: d } of found) {
    const desc = d.PluginDesc ?? {};
    const vst3 = desc.Vst3PluginInfo;
    const vst2 = desc.VstPluginInfo;
    const info = vst3 ?? vst2 ?? {};
    const name =
      str(val(info, "Name")) ?? str(val(info, "PlugName")) ?? "unknown plugin";
    const on = val(d, "On", "Manual");
    const plugin: PluginOut = {
      type: tag === "AuPluginDevice" ? "au" : vst3 ? "vst3" : "vst2",
      name,
      enabled: on == null ? true : bool(on),
    };

    // VST3 keeps its state in ProcessorState, VST2 in Preset/VstPreset/Buffer; both are hex text.
    const raw =
      textOf(vst3?.Preset?.Vst3Preset?.ProcessorState) ??
      textOf(vst2?.Preset?.VstPreset?.Buffer);
    if (raw) {
      const bytes = decodeHex(raw);
      if (bytes) {
        const key = `plugins/${uniqueName(`${slug(name)}.vstpreset`, ctx.usedNames)}`;
        ctx.files[key] = bytes;
        plugin.path = key;
      }
    }

    // Live exposes only a SUBSET of the params by name, so paramsComplete is never set — docs/import.md.
    const params: Record<string, number> = {};
    for (const p of asArray<any>(d.ParameterList?.PluginFloatParameter)) {
      const pname = str(val(p, "ParameterName"));
      const pval = val(p, "ParameterValue", "Manual");
      if (pname && pval != null) params[pname] = round(num(pval));
    }
    if (Object.keys(params).length) plugin.params = params;

    plugin.role =
      contentType === "notes" && out.length === 0 ? "instrument" : "audioFX";
    out.push(plugin);
  }
  return out;
}

// fast-xml-parser gives a string for a text-only node, or an object with #text when it carries attributes.
function textOf(node: unknown): string | null {
  if (node == null) return null;
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  const text = (node as any)["#text"];
  return text == null ? null : String(text);
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "plugin";
