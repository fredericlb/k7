// ChainsTab.tsx — the routing graph: a chain list beside a node viewer, where each chain
// expands into its real signal path (source track, every `use` module, the weighted
// outputs). dagre lays it out and DomChains draws it, following dagre's ROUTED points so a
// send that skips a column doesn't slice through the module between. Shared with GraphPanel.

import { ChevronRight, List } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import type { PluginParamsStore } from "@studio/engine-browser/params";
import { automationLanes, type WebAutomationLane } from "@studio/graph-model";
import { ASPECTS, aspectOf } from "@studio/song-schema/aspect";
import { foldAssemblies } from "@studio/ui-chains/assembly";
import type { LaneSpan } from "@studio/ui-chains/cables";
import type { GraphNode, TrackControlValues } from "@studio/ui-chains/graph";
import {
  buildGraph,
  layout,
  subgraphForTrack,
  withOpenTabs,
} from "@studio/ui-chains/graph";
import type { GridFit } from "@studio/ui-chains/gridFit";
import type { LaneNotes } from "@studio/ui-chains/noteLoad";
import { stackLayout } from "@studio/ui-chains/stackLayout";
import {
  type Cam,
  type ChainsCamApi,
  type ChainsIcons,
  DomChains,
  type NodeEngines,
  type TapAction,
} from "@studio/ui-chains-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, thawAutoFreeze } from "../api";
import { STUDIO_ICONS } from "../chainsIcons";
import type { MenuCtx } from "../contextMenu";
import { withoutNotes } from "../graphNotes";
import { type HistoryMark, nodePredicate } from "../historyMarks";
import { useChainsMidi } from "../hooks/useChainsMidi";
import { useDocument } from "../hooks/useDocument";
import type { MidiControlApi } from "../hooks/useMidiControl";
import { useRackTrigger } from "../hooks/useRackTrigger";
import { midiActivity } from "../midiActivity";
import { nodeNameFor } from "../nodeInsert";
import { type PendingNode, withPendingNode } from "../pendingNode";
import { useLiveRackLit } from "../rackLit";
import type { WebGraph, WebProject } from "../types";
import { useIsMobile } from "../useIsMobile";
import { MidiFeedback } from "./MidiFeedback";

// A card with no authored vertical layout is folded to the same 4 columns (packages/ui-chains/docs/graphBuild.md).
const GRAPH_FIT: GridFit = { axis: "cols", max: 4 };

export function ChainsTab({
  mark,
  onPreviewNote,
  reloadKey,
  organizeKey = 0,
  active,
  showList,
  icons = STUDIO_ICONS,
  trackOrder,
  videoSpans,
  noteLanes,
  project,
  command,
  onBypassModule,
  onModuleField,
  onOrganize,
  onRecorder,
  onProjectField,
  onAlternative,
  onEngine,
  onPresets,
  onPresetStep,
  presetNames,
  engineWarnings,
  onSetModuleAsset,
  onAssetBrowse,
  onTapEdit,
  onWatchWaveform,
  pendingInsert,
  seedGraph,
  showDocs,
  onDocCount,
  onLaneNodes,
  onContextMenu,
  onEdgeInsert,
  onCanvasInsert,
  onConnect,
  onAutomate,
  onDisconnect,
  onReplug,
  onMoveNode,
  pluginParamsStore,
  requestPluginParams,
  watchPluginParams,
  setPluginParam,
  moduleParams,
  trackControls,
  onTrackToggle,
  onTrackSet,
  focus,
  onFocused,
  stack,
  onStack,
  inputDevices,
  cameras,
  midiDevices,
  masterVolume,
  viewport,
  midiRef,
  onMidiStatus,
}: {
  /** What a hovered History row touched, lit on these cards (historyMarks.ts). */
  mark?: HistoryMark | null;
  /** Play one note through a lane, as the piano roll's click does — what an SFZ kit's pad sounds through. */
  onPreviewNote?: (track: string, key: number, vel: number) => void;
  reloadKey: number;
  // Bumped when `graph organize` ran: the one signal that empties the held node positions and lets dagre re-lay out everything.
  organizeKey?: number;
  // VISIBLE, not focused: a display:none container has no size and fit() would frame to 0.
  active: boolean;
  showList: boolean; // the sidebar is fullscreen chrome; the global view's pane is canvas only
  /** Which glyph set the nodes wear, defaulted so an ordinary song says nothing; a SET passes `DECK_ICONS` (chainsIcons.tsx). */
  icons?: ChainsIcons;
  // The engine's track order; liveness is derived off the store here, so only the graph re-runs it.
  trackOrder: string[];
  /** …and the PICTURE's half of the same answer, since nothing meters a frame: when each video lane is showing one (../videoSpans.ts). */
  videoSpans?: Readonly<Record<string, readonly LaneSpan[]>>;
  /** …and the notes', for a MIDI cable's ripple — nothing meters those either (../noteSpans.ts). */
  noteLanes?: Readonly<Record<string, LaneNotes>>;
  /** The compiled doc, for the one thing the graph cannot derive: which notes a lane plays, which is what lights a rack's pads. */
  project?: WebProject | null;
  command: (line: string) => void | Promise<void>;
  // Toggle a module's bypass: the canvas flips the node itself on click and lets the refetch confirm — see pendingBypass.
  onBypassModule?: (module: string) => void;
  /** Set a module's own field. Wired to the RELOADING sender: an intrinsic dropdown draws the file. */
  onModuleField?: (line: string) => void | Promise<void>;
  /** The minimap's Organize button: `graph organize` through the shell, which is what re-lays the graph out. */
  onOrganize?: () => void;
  /** A RECORDER's button — record and clear go to the engine, save is a command (recorder.md). */
  /** Set a PROJECT setting — the RENDER card's frame dropdown (../noteSpans.ts's sibling). */
  onProjectField?: (field: string, value: string) => void;
  onRecorder?: (
    verb: "record" | "clear" | "save",
    node: { module: string; pluginId?: string },
  ) => void;
  /** A node's alternative badge: switch to a set, or copy the one on (null) — straight through, the command being the SHELL's. */
  onAlternative?: (module: string, name: string | null) => void;
  /** A node's engine dropdown — straight through, the command being the SHELL's (packages/song/docs/engines.md). */
  onEngine?: (module: string, name: string) => void;
  /** A node's preset dropdown — the shell draws the list (packages/song/docs/userPresets.md). */
  /** The arrows beside a node's preset dropdown: load its previous (-1) or next (+1) preset. */
  onPresetStep?: (module: string, step: -1 | 1) => void;
  onPresets?: (
    module: string,
    x: number,
    y: number,
    engines?: NodeEngines,
  ) => void;
  /** The preset each node last loaded, by node. */
  presetNames?: Record<string, string>;
  /** Engine load problems by plugin id, badged onto the module they concern. */
  engineWarnings?: Record<string, string>;
  // Load a library file into a module: `kind` is the asset, `file` library-relative or "none" to clear.
  onSetModuleAsset?: (module: string, kind: string, file: string) => void;
  /** Open the library browser for a module's asset field, at viewport coords. */
  onAssetBrowse?: (module: string, kind: string, x: number, y: number) => void;
  /** A rack tap's edit — the shell runs its `node tap` command (packages/song/docs/racks.md). */
  onTapEdit?: (module: string, action: TapAction) => void;
  /** Place/remove the engine's waveform tap while a waveform widget is on screen. */
  onWatchWaveform?: (
    pluginId: string,
    side: "input" | "output",
    on: boolean,
  ) => void;
  /** The node being created on an arrow right now, or null. Drawn as a placeholder until real data lands. */
  pendingInsert?: PendingNode | null;
  /** The graph a writing command already came back with, its id, and the `reloadKey` it is the answer FOR — taken once, and only at that key. */
  seedGraph?: { id: number; graph: WebGraph; at: number } | null;
  /** Whether to DRAW the project's notes: off by default, and filtered here rather than in the renderer, being a question about this graph. */
  showDocs?: boolean;
  /** How many notes the project has, reported up — the shell's button is in the footer. */
  onDocCount?: (n: number) => void;
  /** Each lane node's alternatives and freeze, reported up — the timeline's gutter draws them. */
  onLaneNodes?: (f: {
    alternatives: WebGraph["trackAlternatives"];
    frozen: WebGraph["frozen"];
    automation: Record<string, WebAutomationLane[]>;
  }) => void;
  // Right-click a node → the shell opens its context menu. No 'edit this module' here: a module is a LIBRARY thing.
  onContextMenu?: (ctx: MenuCtx, x: number, y: number) => void;
  /** A `+` click opens the module picker at the pointer and the pick runs; `nameFor` answers what a node dropped HERE would be called. */
  onEdgeInsert?: (
    info: { before: string; after: string },
    x: number,
    y: number,
    at: { x: number; y: number } | undefined,
    nameFor: (module: string) => string,
  ) => void;
  // A right-click on empty canvas opens the same picker, with no arrow to read a lane off: `<module>_<n>`.
  onCanvasInsert?: (
    x: number,
    y: number,
    at: { x: number; y: number } | undefined,
    nameFor: (module: string) => string,
  ) => void;
  // The patch cable landed: a free output then a free input, as graph.yaml addresses, ready for `graph chain connect`.
  onConnect?: (from: string, to: string) => void;
  // A curve's cable landed on a knob, or a note-on on an envelope's ear — both write one line of `node automate`.
  onAutomate?: (
    module: string,
    param: string,
    curve: string,
    trigger?: string,
  ) => void;
  // A lifted cable dropped on the bare canvas — ready for `graph chain disconnect`.
  onDisconnect?: (from: string, to: string) => void;
  // A lifted cable's end landed on another jack — ready for `graph chain replug`.
  onReplug?: (from: string, to: string, newFrom: string, newTo: string) => void;
  // A module's header was dragged and dropped: pin it there — ready for `graph move`.
  onMoveNode?: (module: string, x: number, y: number) => void;
  // Live plugin params as an EXTERNAL store, so param frames re-render the graph and not the whole app.
  pluginParamsStore: PluginParamsStore;
  requestPluginParams: (id: string) => void;
  watchPluginParams: (id: string, on: boolean) => void;
  setPluginParam: (id: string, name: string, value: number) => void;
  /** What each `offline` module is currently set to — the desk's numbers lent to the graph, and what turns those widgets on at all. */
  moduleParams?: Record<string, Record<string, number>>;
  // Live mixer state plus the two callbacks a track node's controls actuate — pure pass-through to the canvas.
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
  /** Frame the chains a track feeds. `nonce` is what makes picking the SAME track twice re-frame. */
  focus?: { id: string; nonce: number } | null;
  /** How many chains that framing found — so the shell's status line can say when it was none. */
  onFocused?: (chains: number) => void;
  /** The STACK view: a column per lane, the MIX's last — @studio/ui-chains's stackLayout.ts. */
  stack?: boolean;
  /** …and its toggle, drawn on the minimap beside zoom fit. */
  onStack?: () => void;
  // How the machine's interface groups its inputs, for a live input's socket dropdown — empty with no engine, which is the honest picture.
  inputDevices?: readonly { name: string; channels: number[] }[];
  /** The lenses this BROWSER can see, by label — see packages/song/docs/camera.md. */
  cameras?: readonly string[];
  /** The MIDI inputs this browser sees, by name — what a midi-in node's dropdown offers. */
  midiDevices?: readonly string[];
  // The song's output level, for the fader on the OUT card: a project setting, so the shell hands it over.
  masterVolume?: number;
  /** The FRAME's pixel size, so the RENDER card can tick the shape it is — absent for a project
   *  with no picture, whose card carries no dropdown at all (@studio/song-schema's aspect.ts). */
  viewport?: readonly [number, number];
  /** Where the shell reaches MIDI learn from — the runtime lives HERE, this being the one component that always holds the graph. */
  midiRef?: React.RefObject<MidiControlApi | null>;
  /** Say what a learn is waiting for, or what it captured. */
  onMidiStatus?: (line: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const camApi = useRef<ChainsCamApi | null>(null);
  // The camera is parked HERE because this stays mounted while DomChains is torn down with its pane.
  const camStore = useRef<Cam | null>(null);
  const isMobile = useIsMobile();
  const [listOpen, setListOpen] = useState(false);

  const handleCamReady = useCallback((api: ChainsCamApi) => {
    camApi.current = api;
  }, []);

  // Through a ref, so the seed is not a dependency of this effect; `consumedSeed` is what makes it a one-shot.
  const seedRef = useRef(seedGraph);
  seedRef.current = seedGraph;
  const consumedSeed = useRef(0);
  // The seed is just another way of ANSWERING, so it lives INSIDE the load: one document from one place, retry included.
  // Hidden, a reload is REMEMBERED rather than fetched: the graph is asked for when the pane is shown again.
  // A fresh seed is a trigger of its own: a bypass hands one back with no reload behind it.
  const trigger = `${reloadKey}:${seedGraph?.at === reloadKey ? seedGraph.id : 0}`;
  const shownKey = useRef(trigger);
  if (active) shownKey.current = trigger;
  const keyRef = useRef(reloadKey);
  keyRef.current = reloadKey;
  const { doc: graph, error } = useDocument(async () => {
    const seed = seedRef.current;
    // A seed answers the key it was made at; one left over from an earlier key would draw a graph older than the reload.
    if (seed && seed.id > consumedSeed.current && seed.at === keyRef.current) {
      consumedSeed.current = seed.id;
      return seed.graph;
    }
    return api.graph();
  }, shownKey.current);

  /** What a node dropped here would be CALLED, handed to the shell with the click — only this pane can answer it (nodeInsert.ts). */
  const nameFor = useCallback(
    (before: string | null) =>
      (module: string): string =>
        graph ? nodeNameFor(graph, module, before) : `${module}_1`,
    [graph],
  );
  const edgeInsert = useMemo(
    () =>
      onEdgeInsert &&
      ((
        info: { before: string; after: string },
        x: number,
        y: number,
        at?: { x: number; y: number },
      ) => onEdgeInsert(info, x, y, at, nameFor(info.before))),
    [onEdgeInsert, nameFor],
  );
  const canvasInsert = useMemo(
    () =>
      onCanvasInsert &&
      ((x: number, y: number, at?: { x: number; y: number }) =>
        onCanvasInsert(x, y, at, nameFor(null))),
    [onCanvasInsert, nameFor],
  );

  // Bypasses clicked but not yet confirmed by a refetch, by module name: the engine flips live while re-reading the graph costs ~220 ms.
  const [pendingBypass, setPendingBypass] = useState<Record<string, boolean>>(
    {},
  );
  useEffect(() => setPendingBypass({}), [graph]);

  const bypassModule = useCallback(
    (module: string) => {
      setPendingBypass((prev) => {
        const node = laidRef.current?.nodes.find(
          (n) => n.kind === "module" && n.module === module,
        );
        const now = prev[module] ?? !!node?.bypassed;
        return { ...prev, [module]: !now };
      });
      onBypassModule?.(module);
    },
    [onBypassModule],
  );

  // The History panel's hover, as the per-card test DomChains reads.
  const marked = useMemo(() => nodePredicate(mark), [mark]);
  // Which of this project's rack sounds are firing right now — derived from the arrangement and the playhead (rackLit.ts).
  const rackLit = useLiveRackLit(project, graph);

  // Which boxes are OPEN: session state, never written — packages/song/docs/assemblies.md.
  const [openAssemblies, setOpenAssemblies] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggleAssembly = useCallback((name: string) => {
    setOpenAssemblies((open) => {
      const next = new Set(open);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  }, []);

  /** The project's NOTES, by name: `graph.modules` is keyed by doc modules and nothing else, so its keys ARE the notes. */
  const docNames = useMemo(
    () => new Set(Object.keys(graph?.modules ?? {})),
    [graph],
  );
  useEffect(() => onDocCount?.(docNames.size), [docNames, onDocCount]);

  /** What the graph knows about each LANE's node, travelling up for the timeline's gutter — memoised, so the effect below fires only on a new graph. */
  const laneNodes = useMemo(
    () => ({
      alternatives: graph?.trackAlternatives,
      frozen: graph?.frozen,
      // …and each lane's AUTOMATION, by the same road: `automationLanes` is the one place the binding and the curve are joined.
      automation: graph ? automationLanes(graph) : {},
    }),
    [graph],
  );
  useEffect(() => onLaneNodes?.(laneNodes), [laneNodes, onLaneNodes]);

  /** The graph as it is DRAWN: without the notes unless the shell asked — filtered before `buildGraph`, or the hole would stay in the layout. */
  const drawn = useMemo(() => {
    if (!graph || showDocs) return graph;
    return withoutNotes(graph, docNames);
  }, [graph, showDocs, docNames]);

  // Where each node was DRAWN last — the session memory that keeps an EDIT from reorganizing the picture; `graph organize` empties it.
  const prevLaid = useRef<Map<string, { x: number; y: number }> | null>(null);
  // What has already been written to `positions:` this session — see the pinning effect below.
  const pinned = useRef(new Set<string>());
  const organizeSeen = useRef(organizeKey);
  /** Which row of the RENDER card's dropdown is ticked — by RATIO, so an old [1280, 720] project
   *  ticks the same row as a new one, and nothing is ticked for a shape on neither list.
   *
   *  Derived HERE rather than inside the layout memo below, and as a NUMBER: the viewport is a
   *  fresh array on every fetch, so depending on it directly would relayout the graph on every
   *  poll — and leaving it out of the deps altogether is what left the menu showing the old shape
   *  until something else moved. See ../docs/picture.md. */
  const aspectRow = useMemo(() => {
    const shape = viewport ? aspectOf(viewport[0], viewport[1]) : null;
    return shape ? ASPECTS.findIndex((a) => a.name === shape.name) : undefined;
  }, [viewport]);

  const laid = useMemo(() => {
    if (!drawn) return null;
    // The OUT card IS drawn, and it costs one node — plus the two things not in the graph document: the inputs, and the song's output level.
    const built = buildGraph(drawn, {
      drawMainOut: true,
      inputDevices,
      cameras,
      midiDevices,
      mainOutVolume: masterVolume,
      aspect: aspectRow,
      // The graph spreads in both directions, so a card is drawn NARROW: its vertical layout, tabs as a menu.
      layout: "vertical",
      fit: GRAPH_FIT,
    });
    // …then the assemblies are folded in: a box instead of its members, unless it is open — packages/song/docs/assemblies.md.
    const { nodes, edges } = foldAssemblies(drawn, built, openAssemblies);
    // The STACK view is an arrangement too, but a whole one: no pins, no held positions, no dagre.
    if (stack) return stackLayout(nodes, edges, drawn, trackOrder);
    // `graph organize` ran: forget the session's positions AND ignore the old pins this once, since the reload may not have landed.
    const fresh = organizeSeen.current !== organizeKey;
    organizeSeen.current = organizeKey;
    if (fresh) {
      prevLaid.current = null;
      // …and forget what has been pinned, or organize would clear the file's positions and then decline to write the new ones.
      pinned.current.clear();
    }
    const out = layout(
      nodes,
      edges,
      fresh ? undefined : drawn.positions,
      prevLaid.current ?? undefined,
    );
    prevLaid.current = new Map(
      // Where a pushed-aside card BELONGS, not where the open frame shoved it (docs/assemblies.md).
      out.nodes.map((n) => [n.id, n.pushed ?? { x: n.x, y: n.y }]),
    );
    return out;
  }, [
    drawn,
    inputDevices,
    cameras,
    midiDevices,
    masterVolume,
    aspectRow,
    organizeKey,
    openAssemblies,
    stack,
    trackOrder,
  ]);

  /** The graph writes down where it drew itself — once, and then the FILE is the layout; not a curve, not twice (docs/chainsGraph.md). */

  // biome-ignore lint/correctness/useExhaustiveDependencies: `command` is a stable callback and re-running on its identity would re-send the batch.
  useEffect(() => {
    // `onMoveNode` absent means this graph cannot be pinned by hand — a frozen snapshot — so it must not pin itself either.
    if (!laid || !onMoveNode || stack) return;
    const have = drawn?.positions ?? {};
    const at: Record<string, { x: number; y: number }> = {};
    for (const n of laid.nodes) {
      if (n.kind === "curve") continue;
      // A member of an OPEN box sits where its FRAME put it; that number means nothing on the graph.
      if (n.assembly) continue;
      const name =
        n.kind === "module" || n.kind === "assembly"
          ? (n.module ?? n.label)
          : n.label;
      if (!name || have[name] || pinned.current.has(name)) continue;
      // …and a card that stepped aside is pinned where it BELONGS, for the same reason.
      const spot = n.pushed ?? n;
      at[name] = { x: Math.round(spot.x), y: Math.round(spot.y) };
    }
    const names = Object.keys(at);
    if (!names.length) return;
    for (const name of names) pinned.current.add(name);
    void command(`graph pin ${JSON.stringify(at)}`);
  }, [laid, drawn?.positions, onMoveNode, stack]);

  // The tab each card has open, held here because it sizes the card: a narrow card is as tall as its page (ui-chains' `tabH`).
  const [openTabs, setOpenTabs] = useState<Record<string, number>>({});
  const onOpenTab = useCallback(
    (id: string, tab: number) =>
      setOpenTabs((prev) => (prev[id] === tab ? prev : { ...prev, [id]: tab })),
    [],
  );

  // The optimistic flag painted on after layout, and each card's open page: how a node READS and how tall, never where it sits.
  const laidShown = useMemo(() => {
    if (!laid) return laid;
    const sized = withOpenTabs(laid.nodes, openTabs);
    if (!Object.keys(pendingBypass).length)
      return sized === laid.nodes ? laid : { ...laid, nodes: [...sized] };
    return {
      ...laid,
      nodes: sized.map((n) => {
        if (n.kind !== "module" || !n.module) return n;
        const b = pendingBypass[n.module];
        return b === undefined ? n : { ...n, bypassed: b, dim: b };
      }),
    };
  }, [laid, pendingBypass, openTabs]);

  // The node being created, standing where it will land and wired in: what is drawn is the WAIT, adding one costing ~700 ms of recompiling.
  const withPending = useMemo(
    () =>
      laidShown && pendingInsert
        ? withPendingNode(laidShown, pendingInsert)
        : laidShown,
    [laidShown, pendingInsert],
  );

  // Read by bypassModule without making it depend on the layout, which would rebind it on every refetch.
  const laidRef = useRef(laid);
  laidRef.current = laid;
  // A pad clicked auditions its sound, the same way in every pane that draws a kit.
  const triggerRack = useRackTrigger(laidRef, onPreviewNote, rackLit.flash);

  const chainNodes = useCallback(
    (chainName: string) => {
      if (!laid || !graph) return [];
      const chain = graph.chains[chainName];
      const targets = chain?.out?.map((o) => o.to) ?? [];
      const isChain = (n: string) => n in graph.chains;
      return laid.nodes.filter((n) => {
        // The chain node itself
        if (n.kind === "chain" && n.label === chainName) return true;
        // Modules belonging to this chain (single or shared)
        if (
          n.kind === "module" &&
          (n.chain === chainName || n.chains?.includes(chainName))
        )
          return true;
        // The "from" source (a track node or a chain-entry module)
        if (chain?.from) {
          if (n.kind === "track" && n.label === chain.from) return true;
          if (
            isChain(chain.from) &&
            n.kind === "module" &&
            (n.chain === chain.from || n.chains?.includes(chain.from))
          ) {
            const fromChain = graph.chains[chain.from];
            const fromEntry = fromChain.use[0]?.module;
            if (fromEntry && n.module === fromEntry) return true;
          }
        }
        // The "to" sinks / chain-entry modules
        for (const t of targets) {
          if (n.kind === "sink" && n.label === t) return true;
          if (
            isChain(t) &&
            n.kind === "module" &&
            (n.chain === t || n.chains?.includes(t))
          ) {
            const tChain = graph.chains[t];
            const tEntry = tChain.use[0]?.module;
            if (tEntry && n.module === tEntry) return true;
          }
        }
        return false;
      });
    },
    [laid, graph],
  );

  // A tapped module's sidebar row may sit in a collapsed chain, so open every chain that lists it.
  const selectFromGraph = useCallback(
    (name: string | null) => {
      setSelected(name);
      if (!name || !graph) return;
      const owners = Object.keys(graph.chains).filter((c) =>
        graph.chains[c].use.some((s) => s.module === name),
      );
      if (owners.length) setExpanded((prev) => new Set([...prev, ...owners]));
    },
    [graph],
  );

  // --- MIDI: the graph's map, played ------------------------------------------------

  const midi = useChainsMidi(graph, setPluginParam, midiRef, onMidiStatus);

  // --- framing a track (a double-click on its timeline header) -----------------------

  // The set is the Graph panel's (`subgraphForTrack`), applied ONCE per focus by its nonce; off screen it waits, a hidden canvas having no size.
  const focusApplied = useRef(-1);
  useEffect(() => {
    if (!focus || !graph || !laid || !active) return;
    if (focusApplied.current === focus.nonce) return;
    focusApplied.current = focus.nonce;
    const chains = Object.keys(subgraphForTrack(graph, focus.id).chains);
    const nodes = new Map<string, GraphNode>();
    for (const name of chains)
      for (const n of chainNodes(name)) nodes.set(n.id, n);
    if (nodes.size) camApi.current?.fitTo([...nodes.values()]);
    // Open them in the sidebar too, so the list reads as being about this track.
    if (chains.length) setExpanded((prev) => new Set([...prev, ...chains]));
    onFocused?.(chains.length);
  }, [focus, graph, laid, active, chainNodes, onFocused]);

  /** Frame the whole stack when the stack view opens, and give the camera back when it closes. */
  const camBeforeStack = useRef<Cam | null>(null);
  const stackFramed = useRef(false);
  useEffect(() => {
    if (!laid || !active || stackFramed.current === !!stack) return;
    if (!stack) {
      stackFramed.current = false;
      const back = camBeforeStack.current;
      camBeforeStack.current = null;
      if (back) camApi.current?.set(back);
      return;
    }
    const was = camApi.current?.get();
    if (camApi.current?.fitTo(laid.nodes)) {
      stackFramed.current = true;
      camBeforeStack.current = was ?? null;
    }
  }, [stack, laid, active]);

  // Scroll the selected row in, keyed on `expanded` too — the row doesn't exist until its group opens.
  const selectedRowRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected, expanded]);

  // Ask what every drawing module's plugin holds, once per graph; re-run on open and on reconnect.
  const pluginIds = useMemo(
    () =>
      Object.values(graph?.chains ?? {})
        .flatMap((c) => c.use)
        .filter((s) => s.ui && s.pluginId)
        .map((s) => s.pluginId as string),
    [graph],
  );
  useEffect(() => {
    if (!active) return;
    for (const id of pluginIds) requestPluginParams(id);
  }, [active, pluginIds, requestPluginParams]);

  // …then FOLLOW them, so a native editor's knob moves the widget. Torn down off screen — a watch costs a read/frame.
  useEffect(() => {
    if (!active) return;
    for (const id of pluginIds) watchPluginParams(id, true);
    return () => {
      for (const id of pluginIds) watchPluginParams(id, false);
    };
  }, [active, pluginIds, watchPluginParams]);

  // Only with nothing to draw: a failed RE-read keeps the last graph on screen while useDocument retries.
  if (error && !graph)
    return (
      <div className="p-4 text-sm text-red-400">
        graph unavailable — {error}
      </div>
    );
  if (!graph || !laid)
    return <div className="p-4 text-sm text-muted-foreground">loading…</div>;

  // Past the guard `laid` is real; the fallback never fires and is only how the narrowing reaches a memo computed above.
  const shown = withPending ?? laid;

  return (
    // min-w-0: without it the canvas's width becomes this flex child's minimum and the page slides sideways.
    <div className="relative flex min-h-0 min-w-0 flex-1">
      {/* The MIDI feedback pass, in a component of its own that draws nothing: subscribing here would re-render the graph per engine frame. */}
      <MidiFeedback store={pluginParamsStore} push={midi.pushFeedback} />
      {/* On a phone the chain list is a DRAWER: 288px of a ~390px screen would leave the graph a sliver, so it closes on a pick. */}
      {showList && isMobile && (
        <button
          type="button"
          onClick={() => setListOpen((o) => !o)}
          aria-expanded={listOpen}
          className="absolute left-2 top-2 z-30 flex items-center gap-1 rounded border border-border bg-card/90 px-2 py-1 text-xs shadow"
        >
          <List className="h-3.5 w-3.5" />
          chains
        </button>
      )}
      {showList && (!isMobile || listOpen) && (
        <aside
          className={cn(
            "flex flex-col border-r border-border text-sm",
            isMobile
              ? "absolute inset-y-0 left-0 z-20 w-64 bg-card shadow-xl"
              : "w-72 shrink-0 bg-card/40",
          )}
        >
          <div className="min-h-0 flex-1 overflow-auto p-2">
            <div className="mb-1 px-1 text-xs uppercase tracking-wide text-muted-foreground">
              {Object.keys(graph.chains).length} chains
            </div>
            {Object.keys(graph.chains).map((name) => {
              const chain = graph.chains[name];
              const isExpanded = expanded.has(name);
              const isSelected = name === selected;
              const fromLabel = chain.from ?? null;
              const toLabels = chain.out?.map((o) => o.to) ?? [];
              return (
                <div key={name}>
                  <button
                    onClick={() => {
                      const willSelect = !isSelected;
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (willSelect) next.add(name);
                        else next.delete(name);
                        return next;
                      });
                      setSelected(willSelect ? name : null);
                      if (willSelect) camApi.current?.fitTo(chainNodes(name));
                      if (isMobile && willSelect) setListOpen(false);
                    }}
                    className={`flex w-full items-center gap-1 truncate rounded px-2 py-1 text-left font-mono text-xs text-foreground hover:bg-accent ${isSelected ? "bg-accent" : ""}`}
                  >
                    <ChevronRight
                      className={`h-3 w-3 shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    />
                    {name}
                  </button>
                  {isExpanded && (
                    <>
                      {fromLabel && (
                        <div className="truncate py-0.5 pl-7 pr-2 font-mono text-xs text-muted-foreground">
                          {fromLabel}
                        </div>
                      )}
                      {chain.use.map((step) => {
                        const modSelected = step.module === selected;
                        return (
                          <div key={step.module} className="flex items-center">
                            <button
                              ref={modSelected ? selectedRowRef : null}
                              onClick={() => {
                                setSelected(modSelected ? null : step.module);
                                if (!modSelected) {
                                  const nodes = chainNodes(name);
                                  const modNode = laid?.nodes.find(
                                    (n) =>
                                      n.kind === "module" &&
                                      n.module === step.module,
                                  );
                                  if (modNode)
                                    camApi.current?.fitTo(nodes, {
                                      panOnly: modNode,
                                    });
                                }
                              }}
                              className={`min-w-0 flex-1 truncate rounded py-0.5 pl-7 pr-1 text-left font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground ${modSelected ? "bg-accent text-foreground" : ""}`}
                            >
                              {step.module}
                            </button>
                          </div>
                        );
                      })}
                      {toLabels.map((t) => (
                        <div
                          key={t}
                          className="truncate py-0.5 pl-7 pr-2 font-mono text-xs text-muted-foreground"
                        >
                          {t}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              );
            })}
            {graph.warnings.length > 0 && (
              <div className="mt-3 border-t border-border pt-2 text-xs text-amber-400">
                {graph.warnings.map((w, i) => (
                  <div key={i}>! {w}</div>
                ))}
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Mount the graph only while the tab is visible: a display:none container has no size, so fit() would frame to 0. */}
      <main className="min-w-0 flex-1">
        {active && (
          <DomChains
            openTabs={openTabs}
            onOpenTab={onOpenTab}
            onToggleAssembly={toggleAssembly}
            icons={icons}
            graph={shown}
            selected={selected}
            trackOrder={trackOrder}
            videoSpans={videoSpans}
            noteLanes={noteLanes}
            onSelect={selectFromGraph}
            onContextMenu={onContextMenu}
            onEdgeInsert={edgeInsert}
            onCanvasInsert={canvasInsert}
            onConnect={onConnect}
            onAutomate={onAutomate}
            onDisconnect={onDisconnect}
            onReplug={onReplug}
            // A stack is an arrangement, not a place: dragging a card there must not pin it in the file.
            onMoveNode={stack ? undefined : onMoveNode}
            onCamReady={handleCamReady}
            camStore={camStore}
            command={command}
            onBypassModule={bypassModule}
            onThawAutoFreeze={thawAutoFreeze}
            onModuleField={onModuleField}
            // The corner minimap is this pane's: the graph panel and a lane's row are too small to want one.
            minimap
            onOrganize={onOrganize}
            onStack={onStack}
            stacked={!!stack}
            organizeKey={organizeKey}
            onRecorder={onRecorder}
            onProjectField={onProjectField}
            onAlternative={onAlternative}
            onEngine={onEngine}
            onPresets={onPresets}
            onPresetStep={onPresetStep}
            presetNames={presetNames}
            onTriggerRack={triggerRack}
            rackLit={rackLit}
            midiActivity={midiActivity}
            marked={marked}
            engineWarnings={engineWarnings}
            onSetModuleAsset={onSetModuleAsset}
            onAssetBrowse={onAssetBrowse}
            onTapEdit={onTapEdit}
            onWatchWaveform={onWatchWaveform}
            pluginParamsStore={pluginParamsStore}
            setPluginParam={setPluginParam}
            moduleParams={moduleParams}
            trackControls={trackControls}
            onTrackToggle={onTrackToggle}
            onTrackSet={onTrackSet}
          />
        )}
      </main>
    </div>
  );
}
