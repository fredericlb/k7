// DomChains.tsx — the Chains routing graph: HTML nodes over a canvas of signal cables,
// with an SVG layer between them for the labels, the arrows and the hit paths.
// It consumes a laid-out graph (dagre owns the layout); only the DRAWING is React, which
// buys real type, CSS effects and a DOM a test can read.
// Shared by the Chains tab and the Graph panel — mount it only where it has a
// real size, since fit() frames to the host. See docs/chainsGraph.md.

import { PluginParamsStore } from "@studio/engine-browser/params";
import {
  EngineStore,
  EngineStoreProvider,
  useEngineStoreOrNull,
} from "@studio/engine-browser/store";
import type { WebSignal, WebWidget } from "@studio/graph-model";
import { encodeDepth } from "@studio/ui-chains/automationDepth";
import {
  AUTO_ALPHA,
  AUTO_DASH,
  AUTO_SHADOW_W,
  AUTO_W,
  type CableDraw,
  drawCables,
  FOREIGN_ALPHA,
  newScratch,
  WOBBLE_FPS,
  WOBBLE_HZ,
  WOBBLE_MAX_SAMPLES,
  WOBBLE_STEP,
} from "@studio/ui-chains/cableCanvas";
import {
  type AutoTarget,
  autoTarget,
  buildCableGeom,
  type CableGeom,
  computeFlow,
  insertFor,
  jackRef,
  type LaneSpan,
  liveVideoLanes,
  smoothPath,
} from "@studio/ui-chains/cables";
import { withoutCurves } from "@studio/ui-chains/curvePlacement";
import {
  type LaneSource,
  type NodeFlow,
  seedFlows,
  seedsEq,
} from "@studio/ui-chains/flow";
import {
  cablePath,
  curveOutPoint,
  type EdgeInsert,
  eventPoint,
  type GraphEdge,
  type GraphNode,
  type Jack,
  jackPoint,
  type LaidOutGraph,
  pairValue,
  type RecVerb,
  rackBindSymbol,
  type TrackControlValues,
  widgetDenorm,
  widgetNorm,
} from "@studio/ui-chains/graph";
import {
  type CableSway,
  exciteSway,
  hangPoints,
  newSway,
  stepSway,
} from "@studio/ui-chains/hang";
import type { LcdSounds } from "@studio/ui-chains/lcdScreen";
import {
  linkedNodes,
  linkedValue,
  nodesInBox,
  toggleSelection,
} from "@studio/ui-chains/multiSelect";
import { type LaneNotes, noteLoadAt } from "@studio/ui-chains/noteLoad";
import { patchAct } from "@studio/ui-chains/patchGesture";
import type { RowSeam } from "@studio/ui-chains/rowSeams";
import { pinchFactor, spreadOf } from "@studio/ui-chains/zoomGesture";
import { usePointerFollow } from "@studio/ui-timeline/drag";
import { isMouseWheel, isZoomWheel } from "@studio/ui-timeline/panZoom";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Cables, type EdgeGeom } from "./ChainsCables";
import { Node } from "./ChainsNode";
import {
  applyCam,
  approach,
  type Cam,
  clampZoom,
  flyStep,
  frameBox,
  frameOriginX,
  type Lod,
  lodFor,
  sameLod,
  wheelFactor,
  wheelPixels,
  zoomAbout,
} from "./camera";
import { cableColorFor, MAUVE, useCss } from "./chainsCss";
import {
  type Channels,
  createOverrideStore,
  dropChannel,
  type MidiActivityStore,
  NOOP,
  type RackLitStore,
} from "./chainsStores";
import {
  type CamStore,
  type ChainsIcons,
  type GraphMenuCtx,
  IconsContext,
  type SinkPlay,
} from "./chainsTypes";
import {
  type LcdSet,
  LcdSetContext,
  LcdSoundsContext,
} from "./LcdScreenWidget";
import { createLcdZoom, LcdZoomContext } from "./lcdZoom";
import { Minimap } from "./Minimap";
import { cornerButtons } from "./nodeLayout";
import {
  advanceMotion,
  type Ghost,
  type Motion,
  motionPos,
  motionTransform,
  ORGANIZE_HALF_LIFE,
  planMotion,
} from "./nodeMotion";
import type { NodeEngines } from "./PresetButton";
import { Seams } from "./Seams";
import type { TapAction } from "./TapWidget";
import {
  hasChannel,
  pairTarget,
  targetKey,
  type WidgetTarget,
  widgetTarget,
  widgetValue,
} from "./widgetTarget";

// A shared, never-updated store for a graph without live params, so the hook stays unconditional.
const EMPTY_PARAMS_STORE = new PluginParamsStore();

// A stable empty track order: a fresh `[]` per render would change every Node's props each frame.
const EMPTY_ORDER: string[] = [];
// The same for "no cable carries signal" — never mutated, always replaced.
const EMPTY_LIVE: Map<string, number> = new Map();
const EMPTY_SEEDS: Map<string, NodeFlow> = new Map();
// …and for "nothing is leaving", so settling twice does not re-render the graph twice.
const EMPTY_GHOSTS: Ghost<GraphNode>[] = [];
// A cable drawn mid-move is drawn STILL — docs/nodeMotion.md.
const NO_SAMPLES: CableGeom["samples"] = [];

const DRAG_SLOP = 4; // px of movement before a press becomes a pan (so a pan never selects)
const DRAG_TRAVEL_PX = 150; // screen px of vertical drag that sweep a control's whole range
const DRAG_FINE = 0.25; // shift-held multiplier for a fine adjustment

// The palette and the stylesheet, scoped to `.dgx`, are `chainsCss.ts`; the hook that injects it too.

// `Cam` lives in camera.ts, a rack tap's edit is packages/song/docs/racks.md — docs/hosting.md.
export type { Cam, NodeEngines, TapAction };

/** What every AUTOMATION cable wears — a curve into its knob, and a node's event into the curve it fires. */
const AUTO_DRESS = {
  width: AUTO_W,
  shadowWidth: AUTO_SHADOW_W,
  dash: AUTO_DASH,
  alpha: AUTO_ALPHA,
} as const;

const EMPTY_SET: ReadonlySet<string> = new Set();
const NOOP1 = (_: unknown): void => {};

// Hand a node back to React: the three properties the frame loop writes, and only those.
function clearMotionStyle(el: HTMLElement | undefined): void {
  if (!el) return;
  el.style.transform = "";
  el.style.filter = "";
  el.style.pointerEvents = "";
}

// Are these the same cards on their way out? By id, so re-planning mid-exit does not re-render.
function sameGhosts(
  a: readonly Ghost<GraphNode>[],
  b: readonly Ghost<GraphNode>[],
): boolean {
  return a.length === b.length && a.every((g, i) => g.node.id === b[i].node.id);
}

// Map a right-clicked node to the shell's menu context (track id, module node, chain name, curve and its binding).
function nodeToCtx(n: GraphNode): GraphMenuCtx | null {
  switch (n.kind) {
    case "track":
      return { kind: "track", id: n.label };
    case "module":
      return n.module
        ? {
            kind: "module",
            id: n.module,
            missing: n.missing,
            // Its model can be fetched: the menu grows "Download model".
            ...(n.modelDownload ? { model: true } : {}),
            // The same test as the corner bubble, so the menu offers `node external-ui` exactly where the button shows.
            ...(cornerButtons(n).includes("plugin") ? { native: true } : {}),
          }
        : null;
    case "chain":
      return { kind: "chain", id: n.chain ?? n.label };
    case "sink":
      return { kind: "sink", id: n.label };
    case "assembly":
      return n.module && n.assemblyOf
        ? { kind: "assembly", id: n.module, uses: n.assemblyOf.uses }
        : null;
    case "curve":
      return n.curveOf ? { kind: "curve-card", ...n.curveOf } : null;
  }
}

/** The camera, for a host that BORROWS it and has to put it back — docs/camera.md. */
export interface ChainsCamApi {
  fitTo: FitToFn;
  get: () => Cam;
  set: (c: Cam) => void;
}

interface FitToOpts {
  /** Keep the zoom this fit computed and only CENTRE on this node — used to walk a chain. */
  panOnly?: GraphNode;
  /** `"height"` fills the height and lets the set run off the right, where it pans — docs/camera.md. */
  axis?: "both" | "height";
  /** Multiply the fitted zoom; below 1 it pulls BACK from a perfect fit — docs/camera.md. */
  zoom?: number;
}

type FitToFn = (nodes: GraphNode[], opts?: FitToOpts) => boolean;

export function DomChains({
  icons,
  graph: laidOut,
  selected,
  openTabs,
  onOpenTab,
  trackOrder,
  videoSpans,
  noteLanes,
  onSelect,
  onPickModule,
  onContextMenu,
  onEdgeInsert,
  seams,
  onCanvasInsert,
  onConnect,
  onDisconnect,
  onAutomate,
  onReplug,
  onMoveNode,
  onCamReady,
  row,
  fixed = false,
  minimap,
  onOrganize,
  onStack,
  stacked,
  onTapEdit,
  camStore,
  engineWarnings,
  fitKey,
  organizeKey,
  fitAxis = "both",
  fitMaxZoom,
  fitPad = 0.9,
  alwaysDetailed = false,
  command,
  onBypassModule,
  onThawAutoFreeze,
  onModuleField,
  onToggleAssembly,
  onAlternative,
  onEngine,
  onPresets,
  onPresetStep,
  presetNames,
  onTriggerRack,
  onRecorder,
  onProjectField,
  rackLit,
  midiActivity,
  marked,
  onSetModuleAsset,
  onAssetBrowse,
  sounds,
  onLibraryBrowse,
  trackInputs,
  onPickTrackInput,
  onWatchWaveform,
  sinkPlay,
  pluginParamsStore,
  setPluginParam,
  moduleParams,
  onModuleParam,
  trackControls,
  onTrackToggle,
  onTrackSet,
  rehearsal,
  motion = true,
}: {
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
  /** …and the NOTES' half of it: nothing meters MIDI, so a note cable's ripple is the velocities
   *  sounding at the playhead, against the busiest that lane ever gets (@studio/ui-chains's
   *  noteLoad.ts). By lane id, as `videoSpans` is; a lane with no notes is left out. */
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
  /** Set a module's own FIELD, `node param <node> @<field> <v>`. Separate for onBypassModule's
   *  reason and one more: an intrinsic has no optimistic value, so the reload IS the feedback. */
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
  /** A RECORDER's button was pressed. `pluginId` is what the ENGINE keys a node by; `module` is
   *  what a VERB names. The host needs both — record and clear go down the socket, save is a
   *  command. See engine/k7-runtime/docs/recorder.md. */
  /** Set a PROJECT setting — `project <field> <value>`. Absent means the dropdown reads only. */
  onProjectField?: (field: string, value: string) => void;
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
}) {
  useCss();
  // NOT subscribed here: each widget taps its own plugin — engine-browser's docs/params.md.
  const params = pluginParamsStore ?? EMPTY_PARAMS_STORE;
  const hostRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  // The camera lives OUTSIDE React: `cam` is what is on screen, `goal` where a gesture takes it — docs/camera.md.
  const cam = useRef<Cam>({ ...(camStore?.current ?? { x: 0, y: 0, k: 1 }) });
  const goal = useRef<Cam>({ ...cam.current });
  // The point a zoom holds still: where the wheel was, in host coordinates.
  const anchor = useRef({ px: 0, py: 0 });
  const kick = useRef<() => void>(() => {});
  // A camera being FLOWN to — a double-click's, not a hand's, so any wheel, drag or pinch drops it.
  const flight = useRef<Cam | null>(null);
  // …and how fast, when not the zoom's own glide: an organize's reframe travels with its cards.
  const flightHalf = useRef<number | undefined>(undefined);
  // The view before the first zoom onto a node: what a double-click on the bare canvas flies back to.
  const before = useRef<Cam | null>(null);
  // Through a ref: the wheel and the pan are bound once, and would read `row` as it first was.
  const rowRef = useRef(row);
  rowRef.current = row;
  const fixedRef = useRef(fixed);
  fixedRef.current = fixed;
  // Redraws the cable canvas, which sits OUTSIDE `.dgx-world` and so is moved by no transform.
  const paintRef = useRef<() => void>(() => {});
  // The minimap's own paint, called from the graph's — the one place every camera move passes through.
  const minimapPaint = useRef<() => void>(() => {});
  // Has the graph been framed? A saved camera means the user already has a view, so it starts true.
  const fitted = useRef(camStore?.current != null);
  // Has the USER taken the camera? Separate from `fitted` — see docs/chainsGraph.md.
  const userMoved = useRef(camStore?.current != null);
  const camStoreRef = useRef(camStore);
  camStoreRef.current = camStore;
  // What the drawing takes from the camera, committed only when one of the three differs.
  const [lod, setLod] = useState<Lod>(() => lodFor(cam.current.k));
  const lodRef = useRef(lod);
  // Zoomed out, the curve cards and their cables go: a binding is a detail of the knob it moves (docs/nodeCard.md).
  const graph = useMemo(
    () => (alwaysDetailed || lod.widgets ? laidOut : withoutCurves(laidOut)),
    [laidOut, alwaysDetailed, lod.widgets],
  );
  // The settled zoom the screens size their pixels for, published at the same two moments a camera is kept.
  const [lcdZoom] = useState(() => createLcdZoom(cam.current.k));
  // Persist ONLY after a real fit: the identity camera is indistinguishable from one the user chose.
  const persist = () => {
    lcdZoom.set(cam.current.k);
    const store = camStoreRef.current;
    if (store && fitted.current) store.current = { ...cam.current };
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;
  // Put the camera somewhere outright — a fit, not a gesture, so it lands whole in one frame.
  const place = (c: Cam) => {
    Object.assign(cam.current, c);
    Object.assign(goal.current, c);
    applyCam(worldRef.current, cam.current);
    paintRef.current();
    const next = lodFor(cam.current.k);
    if (!sameLod(next, lodRef.current)) {
      lodRef.current = next;
      setLod(next);
    }
    persist();
  };
  const placeRef = useRef(place);
  placeRef.current = place;
  // A camera restored from the store is never placed by a fit, so it needs this one write.
  useLayoutEffect(() => {
    applyCam(worldRef.current, cam.current);
    paintRef.current();
  }, []);
  const [panning, setPanning] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  // Optimistic values the hand set, outranking the incoming frame until it catches up.
  const [overrides] = useState(createOverrideStore);
  const setOverride = overrides.set;

  // Latest callbacks in refs, so the once-bound window listeners read current values without re-subscribing.
  const cb = useRef({
    onSelect,
    onPickModule,
    onContextMenu,
    onEdgeInsert,
    onCanvasInsert,
    onConnect,
    onDisconnect,
    onAutomate,
    onReplug,
    onMoveNode,
    command,
    onBypassModule,
    onThawAutoFreeze,
    onModuleField,
    onAlternative,
    onEngine,
    onPresets,
    onPresetStep,
    onTriggerRack,
    onRecorder,
    onProjectField,
    onSetModuleAsset,
    onAssetBrowse,
    onLibraryBrowse,
    onPickTrackInput,
    setPluginParam,
    onModuleParam,
    onTrackToggle,
    onTrackSet,
    onTapEdit,
  });
  cb.current = {
    onSelect,
    onPickModule,
    onContextMenu,
    onEdgeInsert,
    onCanvasInsert,
    onConnect,
    onDisconnect,
    onAutomate,
    onReplug,
    onMoveNode,
    command,
    onBypassModule,
    onThawAutoFreeze,
    onModuleField,
    onAlternative,
    onEngine,
    onPresets,
    onPresetStep,
    onTriggerRack,
    onRecorder,
    onProjectField,
    onSetModuleAsset,
    onAssetBrowse,
    onLibraryBrowse,
    onPickTrackInput,
    setPluginParam,
    onModuleParam,
    onTrackToggle,
    onTrackSet,
    onTapEdit,
  };

  // --- the compiled geometry: signal cables (with insert eligibility) + automations ---
  const model = useMemo(() => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    // With a box OPEN, the cables that are not its own are the traffic crossing it: they still run
    // right over the frame, at half, so the wiring inside reads first. Nothing fades otherwise.
    const anyOpen = graph.nodes.some((n) => n.assemblyOf?.open);
    // …and a CLOSED box has swallowed its lanes' cards, so a metered one's signal now leaves from
    // the box. Without this a folded set reaches nothing and not one cable ripples.
    const foldedAt = new Map<string, string>();
    for (const n of graph.nodes)
      if (n.assemblyOf && !n.assemblyOf.open)
        for (const m of n.assemblyOf.members) foldedAt.set(m, n.id);
    const signal: EdgeGeom[] = [];
    // The edges between two TOUCHING cards: never drawn, but the ripple still has to walk through them.
    const glued: GraphEdge[] = [];
    const auto: AutoTarget[] = [];
    // An automation cable is a CABLE: only its param LABEL stays in the SVG, off the AutoTarget list.
    const autoGeom: ({ id: string } & CableGeom)[] = [];
    for (const e of graph.edges) {
      if (e.automation) {
        const a = autoTarget(e, byId);
        if (!a) continue;
        auto.push(a);
        autoGeom.push({
          id: a.id,
          ...buildCableGeom(
            hangPoints(a.from, a.to),
            WOBBLE_STEP,
            WOBBLE_MAX_SAMPLES,
          ),
        });
        continue;
      }
      if (e.glued) {
        glued.push(e);
        continue;
      }
      if (e.points.length < 2) continue;
      signal.push({
        id: e.id,
        // Plugged into the SOCKETS rather than aimed at the borders dagre routed to — see cablePath.
        ...buildCableGeom(
          cablePath(e, byId.get(e.source), byId.get(e.target)),
          WOBBLE_STEP,
          WOBBLE_MAX_SAMPLES,
        ),
        source: e.source,
        target: e.target,
        label: e.label,
        signal: e.signal,
        faded: anyOpen && !e.assembly,
        insert: insertFor(e.source, e.target, byId),
      });
    }
    // What the ripple walks: every signal edge, drawn or glued.
    const flowEdges = glued.length ? [...signal, ...glued] : signal;
    return { byId, signal, flowEdges, auto, autoGeom, foldedAt };
  }, [graph]);

  // --- node motion: the cards slide, arrive and leave rather than jumping (docs/nodeMotion.md) ---
  const reducedMotion = useRef(
    typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  ).current;
  const animate = motion && !reducedMotion;
  const motions = useRef<Map<string, Motion>>(new Map());
  // Where each node is DRAWN right now, ghosts included — what the next layout measures from.
  const drawn = useRef<Map<string, Ghost<GraphNode>>>(new Map());
  const [ghosts, setGhosts] = useState<Ghost<GraphNode>[]>(EMPTY_GHOSTS);
  const ghostCount = useRef(0);
  ghostCount.current = ghosts.length;
  // React has just replaced the nodes, so the element map is stale: re-read it once, next frame.
  const rebind = useRef(true);
  const nodeEls = useRef<Map<string, HTMLElement>>(new Map());
  // Which ids currently carry an inline transform, so each is cleared exactly once.
  const styled = useRef<Set<string>>(new Set());
  const cablesSvg = useRef<SVGSVGElement>(null);
  const layoutNodes = useRef(graph.nodes);
  layoutNodes.current = graph.nodes;

  // The positions a settled graph is measured from: the layout, and nothing else.
  const settledDrawn = (): Map<string, Ghost<GraphNode>> =>
    new Map(
      layoutNodes.current.map((n) => [n.id, { node: n, x: n.x, y: n.y }]),
    );

  /** One frame of movement: advance, write, and rebuild the cables from where the cards ARE. */
  const motionStep = useRef<(dt: number) => boolean>(() => false);
  motionStep.current = (dt: number) => {
    const ms = motions.current;
    if (rebind.current) {
      rebind.current = false;
      const world = worldRef.current;
      nodeEls.current = new Map();
      if (world)
        for (const el of world.querySelectorAll<HTMLElement>("[data-node-id]"))
          nodeEls.current.set(String(el.dataset.nodeId), el);
    }
    const still = advanceMotion(ms, dt);
    for (const [id, m] of ms) {
      const el = nodeEls.current.get(id);
      if (!el) continue;
      el.style.transform = motionTransform(m);
      el.style.filter = m.a >= 1 ? "" : `opacity(${m.a})`;
      // A card on its way out is already gone as far as the graph is concerned.
      el.style.pointerEvents = m.at === 0 ? "none" : "";
      styled.current.add(id);
    }
    for (const id of styled.current) {
      if (ms.has(id)) continue;
      clearMotionStyle(nodeEls.current.get(id));
      styled.current.delete(id);
    }
    // The cables follow for free, and `rebuildCables` is the one place that decides — docs/nodeMotion.md.
    rebuildCables.current();
    return still;
  };

  // The cable draws for one frame of a move, from the interpolated positions — docs/nodeMotion.md.
  const motionCables = useRef<() => CableDraw[]>(() => []);
  motionCables.current = () => {
    const ms = motions.current;
    const drag = nodeDrag.current;
    const byId = new Map<string, GraphNode>();
    for (const n of layoutNodes.current) {
      const p = motionPos(n, ms);
      let { x, y } = p;
      // A card in hand (or dropped, pending its reload) is wherever the hand put it.
      if (drag && n.id === drag.n.id) {
        x = n.x + drag.dx;
        y = n.y + drag.dy;
      } else {
        const dropped = droppedNodes.current.get(n.id);
        if (dropped) {
          x = n.x + dropped.dx;
          y = n.y + dropped.dy;
        }
      }
      byId.set(n.id, x === n.x && y === n.y ? n : { ...n, x, y });
    }
    const draws: CableDraw[] = [];
    const lifted = patchRef.current?.edge?.id;
    // The fade has to hold through a slide too, or every cable snaps to full while cards move.
    const anyOpen = graph.nodes.some((n) => n.assemblyOf?.open);
    for (const e of graph.edges) {
      if (e.id === lifted) continue; // its end is in hand — the dashed ghost draws it
      // The automation cables move too: a curve is a node, and its cables are cables.
      if (e.automation) {
        const a = autoTarget(e, byId);
        if (!a) continue;
        const base = hangPoints(a.from, a.to);
        const sway = swayFor(a.id);
        exciteSway(sway, base[0], base[base.length - 1]);
        draws.push({
          geom: { base, samples: NO_SAMPLES, len: 0 },
          color: MAUVE,
          flow: 0,
          sway,
          width: AUTO_W,
          shadowWidth: AUTO_SHADOW_W,
          dash: AUTO_DASH,
          alpha: AUTO_ALPHA,
        });
        continue;
      }
      if (e.points.length < 2) continue;
      const base = cablePath(e, byId.get(e.source), byId.get(e.target));
      if (base.length < 2) continue;
      // Every motion frame re-reads the sockets, so the slack trails the cards through a slide.
      const sway = swayFor(e.id);
      exciteSway(sway, base[0], base[base.length - 1]);
      draws.push({
        geom: { base, samples: NO_SAMPLES, len: 0 },
        color: cableColorFor(e.signal),
        flow: 0,
        sway,
        ...(anyOpen && !e.assembly ? { alpha: FOREIGN_ALPHA } : {}),
        ...(e.signal === "event" ? AUTO_DRESS : {}),
      });
    }
    return draws;
  };

  /** Everything lands: styles off, ghosts unmounted, the real cable geometry back. */
  const settleMotion = useRef<() => void>(NOOP);
  settleMotion.current = () => {
    motions.current.clear();
    for (const id of styled.current) clearMotionStyle(nodeEls.current.get(id));
    styled.current.clear();
    drawn.current = settledDrawn();
    cablesSvg.current?.classList.remove("moving");
    if (ghostCount.current) setGhosts(EMPTY_GHOSTS);
    // Back to the baked geometry — resampled, and rippling again wherever signal runs.
    applyLive.current();
  };

  // The organize this graph last showed: a new one makes the next layout a WATCHED one, docs/nodeMotion.md.
  const organizeSeen = useRef(organizeKey);

  // A new layout, and its first frame now — a LAYOUT effect, which is the FLIP rule, docs/nodeMotion.md.

  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs above were reassigned with this render's layout, so `graph` IS the trigger and the body reads nothing else.
  useLayoutEffect(() => {
    // A new layout retires every dropped card's inline transform, its left/top now carrying it.
    if (droppedNodes.current.size) {
      for (const { el } of droppedNodes.current.values())
        el.style.transform = "";
      droppedNodes.current.clear();
    }
    const organizing = organizeSeen.current !== organizeKey;
    organizeSeen.current = organizeKey;
    // An organize ends framed on what it made: flown with the cards, or placed outright when nothing moves.
    const reframe = () => {
      const to = organizing ? fitCam.current() : null;
      if (!to) return;
      userMoved.current = true;
      if (!animate) return void place(to);
      goal.current.k = cam.current.k;
      flightHalf.current = ORGANIZE_HALF_LIFE;
      flight.current = to;
      kick.current();
    };
    if (!animate) {
      // Turned off mid-flight — nothing else would ever take the inline styles back off.
      if (motions.current.size || styled.current.size) settleMotion.current();
      drawn.current = settledDrawn();
      reframe();
      return;
    }
    // The FIRST layout is not a change, and the cap is a screen and a half in WORLD px — docs/nodeMotion.md.
    const host = hostRef.current;
    const travel =
      host && !organizing
        ? (Math.hypot(host.clientWidth, host.clientHeight) * 1.5) /
          Math.max(cam.current.k, 0.01)
        : Number.POSITIVE_INFINITY;
    const plan = drawn.current.size
      ? planMotion(
          drawn.current,
          motions.current,
          graph.nodes,
          travel,
          organizing ? ORGANIZE_HALF_LIFE : undefined,
        )
      : null;
    reframe();
    drawn.current = settledDrawn();
    if (!plan?.moving) {
      // Nothing to do — but something from the layout before this one may still be in flight.
      if (motions.current.size || styled.current.size) settleMotion.current();
      return;
    }
    for (const g of plan.ghosts) drawn.current.set(g.node.id, g);
    motions.current = plan.motions;
    rebind.current = true;
    setGhosts((cur) => (sameGhosts(cur, plan.ghosts) ? cur : plan.ghosts));
    // The stale half of the drawing steps aside for the move — see the `.dgx-cables` rule.
    cablesSvg.current?.classList.add("moving");
    // dt 0: place the offsets, advance nothing.
    motionStep.current(0);
    // …and look again next frame: the ghosts are not in the DOM until the state update lands.
    rebind.current = true;
    kick.current();
  }, [graph, animate, organizeKey]);

  // --- what carries signal: refs, not state, so a crossing re-renders nothing (docs/liveCables.md) ---
  const hostStore = useEngineStoreOrNull();
  const liveRef = useRef<Map<string, number>>(EMPTY_LIVE);
  // What each lane is PUTTING OUT, per kind of wire — the seed the walk seeds from, and the
  // reason a cable's ripple says how loud rather than merely whether. See docs/liveCables.md.
  const seedRef = useRef<Map<string, NodeFlow>>(EMPTY_SEEDS);
  const cableDrawsRef = useRef<CableDraw[]>([]);
  const rebuildCables = useRef<() => void>(NOOP);
  const applyLive = useRef<() => void>(NOOP);
  // …and its cheap half, for the frames where only the LEVELS moved.
  const applyFlow = useRef<() => void>(NOOP);
  // Assigned every render like `applyLive`, so the walk always sees the CURRENT edges: the meter
  // effect below mounts once and would otherwise close over the graph as it was then.
  const applyMeter = useRef<(seeds: Map<string, NodeFlow>) => void>(NOOP1);
  // Set by the ripple effect below; poked whenever liveness changes, to start a stopped loop.
  const rippleRef = useRef<() => void>(NOOP);
  // One swing per cable, keyed by edge id and SHARED with the draws, so settling rebuilds nothing.
  const sways = useRef(new Map<string, CableSway>());
  const swayKick = useRef<() => void>(NOOP);
  const swayFor = (id: string): CableSway => {
    let s = sways.current.get(id);
    if (!s) {
      s = newSway();
      sways.current.set(id, s);
    }
    return s;
  };

  // --- the cable canvas: its width comes from the LOD, which QUANTISES it (docs/camera.md) ---
  const linkBoost = lod.boost;

  // Reassigned every render, like `paint` and `fit`, so it always sees the CURRENT edges.
  rebuildCables.current = () => {
    // Mid-move the laid-out geometry is a lie, and so is a HELD card's — docs/nodeMotion.md.
    if (motions.current.size || nodeDrag.current || droppedNodes.current.size) {
      cableDrawsRef.current = motionCables.current();
      swayKick.current();
      return;
    }
    const live = liveRef.current;
    // The cable whose end is in hand steps aside: its dashed ghost is the drawing of it.
    const lifted = patchRef.current?.edge?.id;
    cableDrawsRef.current = [
      ...model.signal
        .filter((g) => g.id !== lifted)
        .map((g) => {
          // Excitation happens HERE, where the endpoints are read, so only a moved socket swings.
          const sway = swayFor(g.id);
          exciteSway(sway, g.base[0], g.base[g.base.length - 1]);
          return {
            id: g.id,
            geom: g,
            color: cableColorFor(g.signal),
            flow: live.get(g.id) ?? 0,
            sway,
            ...(g.faded ? { alpha: FOREIGN_ALPHA } : {}),
            // A note-on into a curve is an automation cable too, and wears its dress.
            ...(g.signal === "event" ? AUTO_DRESS : {}),
          };
        }),
      // The automation cables, same physics, wearing the auto dress — a cable is a cable.
      ...model.autoGeom.map((g): CableDraw => {
        const sway = swayFor(g.id);
        exciteSway(sway, g.base[0], g.base[g.base.length - 1]);
        return {
          geom: g,
          color: MAUVE,
          flow: 0,
          sway,
          width: AUTO_W,
          shadowWidth: AUTO_SHADOW_W,
          dash: AUTO_DASH,
          alpha: AUTO_ALPHA,
        };
      }),
    ];
    // Springs for cables that left go with them, or a rewired graph accumulates ghosts.
    const total = model.signal.length + model.autoGeom.length;
    if (sways.current.size > total) {
      const keep = new Set([
        ...model.signal.map((g) => g.id),
        ...model.autoGeom.map((g) => g.id),
      ]);
      for (const id of sways.current.keys())
        if (!keep.has(id)) sways.current.delete(id);
    }
    swayKick.current();
  };
  /** A meter frame moves the NUMBERS and nothing else: rebuilding would re-excite every spring
   *  twenty times a second, and reallocate the array with it. See docs/liveCables.md. */
  applyFlow.current = () => {
    const live = liveRef.current;
    let moved = false;
    for (const c of cableDrawsRef.current) {
      const f = (c.id && live.get(c.id)) || 0;
      if (c.flow === f) continue;
      c.flow = f;
      moved = true;
    }
    if (!moved) return;
    paintRef.current();
    rippleRef.current();
  };

  applyMeter.current = (seeds) => {
    seedRef.current = seeds;
    liveRef.current = computeFlow(model.flowEdges, seeds, model.foldedAt);
    applyFlow.current();
  };

  // The flow map is keyed by EDGE, so a graph change goes through here too, not just a meter frame.
  applyLive.current = () => {
    liveRef.current = computeFlow(
      model.flowEdges,
      seedRef.current,
      model.foldedAt,
    );
    rebuildCables.current();
    paintRef.current();
    rippleRef.current();
  };

  const cvRef = useRef<HTMLCanvasElement>(null);
  const scratch = useRef(newScratch()).current;
  const phase = useRef(0);
  // The host's size, from the ResizeObserver below: reading it in the draw would flush style per frame.
  const hostSize = useRef({ w: 0, h: 0 });
  // Reassigned every render, like `fit` below, so the rAF always draws the CURRENT camera and cables.
  paintRef.current = () => {
    minimapPaint.current();
    const cv = cvRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(hostSize.current.w * dpr);
    const height = Math.round(hostSize.current.h * dpr);
    if (!width || !height) return;
    // Resizing the backing store also clears it, so only do it when it actually changed.
    if (cv.width !== width || cv.height !== height) {
      cv.width = width;
      cv.height = height;
    }
    drawCables(
      ctx,
      {
        width,
        height,
        // `cam.current`, not `cam`: the camera is a REF, mutated in place by the frame loop.
        cam: cam.current,
        dpr,
        cables: cableDrawsRef.current,
        phase: phase.current,
        boost: linkBoost,
      },
      scratch,
    );
  };

  // A graph or LOD change redraws AT ONCE so canvas and nodes land together; the CAMERA never does.

  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the frame's inputs, not values this body reads — the refs above were reassigned with them during the render, so listing them here IS the redraw trigger.
  useLayoutEffect(() => {
    applyLive.current();
  }, [model.signal, linkBoost]);

  // The ripple, on its own clock at WOBBLE_HZ, mounted ONCE and steered by `liveRef`.
  useEffect(() => {
    let raf = 0;
    let lastAt = 0;
    const step = 1000 / WOBBLE_FPS;
    const tick = (now: number) => {
      if (liveRef.current.size === 0) {
        raf = 0; // nothing carries signal any more: stop, and let `sync` restart us
        return;
      }
      raf = requestAnimationFrame(tick);
      if (now - lastAt < step) return;
      // By REAL elapsed time, not by a fixed increment, so capping the rate slows nothing down.
      phase.current += Math.PI * 2 * WOBBLE_HZ * ((now - lastAt) / 1000);
      lastAt = now;
      paintRef.current();
    };
    const sync = () => {
      if (raf || liveRef.current.size === 0) return;
      lastAt = performance.now();
      raf = requestAnimationFrame(tick);
    };
    rippleRef.current = sync;
    sync();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      rippleRef.current = NOOP;
    };
  }, []);

  // The SWING's clock, beside the ripple's: kicked by every rebuild, and a kick while running is a no-op.
  useEffect(() => {
    let raf = 0;
    let lastAt = 0;
    const tick = (now: number) => {
      // Capped dt: a background tab's first frame back would otherwise integrate seconds at once.
      const dt = Math.min(0.05, (now - lastAt) / 1000);
      lastAt = now;
      let moving = false;
      for (const s of sways.current.values())
        if (stepSway(s, dt)) moving = true;
      paintRef.current();
      raf = moving ? requestAnimationFrame(tick) : 0;
    };
    swayKick.current = () => {
      if (raf) return;
      lastAt = performance.now();
      raf = requestAnimationFrame(tick);
    };
    return () => {
      if (raf) cancelAnimationFrame(raf);
      swayKick.current = NOOP;
    };
  }, []);

  // The meters straight off the store, and the PICTURE on the same frame — docs/liveCables.md.
  useEffect(() => {
    if (!hostStore) return;
    const order = trackOrder ?? EMPTY_ORDER;
    const spans = videoSpans;
    const read = (): void => {
      const s = hostStore.getSnapshot();
      const showing =
        spans && s.playing ? liveVideoLanes(spans, s.playhead) : EMPTY_ORDER;
      const lanes: Record<string, LaneSource> = {};
      for (let i = 0; i < order.length; i++) {
        const id = order[i];
        const notes = noteLanes?.[id];
        lanes[id] = {
          db: s.levels[i],
          ...(notes
            ? {
                notes: {
                  load: noteLoadAt(notes.spans, s.playhead),
                  peak: notes.peak,
                },
              }
            : {}),
        };
      }
      for (const id of showing) lanes[id] = { ...lanes[id], showing: true };
      const seeds = seedFlows(lanes);
      if (seedsEq(seeds, seedRef.current)) return;
      seedRef.current = seeds;
      applyMeter.current(seeds);
    };
    read();
    return hostStore.subscribe(read);
  }, [hostStore, trackOrder, videoSpans, noteLanes]);

  // --- fit: frame the whole graph to the host; it ANSWERS whether it did (docs/camera.md) ---
  const fit = useRef<() => boolean>(() => false);
  fit.current = () => {
    const c = fitCam.current();
    if (!c) return false;
    // Framed, so from here the camera is worth remembering — `place` persists it.
    fitted.current = true;
    place(c);
    return true;
  };
  /** The camera that frames the whole graph, or null while there is no size to frame to. */
  const fitCam = useRef<() => Cam | null>(() => null);
  fitCam.current = () => {
    const host = hostRef.current;
    // isFinite, not truthy: an empty dagre layout reported -Infinity and still marked the view framed over nothing.
    if (
      !host ||
      !Number.isFinite(graph.width) ||
      !Number.isFinite(graph.height)
    )
      return null;
    // The BOX, not the extent: a pin may sit above the first track or left of it — docs/hosting.md.
    const gw = graph.width - graph.left;
    const gh = graph.height - graph.top;
    if (!gw || !gh) return null;
    const sw = host.clientWidth;
    const sh = host.clientHeight;
    if (!sw || !sh) return null;
    const pad = fitPad;
    // "height" frames the HEIGHT and lets the width run off the side, which is pannable — docs/camera.md.
    const k = clampZoom(
      Math.min(
        fitMaxZoom ?? Number.POSITIVE_INFINITY,
        fitAxis === "height"
          ? (sh / gh) * pad
          : Math.min((sw / gw) * pad, (sh / gh) * pad),
      ),
    );
    return {
      k,
      // Height-fitted content overflows, so it is pinned LEFT and each offset carries the box's corner.
      x:
        (fitAxis === "height" && gw * k > sw ? 0 : (sw - gw * k) / 2) -
        graph.left * k,
      y: (sh - gh * k) / 2 - graph.top * k,
    };
  };
  // Frame once, and again only when `fitKey` says this is a different graph. See docs/chainsGraph.md.
  const lastFitKey = useRef(fitKey);
  useLayoutEffect(() => {
    if (fitKey !== lastFitKey.current) {
      lastFitKey.current = fitKey;
      fitted.current = false;
    }
    if (!fitted.current) fitted.current = fit.current();
  }, [graph, fitKey]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Only until the first successful fit: the host starts at zero size, but later resizes must not re-frame.
    const ro = new ResizeObserver(([entry]) => {
      // The cable canvas is sized from here: not being in the flow, nothing else would tell it.
      const box = entry?.contentRect;
      if (box) hostSize.current = { w: box.width, h: box.height };
      paintRef.current();
      // Keep re-framing while the camera is still ours — the host settles for a while after the first fit.
      if (userMoved.current) return;
      if (fit.current()) fitted.current = true;
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // --- fitTo: frame a subset of nodes (chain selection from the sidebar) ---------
  const fitTo = useRef<FitToFn>(() => false);
  fitTo.current = (nodes: GraphNode[], opts: FitToOpts = {}) => {
    const { panOnly, axis = "both", zoom = 1 } = opts;
    const host = hostRef.current;
    if (!host || !nodes.length) return false;
    const sw = host.clientWidth;
    const sh = host.clientHeight;
    if (!sw || !sh) return false;
    // Framing a chain the user picked is their choice too — AFTER the size checks, so a no-op claims nothing.
    userMoved.current = true;
    const minX = Math.min(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    const maxX = Math.max(...nodes.map((n) => n.x + n.w));
    const maxY = Math.max(...nodes.map((n) => n.y + n.h));
    const bw = maxX - minX;
    const bh = maxY - minY;
    const pad = 0.9;
    const k = clampZoom(
      (axis === "height"
        ? (sh / bh) * pad
        : Math.min((sw / bw) * pad, (sh / bh) * pad)) * zoom,
    );
    if (panOnly) {
      // Keep the zoom from the chain fit; only adjust translation to center the target.
      const cur = cam.current;
      place({
        k: cur.k,
        x: sw / 2 - (panOnly.x + panOnly.w / 2) * cur.k,
        y: sh / 2 - (panOnly.y + panOnly.h / 2) * cur.k,
      });
    } else {
      // Centred, EXCEPT a row that does not fit across — see `frameOriginX`, docs/camera.md.
      const spills = axis === "height" && bw * k > sw;
      const originX = frameOriginX(sw, bw * k, pad, spills);
      place({
        k,
        x: originX - minX * k,
        y: (sh - bh * k) / 2 - minY * k,
      });
    }
    return true;
  };
  useEffect(() => {
    // One options object forwarded whole, because it cannot be half-forwarded by accident.
    onCamReady?.({
      fitTo: (nodes, opts) => fitTo.current(nodes, opts),
      get: () => ({ ...cam.current }),
      // Placed outright, no glide: putting a camera BACK is not a gesture to animate.
      set: (c) => {
        userMoved.current = true;
        place(c);
      },
    });
  }, [onCamReady]);

  // --- reconcile optimistic overrides as fresh engine/track frames arrive ------------
  const drag = useRef<{
    node: GraphNode;
    w: WebWidget;
    tgt: WidgetTarget;
    key: string;
    /** A crossfade knob's DRY param, written beside the wet one on every send — docs/widgets.md. */
    pair: WidgetTarget | null;
    startT: number;
    startY: number;
    travel: number; // screen px that sweep the whole range for THIS control
    value: number;
    /** The value the press found — a release that did not move it writes nothing. */
    from: number;
    sent: boolean;
    /** The same control on every LINKED node, moved to the same value — multiSelect.ts. */
    /** The other selected nodes, each moved by the SAME travel from its own start — multiSelect.ts. */
    linked: {
      node: GraphNode;
      tgt: WidgetTarget;
      pair: WidgetTarget | null;
      startT: number;
      value: number;
    }[];
  } | null>(null);

  // One live value to the engine, or to the surface that realises an offline module — nothing else sends live.
  const sendLive = useCallback((t: WidgetTarget, value: number) => {
    if (t.kind === "plugin")
      cb.current.setPluginParam?.(t.pluginId, t.name, value);
    else if (t.kind === "offline")
      cb.current.onModuleParam?.(t.module, t.name, value);
  }, []);

  // Write a plugin param into the module's file, and a crossfade's dry one AFTER it: two writes to one file must not race.
  const commitParam = useCallback(
    (
      module: string,
      t: WidgetTarget,
      value: number,
      pair: WidgetTarget | null,
      w: WebWidget,
    ) => {
      if (t.kind !== "plugin") return;
      const line = (name: string, v: number) =>
        `node param ${module} ${JSON.stringify(name)} ${v}`;
      const first = cb.current.command(line(t.name, value));
      if (pair?.kind === "plugin")
        void Promise.resolve(first).then(() =>
          cb.current.command(line(pair.name, pairValue(w, value))),
        );
    },
    [],
  );
  useEffect(() => {
    // A plugin frame landed: drop the overrides it now speaks for, keeping the one under the hand.
    return params.subscribe(() => {
      if (!hasChannel(overrides.get(), "p:")) return;
      setOverride((o) => dropChannel(o, "p:", drag.current?.key));
    });
  }, [params, overrides, setOverride]);
  useEffect(() => {
    setOverride((o) => dropChannel(o, "o:", drag.current?.key));
  }, [moduleParams, setOverride]);
  useEffect(() => {
    setOverride((o) => dropChannel(o, "t:", drag.current?.key));
  }, [trackControls, setOverride]);

  // Either prop turns the channel on: a host may only SHOW such a value, or only take one.
  const offlineChannel =
    moduleParams !== undefined || onModuleParam !== undefined;
  const pluginWritable = setPluginParam !== undefined;
  // Either one: a host that wired the toggles or the two continuous controls meant it.
  const trackWritable = onTrackSet !== undefined || onTrackToggle !== undefined;
  const offlineWritable = onModuleParam !== undefined;
  const rackTriggerable = onTriggerRack !== undefined;
  const recorderWired = onRecorder !== undefined;
  const projectWritable = onProjectField !== undefined;
  // Memoised on VALUES, never on the host's callbacks, which are often inline lambdas.
  const ch = useMemo<Channels>(
    () => ({
      params,
      trackControls: trackControls ?? {},
      overrides,
      trackOrder: trackOrder ?? EMPTY_ORDER,
      moduleParams: moduleParams ?? {},
      offlineChannel,
      pluginWritable,
      trackWritable,
      offlineWritable,
      rackTriggerable,
      recorderWired,
      projectWritable,
      rehearsal: !!rehearsal,
      rackLit,
      midiActivity,
    }),
    [
      params,
      trackControls,
      overrides,
      trackOrder,
      moduleParams,
      offlineChannel,
      pluginWritable,
      trackWritable,
      offlineWritable,
      rackTriggerable,
      recorderWired,
      projectWritable,
      rehearsal,
      rackLit,
      midiActivity,
    ],
  );

  // Through a ref, assigned every render, so every handler binds once and a memoised Node sees no new prop.
  const chRef = useRef(ch);
  chRef.current = ch;
  // Likewise for the window listeners, which are bound once and would hold the binding render's value.
  const rehearsalRef = useRef(false);
  rehearsalRef.current = !!rehearsal;
  const selRef = useRef(selected);
  selRef.current = selected;
  // The Shift+click selection, the graph's own: the host keeps its single `selected` (multiSelect.ts).
  const [multi, setMulti] = useState<ReadonlySet<string>>(EMPTY_SET);
  const multiRef = useRef(multi);
  multiRef.current = multi;
  // A selection made elsewhere — a sidebar row — is a single one again.
  useEffect(() => {
    if (selected && !multiRef.current.has(selected)) setMulti(EMPTY_SET);
  }, [selected]);
  const nodesRef = useRef(graph.nodes);
  nodesRef.current = graph.nodes;
  // The params a curve drives, by node: what makes a control glow — newline-joined per node, see Node's `automated`.
  const automatedOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of graph.edges)
      if (e.automation) {
        // A line per param, its depth after a tab when the curve has one — Node splits it back.
        const { param, depth } = e.automation;
        const line = depth ? `${param}\t${encodeDepth(depth)}` : param;
        m.set(e.target, [...(m.get(e.target) ?? []), line]);
      }
    return new Map([...m].map(([id, ps]) => [id, ps.sort().join("\n")]));
  }, [graph.edges]);
  // …and the edges, read by the right-click of a control to know whether a curve drives it.
  const edgesRef = useRef(graph.edges);
  edgesRef.current = graph.edges;
  // The other nodes a control on `n` moves too: every selected one, when all are one ref on one engine.
  const linked = useCallback(
    (n: GraphNode) => linkedNodes(nodesRef.current, multiRef.current, n),
    [],
  );

  // --- widget drag (knob/slider/number): live sends coalesced, commit on release ------
  const beginDrag = useCallback(
    (n: GraphNode, w: WebWidget, e: React.PointerEvent) => {
      const ch = chRef.current;
      e.stopPropagation(); // don't select the node or start a pan
      // A frozen MODULE has no plugin in the engine; a frozen LANE carries its own controls.
      if (n.frozen && n.kind === "module") return;
      // An AUTOMATIC freeze gives way instead: thawed first, so the drag reaches a live plugin.
      if (n.autoFrozen) cb.current.onThawAutoFreeze?.(n.autoFrozen);
      const tgt = widgetTarget(n, w, ch.offlineChannel);
      if (!tgt) return;
      const v = widgetValue(n, w, ch);
      drag.current = {
        node: n,
        w,
        tgt,
        key: targetKey(tgt),
        pair: pairTarget(n, w, ch.offlineChannel),
        startT: v === undefined ? 0 : widgetNorm(w, v),
        startY: e.clientY,
        // A fader sweeps over its OWN throw, measured off the rail — docs/widgets.md.
        travel:
          w.type === "fader"
            ? Math.max(
                40,
                (e.currentTarget as HTMLElement).querySelector(".rail")
                  ?.clientHeight ?? DRAG_TRAVEL_PX,
              )
            : DRAG_TRAVEL_PX,
        value: v ?? widgetDenorm(w, 0),
        from: v ?? widgetDenorm(w, 0),
        sent: false,
        linked: linked(n).flatMap((m) => {
          const t = widgetTarget(m, w, ch.offlineChannel);
          if (!t || t.kind !== tgt.kind) return [];
          const own = widgetValue(m, w, ch) ?? widgetDenorm(w, 0);
          return [
            {
              node: m,
              tgt: t,
              pair: pairTarget(m, w, ch.offlineChannel),
              startT: widgetNorm(w, own),
              value: own,
            },
          ];
        }),
      };
    },
    [linked],
  );

  // An interactive screen's params: a knob's live send and commit, one per name — docs/lcdScreen.md.
  const lcdOne = useCallback<LcdSet>(
    (n, changes, commit) => {
      const ch = chRef.current;
      if (n.frozen && n.kind === "module") return;
      if (n.autoFrozen) cb.current.onThawAutoFreeze?.(n.autoFrozen);
      const targets: [WidgetTarget, number][] = [];
      for (const [name, value] of Object.entries(changes)) {
        const t = widgetTarget(
          n,
          { type: "knob", col: 0, row: 0, bind: name },
          ch.offlineChannel,
        );
        if (t?.kind === "plugin" || t?.kind === "offline")
          targets.push([t, value]);
      }
      if (!commit) {
        setOverride((o) => {
          const next = { ...o };
          for (const [t, v] of targets) next[targetKey(t)] = v;
          return next;
        });
        for (const [t, v] of targets) sendLive(t, v);
        return;
      }
      const module = n.module;
      if (!module || rehearsalRef.current) return;
      // One after the other: two writes to one module file must not race.
      let chain: Promise<unknown> = Promise.resolve();
      for (const [t, v] of targets)
        if (t.kind === "plugin")
          chain = chain.then(() =>
            cb.current.command(
              `node param ${module} ${JSON.stringify(t.name)} ${v}`,
            ),
          );
    },
    [sendLive, setOverride],
  );
  // …and the same changes on every LINKED node — multiSelect.ts.
  const lcdSet = useCallback<LcdSet>(
    (n, changes, commit) => {
      lcdOne(n, changes, commit);
      for (const m of linked(n)) lcdOne(m, changes, commit);
    },
    [lcdOne, linked],
  );

  // Global pointer handling — pan, widget drag, gesture settle. Bound once; a movement threshold gates selection.
  const pan = useRef<{
    sx: number;
    sy: number;
    cx: number;
    cy: number;
    moved: number;
  } | null>(null);
  const suppressClick = useRef(false);
  // A Shift+drag over empty space: the rectangle, in HOST pixels, that selects what it touches on release.
  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  const marqueeRef = useRef(marquee);
  useEffect(() => {
    /** A gesture taken away — cancelled, focus lost, a release that happened outside: undone, and nothing written. */
    const cancel = () => {
      if (marqueeRef.current) {
        marqueeRef.current = null;
        setMarquee(null);
      }
      const d = drag.current;
      if (d) {
        drag.current = null;
        // The engine heard the drag live, so it is told the value back; the knob then shows the file's again.
        if (d.tgt.kind === "plugin" || d.tgt.kind === "offline") {
          sendLive(d.tgt, d.from);
          if (d.pair) sendLive(d.pair, pairValue(d.w, d.from));
          for (const l of d.linked) {
            const v = linkedValue(d.w, l.startT, d.startT, d.startT);
            sendLive(l.tgt, v);
            if (l.pair) sendLive(l.pair, pairValue(d.w, v));
          }
        }
        const keys = [
          d.key,
          d.pair && targetKey(d.pair),
          ...d.linked.flatMap((l) => [
            targetKey(l.tgt),
            l.pair && targetKey(l.pair),
          ]),
        ];
        setOverride((o) => {
          const next = { ...o };
          for (const k of keys) if (k) delete next[k];
          return next;
        });
      }
      if (pan.current) {
        pan.current = null;
        setPanning(false);
      }
    };
    const move = (e: PointerEvent) => {
      // A mouse with no button down while a gesture runs: its release happened where this window could not hear it.
      if (
        e.pointerType === "mouse" &&
        e.buttons === 0 &&
        (drag.current || marqueeRef.current || pan.current)
      )
        return cancel();
      const mq = marqueeRef.current;
      if (mq) {
        const r = hostRef.current?.getBoundingClientRect();
        marqueeRef.current = {
          ...mq,
          x1: e.clientX - (r?.left ?? 0),
          y1: e.clientY - (r?.top ?? 0),
        };
        setMarquee(marqueeRef.current);
        return;
      }
      const d = drag.current;
      if (d) {
        const dy = (d.startY - e.clientY) / d.travel;
        const t = d.startT + dy * (e.shiftKey ? DRAG_FINE : 1);
        const value = widgetDenorm(d.w, t);
        if (value === d.value) return;
        d.value = value;
        const dry = d.pair ? pairValue(d.w, value) : null;
        setOverride((o) => {
          const next = {
            ...o,
            [d.key]: value,
            ...(d.pair && dry !== null ? { [targetKey(d.pair)]: dry } : {}),
          };
          // The same TRAVEL, not the same value: each linked knob keeps its offset from the one in hand.
          for (const l of d.linked) {
            l.value = linkedValue(d.w, l.startT, d.startT, t);
            next[targetKey(l.tgt)] = l.value;
            if (l.pair) next[targetKey(l.pair)] = pairValue(d.w, l.value);
          }
          return next;
        });
        // Coalesce to one live send per frame; only a plugin param feeds live (a track knob persists on release).
        if (!d.sent && (d.tgt.kind === "plugin" || d.tgt.kind === "offline")) {
          d.sent = true;
          requestAnimationFrame(() => {
            const cur = drag.current;
            if (!cur) return;
            cur.sent = false;
            for (const t of [cur, ...cur.linked]) {
              sendLive(t.tgt, t.value);
              if (t.pair) sendLive(t.pair, pairValue(cur.w, t.value));
            }
          });
        }
        return;
      }
      const p = pan.current;
      if (!p) return;
      const nx = e.clientX - p.sx;
      const ny = e.clientY - p.sy;
      p.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (p.moved > DRAG_SLOP) {
        setPanning(true);
        setHovered(null);
        userMoved.current = true; // the camera is theirs now — stop auto-framing
        // Both axes and no glide, unless the graph is a ROW — docs/camera.md.
        cam.current.x = goal.current.x = p.cx + nx;
        if (!rowRef.current) cam.current.y = goal.current.y = p.cy + ny;
        kick.current();
      }
    };
    const up = () => {
      const mq = marqueeRef.current;
      if (mq) {
        marqueeRef.current = null;
        setMarquee(null);
        // Host pixels to world through the camera, both corners, then every card the box touches joins the selection.
        const c = cam.current;
        const caught = nodesInBox(nodesRef.current, {
          x0: (mq.x0 - c.x) / c.k,
          y0: (mq.y0 - c.y) / c.k,
          x1: (mq.x1 - c.x) / c.k,
          y1: (mq.y1 - c.y) / c.k,
        });
        if (caught.length) {
          const primary = selRef.current;
          setMulti((cur) => {
            const next = new Set(cur.size ? cur : primary ? [primary] : []);
            for (const name of caught) next.add(name);
            return next;
          });
          if (!primary) cb.current.onSelect(caught[0]);
        }
        return;
      }
      const d = drag.current;
      if (d) {
        drag.current = null;
        if (d.value === d.from) {
          // A click, or the two presses of a double-click: nothing moved, so nothing is written.
        } else if (d.tgt.kind === "track") {
          if (d.tgt.control === "volume" || d.tgt.control === "pan")
            cb.current.onTrackSet?.(d.tgt.trackId, d.tgt.control, d.value);
          // A module FIELD is a named setting, not a range, so a drag onto one commits nothing.
        } else if (
          d.tgt.kind === "plugin" &&
          d.node.module &&
          !rehearsalRef.current
        ) {
          // Not in a rehearsal: this line WRITES the value into the module's file — docs/hosting.md.
          commitParam(d.node.module, d.tgt, d.value, d.pair, d.w);
          for (const l of d.linked)
            if (l.node.module)
              commitParam(l.node.module, l.tgt, l.value, l.pair, d.w);
        }
        // The override stays until the matching frame arrives (see the reconcile effects).
      }
      if (pan.current) {
        suppressClick.current = pan.current.moved > DRAG_SLOP;
        pan.current = null;
        setPanning(false);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
    };
  }, [setOverride]);

  const onPointerDown = (e: React.PointerEvent) => {
    // Shift on EMPTY space draws a selection box instead of panning — even where the camera is fixed.
    if (
      e.shiftKey &&
      e.button === 0 &&
      !(e.target as HTMLElement).closest(".dgx-node")
    ) {
      const r = hostRef.current?.getBoundingClientRect();
      const x = e.clientX - (r?.left ?? 0);
      const y = e.clientY - (r?.top ?? 0);
      marqueeRef.current = { x0: x, y0: y, x1: x, y1: y };
      setMarquee(marqueeRef.current);
      e.preventDefault();
      return;
    }
    if (fixedRef.current) return;
    flight.current = null;
    // Grabbing the canvas ends any zoom still in flight: you are steering now — docs/camera.md.
    goal.current.k = cam.current.k;
    pan.current = {
      sx: e.clientX,
      sy: e.clientY,
      cx: cam.current.x,
      cy: cam.current.y,
      moved: 0,
    };
  };

  // The camera loop, the wheel and the pinch, bound once and writing only refs — docs/camera.md.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    let last = 0;
    const step = (t: number) => {
      // Clamped: a backgrounded tab hands back one enormous dt, which would land the glide at once.
      const dt = last ? Math.min(100, t - last) : 16;
      last = t;
      const c = cam.current;
      const g = goal.current;
      let moving = pan.current != null;
      // The cards, before the camera: `motionStep` rebuilds the cable draws for this frame.
      if (motions.current.size) {
        const still = motionStep.current(dt);
        moving = moving || still;
        if (!still) settleMotion.current();
      }
      const fl = flight.current;
      if (fl) {
        const next = flyStep(
          c,
          fl,
          approach(dt, flightHalf.current),
          host.clientWidth,
          host.clientHeight,
        );
        Object.assign(c, next);
        Object.assign(g, next);
        if (next.k === fl.k && next.x === fl.x && next.y === fl.y)
          flight.current = null;
        else moving = true;
      }
      if (c.k !== g.k) {
        // Within a thousandth of the goal, land on it — an exponential never quite arrives.
        const near = Math.abs(g.k - c.k) <= c.k * 1e-3;
        const k = near ? g.k : c.k + (g.k - c.k) * approach(dt);
        Object.assign(c, zoomAbout(c, k, anchor.current.px, anchor.current.py));
        Object.assign(g, { x: c.x, y: c.y });
        moving = moving || !near;
      }
      applyCam(worldRef.current, c);
      paintRef.current(); // the canvas is outside `.dgx-world`, so the transform misses it
      const next = lodFor(c.k);
      if (!sameLod(next, lodRef.current)) {
        lodRef.current = next;
        setLod(next);
      }
      if (moving) raf = requestAnimationFrame(step);
      else {
        raf = 0;
        last = 0;
        persistRef.current(); // settled — this is the camera worth remembering
      }
    };
    kick.current = () => {
      if (!raf) {
        last = 0;
        raf = requestAnimationFrame(step);
      }
    };
    // Non-passive: it must preventDefault, and a React onWheel would allocate an event per notch.
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      // A tab column longer than its card scrolls under the wheel, as a list does, instead of moving the camera.
      const col = (e.target as Element | null)?.closest?.(".dgx-tabs");
      if (
        col instanceof HTMLElement &&
        col.scrollHeight > col.clientHeight &&
        !e.ctrlKey
      ) {
        col.scrollTop += wheelPixels(e.deltaY, e.deltaMode, col.clientHeight);
        return;
      }
      if (fixedRef.current) return;
      flight.current = null;
      userMoved.current = true; // either way, the camera is theirs now — stop auto-framing
      if (rowRef.current) {
        // A ROW is read across: the wheel walks along it, whatever axis the device reports.
        const c = cam.current;
        const g = goal.current;
        g.k = c.k;
        c.x = g.x =
          g.x -
          wheelPixels(e.deltaX || e.deltaY, e.deltaMode, host.clientWidth);
      } else if (isZoomWheel(e) || isMouseWheel(e)) {
        const r = host.getBoundingClientRect();
        anchor.current = { px: e.clientX - r.left, py: e.clientY - r.top };
        // Multiplied onto the GOAL, and `e.ctrlKey` marks a PINCH with its own rate — docs/camera.md.
        goal.current.k = clampZoom(
          goal.current.k *
            wheelFactor(e.deltaY, e.deltaMode, host.clientHeight, e.ctrlKey),
        );
      } else {
        // Two fingers on a SURFACE: the camera moves WITH them, 1:1 and with no glide, in screen px.
        const c = cam.current;
        const g = goal.current;
        g.k = c.k; // a slide takes over from any zoom still in flight, as a pointer-down does
        c.x = g.x = g.x - wheelPixels(e.deltaX, e.deltaMode, host.clientWidth);
        c.y = g.y = g.y - wheelPixels(e.deltaY, e.deltaMode, host.clientHeight);
      }
      kick.current();
    };
    host.addEventListener("wheel", wheel, { passive: false });

    // Two fingers where there is no wheel at all — TOUCH events, and absolute, docs/camera.md.
    let pinch: { dist: number; k: number; x: number; y: number } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2 || fixedRef.current) return;
      flight.current = null;
      pan.current = null; // a pinch is not a pan, whatever the first finger had started
      setPanning(false);
      pinch = { dist: spreadOf(e.touches[0], e.touches[1]), ...cam.current };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const d = spreadOf(e.touches[0], e.touches[1]);
      if (d <= 0) return;
      const r = host.getBoundingClientRect();
      const px = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
      const py = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
      userMoved.current = true;
      const k = clampZoom(pinch.k * pinchFactor(pinch.dist, d));
      // From the gesture's OWN starting camera, which is what makes the whole pinch absolute.
      Object.assign(cam.current, zoomAbout(pinch, k, px, py));
      Object.assign(goal.current, cam.current);
      kick.current();
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    host.addEventListener("touchstart", onTouchStart, { passive: false });
    host.addEventListener("touchmove", onTouchMove, { passive: false });
    host.addEventListener("touchend", onTouchEnd);
    host.addEventListener("touchcancel", onTouchEnd);

    return () => {
      host.removeEventListener("wheel", wheel);
      host.removeEventListener("touchstart", onTouchStart);
      host.removeEventListener("touchmove", onTouchMove);
      host.removeEventListener("touchend", onTouchEnd);
      host.removeEventListener("touchcancel", onTouchEnd);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // --- the double-click camera: onto a node, and back to where it was — docs/camera.md -----
  const flyTo = useCallback((to: Cam) => {
    userMoved.current = true; // a camera somebody asked for; no resize re-frames it away
    goal.current.k = cam.current.k; // a zoom still gliding gives way, as it does to a press
    flightHalf.current = undefined;
    flight.current = to;
    kick.current();
  }, []);
  const zoomToNode = useCallback(
    (n: GraphNode) => {
      const host = hostRef.current;
      // A ROW is walked along rather than zoomed into — docs/camera.md.
      if (!host || rowRef.current || fixedRef.current) return;
      // The view before the FIRST node visited, however many are visited after it.
      before.current ??= { ...cam.current };
      flyTo(
        frameBox(
          { x: n.x, y: n.y, w: n.w, h: n.h },
          host.clientWidth,
          host.clientHeight,
        ),
      );
    },
    [flyTo],
  );
  // Only on the BARE canvas: a card, a badge, a socket or a cable is not empty space.
  const canvasDoubleClick = (e: React.MouseEvent) => {
    if (
      (e.target as Element).closest(
        ".dgx-node, .dgx-frame, .dgx-alts, .dgx-engine, .dgx-port, .dgx-hit, .dgx-ins-btn",
      )
    )
      return;
    const back = before.current;
    if (!back) return;
    before.current = null;
    flyTo(back);
  };

  // The minimap: a press puts the pane's centre there, and "Zoom fit" is the first frame again.
  const centerOn = useCallback((wx: number, wy: number) => {
    const { w, h } = hostSize.current;
    const k = cam.current.k;
    flight.current = null;
    userMoved.current = true;
    placeRef.current({ k, x: w / 2 - wx * k, y: h / 2 - wy * k });
  }, []);
  const zoomFit = useCallback(() => {
    flight.current = null;
    before.current = null;
    // The camera is the graph's again: a resize re-frames it, as it did before anybody moved it.
    userMoved.current = false;
    fit.current();
  }, []);

  // --- node + widget actions ---------------------------------------------------------
  const tapNode = useCallback((n: GraphNode, shift?: boolean) => {
    if (suppressClick.current) return; // that click ended a pan
    const selected = selRef.current;
    // Shift+click grows or shrinks the selection; the host's single one is set only when there was none.
    if (shift && n.kind === "module" && n.module) {
      const name = n.module;
      setMulti((cur) => toggleSelection(cur, selected, name));
      if (!selected) cb.current.onSelect(name);
      return;
    }
    setMulti(EMPTY_SET);
    cb.current.onPickModule?.(n.kind === "module" ? (n.module ?? null) : null);
    if (n.kind === "module" && n.module) {
      cb.current.onSelect(selected === n.module ? null : n.module);
    } else if (n.chain) {
      cb.current.onSelect(selected === n.chain ? null : n.chain);
    }
  }, []);
  const contextNode = useCallback((n: GraphNode, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ctx = nodeToCtx(n);
    if (ctx) cb.current.onContextMenu?.(ctx, e.clientX, e.clientY);
  }, []);
  // Right-click on a CONTROL: the menu for the PLUGIN param it drives, and only that — docs/widgets.md.
  const contextParam = useCallback(
    (n: GraphNode, w: WebWidget, x: number, y: number): void => {
      // A PAD's menu is its kit's — the node and the sound — rather than a param's (packages/song/docs/racks.md).
      const symbol = rackBindSymbol(w.bind);
      if (symbol && n.module) {
        cb.current.onContextMenu?.({ kind: "tap", id: n.module, symbol }, x, y);
        return;
      }
      if (!n.module || !w.bind || w.bind.startsWith("@") || !n.pluginId) return;
      cb.current.onContextMenu?.(
        {
          kind: "param",
          id: n.module,
          param: w.bind,
          label: w.label || w.bind,
          cc: n.cc?.[w.bind],
          automated: edgesRef.current.some(
            (e) => e.target === n.id && e.automation?.param === w.bind,
          ),
        },
        x,
        y,
      );
    },
    [],
  );
  // The plugin's OWN window: the verb names an INSTANCE, since a window belongs to what is loaded.
  // Which VST's render holds each node, by module — so the plugin bubble can thaw it first.
  const autoFrozenOf = useRef<Record<string, string>>({});
  autoFrozenOf.current = Object.fromEntries(
    graph.nodes.flatMap((n) =>
      n.module && n.autoFrozen ? [[n.module, n.autoFrozen]] : [],
    ),
  );
  const openPlugin = useCallback((module: string) => {
    // A baked VST has no window to open: thaw its freeze, then ask.
    const at = autoFrozenOf.current[module];
    if (at) cb.current.onThawAutoFreeze?.(at);
    void cb.current.command(`node external-ui ${module}`);
  }, []);
  // Bare `node bypass` toggles, and NOT the quiet path: bypass changes the graph's shape, so it must reload.
  const bypassModule = useCallback(
    (module: string) => cb.current.onBypassModule?.(module),
    [],
  );
  // The badge only ASKS: which command switches or copies a set is the host's — docs/hosting.md.
  const pickAlternative = useCallback(
    (module: string, name: string | null) =>
      cb.current.onAlternative?.(module, name),
    [],
  );
  // …and so does the engine dropdown.
  const pickEngine = useCallback(
    (module: string, name: string) => cb.current.onEngine?.(module, name),
    [],
  );
  // …and so does the preset dropdown, which the host draws.
  const pickPresets = useCallback(
    (module: string, x: number, y: number, engines?: NodeEngines) =>
      cb.current.onPresets?.(module, x, y, engines),
    [],
  );
  // …and its arrows, which load the neighbouring preset.
  const stepPresets = useCallback(
    (module: string, step: -1 | 1) => cb.current.onPresetStep?.(module, step),
    [],
  );
  // The widget only ASKS, and the shell writes what comes back — an asset loads at BUILD time.
  const pickAsset = useCallback(
    (n: GraphNode, param: string, x: number, y: number, family?: string) => {
      if (n.module) cb.current.onAssetBrowse?.(n.module, param, x, y, family);
    },
    [],
  );
  // What feeds a track: the list is the MACHINE's — its interface, its channel labels.
  const pickTrackInput = useCallback((n: GraphNode, x: number, y: number) => {
    cb.current.onPickTrackInput?.(n.label, x, y);
  }, []);
  // Commit a module FIELD into its own file — no optimism and no socket, docs/widgets.md.
  const setModuleField = useCallback(
    (
      // The whole target, not just its two names: a rehearsal keys its override by it.
      w: WebWidget,
      tgt: { kind: "module"; module: string; field: string },
      value: number,
    ) => {
      const opt = w.options?.find((o) => o.value === value);
      if (!opt) return; // a field with no named settings — nothing to write
      // A rehearsal shows the pick and writes nothing, so the override is all that can answer.
      if (rehearsal) {
        setOverride((o) => ({ ...o, [targetKey(tgt)]: value }));
        return;
      }
      // `arg` where the entry SAYS one thing and SETS another, and the field is named as the WIDGET does.
      const line = `node param ${tgt.module} @${tgt.field} ${opt.arg ?? opt.label}`;
      // The RELOADING sender when the host wired one: this control shows the file and nothing else,
      // so a command that brings no graph back leaves it on the old value. See docs/widgets.md.
      void (cb.current.onModuleField ?? cb.current.command)(line);
    },
    [rehearsal, setOverride],
  );

  // A dropdown's chosen setting: the same commit path as a toggle, but the value is the option's, not a flip.
  const pickOne = useCallback(
    (n: GraphNode, w: WebWidget, value: number) => {
      const tgt = widgetTarget(n, w, chRef.current.offlineChannel);
      // A track intrinsic has no named settings, and a pad and a recorder button no value at
      // all: none of the three can be SET here.
      if (
        !tgt ||
        tgt.kind === "track" ||
        tgt.kind === "rack" ||
        tgt.kind === "recorder"
      )
        return;
      if (tgt.kind === "module") {
        setModuleField(w, tgt, value);
        return;
      }
      // A PROJECT setting travels as the option's WORD, not its index: `project aspect 16:9` is
      // what a person would type, and the row's position is this card's business alone.
      if (tgt.kind === "project") {
        const opt = w.options?.find((o) => o.value === value);
        if (opt) cb.current.onProjectField?.(tgt.field, opt.arg ?? opt.label);
        return;
      }
      const pair = pairTarget(n, w, chRef.current.offlineChannel);
      // A crossfade knob's dry half moves with the wet one, on screen and in the engine alike.
      const dry = pair ? pairValue(w, value) : 0;
      setOverride((o) => ({
        ...o,
        [targetKey(tgt)]: value,
        ...(pair ? { [targetKey(pair)]: dry } : {}),
      }));
      if (tgt.kind === "offline") {
        sendLive(tgt, value);
        if (pair) sendLive(pair, dry);
        return;
      }
      sendLive(tgt, value);
      if (pair) sendLive(pair, dry);
      if (n.module && !rehearsal) commitParam(n.module, tgt, value, pair, w);
    },
    [setModuleField, rehearsal, sendLive, commitParam, setOverride],
  );
  // …and on every LINKED node too, with the same value — multiSelect.ts.
  const pickWidget = useCallback(
    (n: GraphNode, w: WebWidget, value: number) => {
      pickOne(n, w, value);
      for (const m of linked(n)) pickOne(m, w, value);
    },
    [pickOne, linked],
  );

  // A tap only ASKS: which command writes the kit is the host's, and so is the sample picker.
  const editTap = useCallback((n: GraphNode, action: TapAction) => {
    if (n.module) cb.current.onTapEdit?.(n.module, action);
  }, []);

  // A TYPED value: one step of what a drag does, committed at once — docs/widgets.md.
  const typeWidget = useCallback(
    (n: GraphNode, w: WebWidget, value: number) => {
      // The same two gates a drag has: a baked module has no plugin, an automatic freeze gives way.
      if (n.frozen && n.kind === "module") return;
      if (n.autoFrozen) cb.current.onThawAutoFreeze?.(n.autoFrozen);
      const tgt = widgetTarget(n, w, chRef.current.offlineChannel);
      if (tgt?.kind !== "track") return pickWidget(n, w, value);
      // A lane's level and pan, the two a drag commits; a toggle is never typed.
      if (tgt.control !== "volume" && tgt.control !== "pan") return;
      setOverride((o) => ({ ...o, [targetKey(tgt)]: value }));
      cb.current.onTrackSet?.(tgt.trackId, tgt.control, value);
    },
    [pickWidget, setOverride],
  );

  const tapWidget = useCallback(
    (n: GraphNode, w: WebWidget) => {
      const ch = chRef.current;
      const tgt = widgetTarget(n, w, ch.offlineChannel);
      if (!tgt) return;
      if (tgt.kind === "track") {
        // Mute/solo/arm: no optimism, so a rapid double-click can't leave the button inverted against the file.
        if (
          tgt.control === "mute" ||
          tgt.control === "solo" ||
          tgt.control === "arm" ||
          tgt.control === "highlight"
        )
          cb.current.onTrackToggle?.(tgt.trackId, tgt.control);
        return;
      }
      // A RECORDER's button fires and is done, exactly as a pad does: no optimistic value, since
      // the state frame answers at 20 Hz and a light that lied about a refusal is worse.
      if (tgt.kind === "recorder") {
        cb.current.onRecorder?.(tgt.verb, {
          module: tgt.module,
          pluginId: tgt.pluginId,
        });
        return;
      }
      // A RACK pad fires its sound and is done: no override to place, nothing to commit.
      if (tgt.kind === "rack") {
        cb.current.onTriggerRack?.(tgt.module, tgt.symbol);
        return;
      }
      // A project setting is a dropdown and is PICKED, never flipped — see `pickWidget`.
      if (tgt.kind === "project") return;
      // A module field cycles through its own named settings — there is no 0/1 to flip.
      if (tgt.kind === "module") {
        const opts = w.options ?? [];
        const at = opts.findIndex((o) => o.value === widgetValue(n, w, ch));
        const next = opts[(at + 1) % (opts.length || 1)];
        if (next) {
          setModuleField(w, tgt, next.value);
          // The linked nodes take the SAME setting, not each its own next one.
          for (const m of linked(n)) pickOne(m, w, next.value);
        }
        return;
      }
      // A plugin toggle has no such round-trip: set it 0/1 down the socket, optimistically, and commit at once.
      const cur = widgetValue(n, w, ch);
      const on = cur !== undefined && widgetNorm(w, cur) >= 0.5;
      const next = widgetDenorm(w, on ? 0 : 1);
      setOverride((o) => ({ ...o, [targetKey(tgt)]: next }));
      // The linked nodes are SET to where this one lands, so a flip never leaves them out of step.
      for (const m of linked(n)) pickOne(m, w, next);
      if (tgt.kind === "offline") {
        cb.current.onModuleParam?.(tgt.module, tgt.name, next);
        return;
      }
      cb.current.setPluginParam?.(tgt.pluginId, tgt.name, next);
      if (n.module && !rehearsal)
        cb.current.command(
          `node param ${n.module} ${JSON.stringify(tgt.name)} ${next}`,
        );
    },
    [setModuleField, rehearsal, linked, pickOne, setOverride],
  );
  const insert = useCallback(
    (info: EdgeInsert, x: number, y: number, at: { x: number; y: number }) => {
      if (suppressClick.current) return;
      cb.current.onEdgeInsert?.(info, x, y, at);
    },
    [],
  );

  // --- the patch cable: one loose end, landing on connect or replug (docs/hosting.md) ---
  const [patch, setPatch] = useState<{
    /** WHAT is being drawn, because the three cables land on different things — docs/hosting.md. */
    kind?: "signal" | "automation" | "event";
    /** The curve this cable belongs to, on both of the two that involve one. */
    curve?: { curve: string; module?: string; param?: string };
    type: WebSignal;
    seeking: "in" | "out"; // which side of a jack lands the loose end
    fixedRef: string; // the plugged end's chains address
    fixedNode: string; // …the node it is ON, which is the one jack gating must NOT offer
    fixedAt: { x: number; y: number }; // …and its socket, where the temp cable is pinned
    // The arrow this WAS, when an existing cable was lifted — absent for a new one.
    edge?: { id: string; from: string; to: string };
  } | null>(null);
  const patchRef = useRef(patch);
  patchRef.current = patch;
  const patchEl = useRef<SVGPathElement | null>(null);
  // The laid-out graph, in a ref, so `tapJack` stays stable while reading the current layout.
  const graphRef = useRef(graph);
  graphRef.current = graph;

  // Screen → world, the inverse of the camera `applyCam` writes — the one place that needs it.
  const toWorld = useCallback((cx: number, cy: number) => {
    const r = hostRef.current?.getBoundingClientRect();
    const c = cam.current;
    return {
      x: (cx - (r?.left ?? 0) - c.x) / c.k,
      y: (cy - (r?.top ?? 0) - c.y) / c.k,
    };
  }, []);

  /** The dashed promise HANGS like the cable it becomes; `f` is always the OUT end. */
  const patchD = (f: { x: number; y: number }, t: { x: number; y: number }) =>
    smoothPath(hangPoints(f, t));

  // The ref is written before the state lands, because `rebuildCables` reads the ref.
  const setPatchNow = (next: typeof patchRef.current): void => {
    patchRef.current = next;
    setPatch(next);
    rebuildCables.current();
    paintRef.current();
  };

  // The socket THIS press armed from, so its own release lands nothing; cleared by every release.
  const armedFrom = useRef<string | null>(null);

  /** The loose end went into `p`: a lifted cable moves one of its ends, a new one is drawn. */
  const landPatch = (
    cur: NonNullable<typeof patchRef.current>,
    n: GraphNode,
    p: Jack,
  ): void => {
    const landed = jackRef(n, p.name);
    if (cur.edge) {
      const nf = cur.seeking === "out" ? landed : cur.edge.from;
      const nt = cur.seeking === "in" ? landed : cur.edge.to;
      cb.current.onReplug?.(cur.edge.from, cur.edge.to, nf, nt);
    } else {
      cb.current.onConnect?.(cur.fixedRef, landed);
    }
    setPatchNow(null);
  };

  // The three halves of the two curve cables, committing through ONE callback — docs/hosting.md.
  const startAutomation = useCallback((n: GraphNode) => {
    suppressClick.current = false;
    if (!n.curveOf) return;
    setPatchNow({
      kind: "automation",
      curve: n.curveOf,
      type: "event", // mauve, and never type-matched against a signal jack
      seeking: "in",
      fixedRef: n.id,
      fixedNode: n.id,
      fixedAt: curveOutPoint(n),
    });
  }, []);

  const landAutomation = useCallback((n: GraphNode, w: WebWidget) => {
    const cur = patchRef.current;
    if (!cur?.curve || !n.module || !w.bind) return;
    cb.current.onAutomate?.(n.module, w.bind, cur.curve.curve);
    setPatchNow(null);
  }, []);

  const startEvent = useCallback((n: GraphNode, event: string) => {
    suppressClick.current = false;
    setPatchNow({
      kind: "event",
      type: "event",
      seeking: "in",
      fixedRef: n.id,
      fixedNode: n.id,
      fixedAt: eventPoint(n, "out", Math.max(0, n.events?.indexOf(event) ?? 0)),
      // The module the note-on leaves — what becomes the binding's `trigger`.
      curve: { curve: "", module: n.module ?? n.label },
    });
  }, []);

  const landEvent = useCallback((n: GraphNode) => {
    const cur = patchRef.current;
    const b = n.curveOf;
    // A free card has no binding to write a trigger onto — the second guard, not the only one.
    if (cur?.kind !== "event" || !b?.module || !b.param) return;
    cb.current.onAutomate?.(b.module, b.param, b.curve, cur.curve?.module);
    setPatchNow(null);
  }, []);

  const tapJack = useCallback(
    (
      n: GraphNode,
      side: "in" | "out",
      p: Jack,
      index: number,
      phase: "down" | "up",
    ) => {
      const cur = patchRef.current;
      const here = jackRef(n, p.name);
      // A press STARTS a gesture, so it clears the flag itself: no pointerup will — docs/hosting.md.
      if (phase === "down") suppressClick.current = false;
      const act = patchAct(phase, !!cur, armedFrom.current, here);
      if (phase === "up" || act === "land") {
        // NodeInner arms only jacks of the seeking side, free and type-matched: land it.
        if (cur && act === "land") landPatch(cur, n, p);
        armedFrom.current = null;
        return;
      }
      armedFrom.current = here;
      if (p.free) {
        // A free OUT jack starts a NEW cable (a free IN jack is never armed at rest).
        setPatchNow({
          type: p.type,
          seeking: "in",
          fixedRef: jackRef(n, p.name),
          fixedNode: n.id,
          fixedAt: jackPoint(n, "out", index),
        });
        return;
      }
      // An occupied jack lifts the FIRST signal cable's end off it, where a drop has somewhere to go.
      if (!cb.current.onReplug || !cb.current.onDisconnect) return;
      const g = graphRef.current;
      // Matched by the port the cable NAMES — or the FIRST jack when it names none, docs/hosting.md.
      const portOf = (ed: GraphEdge) =>
        (side === "out" ? ed.sourcePort : ed.targetPort) ?? undefined;
      const e = g.edges.find(
        (ed) =>
          !ed.automation &&
          (side === "out" ? ed.source : ed.target) === n.id &&
          (portOf(ed) === (p.name ?? undefined) ||
            (portOf(ed) === undefined && index === 0)),
      );
      if (!e) return; // only automation plugs here — those cables are edited on the module
      const src = g.nodes.find((x) => x.id === e.source);
      const tgt = g.nodes.find((x) => x.id === e.target);
      if (!src || !tgt) return;
      const from = jackRef(src, e.sourcePort);
      const to = jackRef(tgt, e.targetPort);
      const inIndex = Math.max(
        0,
        tgt.jacks?.in.findIndex((j) => j.name === e.targetPort) ?? 0,
      );
      const outIndex = Math.max(
        0,
        src.jacks?.out.findIndex((j) => j.name === e.sourcePort) ?? 0,
      );
      setPatchNow(
        side === "out"
          ? {
              // The source end comes off: the loose end seeks a new OUT jack to leave from.
              type: p.type,
              seeking: "out",
              fixedRef: to,
              fixedNode: tgt.id,
              fixedAt: jackPoint(tgt, "in", inIndex),
              edge: { id: e.id, from, to },
            }
          : {
              // The target end comes off: the source stays plugged, as a new cable would be.
              type: p.type,
              seeking: "in",
              fixedRef: from,
              fixedNode: src.id,
              fixedAt: jackPoint(src, "out", outIndex),
              edge: { id: e.id, from, to },
            },
      );
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: setPatchNow reads refs only.
    [],
  );

  // Direct DOM on every move, no re-render: the cable's loose end is the cursor, 60 times a second.
  const movePatch = useCallback(
    (e: React.PointerEvent) => {
      const cur = patchRef.current;
      const el = patchEl.current;
      if (!cur || !el) return;
      const w = toWorld(e.clientX, e.clientY);
      el.setAttribute(
        "d",
        cur.seeking === "in" ? patchD(cur.fixedAt, w) : patchD(w, cur.fixedAt),
      );
    },
    [toWorld],
  );

  // What every node's jack gating reads — memoised, or a new object would re-render all the cards.
  const patchWant = useMemo(
    () =>
      patch
        ? {
            seeking: patch.seeking,
            type: patch.type,
            node: patch.fixedNode,
            kind: patch.kind ?? "signal",
          }
        : null,
    [patch],
  );

  // A cable dropped on the BARE canvas is DELETED; a new one simply ceases — docs/hosting.md.
  const canvasDrop = (e: React.MouseEvent): boolean => {
    const cur = patchRef.current;
    if (!cur || suppressClick.current) return false;
    const t = e.target as HTMLElement;
    if (t !== hostRef.current && !t.classList?.contains("dgx-world"))
      return false;
    if (cur.edge) cb.current.onDisconnect?.(cur.edge.from, cur.edge.to);
    setPatchNow(null);
    return true;
  };

  // --- dragging a node by its HEADER: the pin gesture (docs/hosting.md) --------------
  const nodeDrag = useRef<{
    n: GraphNode;
    el: HTMLElement;
    sx: number;
    sy: number;
    dx: number;
    dy: number;
    moved: boolean;
  } | null>(null);
  // Dropped, written, waiting for the reload: offsets to honour and transforms to take off later.
  const droppedNodes = useRef(
    new Map<string, { dx: number; dy: number; el: HTMLElement }>(),
  );

  // One pointer per drag, abandoned on a cancel or an unmount — @studio/ui-timeline/drag.
  const follow = usePointerFollow();
  const beginNodeDrag = useCallback(
    (n: GraphNode, e: React.PointerEvent) => {
      if (e.button !== 0) return;
      // The same press must not also arm a pan — the reason every header control stops it too.
      e.stopPropagation();
      const el = (e.currentTarget as HTMLElement).closest(
        "[data-node-id]",
      ) as HTMLElement | null;
      if (!el) return;
      // A press STARTS a gesture, so it clears the flag itself, exactly as a jack does.
      suppressClick.current = false;
      nodeDrag.current = {
        n,
        el,
        sx: e.clientX,
        sy: e.clientY,
        dx: 0,
        dy: 0,
        moved: false,
      };
      const onMove = (ev: PointerEvent) => {
        const d = nodeDrag.current;
        if (!d) return;
        const k = Math.max(cam.current.k, 0.01);
        d.dx = (ev.clientX - d.sx) / k;
        d.dy = (ev.clientY - d.sy) / k;
        if (Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) > 3)
          d.moved = true;
        d.el.style.transform = `translate(${d.dx}px, ${d.dy}px)`;
        // The cables follow live, through the same path a node MOTION takes, springs included.
        rebuildCables.current();
        paintRef.current();
      };
      const onUp = () => {
        const d = nodeDrag.current;
        nodeDrag.current = null;
        if (!d) return;
        if (!d.moved) {
          // A press that never travelled is a click, and the click is the node's own.
          d.el.style.transform = "";
          return;
        }
        // It travelled, so the click that follows is the drag's tail rather than a tap: swallow it.
        suppressClick.current = true;
        // Wherever it was let go, including ABOVE the first track or left of it — docs/hosting.md.
        const x = Math.round(d.n.x + d.dx);
        const y = Math.round(d.n.y + d.dy);
        droppedNodes.current.set(d.n.id, {
          dx: x - d.n.x,
          dy: y - d.n.y,
          el: d.el,
        });
        // Pre-seed the drawn map with the drop, so the layout landing the write plans NO slide.
        drawn.current.set(d.n.id, { node: d.n, x, y });
        rebuildCables.current();
        paintRef.current();
        cb.current.onMoveNode?.(jackRef(d.n), x, y);
      };
      // A cancel, or the graph going away mid-drag, puts the card back and moves nothing.
      const onCancel = () => {
        const d = nodeDrag.current;
        nodeDrag.current = null;
        if (!d) return;
        d.el.style.transform = "";
        rebuildCables.current();
        paintRef.current();
      };
      follow(e, { move: onMove, end: onUp, cancel: onCancel });
    },
    [follow],
  );

  // Esc or ANY right-click puts the cable in hand BACK, in the CAPTURE phase and writing nothing.
  useEffect(() => {
    if (!patch) return;
    const back = () => {
      patchRef.current = null;
      setPatch(null);
      rebuildCables.current();
      paintRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      back();
    };
    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      back();
    };
    window.addEventListener("keydown", onKey, true);
    const host = hostRef.current;
    host?.addEventListener("contextmenu", onCtx, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      host?.removeEventListener("contextmenu", onCtx, true);
    };
  }, [patch]);
  // Right-click on EMPTY canvas — the picker, for a module that lands wired to nothing.
  const canvasMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const t = e.target as Node;
    if (
      t !== hostRef.current &&
      !(t as HTMLElement).classList?.contains("dgx-world")
    )
      return;
    // The click's WORLD point rides along: the module picked will be born exactly there.
    cb.current.onCanvasInsert?.(
      e.clientX,
      e.clientY,
      toWorld(e.clientX, e.clientY),
    );
  };

  const showWidgets = alwaysDetailed || lod.widgets;
  const showLabels = alwaysDetailed || lod.labels;
  // Too far for the widgets ⇒ nodes draw as a fitted name instead (see Node's far branch).
  const far = !showWidgets;

  // Where the meters read their levels — PROVIDED here rather than demanded, docs/hosting.md.
  const ownStore = useRef<EngineStore | null>(null);
  ownStore.current ??= new EngineStore();
  const meterStore = hostStore ?? ownStore.current;
  // A host that passes no `sounds` may still provide them ABOVE the graph, once for every graph it mounts.
  const inheritedSounds = useContext(LcdSoundsContext);

  return (
    <EngineStoreProvider value={meterStore}>
      <IconsContext.Provider value={icons}>
        <LcdSetContext.Provider value={lcdSet}>
          <LcdSoundsContext.Provider value={sounds ?? inheritedSounds}>
            <LcdZoomContext.Provider value={lcdZoom}>
              <div
                ref={hostRef}
                className={`dgx${panning ? " panning" : ""}`}
                onPointerDown={onPointerDown}
                onDoubleClick={canvasDoubleClick}
                // Bound only while a cable is in hand — the graph pays nothing for the gesture at rest.
                onPointerMove={patch ? movePatch : undefined}
                onClick={patch ? canvasDrop : undefined}
                onContextMenu={canvasMenu}
                style={{ cursor: hovered ? "pointer" : undefined }}
              >
                {/* The signal cables, OUTSIDE `.dgx-world`: a canvas scaled by CSS goes blurry, so the camera is applied to the 2D context. */}
                <canvas ref={cvRef} className="dgx-cablecv" />
                {marquee && (
                  <div
                    className="dgx-marquee"
                    style={{
                      left: Math.min(marquee.x0, marquee.x1),
                      top: Math.min(marquee.y0, marquee.y1),
                      width: Math.abs(marquee.x1 - marquee.x0),
                      height: Math.abs(marquee.y1 - marquee.y0),
                    }}
                  />
                )}
                {/* No `transform` here: the frame loop writes the camera onto this element, so React never fights a gesture. */}
                <div className="dgx-world" ref={worldRef}>
                  <svg
                    className="dgx-cables"
                    ref={cablesSvg}
                    width={graph.width}
                    height={graph.height}
                  >
                    <Cables
                      signal={model.signal}
                      auto={model.auto}
                      showLabels={showLabels}
                      hovered={hovered}
                      setHovered={setHovered}
                      onInsert={onEdgeInsert ? insert : undefined}
                    />
                    {/* The cable in hand, moved by movePatch off-React, in the world SVG so jackPoint's coordinates hold. */}
                    {patch && (
                      <path
                        ref={patchEl}
                        className="dgx-patchcable"
                        style={{ stroke: cableColorFor(patch.type) }}
                        d={patchD(patch.fixedAt, patch.fixedAt)}
                      />
                    )}
                  </svg>
                  {/* On their way out, before the live nodes so an arriving card paints over the one it replaces. */}
                  {ghosts.map((g) => (
                    <Node
                      key={`gone:${g.node.id}`}
                      n={{ ...g.node, x: g.x, y: g.y }}
                      selected={null}
                      showWidgets={showWidgets}
                      far={far}
                      ch={ch}
                      trackOrder={EMPTY_ORDER}
                      onTapNode={NOOP}
                      onContext={NOOP}
                      onOpenPlugin={NOOP}
                      onBypass={NOOP}
                      onDragStart={NOOP}
                      onTapWidget={NOOP}
                      onPickWidget={NOOP}
                      onPickAsset={NOOP}
                      onPickTrackInput={NOOP}
                      onContextParam={NOOP}
                    />
                  ))}
                  {graph.nodes.map((n) => (
                    <Node
                      key={n.id}
                      n={n}
                      selected={selected}
                      hostTab={openTabs?.[n.id]}
                      onOpenTab={onOpenTab}
                      inSelection={!!n.module && multi.has(n.module)}
                      marked={marked?.(n) ?? false}
                      automated={automatedOf.get(n.id)}
                      showWidgets={showWidgets}
                      far={far}
                      ch={ch}
                      trackOrder={trackOrder ?? EMPTY_ORDER}
                      onTapNode={tapNode}
                      onContext={contextNode}
                      onOpenPlugin={openPlugin}
                      onBypass={bypassModule}
                      onToggleAssembly={onToggleAssembly}
                      onAlternative={
                        onAlternative ? pickAlternative : undefined
                      }
                      onEngine={onEngine ? pickEngine : undefined}
                      onPresets={onPresets ? pickPresets : undefined}
                      onPresetStep={onPresetStep ? stepPresets : undefined}
                      presetName={
                        n.module ? presetNames?.[n.module] : undefined
                      }
                      onZoomTo={zoomToNode}
                      warning={
                        n.pluginId ? engineWarnings?.[n.pluginId] : undefined
                      }
                      onDragStart={beginDrag}
                      onTapWidget={tapWidget}
                      onPickWidget={pickWidget}
                      onPickAsset={pickAsset}
                      trackInput={
                        onPickTrackInput && n.kind === "track"
                          ? (trackInputs?.[n.label] ?? "aucune")
                          : undefined
                      }
                      onPickTrackInput={pickTrackInput}
                      onWatchWaveform={onWatchWaveform}
                      onContextParam={contextParam}
                      onTypeValue={typeWidget}
                      onTapEdit={onTapEdit ? editTap : undefined}
                      sinkPlay={sinkPlay}
                      onTapJack={onConnect ? tapJack : undefined}
                      patchWant={patchWant}
                      // The curve cables, all four halves gated on the one callback that commits them.
                      onStartAutomation={
                        onAutomate ? startAutomation : undefined
                      }
                      onLandAutomation={onAutomate ? landAutomation : undefined}
                      onStartEvent={onAutomate ? startEvent : undefined}
                      onLandEvent={onAutomate ? landEvent : undefined}
                      // EVERY node can be pinned, all by jackRef's answer; the ROW refuses, and so does a
                      // member of an OPEN box — its place is its FRAME's, not the graph's.
                      onHeaderDrag={
                        onMoveNode && !row && !n.assembly
                          ? beginNodeDrag
                          : undefined
                      }
                    />
                  ))}
                  {seams?.length && onEdgeInsert ? (
                    <Seams
                      seams={seams}
                      width={graph.width}
                      height={graph.height}
                      onInsert={insert}
                    />
                  ) : null}
                </div>
                {/* Outside `.dgx-world`, so the camera never carries it off: it stays in the pane's corner. */}
                {minimap && !row && (
                  <Minimap
                    nodes={graph.nodes}
                    bounds={graph}
                    cam={cam}
                    view={hostSize}
                    paintRef={minimapPaint}
                    onCenter={centerOn}
                    onFit={zoomFit}
                    onOrganize={onOrganize}
                    onStack={onStack}
                    stacked={stacked}
                  />
                )}
              </div>
            </LcdZoomContext.Provider>
          </LcdSoundsContext.Provider>
        </LcdSetContext.Provider>
      </IconsContext.Provider>
    </EngineStoreProvider>
  );
}

export type { MidiActivityStore, RackLitStore } from "./chainsStores";
export { SongClockProvider } from "./chainsStores";
export type {
  CamStore,
  ChainsIcons,
  GraphMenuCtx,
  SinkPlay,
} from "./chainsTypes";
// Exported so a host can provide one decoder for every graph it mounts — docs/lcdScreen.md.
export { LcdSoundsContext };
