// graphTypes.ts — the GraphDoc model a surface draws: tracks, chains, modules and their ports,
// and the questions every reader asks of a node (is it a sink, an input, a camera, cold?).
// What a reader gets wrong: chains are DERIVED from segments, never stored. docs/graphModel.md.

import type { WebOut } from "@studio/graph-model";
import {
  CAMERA_IO,
  isBuiltinOutput,
  isIoSource,
  isPicturePass,
  MIDI_IN_IO,
  type ModuleKind,
  SHAPE_CATEGORY,
  splitPort,
} from "@studio/song-schema/moduleTypes";
import type { ControllerFile } from "@studio/song-schema/yaml/moduleSchema";
import type { Assembly } from "./assemblies";
import { NODE_SEP, readsAsPicture } from "./loader";
import type { RawClip, RawPlugin, RawSequence, RawVideoTrack } from "./rawDoc";
import type { TapFeed } from "./tapOuts";
import { type Lane, laneMaterials, laneSignal } from "./trackModule";

// --- model -------------------------------------------------------------------

export interface Placement {
  ref: string;
  start: number;
  // How many passes of the material's window, not how long it sounds (see PlacementSchema).
  loop: number;
  kind: "audio" | "midi" | "missing";
}
// A LANE as every surface downstream reads one — a projection of a track module, not an entity; see docs/graphModel.md.
export interface Track {
  name: string;
  type: "single" | "group" | "strudel";
  color?: string; // authored display colour (hex, e.g. "#ff5706"); absent when unset
  // Silenced. Read off `graph.yaml`'s `bypassed:` — the lane file carries no `mute:` of its own.
  mute: boolean;
  // Always false: solo is a session state the surface derives by bypassing every OTHER lane.
  solo: boolean;
  placements: Placement[]; // single only
  tracks: string[]; // group only: member lane names
  strudel?: string; // strudel only: project-relative path to its pattern file
  videoSource?: string; // the PICTURE lane whose shots this lane sounds (docs/videoSound.md)
}
// A video lane as the graph and the timeline need it; its geometry and placements stay in the compiled ProjectDoc.
export interface VideoTrack {
  name: string;
  color?: string;
  mute: boolean; // "mute" == hidden, for a video lane
}

export interface Step {
  module: string; // a module node name
  in?: string[]; // extra input sources feeding the module's ports past the chain flow
  enabled?: boolean; // undefined/true == on; false == bypassed
}
// A typed input port derived from a module's type folder. `mandatory` ports must be fed.
export interface InputDef {
  name: string;
  type: "audio" | "midi" | "video";
  mandatory: boolean;
}
// …and a typed OUTPUT port. No `mandatory` twin: an output is offered, never required. See docs/ports.md.
export interface OutputDef {
  name: string;
  type: "audio" | "midi" | "video";
}
// A signal destination — the SAME shape the browser receives, not a second declaration of it; see docs/graphModel.md.
export type Out = WebOut;
export interface Chain {
  from?: string;
  // Which of the source lane's OUTPUTS this run left by, absent unless the lane was keyed on both (docs/trackModules.md).
  fromPort?: string;
  use: Step[]; // ordered module nodes: from -> use[0] -> … -> out
  enabled?: boolean; // whole-chain bypass
  out: Out[];
}
// The kinds of widget a module UI can place: `label` draws text, `meter` is read-only, every other kind binds to a param.
export type WidgetType =
  | "label"
  | "knob"
  | "slider"
  | "fader"
  | "number"
  | "toggle"
  | "button"
  | "meter"
  | "waveform"
  | "dropdown"
  | "lcdscreen"
  | "group";

// One widget on a module's grid — see #Widget in the schema above for the contract.
export interface Widget {
  type: WidgetType;
  col: number;
  row: number;
  colSpan?: number;
  rowSpan?: number;
  label?: string;
  hidden?: boolean;
  text?: string; // label only
  bind?: string; // everything but label/waveform: the param name
  min?: number; // knob | slider | number
  max?: number;
  step?: number;
  curve?: "lin" | "log";
  source?: "input" | "output"; // waveform only: which audio tap to display
  // dropdown only: a discrete param's named settings…
  options?: { label: string; value: number }[];
  // …or the library folder its choices are listed from ("ir"), where `bind` names a MODULE field (see #Widget).
  library?: string;
  color?: string; // group only: its background colour
  pair?: string; // knob only: the dry param of a crossfade knob
}
// One tab of a panel: its name, and the widgets drawn while it is open.
export interface UiTab {
  name: string;
  widgets: Record<string, Widget>;
}
// A module's UI: widgets on a grid, keyed by a stable id (the override key); `widgets` show on every tab.
export interface ModuleUI {
  cols: number;
  rows: number;
  widgets: Record<string, Widget>;
  tabs?: UiTab[];
  // The source of the `widgets.js` beside the panel, which draws its lcdscreen widgets.
  script?: string;
  // The panel laid out NARROW, at most 4 columns — absent, the panel serves both shapes (song-schema's LayoutSchema).
  vertical?: Omit<ModuleUI, "script" | "vertical">;
}

// One rack sound triggered by a MIDI note: its own `clip` in a "samples" rack, a [from, to) second window in a "slice" one.
export interface RackSound {
  note: number; // MIDI note 0..127 the sound maps to
  sample?: string; // a TAP's library sample, `@<library>/<path>` — resolved into `clip` by the loader
  clip?: string; // samples: a clips/<id> id (resolved to an absolute path for the engine)
  from?: number; // slice: window start in the source, seconds
  to?: number; // slice: window end in the source, seconds
  mute?: boolean; // silenced: drawn on its pad, never sent to the sampler
}
export type RackType = "samples" | "slice";
// A rack: how a set of symbols (e.g. "BD", "HH") get their audio — see docs/racks.md.
export interface Rack {
  rackType: RackType;
  source?: string; // slice: the clip id every symbol slices from
  symbols: Record<string, RackSound>;
}

// The AUTHORED instrument discriminator — distinct from the folder-derived `Module.kind` and from `plugin.type`.
export type InstrumentType = "plugin" | "rack";

// A module: a plugin (or io, or a rack) plus params, plus an optional `extends` it inherits defaults from.
export interface Module {
  extends?: string; // the module this inherits from ("type/name" | "@ns/type/name"); "" when none
  kind: ModuleKind; // from the type folder — "plugin", "io", or "doc" (a note; see docModule.ts)
  io?: string; // io modules only: "out" (sink) | "in" (live source)
  plugin?: RawPlugin; // a plugin definition (plugin.type = xmlTypeName / cache id)
  type?: InstrumentType; // "plugin" (default) | "rack"
  // Numbers, except the file-valued ones (moduleTypes.FILE_PARAMS), which name a file in the module's assets/.
  params?: Record<string, number | string>;
  // Only usable on an input that is already a FILE — see docs/coldModules.md and isColdModule.
  cold?: boolean;
  // The engine's blend around the effect, 0..1 — carried to the plugin as its `@mix` param (engine docs/mix.md).
  mix?: number;
  // …and the levels on that same stage, in dB — carried as `@input-volume` / `@output-volume`.
  input_volume?: number;
  output_volume?: number;
  // Which named BASE this module starts from — the opaque state UNDER `params:`; see docs/userPresets.md.
  base?: string;
  // Which SHADER a shader node runs, absent when nothing is chosen — see packages/song-video/docs/shaders.md.
  shader?: string;
  // …and the 3D LUT it reads, project-relative — packages/song-video/docs/effects.md.
  lut?: string;
  // …and which PRIMITIVE a shape module draws, its geometry being `params:` — see song-video/docs/shapes.md.
  shape?: string;
  // What a shape is FILLED with, and on a lane module its colour in the timeline — one key, read by category.
  color?: string;
  // A `text` shape's CSS font family; its string is `content:`, the key a doc note already uses.
  font?: string;
  // …and how a `text` shape's lines are set — packages/song-video/docs/titles.md.
  align?: "left" | "center" | "right";
  background?: string;
  shadow?: boolean;
  ui?: ModuleUI;
  // What this module LOADS when it is a rack, `extends` already merged in; absent for a plugin.
  rack?: Rack;
  // …and an SFZ kit's pads, name → note, which the kit itself plays (docs/racks.md).
  kit?: Record<string, number>;
  // Which MIDI CC plays which param, keyed by the widget's `bind` string verbatim (controller.ts).
  cc?: ControllerFile;
  inputs: InputDef[]; // typed input ports from the type folder (empty == unconstrained)
  // …and its output ports, carried beside `emits` rather than derived from it — see docs/graphModel.md.
  outputs: OutputDef[];
  // The module's TYPE FOLDER, which is what says what KIND of module this is; see docs/graphModel.md.
  category?: string;
  // The ABSOLUTE folder this module's files live in, stamped by the loader; `moduleAssetChoices` walks the ancestry off these.
  folderAbs?: string;
  // What this module EMITS — the signal on the cable leaving it (see moduleEmits); undefined for a sink.
  emits?: "audio" | "midi" | "video";
  // The file a file-valued param names, resolved to an ABSOLUTE path for the engine, or undefined when assets/ lacks it.
  model?: string;
  // …the same for the neural MODEL an offline module runs, resolved against its assets/ then the machine's cache.
  onnx?: string;
  // …and what the module SAYS, per param: the short assets-relative name; the two disagreeing is how a dangling ref is spotted.
  assets?: Record<string, string>;
  // Where that model can be downloaded from when the machine has not got it — docs/moduleAssets.md.
  model_url?: string;
  // io: "file" only — the audio file this source reads, project-relative; absent in a chain TEMPLATE.
  source?: string;
  // io: "in" only — a live interface input, as DECLARED rather than resolved; see docs/graphModel.md.
  channel?: string | number[];
  // io: "camera" only — WHICH lens, by the LABEL a person reads; "" or absent is the default one.
  camera?: string;
  // io: "midi" only — WHICH MIDI device it records from, by its label; "" or absent is any device.
  device?: string;
  // …and where in the viewport it draws, [x, y, w, h] in px; absent is the whole frame.
  frame?: number[];
  monitor?: "off" | "auto" | "on";
  // A NOTE's text on a doc module — multiline, drawn as written on the node itself; see docs/docModules.md.
  content?: string;
  // Which curve (by id, from curves/) drives which param here; drawn by the web graph, no engine meaning yet.
  automations?: Automation[];
  // The module's other attribute SETS and which one is ON, carried after the merge — see docs/graphModel.md.
  alternatives?: string[];
  alternative?: string;
  // The modules it can run AS and which one it does, sent only when there is a choice — docs/engines.md.
  engines?: string[];
  engine?: string;
  // The render standing in for everything upstream of this module, itself included — see docs/freeze.md.
  frozen?: string;
}
// One automation binding: a curve id driving a named param (mirrors #Automation).
export interface Automation {
  param: string;
  curve: string;
}

export interface GraphDoc {
  project: {
    name: string;
    tempo: number;
    sampleRate: number;
    timeSignature: string;
  };
  chains: Record<string, Chain>;
  // The tracks the song actually plays: a DISABLED track is absent, and so is any chain sourced from one.
  tracks: Record<string, Track>;
  // Video tracks (video_tracks/<id>.yaml), kept SEPARATE from `tracks` — see docs/graphModel.md.
  videoTracks: Record<string, VideoTrack>;
  // The ids left out for being disabled, so validate() can tell "you disabled this" from "this doesn't exist".
  disabledTracks: string[];
  // Modules keyed by BARE NAME — what chains reference (use / out); the io sink "OUT" is a module here too.
  modules: Record<string, Module>;
  // The same modules keyed by REF — the `extends` vocabulary, resolved like `modules` (see moduleResolve.ts).
  moduleRefs: Record<string, Module>;
  // graph.yaml's `positions:`, verbatim; nothing about the SIGNAL reads it, it rides through to the renderer.
  positions?: Record<string, { x: number; y: number }>;
  // The `assemblies/` folder, RESOLVED — a drawing fact the compiler never reads, see docs/assemblies.md.
  assemblies: Record<string, Assembly>;
  // A rack node's taps routed to subchains, each with the first node of the run it feeds (docs/racks.md).
  tapFeeds?: TapFeed[];
  warnings: string[];
}

// Is `id` a sink: something the signal ENDS at, by name (OUT, MIX, RENDER, VIDEO_OUT, CUE), by role, or by shape.
export const isSink = (g: GraphDoc, id: string): boolean => {
  // The five built-in outputs have no folder behind them — see docs/graphModel.md.
  if (isBuiltinOutput(id)) return true;
  const m = g.modules[id];
  if (!m) return false;
  // A NOTE ends a run too: it takes one input and gives nothing back, so it is a sink by SHAPE.
  if (m.kind === "doc") return true;
  return m.kind === "io" && !isIoSource(m.io);
};
// The other io edge: a LIVE interface source (io: "in"), deliberately narrower than "is a source" (docs/graphModel.md).
export const isInputModule = (_g: GraphDoc, b: Module): boolean =>
  b.kind === "io" && b.io === "in";
/** …and the CAMERA, the one io source whose signal is a picture. See docs/camera.md.
 *
 * Kept apart from `isInputModule` for the reason that one is narrow: everything it gates — a
 * channel, monitoring, a trim, the tuner — is about a physical AUDIO input, and none of it means
 * anything for a lens. What a camera shares with it is only that signal comes FROM it. */
export const isCameraModule = (b: Module): boolean =>
  b.kind === "io" && b.io === CAMERA_IO;

/** …and a MIDI device (io: "midi"): notes the BROWSER records onto the lane it feeds. See docs/midiIn.md. */
export const isMidiInModule = (b: Module): boolean =>
  b.kind === "io" && b.io === MIDI_IN_IO;

/** …and the file source (io: "file"), which reads audio off disk. See docs/fileInput.md. */
export const isFileInputModule = (b: Module): boolean =>
  b.kind === "io" && b.io === "file";

/** A SHAPE: the other picture source, drawn rather than filmed — see song-video/docs/shapes.md. */
export const isShapeModule = (b: Module): boolean =>
  b.category === SHAPE_CATEGORY;
// The " — did you mean …" tail when the last `/` should have been the node separator; see docs/graphModel.md.
export function nodeHint(g: GraphDoc, name: string): string {
  const cut = name.lastIndexOf("/");
  if (cut < 0) return "";
  const asNode = `${name.slice(0, cut)}${NODE_SEP}${name.slice(cut + 1)}`;
  return g.modules[asNode] || g.moduleRefs[asNode]
    ? ` — did you mean '${asNode}'? a node is named with '${NODE_SEP}', not '/'`
    : "";
}

// The chain a module RUNS INSIDE, when it is a step rather than a meeting point of its own — see docs/graphModel.md.
function chainHosting(g: GraphDoc, node: string): string | undefined {
  for (const [name, c] of Object.entries(g.chains))
    if (c.use.some((s) => s.module === node)) return name;
  return undefined;
}

// The chain a destination continues in: itself when it names one, else the run hosting the module it lands on.
export function chainAt(g: GraphDoc, to: string): string | undefined {
  const { node } = splitPort(to);
  return g.chains[node] ? node : chainHosting(g, node);
}

// A destination the signal can legitimately arrive at; the PORT is stripped first, every question here is about the module.
export const isNode = (g: GraphDoc, id: string): boolean => {
  const { node } = splitPort(id);
  return !!g.chains[node] || isSink(g, node) || !!chainHosting(g, node);
};
/** Does this chain carry a CAMERA — a live picture, which is what a video lane may be fed by? */
export const carriesCamera = (g: GraphDoc, c: Chain): boolean =>
  c.use.some((s) => {
    const b = g.modules[s.module];
    return !!b && isCameraModule(b);
  });

/** …and does it carry a SHAPE, the other thing a picture lane may be fed by (docs/shapes.md)? */
export const carriesShape = (g: GraphDoc, c: Chain): boolean =>
  c.use.some((s) => {
    const b = g.modules[s.module];
    return !!b && isShapeModule(b);
  });

/** …or is it a STRETCH: picture passes nothing feeds, landing on a picture lane, run by a fade's `chain:` (song-video/docs/transitions.md). */
export const isStretch = (g: GraphDoc, c: Chain): boolean => {
  const head = c.use[0]?.module;
  if (c.from || !head) return false;
  if (!c.out.some((o) => !!g.videoTracks[splitPort(o.to).node])) return false;
  if (!c.use.every((s) => isPicturePass(g.modules[s.module]?.category)))
    return false;
  // A run another one feeds is a meeting point of that signal, not a shot's.
  return !Object.values(g.chains).some((o) =>
    o.out.some((x) => splitPort(x.to).node === head),
  );
};

/** Does this chain carry a MIDI device — notes a lane may be fed by, for the browser to record? */
export const carriesMidiIn = (g: GraphDoc, c: Chain): boolean =>
  c.use.some((s) => {
    const b = g.modules[s.module];
    return !!b && isMidiInModule(b);
  });

/** Does this chain carry a live interface input? */
export const carriesInput = (g: GraphDoc, c: Chain): boolean =>
  c.use.some((s) => {
    const b = g.modules[s.module];
    return !!b && isInputModule(g, b);
  });

/** …and the other source: does its signal come off DISK (an `io: file` step)? */
export const carriesFileInput = (g: GraphDoc, c: Chain): boolean =>
  c.use.some((s) => {
    const b = g.modules[s.module];
    return !!b && isFileInputModule(b);
  });

/** A module that only works on material already on disk. See docs/coldModules.md. */
export const isColdModule = (b: Module | undefined): boolean =>
  b?.cold === true;

// Why `module` may not be added after `at`, or null when it may — THE one place the cold rule is decided (docs/graphModel.md).
export function coldPlacementError(
  g: GraphDoc,
  module: Module | undefined,
  name: string,
  at: string | undefined,
): string | null {
  if (!isColdModule(module)) return null;
  if (at === undefined) return null;
  const { node } = splitPort(at);
  const hostName = g.chains[node] ? node : chainHosting(g, node);
  const chain = hostName ? g.chains[hostName] : undefined;
  if (chain && carriesFileInput(g, chain)) return null;
  return (
    `'${name}' is a COLD module: it has to know the whole of its input before it can produce any ` +
    `of it, so it only works on audio already on disk. ` +
    (chain
      ? `The chain at '${at}' has no file input (io: file) — a live input has no "whole" yet. ` +
        `Use it in a médiathèque chain over a song, or give this chain a file source.`
      : `'${at}' is not part of a chain drawing from a file.`)
  );
}

// The track a chain's live input lands on: its own source track when the input is a step ON it, else the track its run ends at.
export function inputLandingTrack(
  c: Chain,
  isTrack: (id: string) => boolean,
): string {
  if (c.from) return c.from;
  return c.out.map((o) => o.to).find(isTrack) ?? "";
}

// A port's signal, defaulting to audio; `video` is spelled out so a video chain is not rejected by the positional check.
const portSignal = (t: unknown): "audio" | "midi" | "video" =>
  t === "midi" ? "midi" : t === "video" ? "video" : "audio";

// Normalize a module's declared input ports (from its type folder); absent or empty == unconstrained.
export function normalizeInputs(raw: unknown): InputDef[] {
  if (!Array.isArray(raw)) return [];
  return (raw as { name?: unknown; type?: unknown; mandatory?: unknown }[]).map(
    (i): InputDef => ({
      name: String(i?.name ?? ""),
      type: portSignal(i?.type),
      mandatory: i?.mandatory !== false,
    }),
  );
}

// …and its outputs. The same shape minus `mandatory`, which an output has no use for.
export function normalizeOutputs(raw: unknown): OutputDef[] {
  if (!Array.isArray(raw)) return [];
  return (raw as { name?: unknown; type?: unknown }[]).map(
    (o): OutputDef => ({
      name: String(o?.name ?? ""),
      type: portSignal(o?.type),
    }),
  );
}

// The signal a track puts on a wire, or undefined when it cannot be said — see docs/graphModel.md.
function trackType(
  lane: Lane | undefined,
  port: string | undefined,
  clips: Record<string, RawClip>,
  seqs: Record<string, RawSequence>,
): "audio" | "midi" | undefined {
  if (!lane || lane.type === "group") return undefined;
  if (port === "midi" || port === "audio") return port;
  return laneSignal(
    laneMaterials(lane.events, (ref) =>
      seqs?.[ref] ? "midi" : clips?.[ref] ? "audio" : "missing",
    ),
  );
}

// The type a chain-input source id resolves to, or undefined when unknowable — see docs/graphModel.md.
export function sourceType(
  id: string,
  lanes: Record<string, Lane>,
  clips: Record<string, RawClip>,
  seqs: Record<string, RawSequence>,
  videoTracks?: Record<string, RawVideoTrack>,
): "audio" | "midi" | "video" | undefined {
  if (seqs?.[id]) return "midi";
  if (clips?.[id])
    return readsAsPicture(String(clips[id]?.source ?? "")) ? "video" : "audio";
  const { node, port } = splitPort(id);
  if (lanes?.[node]) return trackType(lanes[node], port, clips, seqs);
  if (videoTracks?.[node]) return "video";
  return undefined;
}

// Check that every chain feeds each module the input ports its type folder declares; a non-empty result is FATAL (docs/graphModel.md).
// An SFZ kit's pads as the module states them, name → note; anything else is no kit.
export function kitOf(v: unknown): Record<string, number> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const pads = Object.entries(v as Record<string, unknown>).filter(
    (e): e is [string, number] => Number.isInteger(e[1]),
  );
  return pads.length ? Object.fromEntries(pads) : undefined;
}
