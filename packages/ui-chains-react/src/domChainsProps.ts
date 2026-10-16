// domChainsProps.ts — everything a host passes DomChains, and the camera it hands back. Callbacks
// are read through a ref, so a host may pass inline lambdas; the other props must keep their
// identity across the host's renders — docs/hosting.md.

import type { PluginParamsStore } from "@studio/engine-browser/params";
import type { LaneSpan } from "@studio/ui-chains/cables";
import type {
  EdgeInsert,
  GraphNode,
  LaidOutGraph,
  RecVerb,
  TrackControlValues,
} from "@studio/ui-chains/graph";
import type { LcdSounds } from "@studio/ui-chains/lcdScreen";
import type { LaneNotes } from "@studio/ui-chains/noteLoad";
import type { RowSeam } from "@studio/ui-chains/rowSeams";
import type { Cam } from "./camera";
import type { MidiActivityStore, RackLitStore } from "./chainsStores";
import type {
  CamStore,
  ChainsIcons,
  GraphMenuCtx,
  SinkPlay,
} from "./chainsTypes";
import type { NodeEngines } from "./PresetButton";
import type { TapAction } from "./TapWidget";

/** The camera, for a host that BORROWS it and has to put it back — docs/camera.md. */
export interface ChainsCamApi {
  fitTo: FitToFn;
  get: () => Cam;
  set: (c: Cam) => void;
}

export interface FitToOpts {
  /** Keep the zoom this fit computed and only CENTRE on this node — used to walk a chain. */
  panOnly?: GraphNode;
  /** `"height"` fills the height and lets the set run off the right, where it pans — docs/camera.md. */
  axis?: "both" | "height";
  /** Multiply the fitted zoom; below 1 it pulls BACK from a perfect fit — docs/camera.md. */
  zoom?: number;
}

export type FitToFn = (nodes: GraphNode[], opts?: FitToOpts) => boolean;

export interface DomChainsProps {
  /** The glyphs the nodes wear. Required, so no caller can render a graph without them. */
  icons: ChainsIcons;
  graph: LaidOutGraph;
  /** Animate a change of layout, on by default — docs/nodeMotion.md says when to turn it off. */
  motion?: boolean;
  selected: string | null;
  /** The engine level index order; the levels themselves never flow through here — docs/liveCables.md. */
  trackOrder?: string[];
  /** The tab each card has open, by node id, for a host that sizes cards by tab (ui-chains' `moduleRow` `tabOf`); absent, each card keeps its own. */
  openTabs?: Readonly<Record<string, number>>;
  /** …and told when a card's tab changes. */
  onOpenTab?: (nodeId: string, tab: number) => void;
  /** When each VIDEO lane is showing a picture, in seconds — omitted, its cables stay still, docs/liveCables.md. */
  videoSpans?: Readonly<Record<string, readonly LaneSpan[]>>;
  /** …and the NOTES' half: a note cable ripples with the velocities at the playhead, by lane id — docs/liveCables.md. */
  noteLanes?: Readonly<Record<string, LaneNotes>>;
  onSelect: (c: string | null) => void;
  onPickModule?: (module: string | null) => void;
  onContextMenu?: (ctx: GraphMenuCtx, x: number, y: number) => void;
  // `at` is the arrow's midpoint in WORLD px — where the picked module will be born.
  onEdgeInsert?: (
    info: EdgeInsert,
    x: number,
    y: number,
    at?: { x: number; y: number },
  ) => void;
  /** A GLUED row's `+` spots, answered through `onEdgeInsert` like a cable's — Seams.tsx. */
  seams?: readonly RowSeam[];
  /** Right-click on EMPTY canvas — a pick lands wired to nothing, BORN at `at` (world px). */
  onCanvasInsert?: (
    x: number,
    y: number,
    at?: { x: number; y: number },
  ) => void;
  /** The patch cable landed: `from`/`to` are chains.yaml addresses, ready for the verb — docs/hosting.md. */
  onConnect?: (from: string, to: string) => void;
  /** A lifted cable was dropped on the bare canvas: delete its arrow — docs/hosting.md. */
  onDisconnect?: (from: string, to: string) => void;
  /** A curve cable landed — bind `curve` to `module`'s `param`, optionally fired by `trigger`. */
  onAutomate?: (
    module: string,
    param: string,
    curve: string,
    trigger?: string,
  ) => void;
  /** A lifted cable's loose end landed elsewhere: from→to becomes newFrom→newTo, one undo step. */
  onReplug?: (from: string, to: string, newFrom: string, newTo: string) => void;
  /** A module was dragged by its header and dropped: pin it there — the pin gesture, docs/hosting.md. */
  onMoveNode?: (module: string, x: number, y: number) => void;
  /** Hands the camera up, once mounted — see ChainsCamApi. */
  onCamReady?: (cam: ChainsCamApi) => void;
  /** This graph is arranged as a ROW to be read across — it changes what the navigation MEANS, docs/hosting.md. */
  row?: boolean;
  /** The camera is the FIT's alone: no wheel, drag or pinch moves it, and every resize re-frames (docs/camera.md). */
  fixed?: boolean;
  /** Draw the corner minimap, with its "Zoom fit" button — docs/minimap.md. Never on a ROW. */
  minimap?: boolean;
  /** The minimap's "Organize": the host's auto-layout, which is a command and its reload. */
  onOrganize?: () => void;
  /** The stack view's toggle, drawn left of the minimap's zoom fit, and whether it is on. */
  onStack?: () => void;
  stacked?: boolean;
  /** A rack tap's edit on a node: the host writes the node's file — packages/song/docs/racks.md. */
  onTapEdit?: (module: string, action: TapAction) => void;
  // Where the camera lives BETWEEN mounts: the graph unmounts with its pane. See docs/chainsGraph.md.
  camStore?: CamStore;
  /** Engine load problems by PluginDoc id — a node badges itself from this. */
  engineWarnings?: Record<string, string>;
  // Identifies WHICH graph is on screen: a change re-frames, a redraw of the same one leaves the camera alone.
  fitKey?: string | number | null;
  /** Bumped by the host's auto-organize: the next layout is WATCHED — every card slides, and the camera glides to frame it (docs/nodeMotion.md). */
  organizeKey?: number;
  /** How the first frame is chosen: "both" fits the whole graph, "height" lets the width overflow. */
  fitAxis?: "both" | "height";
  /** The most the first frame may zoom IN — 1 keeps the cards at their own size, however much room the pane has. */
  fitMaxZoom?: number;
  /** How much of the pane the first frame fills, 0..1 — 0.9 leaves air round the graph, 1 fills it edge to edge. */
  fitPad?: number;
  /** Every card drawn whole at any zoom: no far LOD, for a view whose cards ARE the subject (docs/camera.md). */
  alwaysDetailed?: boolean;
  command: (line: string) => void | Promise<void>;
  // Bypass a module. Separate from `command` because it must RELOAD — the quiet path never bumps reloadKey.
  onBypassModule?: (module: string) => void;
  /** Thaw an AUTOMATIC freeze before a control on it is used: its VST is baked, and an edit must reach a live one (packages/song/docs/autoFreeze.md). */
  onThawAutoFreeze?: (module: string) => void;
  /** Set a module's own FIELD, `node param <node> @<field> <v>`: it must reload, the reload being its only feedback. */
  onModuleField?: (line: string) => void | Promise<void>;
  /** Open or close an ASSEMBLY's box. Session state the HOST holds: nothing is written to the project. */
  onToggleAssembly?: (name: string) => void;
  /** An alternative badge: switch a module to a set (`name`), or copy the one on (null) — docs/hosting.md. */
  onAlternative?: (module: string, name: string | null) => void;
  /** A node's engine dropdown: run a module as another of its engines — packages/song/docs/engines.md. */
  onEngine?: (module: string, name: string) => void;
  /** A node's preset dropdown: the host lists that node's presets at the point given — packages/song/docs/userPresets.md. */
  onPresets?: (
    module: string,
    x: number,
    y: number,
    engines?: NodeEngines,
  ) => void;
  /** The arrows beside the dropdown: the host loads that node's previous (-1) or next (+1) preset. */
  onPresetStep?: (module: string, step: -1 | 1) => void;
  /** The preset each node last loaded, by node — the HOST's session state, drawn on the dropdown. */
  presetNames?: Record<string, string>;
  /** A RACK pad was clicked: the graph says WHICH sound was asked for and stops there — docs/hosting.md. */
  onTriggerRack?: (module: string, symbol: string) => void;
  /** Set a PROJECT setting — `project <field> <value>`. Absent means the dropdown reads only. */
  onProjectField?: (field: string, value: string) => void;
  /** A RECORDER's button: the engine keys a node by `pluginId`, a verb names `module` — engine/k7-runtime/docs/recorder.md. */
  onRecorder?: (
    verb: RecVerb,
    node: { module: string; pluginId?: string },
  ) => void;
  /** Which rack sounds are firing right now, as a store each pad subscribes to. See `RackLitStore`. */
  rackLit?: RackLitStore;
  /** Which MIDI devices just sent something: a midi-in card's LED. See `MidiActivityStore`. */
  midiActivity?: MidiActivityStore;
  /** The nodes the host wants lit — k7's History panel, what a step touched; read per node at draw. */
  marked?: (n: GraphNode) => boolean;
  // Set a file-valued param on a module: `param` is the key ("model"), `file` assets-relative or "none".
  onSetModuleAsset?: (module: string, kind: string, file: string) => void;
  /** The host's decoder of a module's sound files, which a screen draws with `lcd.sound(slot)` — docs/lcdScreen.md. */
  sounds?: LcdSounds;
  /** Open the asset browser for a module's file-valued param, at viewport coords. */
  onAssetBrowse?: (
    module: string,
    kind: string,
    x: number,
    y: number,
    family?: string,
  ) => void;
  onLibraryBrowse?: (
    module: string,
    kind: string,
    x: number,
    y: number,
  ) => void;
  /** What each track is fed FROM — what the HOST knows about a live input and the graph does not. */
  trackInputs?: Record<string, string>;
  /** Choose what feeds a track, at the click's viewport coords — the popup is the host's. */
  onPickTrackInput?: (trackId: string, x: number, y: number) => void;
  /** Place/remove the engine's waveform tap while a waveform widget is on screen. */
  onWatchWaveform?: (
    pluginId: string,
    side: "input" | "output",
    on: boolean,
  ) => void;
  /** A play button on the sink. Omit it and there is none — see SinkPlay. */
  sinkPlay?: SinkPlay;
  /** This graph is a REHEARSAL: a picked module FIELD is shown and never written — docs/hosting.md. */
  rehearsal?: boolean;
  pluginParamsStore?: PluginParamsStore;
  setPluginParam?: (id: string, name: string, value: number) => void;
  /** What a module with NO plugin is set to, lent by the surface that realises it — docs/hosting.md. */
  moduleParams?: Record<string, Record<string, number>>;
  /** …and the way back, for the same modules. Called per frame during a drag. */
  onModuleParam?: (module: string, name: string, value: number) => void;
  trackControls?: Record<string, TrackControlValues>;
  onTrackToggle?: (
    trackId: string,
    control: "mute" | "solo" | "arm" | "highlight",
  ) => void;
  onTrackSet?: (
    trackId: string,
    control: "volume" | "pan",
    value: number,
  ) => void;
}
