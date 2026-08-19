// graph.ts — load and inspect a node/track/chain project (`studio-graph <project>`): clips and sequences are
// the material, tracks arrange them, modules wrap a plugin or rack, and chains route a track through modules to
// the OUT sink. Chains are DERIVED from graph.yaml's segments (chainsGraph.ts). See docs/nodeProjectLayout.md.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { WebOut } from "@studio/graph-model";
import { alternativesOf, currentAlternative } from "./alternatives";
import { bypassedOf, deriveChains, isParked } from "./chainsGraph";
import {
  exportSub,
  isVideoSource,
  loadChains,
  loadModuleRefs,
  loadModules,
  loadProjectRoot,
  loadVideoTracks,
  moduleEmits,
  NODE_SEP,
  withChainModuleRefs,
} from "./loader";
import { withModuleStamp } from "./moduleCache";
import {
  type ResolvedModule,
  resolvedCc,
  resolvedRack,
  resolvedType,
  resolvedUI,
  resolveModule,
  resolveModuleMap,
} from "./moduleResolve";
import { isIoSource, type ModuleKind, splitPort } from "./moduleTypes";
import { loadPreferences, type Preferences, resolveInput } from "./preferences";
import type {
  LoadedModule,
  RawClip,
  RawPlugin,
  RawProjectRoot,
  RawSequence,
  RawVideoTrack,
} from "./rawDoc";
import { parsePosition } from "./timecode";
import { type Lane, lanesOf } from "./trackModule";
import type { ControllerFile } from "./yaml/moduleSchema";

// --- model -------------------------------------------------------------------

export interface Placement {
  ref: string;
  start: number;
  // How many passes of the material's window, not how long it sounds: the extent lives with the material now,
  // and this graph reads track files without opening the clips they name (see PlacementSchema).
  loop: number;
  kind: "audio" | "midi" | "missing";
}
/**
 * A LANE, as every surface downstream reads one.
 *
 * A PROJECTION now, not an entity: a lane is a node of one of the five `@studio/…-track`
 * modules (docs/trackModules.md), and this is that node seen as an arrangement rather than as
 * a node. Kept in this shape deliberately — the compiler, the wire and the engine all speak it,
 * and the engine's lanes are a compilation target rather than the authoring model, exactly as the
 * `Mixer` module's fader is.
 *
 * A single lane holds placements; a group holds member names; a strudel lane links the pattern its
 * material streams from. The fields of the other kinds are always present but empty, so callers
 * can read any without narrowing first.
 */
export interface Track {
  name: string;
  type: "single" | "group" | "strudel";
  contentType: "audio" | "sequences"; // single/strudel: what its material is
  color?: string; // authored display colour (hex, e.g. "#ff5706"); absent when unset
  // Silenced. Read off `graph.yaml`'s `bypassed:` — a lane's mute IS its module's bypass, which
  // is why the lane file carries no `mute:` for the two to disagree over.
  mute: boolean;
  // Always false. Solo is a session state the surface derives (it bypasses every OTHER lane), so
  // nothing writes this any more; the field goes once the wire and the engine drop it too.
  solo: boolean;
  placements: Placement[]; // single only
  tracks: string[]; // group only: member lane names
  strudel?: string; // strudel only: project-relative path to its pattern file
}
// A video lane, as the graph and the timeline need it: what it's called, how it reads,
// and whether it draws. Its geometry, placements and shapes stay in the compiled
// ProjectDoc — those belong to the renderer, not to a routing diagram or a track list.
export interface VideoTrack {
  name: string;
  color?: string;
  kind: "video" | "shape"; // "shape" draws parametric fills, it links no picture
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
// …and a typed OUTPUT port. No `mandatory` twin: an output is offered, never required — nothing
// is wrong with a jack nobody plugged into. See docs/ports.md.
export interface OutputDef {
  name: string;
  type: "audio" | "midi" | "video";
}
/**
 * A signal destination — the SAME shape the browser receives, not a second declaration of it.
 *
 * `Out` and `WebOut` were field-for-field identical, one here and one in `@studio/graph-model`,
 * which is how `fromPort` came to be added twice. The name survives because it reads better
 * inside a compiler that has no "web" side; the type is one. See docs/ports.md.
 */
export type Out = WebOut;
export interface Chain {
  from?: string;
  use: Step[]; // ordered module nodes: from -> use[0] -> … -> out
  enabled?: boolean; // whole-chain bypass
  out: Out[];
}
// The kinds of widget a module UI can place. `label` draws text; every other kind
// binds to a param. `meter` is read-only.
export type WidgetType =
  | "label"
  | "knob"
  | "slider"
  | "fader"
  | "number"
  | "toggle"
  | "button"
  | "meter"
  | "tabs"
  | "waveform"
  | "dropdown";

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
  bind?: string; // everything but label/tabs/waveform: the param name
  min?: number; // knob | slider | number
  max?: number;
  step?: number;
  curve?: "lin" | "log";
  pages?: Record<string, Record<string, Widget>>; // tabs only: named pages of sub-widgets
  source?: "input" | "output"; // waveform only: which audio tap to display
  // dropdown only: a discrete param's named settings…
  options?: { label: string; value: number }[];
  // …or the library folder its choices are listed from ("ir"), in which case `bind`
  // names a field of the MODULE rather than a plugin param. See #Widget.
  library?: string;
}
// A module's UI: widgets on a grid, keyed by a stable id (the override key).
export interface ModuleUI {
  cols: number;
  rows: number;
  widgets: Record<string, Widget>;
}

// One rack sound triggered by a MIDI note. In a "samples" rack it names its own
// `clip`; in a "slice" rack it's a [from, to) window (seconds) into the rack's shared
// `source`. See #Rack.
export interface RackSound {
  note: number; // MIDI note 0..127 the sound maps to
  clip?: string; // samples: a clips/<id> id (resolved to an absolute path for the engine)
  from?: number; // slice: window start in the source, seconds
  to?: number; // slice: window end in the source, seconds
}
export type RackType = "samples" | "slice";
// A rack: how a set of symbols (e.g. "BD", "HH") get their audio. `samples` gives each
// symbol its own clip; `slice` cuts every symbol out of one `source` clip. A
// `type: "rack"` module carries one; the engine projects it to a SamplerPlugin.
export interface Rack {
  rackType: RackType;
  source?: string; // slice: the clip id every symbol slices from
  symbols: Record<string, RackSound>;
}

// The kind of instrument a module is. `plugin` (the default) instantiates a plugin via
// `plugin.type`; `rack` is a note->clip sampler carrying a `rack` map. This is the
// AUTHORED discriminator — distinct from the folder-derived `Module.kind` and from
// `plugin.type` (the xmlTypeName).
export type InstrumentType = "plugin" | "rack";

// A module: a plugin (or io, or a rack) plus params, and an optional `extends` naming
// another module whose defaults it inherits. `kind` + `inputs` are derived from its type
// folder (see MODULE_TYPES); the rest is authored.
export interface Module {
  extends?: string; // the module this inherits from ("type/name" | "@ns/type/name"); "" when none
  kind: ModuleKind; // from the type folder — "plugin", "io", or "doc" (a note; see docModule.ts)
  io?: string; // io modules only: "out" (sink) | "in" (live source)
  plugin?: RawPlugin; // a plugin definition (plugin.type = xmlTypeName / cache id)
  type?: InstrumentType; // "plugin" (default) | "rack"
  // Numbers, except the file-valued ones (moduleTypes.FILE_PARAMS), which name a file in the
  // module's assets/ — see moduleSchema. The wire stays numeric (nodeProject.numericParams).
  params?: Record<string, number | string>;
  // Only usable on an input that is already a FILE — see docs/coldModules.md and isColdModule.
  cold?: boolean;
  // Which named BASE this module starts from — `base/<name>.vstpreset` in its own folder or an
  // ancestor's, the opaque state UNDER `params:`. A field rather than a param because a preset is
  // loaded when the plugin is BUILT; the params above are applied over it and still win.
  // See docs/userPresets.md.
  base?: string;
  ui?: ModuleUI;
  // What this module LOADS, when it is a rack: its symbols, their notes and their material, with
  // the `extends` base already merged in. Absent for a plugin. Beside `ui` and `cc` because it is
  // the same kind of fact — what the module is, rather than how it is wired.
  rack?: Rack;
  // Which MIDI CC plays which param, from the `controller.yaml` in the module's folder. Keyed by the
  // widget's `bind` string verbatim, so the map and the panel read side by side (controller.ts).
  cc?: ControllerFile;
  inputs: InputDef[]; // typed input ports from the type folder (empty == unconstrained)
  // …and its output ports. Carried beside `emits` rather than derived from it: `emits` is one
  // word for the cable's colour, a port is a PLACE something plugs into, and a module may offer
  // several. The graph draws a jack each.
  outputs: OutputDef[];
  // The module's TYPE FOLDER — io | instruments | audio | transformers | midi |
  // video_effects | video_transitions. The one thing that says what KIND of module
  // this is; `emits` is derived from it but throws the distinction away (an instrument
  // and an audio effect both emit audio), so the graph needs the folder itself to pick
  // an icon. Absent on a module read from a map that didn't record it.
  category?: string;
  // The ABSOLUTE folder this module's files live in, whichever library that is — stamped by the
  // loader. Carried so a consumer can ask what a module's `assets/` holds without re-reading the
  // libraries to find out where it is; `moduleAssetChoices` walks the ancestry off these.
  folderAbs?: string;
  // What this module EMITS — the signal on the cable leaving it (see moduleEmits).
  // NOT derivable from `inputs`: an instrument and a midi transformer both take midi,
  // but one hands back audio and the other midi. Undefined for a sink.
  emits?: "audio" | "midi" | "video";
  // The file a file-valued param names, resolved to an ABSOLUTE path for the engine (or
  // undefined when the module's assets/ doesn't hold it, which validate() reports).
  nam?: string;
  // …and what the module SAYS, per param: the short assets-relative name, which is what the
  // module editor shows as the current choice. The two disagreeing is how a dangling
  // reference is spotted.
  assets?: Record<string, string>;
  // io: "file" only — the audio file this source reads, project-relative. Absent in a chain
  // TEMPLATE, where the input is generic and whoever applies it supplies the audio.
  source?: string;
  // io: "in" modules only — a live interface input. Which TRACK it feeds is not here:
  // it is the track of the chain the module sits in. `channel` is as DECLARED (a
  // preferences label stays a label): this doc describes the song, not the rig it runs
  // on. nodeProject resolves it to physical channels for the engine.
  channel?: string | number[];
  monitor?: "off" | "auto" | "on";
  // A NOTE's text, on a doc module — multiline, drawn as written on the node itself.
  //
  // It replaced `docs` and `todos`, which any module could carry and only the Docs panel could
  // show. That panel is gone: a note about a module now sits IN the graph, wired from what it
  // is about, so it is read where you are already looking rather than in a list of everybody's
  // notes. Absent when unset; no engine meaning, and a doc module never reaches the engine at
  // all. See docs/docModules.md.
  content?: string;
  // Automation bindings: which curve (by id, from curves/) drives which param on this
  // module. Carried through for the web graph, which draws each as a curve node
  // arrowing into the module. No engine meaning yet (the first automation slice is the
  // model + its picture). Absent when the module automates nothing.
  automations?: Automation[];
  /**
   * The module's other attribute SETS, in order, and which one is ON.
   *
   * Carried AFTER the merge, deliberately: the fields above are already the chosen set, and
   * these say what could be chosen instead. A surface draws the list from them and needs no
   * second read of the file. Absent when the module has only its own — which is every module
   * until somebody adds one, so no node grows a menu it has nothing to put in.
   */
  alternatives?: string[];
  alternative?: string;
  /**
   * The render standing in for everything upstream of this module, itself included — a
   * project-relative path, absent unless the module is a freeze point.
   *
   * Carried on the model rather than read off the file by each caller, because three of them ask:
   * the compiler (which lanes fall silent), the graph doc (which nodes wear the badge), and the
   * command (is this a freeze or a thaw). See docs/freeze.md.
   */
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
  // The tracks the song actually plays. A DISABLED track is absent, and so is any chain
  // sourced from one (see buildGraph) — the graph shows what runs, matching the timeline
  // and the compiled doc the engine gets.
  tracks: Record<string, Track>;
  // Video tracks (video_tracks/<id>.yaml), kept SEPARATE from `tracks` rather than mixed
  // in: nearly everything that reads `tracks` is audio logic (groups, placements, the
  // mixer, chain input typing), and a video lane satisfies none of it. They are here so
  // the graph and the timeline can show them, and so a chain sourced from one resolves
  // instead of reading as a dangling reference.
  videoTracks: Record<string, VideoTrack>;
  // The ids left out for being disabled. Kept so validate() can tell "you disabled this"
  // from "this doesn't exist", which read identically once the track is gone from
  // `tracks` — a group listing a disabled member is fine, a group listing a typo is not.
  disabledTracks: string[];
  // Modules keyed by BARE NAME — what chains reference (use / out). The io sink "OUT"
  // is a module here too.
  modules: Record<string, Module>;
  // The same modules keyed by REF ("type/name", "@ns/type/name", bare io name) — the
  // `extends` vocabulary. Resolved like `modules`: what a consumer reads off either map
  // is what the module RUNS with, ancestry already folded in (see moduleResolve.ts).
  moduleRefs: Record<string, Module>;
  // graph.yaml's `positions:`, verbatim — where somebody pinned a node on the graph.
  // Nothing about the SIGNAL reads it; it rides through to the renderer, whose layout
  // places only the nodes that have no entry here.
  positions?: Record<string, { x: number; y: number }>;
  warnings: string[];
}

// The chains, derived from the file's segments (see chainsGraph.ts). Re-exported under
// the name every consumer already calls, because what they get back is unchanged: the
// chains keyed by name. Only where the names and the runs COME FROM has moved.
export const parseChains = deriveChains;

// A port's signal, defaulting to audio — which is what a port with no readable type is, and what
// the overwhelming majority of them are anyway. `video` is spelled out: MODULE_TYPES gives a
// video_effects module a video input, and folding that onto audio would have made the positional
// type check reject a video chain for feeding picture into a picture module.
const portSignal = (t: unknown): "audio" | "midi" | "video" =>
  t === "midi" ? "midi" : t === "video" ? "video" : "audio";

// Normalize a module's declared input ports (from its type folder). Absent/empty ==
// unconstrained.
function normalizeInputs(raw: unknown): InputDef[] {
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
function normalizeOutputs(raw: unknown): OutputDef[] {
  if (!Array.isArray(raw)) return [];
  return (raw as { name?: unknown; type?: unknown }[]).map(
    (o): OutputDef => ({
      name: String(o?.name ?? ""),
      type: portSignal(o?.type),
    }),
  );
}

// The signal type a track carries. A declared contentType settles it ("sequences"
// == midi) — which is every strudel lane, since that arm always has one; otherwise
// fall back to reading the clips' content: 'midi' if every placement refers to a
// sequence, 'audio' if every one is a clip; undefined when empty, mixed, or
// referencing something unresolved (caller then skips the check).
// A group carries no signal of its own, so it's never a chain source.
//
// It used to sniff the lane's clips when `contentType:` was absent, and could answer "can't say"
// three different ways. A lane's signal is its module's output port now, so there is nothing left
// to guess: `@studio/sequence-track` carries midi because that is what it IS.
function trackType(lane: Lane | undefined): "audio" | "midi" | undefined {
  if (!lane || lane.type === "group") return undefined;
  return lane.contentType === "sequences" ? "midi" : "audio";
}

// The type a chain-input source id resolves to, or undefined when unknowable
// (a chain / another module's output — we don't infer types through the graph).
//
// A VIDEO track carries picture, so it types as "video" — which is what lets a chain
// run one through video_effects to VIDEO_OUT and be checked like any other. Without it
// a video source typed as nothing and the whole video-chain half of the model
// (video_effects / video_transitions / VIDEO_OUT / VideoPluginDoc) had no way to be
// reached from a real song.
function sourceType(
  id: string,
  lanes: Record<string, Lane>,
  clips: Record<string, RawClip>,
  seqs: Record<string, RawSequence>,
  videoTracks?: Record<string, RawVideoTrack>,
): "audio" | "midi" | "video" | undefined {
  if (seqs?.[id]) return "midi";
  if (clips?.[id])
    return isVideoSource(String(clips[id]?.source ?? "")) ? "video" : "audio";
  if (lanes?.[id]) return trackType(lanes[id]);
  if (videoTracks?.[id]) return "video";
  return undefined;
}

// Validate that every chain feeds each module the input ports its type folder
// declares. Ports are filled in order: the chain flow (the previous step's output,
// or `from` for the first step, or the summed sends of a routed-into bus) fills the
// first port; a step's `in:` sources fill the rest. A module that declares no
// ports is unconstrained and skipped. Returns human-readable errors — callers
// treat a non-empty result as fatal, so reading a mis-wired project fails.
export function checkChainInputs(
  // Already parsed and keyed by resolved name (see parseChains) — not the raw export.
  parsed: Record<string, Chain>,
  modules: Record<string, LoadedModule>,
  lanes: Record<string, Lane>,
  clips: Record<string, RawClip>,
  seqs: Record<string, RawSequence>,
  // Video tracks (video_tracks/<id>.yaml). A chain may be sourced from one — that is
  // what a VIDEO chain is — and it types as "video", so the port check below rejects
  // feeding picture into an audio module (and vice versa) instead of waving it through.
  videoTracks: Record<string, RawVideoTrack> = {},
): string[] {
  const errs: string[] = [];

  // Chains that receive a signal from upstream routing (another chain's `out`),
  // so their first module has an incoming flow even without a `from`.
  const routedInto = new Set<string>();
  for (const c of Object.values(parsed))
    for (const o of c.out) routedInto.add(o.to);

  for (const [chainName, c] of Object.entries(parsed)) {
    if (isParked(c)) continue; // placed, not wired yet — nothing to check the ports of
    // A group holds no material, so it carries no signal to process — and it is not
    // a lane the engine plays, so the compiler would drop this chain's plugins on
    // the floor without a word. Fatal here rather than silent there. (Before strudel
    // lanes were declarable, wiring a chain to a pattern's group was the obvious
    // thing to try; it did nothing. Name the lane instead.)
    if (c.from && lanes?.[c.from]?.type === "group")
      errs.push(
        `chain '${chainName}': from '${c.from}' is a group — groups carry no signal; name a member track`,
      );

    const steps = c.use;
    steps.forEach((step, idx) => {
      if (step?.enabled === false) return; // a bypassed step passes signal through untouched
      const module = modules?.[step?.module];
      if (!module) return; // a missing module is reported by validate()
      const inputs = normalizeInputs(module.inputs);
      if (!inputs.length) return; // opts out of input checking

      // Sources feeding this step, in port order, each with its resolved type (or
      // undefined when unknowable, then only counted). The flow is a `from` track
      // for a first step; a prior step's output or a bus's summed sends otherwise.
      const hasFlow =
        idx > 0 || (idx === 0 && (!!c.from || routedInto.has(chainName)));
      const sources: {
        id: string;
        type: "audio" | "midi" | "video" | undefined;
      }[] = [];
      if (hasFlow)
        sources.push(
          idx === 0 && c.from
            ? {
                id: String(c.from),
                type: sourceType(
                  String(c.from),
                  lanes,
                  clips,
                  seqs,
                  videoTracks,
                ),
              }
            : { id: "(flow)", type: undefined },
        );
      for (const s of Array.isArray(step.in) ? step.in : [])
        sources.push({
          id: String(s),
          type: sourceType(String(s), lanes, clips, seqs, videoTracks),
        });

      const where = `chain '${chainName}' step ${idx + 1} (module '${step.module}')`;
      const mandatory = inputs.filter((i) => i.mandatory).length;
      if (sources.length < mandatory)
        errs.push(
          `${where}: feeds ${sources.length} input(s) but ${mandatory} mandatory port(s) required`,
        );
      else if (sources.length > inputs.length)
        errs.push(
          `${where}: feeds ${sources.length} input(s) but the module has only ${inputs.length} port(s)`,
        );

      // Positional type check, where the source's type is knowable.
      inputs.forEach((inp, i) => {
        const src = sources[i];
        if (!src || src.type === undefined) return;
        if (src.type !== inp.type)
          errs.push(
            `${where}: port '${inp.name}' expects ${inp.type} but source '${src.id}' is ${src.type}`,
          );
      });
    });
  }
  return errs;
}

// --- assembly (pure; no fs) --------------------------------------------------

// A declared `input`, normalised but NOT resolved: a label stays a label. The schema
// already rejects anything else, so this only has to survive a hand-edit mid-save.
function normInput(v: unknown): string | number[] | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) {
    const ch = v.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    return ch.length ? ch : undefined;
  }
  const s = String(v);
  return s ? s : undefined;
}

function normMonitor(v: unknown): "off" | "auto" | "on" | undefined {
  return v === "off" || v === "auto" || v === "on" ? v : undefined;
}

// A module's `automations` list, coerced. Each entry needs a non-empty param + curve;
// anything else is dropped rather than carried as a half-binding. Undefined when the
// module lists none, so the field stays absent on the model.
function normAutomations(v: unknown): Automation[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Automation[] = [];
  for (const a of v as { param?: unknown; curve?: unknown }[]) {
    const param = typeof a?.param === "string" ? a.param : "";
    const curve = typeof a?.curve === "string" ? a.curve : "";
    if (param && curve) out.push({ param, curve });
  }
  return out.length ? out : undefined;
}

export function buildGraph(
  root: RawProjectRoot,
  chainsMap: unknown,
  clipsMap: Record<string, RawClip>,
  seqMap: Record<string, RawSequence>,
  modulesMap: Record<string, LoadedModule>,
  moduleRefsMap: Record<string, LoadedModule>,
  videoTracksMap: Record<string, RawVideoTrack> = {},
): GraphDoc {
  const ts = String(root?.project?.timeSignature ?? "4/4");
  const [num, den] = ts.split("/").map((n) => parseInt(n, 10));
  const pos = (tc: unknown) =>
    tc != null && tc !== "" ? parsePosition(String(tc), num || 4, den || 4) : 0;

  // The authored instrument type, if one of the known values (else undefined, so
  // effectiveType falls back to "plugin").
  const normType = (v: unknown): InstrumentType | undefined =>
    v === "rack" || v === "plugin" ? v : undefined;
  // One module normalizer for both the bare-name map (chain refs) and the ref map
  // (the `extends` vocabulary). It is handed a RESOLVED module — inheritance is already
  // settled — so every field here is a straight read. kind/inputs come off the type
  // folder (added by loadModules / readModuleTree); everything else is authored.
  const toModule = (b: ResolvedModule): Module => ({
    extends: b?.extends ? String(b.extends) : undefined,
    // Four now: a `doc` is neither an engine plugin nor an edge of the signal, and a `track` is a
    // lane. Read straight rather than folded to "not io means plugin", which is what made a note
    // compile as one.
    kind:
      b?.kind === "io" || b?.kind === "doc" || b?.kind === "track"
        ? b.kind
        : "plugin",
    io: b?.io ? String(b.io) : undefined,
    plugin: b?.plugin,
    type: normType(b?.type),
    params: b?.params ?? {},
    // Inherited like `plugin`, so a use of a cold module is cold and nothing has to restate it.
    cold: b?.cold === true ? true : undefined,
    ui: resolvedUI(b),
    // Stamped on by the loader from the folder's file; re-validated here because a map read off a
    // module map (a cached doc) has not been through the schema.
    cc: resolvedCc(b),
    inputs: normalizeInputs(b?.inputs),
    outputs: normalizeOutputs(b?.outputs),
    // `category` is the type FOLDER, added by loadModules — the only thing that says
    // whether a midi-input module gives back audio (an instrument) or midi (a
    // transformer). Kept AND derived from: the graph draws an icon per folder, which
    // `emits` alone can't tell apart.
    category: b?.category ? String(b.category) : undefined,
    folderAbs: typeof b?.folderAbs === "string" ? b.folderAbs : undefined,
    emits: moduleEmits(b?.category, b?.io, normalizeOutputs(b?.outputs)),
    // Both halves of every file-valued param: the absolute path the engine loads, and the
    // name it was authored with. validate() needs the pair — a name with no path is a file
    // the module's assets/ doesn't hold.
    nam: b?.nam,
    assets: b?.assets,
    source: typeof b?.source === "string" && b.source ? b.source : undefined,
    channel: normInput(b?.channel),
    monitor: normMonitor(b?.monitor),
    // A NOTE's text, on a doc module. It replaced `docs`/`todos`, which every module could
    // carry and only a bottom panel could show; this one is drawn on the node itself.
    content: typeof b?.content === "string" ? b.content : undefined,
    // The RACK this module is, if it is one — its symbols, notes and material, `extends` already
    // folded in by `resolvedRack`. Resolved here beside `ui` and `cc` and for the same reason:
    // what a module IS belongs to the model, and a surface drawing a pad per sound should not
    // have to re-run the merge to find out what it loads. Absent for a plugin, which is most.
    rack: resolvedType(b) === "rack" ? resolvedRack(b) : undefined,
    // The render this module is frozen to, if it is. A path, so an empty string is no freeze.
    frozen: typeof b?.frozen === "string" && b.frozen ? b.frozen : undefined,
    automations: normAutomations(b?.automations),
    // Only when there is a CHOICE: one entry is the module's own fields, which is not a menu.
    ...(() => {
      const all = alternativesOf(b);
      if (all.length < 2) return {};
      return {
        alternatives: all.map((a) => a.name),
        alternative: all[currentAlternative(b)].name,
      };
    })(),
  });

  // Video lanes, as the graph/timeline read them. No `disabled` counterpart: a video
  // track is switched off with `mute` (== hidden), and every one has to be listed in
  // project.layers, so there is no "left out" state to model.
  const videoTracks: Record<string, VideoTrack> = {};
  for (const [id, t] of Object.entries(videoTracksMap ?? {}))
    videoTracks[id] = {
      name: String(t?.name ?? id),
      color: t?.color ? String(t.color) : undefined,
      kind: t?.kind === "shape" ? "shape" : "video",
      mute: !!t?.mute,
    };

  // Resolve ONCE, here: every `extends` chain is folded in before anything reads a
  // module, so no consumer downstream has to know inheritance exists. The `extends`
  // vocabulary is the ref map either way — a local module extends a ref, never a name.
  const refsRaw = moduleRefsMap ?? {};
  const resolved: Record<string, ResolvedModule> = {};
  for (const [name, b] of Object.entries(modulesMap ?? {}))
    resolved[name] = resolveModule(b, refsRaw);

  const modules: Record<string, Module> = {};
  for (const [name, b] of Object.entries(resolved)) modules[name] = toModule(b);

  const moduleRefs: Record<string, Module> = {};
  for (const [ref, b] of Object.entries(resolveModuleMap(refsRaw)))
    moduleRefs[ref] = toModule(b);

  // --- the LANES ---------------------------------------------------------------
  //
  // Read off the resolved modules, because that is where they live now: a lane is a node of
  // one of the five `@studio/…-track` modules, and `kind` is what says so. Nothing here reads a
  // `tracks/` folder — there isn't one. See docs/trackModules.md.
  //
  // The projection is deliberately unchanged in SHAPE: `Track` is what the compiler, the wire and
  // the engine already speak, and re-plumbing all three is a different change from this one.
  const lanes = lanesOf(resolved);

  // Silenced lanes, from the ONE place a bypass is written. A lane carries no `mute:` of its own,
  // so there is no second copy to fall out of step with the button that toggles it.
  const bypassed = bypassedOf(chainsMap);

  // A DISABLED lane is ignored everywhere: the engine never sees it (nodeProject filters it out of
  // the compiled doc) and the timeline draws nothing for it. The graph follows — it is a picture of
  // what the song actually does, and a lane that plays nothing routing through a chain that runs
  // nothing is a lie in the shape of a diagram. So the lane is dropped here and every chain SOURCED
  // from it goes with it (below); the file stays on disk, ready to be re-enabled.
  const disabledTracks = new Set(
    Object.entries(lanes)
      .filter(([, l]) => l.disabled)
      .map(([name]) => name),
  );

  const tracks: Record<string, Track> = {};
  for (const [name, lane] of Object.entries(lanes)) {
    if (disabledTracks.has(name)) continue;
    tracks[name] = {
      name,
      type: lane.type,
      color: lane.color,
      contentType: lane.contentType,
      mute: bypassed.has(name),
      // Derived by the surface, never written. See the note on Track.solo.
      solo: false,
      placements: lane.events.map(
        (p): Placement => ({
          ref: String(p.ref ?? ""),
          start: pos(p.start),
          loop: Math.max(1, Math.floor(Number(p.loop ?? 1)) || 1),
          kind: clipsMap[String(p.ref)]
            ? "audio"
            : seqMap[String(p.ref)]
              ? "midi"
              : "missing",
        }),
      ),
      tracks: lane.tracks,
      strudel: lane.strudel,
    };
  }

  // Chains, minus the ones a disabled lane feeds. Only a chain sourced DIRECTLY from such a lane is
  // dropped: a bus is routed into by `out` from several chains, so disabling one source must not
  // take the shared reverb down with it — and a bus has no `from` to test anyway. `from` naming a
  // lane that doesn't exist at all is a different thing and still warns (see validate).
  //
  // The derivation is told which nodes are lanes: with one `modules:` map, `melody` and `reverb`
  // are spelled alike and only what they extend tells them apart.
  const chains: Record<string, Chain> = {};
  const isLane = (n: string) => modules[n]?.kind === "track";
  for (const [name, chain] of Object.entries(parseChains(chainsMap, isLane))) {
    if (chain.from && disabledTracks.has(chain.from)) continue;
    chains[name] = chain;
  }

  const g: GraphDoc = {
    project: {
      name: String(root.project?.name ?? "untitled"),
      tempo: Number(root.project?.tempo ?? 120),
      sampleRate: Number(root.project?.sampleRate ?? 48000),
      timeSignature: String(root.project?.timeSignature ?? "4/4"),
    },
    chains,
    tracks,
    videoTracks,
    disabledTracks: [...disabledTracks].sort(),
    modules,
    moduleRefs,
    ...(positionsOf(chainsMap) ? { positions: positionsOf(chainsMap) } : {}),
    warnings: [],
  };
  g.warnings = validate(g);
  return g;
}

// The pins, read defensively: `chainsMap` may be the inline `root.chains`, which no schema saw.
function positionsOf(
  chainsMap: unknown,
): Record<string, { x: number; y: number }> | undefined {
  const p = (chainsMap as { positions?: unknown })?.positions;
  if (!p || typeof p !== "object") return undefined;
  const out: Record<string, { x: number; y: number }> = {};
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
    const at = v as { x?: unknown; y?: unknown };
    if (typeof at?.x === "number" && typeof at?.y === "number")
      out[k] = { x: at.x, y: at.y };
  }
  return Object.keys(out).length ? out : undefined;
}

// Is `id` a sink: an io module the signal ENDS at (like OUT). Chains route to it by
// name. An io module is a sink unless it declares itself a SOURCE — routing a chain to
// an input is meaningless, so the source roles are excluded here rather than silently
// accepted as a destination. The list is moduleTypes.IO_SOURCES, read and not restated:
// a role missing from it would become a sink by elimination, silently.
const isSink = (g: GraphDoc, id: string): boolean => {
  // "OUT" is the built-in main output: nodeProject's isSink() takes the name literally,
  // so a project needs no modules/io/OUT folder for it to work — and every demo song
  // relies on that. Requiring the folder here made all four of them warn that the OUT
  // ending each of their chains "is not a chain or io sink".
  if (id === "OUT") return true;
  const m = g.modules[id];
  if (!m) return false;
  // A NOTE ends a run too, and legitimately: a doc module takes one input and gives nothing
  // back, so a chain routed to it terminates there exactly as it does at an output. Without
  // this the graph reports every wired note as "not a chain or io sink" — which is a warning
  // about a comment, on a project that is correct. It is a sink by SHAPE rather than by role,
  // which is why it is asked here and not folded into the io test below.
  if (m.kind === "doc") return true;
  return m.kind === "io" && !isIoSource(m.io);
};
/**
 * The other io edge: a LIVE interface source (io: "in").
 *
 * Deliberately narrower than "is a source". Everything this gates is about a physical input
 * — which track it lands on, whether you monitor it, its trim, whether the rig has a channel
 * by that name, the tuner — and none of it means anything for a file. A file source is
 * `isFileInputModule` below; both emit audio, and that is all they share.
 */
export const isInputModule = (_g: GraphDoc, b: Module): boolean =>
  b.kind === "io" && b.io === "in";
/** …and the file source (io: "file"), which reads audio off disk. See docs/fileInput.md. */
export const isFileInputModule = (b: Module): boolean =>
  b.kind === "io" && b.io === "file";
/**
 * The " — did you mean …" tail for a name that missed, when the last `/` should have been
 * the node separator: `@engine/io/IN/in-2` for `@engine/io/IN:in-2`.
 *
 * A node is a `<name>.yaml` BESIDE a module.yaml, not a folder inside it, so the ref
 * of one is the module's ref with `:node` — and the two spellings look identical to
 * anyone reading the folder on disk. Worth a hint rather than a second guess at the docs:
 * "is not a module" is true and useless, and the whole difference is one character.
 */
function nodeHint(g: GraphDoc, name: string): string {
  const cut = name.lastIndexOf("/");
  if (cut < 0) return "";
  const asNode = `${name.slice(0, cut)}${NODE_SEP}${name.slice(cut + 1)}`;
  return g.modules[asNode] || g.moduleRefs[asNode]
    ? ` — did you mean '${asNode}'? a node is named with '${NODE_SEP}', not '/'`
    : "";
}

/**
 * The chain a module RUNS INSIDE, when it is a step rather than a meeting point of its own.
 *
 * This is what a port destination lands on. `deckB: [ crossfade#b ]` reaches a module that is a
 * STEP of deckA's run — deriveChains deliberately does not let a side input absorb its target —
 * so there is no chain called `crossfade` to look up, and every walk over `out` edges needs the
 * run that contains it instead. Absorption gives a module at most one host.
 */
function chainHosting(g: GraphDoc, node: string): string | undefined {
  for (const [name, c] of Object.entries(g.chains))
    if (c.use.some((s) => s.module === node)) return name;
  return undefined;
}

/**
 * The chain a destination continues in: itself when it names one, otherwise the run hosting the
 * module it lands on. Undefined for a sink or a dangling name — the callers test those.
 */
function chainAt(g: GraphDoc, to: string): string | undefined {
  const { node } = splitPort(to);
  return g.chains[node] ? node : chainHosting(g, node);
}

// A destination the signal can legitimately arrive at. The PORT is stripped first: `crossfade#b`
// is the crossfade, on one of its jacks, and every question below is about the module.
const isNode = (g: GraphDoc, id: string): boolean => {
  const { node } = splitPort(id);
  return !!g.chains[node] || isSink(g, node) || !!chainHosting(g, node);
};
/** Does this chain carry a live interface input? */
const carriesInput = (g: GraphDoc, c: Chain): boolean =>
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

/**
 * Why `module` may not be added after `at`, or null when it may.
 *
 * THE one place the cold rule is decided. Every surface that can add a module to a chain calls
 * this — the commands, and whatever the chain views wire to them — because a rule enforced in
 * two places is a rule that will be enforced differently in one of them.
 *
 * The rule: a cold module's chain must draw its signal from a FILE. Not merely "not live" — a
 * file specifically, since that is the only source whose whole length is knowable before
 * playback. `at` is the node it is being placed after; the chain is the run that hosts it.
 *
 * Takes the MODULE rather than its name because the commands ask before creating anything: the
 * coldness is a fact about the thing being placed (or about what it extends), knowable while
 * nothing has been written yet, which is what lets a refusal leave no folder behind.
 *
 * Placing a module wired to NOTHING (`at` undefined) is allowed: there is no input yet to be
 * wrong about, and the refusal comes when it is wired to something. Refusing earlier would mean
 * refusing to write a module you are about to give a file to.
 */
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

/**
 * The track a chain's live input lands on: the run's own source track when the input is a step ON it, else the
 * TRACK its run ends at.
 *
 * The second form is what `"@engine/io/IN:in-2": [ ge.rythm ]` says, and it is the one that reads correctly —
 * signal comes FROM an input, INTO a lane. The first is what the old chain-list format could express, where a
 * chain named its track up front and the input was a node inside it; both still work, because both are still
 * written.
 */
export function inputLandingTrack(
  c: Chain,
  isTrack: (id: string) => boolean,
): string {
  if (c.from) return c.from;
  return c.out.map((o) => o.to).find(isTrack) ?? "";
}

// `frozenRender` was here. Freezing is gone with the `frozen:` field, to be replaced by another
// mechanism later — see docs/trackModules.md.

export function validate(g: GraphDoc): string[] {
  const w: string[] = [];
  // Tracks that exist on disk but were left out of `g.tracks` for being disabled. A
  // lookup miss below means "absent", which covers both — these tell the two apart.
  const disabled = new Set(g.disabledTracks);

  for (const [name, c] of Object.entries(g.chains)) {
    // `from` may name a track or ANOTHER chain — never this one. Excluding self isn't
    // pedantry now that a chain takes its name from its source track: an unnamed chain
    // is called exactly what its `from` says, so `g.chains[c.from]` finds ITSELF and a
    // dangling source would look perfectly resolved.
    // A VIDEO track is a legitimate source too — that is what a video chain is sourced
    // from (through video_effects, out to VIDEO_OUT). Leaving it out read as a typo.
    if (
      c.from &&
      !g.tracks[c.from] &&
      !g.videoTracks[c.from] &&
      !(c.from !== name && g.chains[c.from])
    )
      w.push(`chain '${name}': from '${c.from}' is not a track or chain`);
    for (const s of c.use) {
      const module = g.modules[s.module];
      if (!module)
        w.push(
          `chain '${name}': step module '${s.module}' is not a module or module node` +
            nodeHint(g, s.module),
        );
      else if (module.extends && !g.moduleRefs[module.extends])
        w.push(
          `chain '${name}': module '${s.module}' extends unknown module '${module.extends}'`,
        );
    }
    for (const o of c.out) {
      // A destination may name a PORT (`crossfade#b`); everything asked here is about the module
      // it lands on, so the jack comes off first. Only the last `#` is the port, so a node
      // or a namespace in the same ref is left alone (see splitPort).
      const { node: to } = splitPort(o.to);
      const target = g.modules[to];
      // Routing INTO a live input is meaningless — it is where signal COMES FROM. Checked
      // ahead of isNode, which now says yes: a module the signal stops at starts a chain
      // of its own, so an input at the end of a run resolves perfectly and does nothing.
      if (target && isInputModule(g, target))
        w.push(
          `chain '${name}': out '${o.to}' is a live input — signal comes FROM it, not to it`,
        );
      // A destination naming a TRACK is where a live input's signal arrives. Nothing else
      // may land on a lane: a track's material is its clips, so an ordinary module aimed
      // at one is silently discarded — which is exactly what a warning is for.
      else if (g.tracks[to] || disabled.has(to)) {
        if (!carriesInput(g, c))
          w.push(
            `chain '${name}': out '${o.to}' is a track — only a live input's signal lands on a lane`,
          );
      } else if (!isNode(g, o.to))
        w.push(`chain '${name}': out '${o.to}' is not a chain or io sink`);
      if (o.gain < 0)
        w.push(`chain '${name}': out '${o.to}' has a negative gain`);
      // …and which output it LEFT from. Asked here because it was asked nowhere: a wrong
      // destination port throws in checkChainInputs, while `sep#vocls` used to route silently
      // — the derivation dropped the typo and the cable landed on the module's first jack.
      // The source is the run's last module; a track has no jacks to name.
      if (o.fromPort) {
        const src = c.use.length ? c.use[c.use.length - 1].module : c.from;
        const srcModule = src ? g.modules[src] : undefined;
        if (srcModule && !srcModule.outputs.some((p) => p.name === o.fromPort))
          w.push(
            `chain '${name}': out '${o.to}' leaves '${src}' through '${o.fromPort}', which is ` +
              `not one of its outputs (${srcModule.outputs.map((p) => p.name).join(", ") || "none"})`,
          );
      }
    }
    if (!c.out.length && !isParked(c))
      w.push(`chain '${name}': has no out (dead end)`);
  }

  for (const [id, t] of Object.entries(g.tracks))
    for (const p of t.placements)
      if (p.kind === "missing")
        w.push(`track '${id}': clip/sequence '${p.ref}' not found`);

  // A module naming a file its own assets/ doesn't hold. The loader resolves each to an
  // absolute path and leaves it undefined when it can't, keeping the authored name in
  // `assets` — so the two disagreeing IS the report. Silently loading nothing would sound
  // like an amp that isn't there: quiet, and unexplained.
  for (const [name, b] of Object.entries(g.modules))
    for (const [param, ref] of Object.entries(b.assets ?? {}))
      if (!(b as unknown as Record<string, unknown>)[param])
        w.push(
          `module '${name}': ${param} '${ref}' is not in this module's assets/`,
        );

  // Live-input modules. Whether the channel EXISTS is a machine question — see
  // checkInputLabels(), called from loadGraph — but everything here is answerable
  // from the song alone.
  // An input is wired by the RUN it sits in — its source track, or the track the run ends
  // at — so these go over the chains, not over the modules. See inputLandingTrack.
  const fedBy = new Map<string, string>();
  for (const [chainName, c] of Object.entries(g.chains)) {
    if (isParked(c)) continue; // an input dropped in but not wired yet lands nowhere, by design
    for (const s of c.use) {
      const b = g.modules[s.module];
      if (!b || !isInputModule(g, b)) continue;
      if (b.channel == null)
        w.push(`input '${s.module}': no channel — it feeds nothing`);
      const track = inputLandingTrack(
        c,
        (id) => !!g.tracks[id] || disabled.has(id),
      );
      if (!track) {
        w.push(
          `input '${s.module}': chain '${chainName}' reaches no track — an input's signal has to land on one`,
        );
        continue;
      }
      const target = g.tracks[track];
      if (!target)
        // Disabled reads as absent here, so say which it is: "not found" sends the reader
        // hunting for a typo in a file that's sitting right there, only switched off.
        w.push(
          disabled.has(track)
            ? `input '${s.module}': track '${track}' is disabled — it records nothing`
            : `input '${s.module}': track '${track}' not found`,
        );
      else if (target.type === "group")
        w.push(
          `input '${s.module}': track '${track}' is a group — it holds no material`,
        );
      else if (target.type === "strudel")
        w.push(
          `input '${s.module}': track '${track}' is a strudel lane — its pattern is the source`,
        );
      else if (target.contentType === "sequences")
        w.push(
          `input '${s.module}': track '${track}' is a sequences track — an interface input carries audio`,
        );
      // The engine assigns ONE input per track: a second would silently replace the
      // first, so name both rather than let the last one loaded win.
      const prev = fedBy.get(track);
      if (prev)
        w.push(
          `track '${track}': fed by two inputs ('${prev}', '${s.module}') — only one can win`,
        );
      else fedBy.set(track, s.module);
    }
  }
  // `channel` anywhere else is silently ignored, which looks like it took effect.
  for (const [name, b] of Object.entries(g.modules))
    if (!isInputModule(g, b) && b.channel != null)
      w.push(
        `module '${name}': channel is for an io "in" module, but '${name}' is not one`,
      );

  // Group membership: a member must exist, must not be the group itself, and must
  // belong to only one group (the flat model gives each track a single parent).
  const claimed = new Map<string, string>();
  for (const [id, t] of Object.entries(g.tracks)) {
    if (t.type !== "group") continue;
    for (const m of t.tracks) {
      if (m === id) w.push(`group '${id}': contains itself`);
      // A disabled member is deliberate, not a mistake — the group simply has one fewer
      // track for now. Only a member that exists nowhere is worth a warning.
      else if (!g.tracks[m] && !disabled.has(m))
        w.push(`group '${id}': track '${m}' not found`);
      const owner = claimed.get(m);
      if (owner) w.push(`track '${m}': in two groups ('${owner}', '${id}')`);
      else claimed.set(m, id);
    }
  }

  // Every source chain (has a track input) should reach a sink.
  for (const [name, c] of Object.entries(g.chains))
    if (c.from && !reachesSink(g, name, new Set()))
      w.push(`chain '${name}': nothing reaches OUT`);

  // Cycle check over chain→chain edges.
  for (const name of Object.keys(g.chains))
    if (hasCycle(g, name, new Set(), new Set())) {
      w.push(`chain '${name}': is part of a cycle`);
      break;
    }

  return w;
}

function reachesSink(g: GraphDoc, name: string, seen: Set<string>): boolean {
  if (seen.has(name)) return false;
  seen.add(name);
  const c = g.chains[name];
  if (!c) return false;
  return c.out.some((o) => {
    if (isSink(g, splitPort(o.to).node)) return true;
    // A side input lands on a step inside ANOTHER run, and the signal carries on in that run —
    // so the walk continues there. Without this, a deck wired to a crossfade's second port read
    // as a dead end, which is the one thing it demonstrably is not.
    const next = chainAt(g, o.to);
    return !!next && reachesSink(g, next, seen);
  });
}

function hasCycle(
  g: GraphDoc,
  name: string,
  stack: Set<string>,
  done: Set<string>,
): boolean {
  if (stack.has(name)) return true;
  if (done.has(name) || !g.chains[name]) return false;
  stack.add(name);
  const cycle = g.chains[name].out.some((o) => {
    // Through a port too: feeding a module inside a run is an edge to that run, and a loop drawn
    // with side inputs is exactly as unplayable as one drawn with bare ones.
    const next = chainAt(g, o.to);
    return !!next && hasCycle(g, next, stack, done);
  });
  stack.delete(name);
  done.add(name);
  return cycle;
}

// --- describe (pure) ---------------------------------------------------------

export function describeGraph(g: GraphDoc): string[] {
  const lines: string[] = [];
  // Roots are the chains fed by a track (source entries); intermediate plugin
  // nodes have `from` = another chain and are shown via downstream().
  const roots = Object.entries(g.chains).filter(
    ([, c]) => c.from && g.tracks[c.from],
  );

  // roots + every chain reachable downstream from them (so we don't re-list a
  // subbranch that already appears inside a root's trace).
  const reached = new Set<string>();
  const mark = (name: string) => {
    if (reached.has(name)) return;
    reached.add(name);
    for (const o of g.chains[name]?.out ?? []) if (g.chains[o.to]) mark(o.to);
  };
  for (const [name] of roots) mark(name);

  for (const [name, c] of roots) {
    let head = `${name}: ${trackDesc(g, c.from!)}`;
    const steps = stepsDesc(g, c);
    if (steps) head += ` -> ${steps}`;
    lines.push(head + downstream(g, c.out, new Set([name])));
  }
  // subbranch chains not reached from any root
  for (const [name, c] of Object.entries(g.chains))
    if (!reached.has(name))
      lines.push(
        `${name} (subbranch): ${stepsDesc(g, c) || name}${downstream(g, c.out, new Set([name]))}`,
      );

  return lines;
}

// Resolve a user-supplied track reference (id or display name, case-insensitive)
// to a track id, or undefined if none matches.
export function resolveTrack(g: GraphDoc, ref: string): string | undefined {
  if (g.tracks[ref]) return ref;
  const lc = ref.toLowerCase();
  for (const [id, t] of Object.entries(g.tracks))
    if (id.toLowerCase() === lc || t.name.toLowerCase() === lc) return id;
  return undefined;
}

// The chains related to one track: the chains it feeds (from === track), each
// traced downstream through its steps to the sink — a focused graph display.
export function describeTrackGraph(g: GraphDoc, trackId: string): string[] {
  const roots = Object.entries(g.chains).filter(([, c]) => c.from === trackId);
  if (!roots.length) return [`track '${trackId}' feeds no chains`];
  return roots.map(([name, c]) => {
    let head = `${name}: ${trackDesc(g, c.from!)}`;
    const steps = stepsDesc(g, c);
    if (steps) head += ` -> ${steps}`;
    return head + downstream(g, c.out, new Set([name]));
  });
}

function trackDesc(g: GraphDoc, from: string): string {
  const t = g.tracks[from];
  if (!t) return g.chains[from] ? `chain '${from}'` : `track '${from}'(?)`;
  const clips = t.placements
    .map((p) => `${p.ref}@${p.start}${p.kind === "missing" ? "(?)" : ""}`)
    .join(", ");
  return `${inputDesc(g, from)}track '${from}' [${clips}]`;
}

// How an io "in" module reads as a node: "in 'guitar'(ch 1) -> ". A live input is a
// real source in the graph, so it's drawn ahead of the track it feeds rather than
// hidden as a track attribute. Returns "" when nothing feeds this track.
function inputDesc(g: GraphDoc, trackId: string): string {
  const hit = inputsByTrack(g).get(trackId);
  return hit ? `${nodeDesc(hit[0], hit[1])} -> ` : "";
}

function nodeDesc(name: string, b: Module): string {
  const ch =
    b.channel == null
      ? "?"
      : Array.isArray(b.channel)
        ? b.channel.join("+")
        : `'${b.channel}'`;
  // "auto" is the default and says nothing; off/on are deliberate choices.
  const mon = b.monitor && b.monitor !== "auto" ? ` mon:${b.monitor}` : "";
  return `in '${name}'(ch ${ch}${mon})`;
}

// track id -> the [name, module] of the input feeding it, read off the chains: an input
// lands on the track of the chain it sits in. First one wins; validate() complains about
// a second.
function inputsByTrack(g: GraphDoc): Map<string, [string, Module]> {
  const m = new Map<string, [string, Module]>();
  for (const c of Object.values(g.chains)) {
    if (!c.from || m.has(c.from)) continue;
    for (const s of c.use) {
      const b = g.modules[s.module];
      if (!b || !isInputModule(g, b)) continue;
      m.set(c.from, [s.module, b]);
      break;
    }
  }
  return m;
}

// A chain's steps as "module -> module(bypassed) -> …". An io "in" step is left out: it
// is the chain's SOURCE, already drawn ahead of the track by inputDesc, and printing it
// again mid-path would read as a second thing in the signal's way.
function stepsDesc(g: GraphDoc, c: Chain): string {
  return c.use
    .filter((s) => !isInputModule(g, g.modules[s.module] ?? ({} as Module)))
    .map((s) => `${s.module}${s.enabled === false ? "(bypassed)" : ""}`)
    .join(" -> ");
}

// A gain suffix shown only when the signal is attenuated (a split/send), e.g.
// "@30%"; the full-signal case (gain 1) stays bare.
const gainTag = (gain: number): string =>
  gain === 1 ? "" : `@${Math.round(gain * 100)}%`;

function downstream(g: GraphDoc, out: Out[], seen: Set<string>): string {
  if (!out.length) return "";
  const parts = out.map((o) => {
    const tag = gainTag(o.gain);
    const { node, port } = splitPort(o.to);
    if (isSink(g, node)) return o.to + tag; // e.g. OUT
    if (seen.has(node)) return `${o.to}${tag}(cycle)`;
    // A port destination lands mid-run, so it is traced from the chain HOSTING that step — and
    // named by the jack rather than by the whole run, which is what the cable actually says.
    const next = chainAt(g, o.to);
    const c = next ? g.chains[next] : undefined;
    if (!c) return `${o.to}${tag}(?)`;
    const head = port ? o.to : stepsDesc(g, c) || node;
    return `${head + tag}${downstream(g, c.out, new Set([...seen, node]))}`;
  });
  return ` -> ${parts.join(" + ")}`;
}

// --- loader (fs) -------------------------------------------------------------

// Reads and writes nothing, and asks the module cache twice — one stamp walk covers the pair.
// See moduleCache.ts; the same wrapping is on compileNodeProject.
export function loadGraph(dir: string): GraphDoc {
  return withModuleStamp(dir, () => loadGraphIn(dir));
}

function loadGraphIn(dir: string): GraphDoc {
  const root = loadProjectRoot(dir, true); // the root file -> project, markers
  // graph.yaml when there is one — see loadChains. Read once and passed everywhere the
  // root's own `chains` used to be, so the two formats can't disagree within one load.
  const rootChains = loadChains(dir, root, true);
  const videoTracksMap = loadVideoTracks(dir, true);
  const clipsMap = exportSub(dir, "clips");
  const seqMap = exportSub(dir, "sequences");

  // modules/<type>/ keyed by bare name (chain refs); the same modules re-keyed by ref
  // (the `extends` vocabulary), plus any inherited via project.modules_from.
  const localModules = loadModules(dir, true); // enforced: a bad module fails the load
  const moduleRefsMap = loadModuleRefs(dir);
  // Which nodes are LANES has to be settled BEFORE the chains are derived — a run is named after
  // its lane, and with one `modules:` map only `extends` tells a lane from a reverb. So the local
  // modules are folded first, and the chains are told. The fold is pure and in memory; doing it
  // twice costs a walk over a few dozen structs and buys the derivation the one fact graph.yaml
  // no longer states.
  const localResolved = resolveModuleMap(localModules, moduleRefsMap);
  const lanes = lanesOf(localResolved);
  const parsedChains = parseChains(rootChains, (n) => n in lanes);
  // …and the shared modules the chains name by ref, so a step can use one directly.
  const modulesMap = withChainModuleRefs(
    localModules,
    moduleRefsMap,
    parsedChains,
  );

  // Module input wiring is a hard constraint: a mis-wired graph fails to read.
  const inputErrs = checkChainInputs(
    parsedChains,
    modulesMap,
    lanes,
    clipsMap,
    seqMap,
    videoTracksMap,
  );
  if (inputErrs.length)
    throw new Error(
      `module input wiring invalid:\n  - ${inputErrs.join("\n  - ")}`,
    );

  const g = buildGraph(
    root,
    rootChains ?? {},
    clipsMap,
    seqMap,
    modulesMap,
    moduleRefsMap,
    videoTracksMap,
  );
  g.warnings.push(...checkInputLabels(g));
  return g;
}

// Whether each input module's channel label exists on THIS machine. Kept out of
// validate() (which is pure) because the answer depends on ~/.studio, not the
// song: the same project warns here and not on the rig the labels were written for.
function checkInputLabels(g: GraphDoc): string[] {
  const w: string[] = [];
  let prefs: Preferences;
  try {
    prefs = loadPreferences();
  } catch {
    return w; // unreadable preferences shouldn't fail a load
  }
  for (const [name, b] of Object.entries(g.modules)) {
    if (!isInputModule(g, b) || b.channel == null) continue;
    const { unknownLabel } = resolveInput(b.channel, prefs);
    if (!unknownLabel) continue;
    const known = prefs.channels.in.map((c) => c.label).join(", ");
    w.push(
      `input '${name}': channel '${unknownLabel}' is not an input label in ~/.studio ` +
        `preferences — ${known ? `have: ${known}` : "none are defined"}`,
    );
  }
  return w;
}

// --- CLI ---------------------------------------------------------------------

function main(): void {
  // Positionals: <project> [trackname]. With a trackname, show only the chains
  // related to that track (a focused graph); otherwise the whole graph.
  const [projectArg, trackArg] = process.argv
    .slice(2)
    .filter((a) => !a.startsWith("-"));
  if (!projectArg) {
    console.error("usage: l8 graph <project> [trackname]");
    process.exit(2);
  }
  let g: GraphDoc;
  try {
    g = loadGraph(resolve(projectArg));
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    process.exit(1);
  }
  console.log(
    `${g.project.name}  (${g.project.tempo} bpm, ${g.project.timeSignature})`,
  );
  console.log(
    `  ${Object.keys(g.chains).length} chains · ${Object.keys(g.tracks).length} tracks · ` +
      `${Object.keys(g.modules).length} modules`,
  );
  console.log("");

  if (trackArg) {
    const id = resolveTrack(g, trackArg);
    if (!id) {
      console.error(
        `  no track matching '${trackArg}' (tracks: ${Object.keys(g.tracks).join(", ") || "none"})`,
      );
      process.exit(1);
    }
    console.log(`  chains for track '${id}':`);
    for (const line of describeTrackGraph(g, id)) console.log("  " + line);
  } else {
    for (const line of describeGraph(g)) console.log("  " + line);
  }

  if (g.warnings.length) {
    console.log("");
    console.warn(`  ${g.warnings.length} warning(s):`);
    for (const w of g.warnings) console.warn(`    ! ${w}`);
  }
}

// Run main() only when this FILE is the entry point (npx tsx …/graph.ts <project>). The
// `import.meta.url === argv[1]` test alone isn't enough: bundlers rewrite
// import.meta.url to the bundle's own URL, so when this module is bundled as a library
// into another entry (the packaged file service) both sides match and the CLI would
// hijack startup. Requiring our own filename keeps that from happening.
if (
  process.argv[1] &&
  import.meta.url.endsWith("/graph.ts") &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  main();
