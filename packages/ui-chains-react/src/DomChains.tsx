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
} from "@studio/ui-chains/graph";
import {
  type CableSway,
  exciteSway,
  hangPoints,
  newSway,
  stepSway,
} from "@studio/ui-chains/hang";
import { noteLoadAt } from "@studio/ui-chains/noteLoad";
import { patchAct } from "@studio/ui-chains/patchGesture";
import { usePointerFollow } from "@studio/ui-timeline/drag";
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
  type Cam,
  clampZoom,
  frameOriginX,
  type Lod,
  lodFor,
  sameLod,
} from "./camera";
import { cableColorFor, MAUVE, useCss } from "./chainsCss";
import { createOverrideStore, EMPTY_ORDER, NOOP } from "./chainsStores";
import { IconsContext } from "./chainsTypes";
import type { DomChainsProps, FitToFn, FitToOpts } from "./domChainsProps";
import { LcdSetContext, LcdSoundsContext } from "./LcdScreenWidget";
import { createLcdZoom, LcdZoomContext } from "./lcdZoom";
import { Minimap } from "./Minimap";
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
import { useChainsCamera } from "./useChainsCamera";
import { useNodeActions } from "./useNodeActions";
import { usePointerGestures } from "./usePointerGestures";
import { useWidgetDrag } from "./useWidgetDrag";

// A shared, never-updated store for a graph without live params, so the hook stays unconditional.
const EMPTY_PARAMS_STORE = new PluginParamsStore();

// A stable "no cable carries signal" — never mutated, always replaced.
const EMPTY_LIVE: Map<string, number> = new Map();
const EMPTY_SEEDS: Map<string, NodeFlow> = new Map();
// …and for "nothing is leaving", so settling twice does not re-render the graph twice.
const EMPTY_GHOSTS: Ghost<GraphNode>[] = [];
// A cable drawn mid-move is drawn STILL — docs/nodeMotion.md.
const NO_SAMPLES: CableGeom["samples"] = [];

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
}: DomChainsProps) {
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

  // The widget drag, the channels it reads and the multi-selection — useWidgetDrag.ts, docs/widgets.md.
  const {
    automatedOf,
    beginDrag,
    ch,
    chRef,
    commitParam,
    drag,
    edgesRef,
    lcdSet,
    linked,
    multi,
    nodesRef,
    rehearsalRef,
    selRef,
    sendLive,
    setMulti,
  } = useWidgetDrag({
    cb,
    graph,
    midiActivity,
    moduleParams,
    onModuleParam,
    onProjectField,
    onRecorder,
    onTrackSet,
    onTrackToggle,
    onTriggerRack,
    overrides,
    params,
    rackLit,
    rehearsal,
    selected,
    setOverride,
    setPluginParam,
    trackControls,
    trackOrder,
  });

  // The pan, the marquee and a widget drag's move and release — usePointerGestures.ts.
  const { marquee, onPointerDown, pan, suppressClick } = usePointerGestures({
    cam,
    cb,
    commitParam,
    drag,
    fixedRef,
    flight,
    goal,
    hostRef,
    kick,
    nodesRef,
    rehearsalRef,
    rowRef,
    selRef,
    sendLive,
    setHovered,
    setMulti,
    setOverride,
    setPanning,
    userMoved,
  });

  // The camera loop, the wheel, the pinch and the flights — useChainsCamera.ts, docs/camera.md.
  const { canvasDoubleClick, centerOn, zoomFit, zoomToNode } = useChainsCamera({
    anchor,
    before,
    cam,
    fit,
    fixedRef,
    flight,
    flightHalf,
    goal,
    hostRef,
    hostSize,
    kick,
    lodRef,
    motionStep,
    motions,
    paintRef,
    pan,
    persistRef,
    placeRef,
    rowRef,
    setLod,
    setPanning,
    settleMotion,
    userMoved,
    worldRef,
  });

  // What a card's clicks, picks and right-clicks ask for — useNodeActions.ts.
  const {
    bypassModule,
    contextNode,
    contextParam,
    editTap,
    openPlugin,
    pickAlternative,
    pickAsset,
    pickEngine,
    pickPresets,
    pickTrackInput,
    pickWidget,
    stepPresets,
    tapNode,
    tapWidget,
    typeWidget,
  } = useNodeActions({
    cb,
    chRef,
    commitParam,
    edgesRef,
    graph,
    linked,
    rehearsal,
    selRef,
    sendLive,
    setMulti,
    setOverride,
    suppressClick,
  });
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
export type { ChainsCamApi } from "./domChainsProps";
// Exported so a host can provide one decoder for every graph it mounts — docs/lcdScreen.md.
export { LcdSoundsContext };
