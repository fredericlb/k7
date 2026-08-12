// ChainsTab.tsx — the routing graph: a chain list beside a node viewer, where each chain
// expands into its real signal path (source track, every `use` module, the weighted
// outputs). dagre lays it out and DomChains draws it, following dagre's ROUTED points so a
// send that skips a column doesn't slice through the module between. Shared with GraphPanel.

import { cn } from "@frediverse/ui/lib/utils";
import {
  type PluginParamsStore,
  usePluginParams,
} from "@studio/engine-browser/params";
import { splitPort } from "@studio/graph-model";
import { showToast } from "@studio/project-shell/toast";
import type { GraphNode, TrackControlValues } from "@studio/ui-chains/graph";
import {
  alignModuleRank,
  buildGraph,
  layout,
  spaceModulesEvenly,
  subgraphForTrack,
} from "@studio/ui-chains/graph";
import {
  type Cam,
  type ChainsCamApi,
  DomChains,
} from "@studio/ui-chains-react";
import { ChevronRight, List } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { STUDIO_ICONS } from "../chainsIcons";
import type { MenuCtx } from "../contextMenu";
import {
  type MappedParam,
  type MidiControlApi,
  useMidiControl,
} from "../hooks/useMidiControl";
import { useLiveRackLit } from "../rackLit";
import type { PreviewReq, WebGraph, WebProject } from "../types";
import { useIsMobile } from "../useIsMobile";

/** The mixer row is framed a fifth SMALLER than a perfect fit — see where it is used. */
const ROW_ZOOM_OUT = 0.8;

export function ChainsTab({
  reloadKey,
  active,
  showList,
  trackOrder,
  project,
  command,
  onBypassModule,
  onNodeMenu,
  engineWarnings,
  onSetModuleAsset,
  onAssetBrowse,
  onWatchWaveform,
  pendingInsert,
  seedGraph,
  showDocs,
  onDocCount,
  onContextMenu,
  onEdgeInsert,
  onCanvasInsert,
  pluginParamsStore,
  requestPluginParams,
  watchPluginParams,
  setPluginParam,
  trackControls,
  onTrackToggle,
  onTrackSet,
  focus,
  onFocused,
  alignModules,
  midiRef,
  onMidiStatus,
}: {
  reloadKey: number;
  // VISIBLE, not focused: a display:none container has no size and fit() would frame to 0.
  active: boolean;
  showList: boolean; // the sidebar is fullscreen chrome; the global view's pane is canvas only
  // The engine's track order; liveness is derived off the store here, so only the graph re-runs it.
  trackOrder: string[];
  /** The compiled doc, for the one thing the graph cannot derive on its own: which notes a lane
   *  plays, which is what lights a rack's pads. Absent until the first one lands. */
  project?: WebProject | null;
  command: (line: string) => void | Promise<void>;
  // Toggle a module's bypass. The canvas flips the node itself on click and lets the refetch confirm — see
  // pendingBypass; the command no longer reloads the project, so waiting for one would be waiting for nothing.
  onBypassModule?: (module: string) => void;
  /** The ⋮ bubble on a node: open that node's menu at those viewport coords — its alternatives
   *  and its freeze. Straight through to the renderer: the menu is the SHELL's, like the asset
   *  browser. */
  onNodeMenu?: (
    n: {
      module?: string;
      alternatives?: string[];
      alternative?: string;
      frozen?: "at" | "inside";
    },
    at: { x: number; y: number },
  ) => void;
  /** Engine load problems by plugin id, badged onto the module they concern. */
  engineWarnings?: Record<string, string>;
  // Load a library file into a module: `kind` is the asset, `file` library-relative or "none" to clear.
  onSetModuleAsset?: (module: string, kind: string, file: string) => void;
  /** Open the library browser for a module's asset field, at viewport coords. */
  onAssetBrowse?: (module: string, kind: string, x: number, y: number) => void;
  /** Place/remove the engine's waveform tap while a waveform widget is on screen. */
  onWatchWaveform?: (
    pluginId: string,
    side: "input" | "output",
    on: boolean,
  ) => void;
  /** The arrow a module is being created on right now, or null. Drawn as a placeholder until real data lands. */
  pendingInsert?: { before: string; after: string } | null;
  /**
   * The graph a writing command already came back with, and its id.
   *
   * A command that changes the project makes this pane's `reloadKey` move, and fetching the graph
   * then costs a round trip plus a ~400 ms rebuild of what the service parsed moments earlier to
   * answer that very command. An unconsumed seed IS that answer, so we draw it and skip the fetch.
   * The id is taken once: a reload from anywhere else — a poll, another tab's edit, the undo
   * journal — must re-fetch rather than redraw a graph that has already been shown.
   */
  seedGraph?: { id: number; graph: WebGraph } | null;
  /**
   * Whether to DRAW the project's notes — its doc modules.
   *
   * Off by default, and the shell's to decide: a note is wired into the chain it is about, so
   * showing every one all the time would put prose in the middle of the signal path. Filtered
   * here rather than in the renderer because it is a question about this project's graph, and
   * `DomChains` draws whatever graph it is given.
   */
  showDocs?: boolean;
  /** How many notes the project has, reported up — the shell's button is in the footer. */
  onDocCount?: (n: number) => void;
  // No "edit this module" here on purpose: a module is a LIBRARY thing — the same file backs every project
  // that names it — so its builder lives in the médiathèque, not in one song's graph.
  // Right-click a node → the shell opens its context menu.
  onContextMenu?: (ctx: MenuCtx, x: number, y: number) => void;
  // A `+` click opens the module picker at the pointer, and pre-writes a command once one is chosen.
  onEdgeInsert?: (
    info: { before: string; after: string },
    x: number,
    y: number,
  ) => void;
  // A right-click on empty canvas opens the same picker, for a module wired to nothing.
  onCanvasInsert?: (x: number, y: number) => void;
  // Live plugin params as an EXTERNAL store, so param frames re-render the graph and not the whole app.
  pluginParamsStore: PluginParamsStore;
  requestPluginParams: (id: string) => void;
  watchPluginParams: (id: string, on: boolean) => void;
  setPluginParam: (id: string, name: string, value: number) => void;
  // Live mixer state plus the two callbacks a track node's controls actuate — pure pass-through to the canvas.
  trackControls?: Record<string, TrackControlValues>;
  onTrackToggle?: (trackId: string, control: "mute" | "solo" | "arm") => void;
  onTrackSet?: (
    trackId: string,
    control: "volume" | "pan",
    value: number,
  ) => void;
  /** Frame the chains a track feeds. `nonce` is what makes picking the SAME track twice re-frame. */
  focus?: { id: string; nonce: number } | null;
  /** How many chains that framing found — so the shell's status line can say when it was none. */
  onFocused?: (chains: number) => void;
  /**
   * Modules to pull onto ONE rank, and frame the camera on — the mixer view, and nothing else.
   *
   * A list rather than a flag: the shell knows which modules are the strips (`mixerStrips.ts`
   * reads it off the compiled project) and this package must not have to guess. Empty or absent
   * leaves the graph exactly as it lays out on its own.
   */
  alignModules?: readonly string[];
  /**
   * Where the shell reaches MIDI learn from.
   *
   * The runtime lives HERE because this is the one component that always holds the graph — the map
   * is part of it — and it stays mounted when the pane is hidden, so a controller keeps playing
   * while you are looking at the timeline. The shell only needs to arm a learn, so it gets a
   * handle rather than the whole thing.
   */
  midiRef?: React.RefObject<MidiControlApi | null>;
  /** Say what a learn is waiting for, or what it captured. */
  onMidiStatus?: (line: string) => void;
}) {
  const [graph, setGraph] = useState<WebGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  // Through a ref, so the seed is not a dependency of this effect: it arrives in the same update as
  // the reload it answers, and depending on it would re-run the effect a second time for the same
  // graph. `consumedSeed` is what makes it a one-shot.
  const seedRef = useRef(seedGraph);
  seedRef.current = seedGraph;
  const consumedSeed = useRef(0);
  useEffect(() => {
    const seed = seedRef.current;
    if (seed && seed.id > consumedSeed.current) {
      consumedSeed.current = seed.id;
      setGraph(seed.graph);
      setError(null);
      return;
    }
    api
      .graph()
      .then((g) => {
        setGraph(g);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }, [reloadKey]);

  // Bypasses clicked but not yet confirmed by a graph refetch, by module name.
  //
  // The command itself is now milliseconds and the engine flips the plugin live, but the BUTTON reads its state
  // off the graph — and the graph is re-read from disk on every fetch (~220 ms on a real song, plus a dagre
  // relayout). So the audio changed instantly while the control sat there looking untouched, which is the whole
  // of what "the interaction takes a second" describes. Held here, cleared the moment real data lands.
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

  /**
   * A rack pad was clicked: audition that symbol's material.
   *
   * `preview` rather than the node's own sampler, deliberately: the engine has no verb for
   * sounding one note of a loaded plugin, and this one exists end to end. What you hear is the
   * SAMPLE, dry — not the reverb and the mixer that follow the rack in the chain. That is the
   * trade the audition route makes, and it is the same sound the editor's gutter ▶ plays.
   *
   * The row comes off the node, which already carries the effective rack (`WebChainStep.rack`),
   * so nothing is fetched and a slice finds its window without a second lookup.
   */
  const triggerRack = useCallback((module: string, symbol: string) => {
    const node = laidRef.current?.nodes.find(
      (n) => n.kind === "module" && n.module === module,
    );
    const sound = node?.rack?.find((s) => s.symbol === symbol);
    if (!sound) return;
    // `kind: "source"` and not `"clip"`: what a rack holds is NOT a clip id by the time it gets
    // here. `resolveRackAudio` has already rewritten it to a path in the module's own folder —
    // which is exactly what the engine is handed — and `resolvePreview` takes a path either way.
    const req: PreviewReq | null = sound.clip
      ? { kind: "source", source: sound.clip }
      : sound.source
        ? {
            kind: "slice",
            source: sound.source,
            from: sound.from ?? 0,
            to: sound.to ?? 0,
          }
        : null;
    // A symbol with neither names no material at all — the compiler already reports that against
    // the file, so there is nothing to add here.
    if (!req) return;
    // …but a symbol whose material does not RESOLVE is worth a word: a pad that is drawn, lights
    // with the sequence and stays silent on click is otherwise indistinguishable from a broken
    // app. `rack-demo`'s own kit is in exactly that state — its samples sit in `clips/` while
    // `resolveRackAudio` looks in the module's folder.
    void api
      .preview(req)
      .catch((e: Error) =>
        showToast({ message: `${symbol}: ${e.message}`, variant: "error" }),
      );
  }, []);

  // Which of this project's rack sounds are firing right now — derived from the arrangement and
  // the playhead, since the engine reports no notes. See rackLit.ts.
  const rackLit = useLiveRackLit(project, graph);

  /**
   * The project's NOTES, by name. `graph.modules` is keyed by doc modules and nothing else
   * (see graphDoc.ts), so its keys ARE the notes — no second field says which nodes are prose.
   */
  const docNames = useMemo(
    () => new Set(Object.keys(graph?.modules ?? {})),
    [graph],
  );
  useEffect(() => onDocCount?.(docNames.size), [docNames, onDocCount]);

  /**
   * The graph as it is DRAWN: without the notes, unless the shell asked for them.
   *
   * Filtered before `buildGraph` rather than after layout, which is the whole reason this is
   * its own memo: dagre ranks what it is given, so hiding a node afterwards would leave the
   * hole it was laid out into — a gap in the signal path where a note used to be.
   *
   * A note is dropped from BOTH places it can appear: a step in a chain's `use`, and the `to`
   * of an `out` when a run ends on one. Missing the second would draw a cable to nothing.
   */
  const drawn = useMemo(() => {
    if (!graph || showDocs || docNames.size === 0) return graph;
    return {
      ...graph,
      chains: Object.fromEntries(
        Object.entries(graph.chains).map(([name, c]) => [
          name,
          {
            ...c,
            use: c.use.filter((s) => !docNames.has(s.module)),
            out: (c.out ?? []).filter(
              (o) => !docNames.has(splitPort(o.to).node),
            ),
          },
        ]),
      ),
    };
  }, [graph, showDocs, docNames]);

  const laid = useMemo(() => {
    if (!drawn) return null;
    // No OUT card. Reaching the sound card is what the END of a chain means here — a mixer sits
    // there and its whole job is the level going out — so a node saying "OUT" would add a card,
    // an edge and a rank to every chain in the song to repeat what the shape already says.
    // The routing is untouched: this is the picture, and the engine reads the compiled doc.
    const { nodes, edges } = buildGraph(drawn, { drawMainOut: false });
    // The mixer view is an ARRANGEMENT of this same graph: same nodes, same cables. One rank
    // puts the strips on a line, then an even re-spacing gives that line a console's rhythm —
    // dagre would otherwise space them by whatever feeds them. See @studio/ui-chains.
    const row = alignModules ?? [];
    return spaceModulesEvenly(layout(alignModuleRank(nodes, row), edges), row);
  }, [drawn, alignModules]);

  // The optimistic flag painted on, after layout — it changes how a node READS, never where it sits, so this
  // costs nothing and cannot move the picture under the pointer.
  const laidShown = useMemo(() => {
    if (!laid || !Object.keys(pendingBypass).length) return laid;
    return {
      ...laid,
      nodes: laid.nodes.map((n) => {
        if (n.kind !== "module" || !n.module) return n;
        const b = pendingBypass[n.module];
        return b === undefined ? n : { ...n, bypassed: b, dim: b };
      }),
    };
  }, [laid, pendingBypass]);

  // A node for the module being created, sitting where it will land: midway between the two ends of the arrow
  // that was clicked. Adding a module costs ~700 ms of genuine recompiling on a real song (measured), and until
  // it lands the graph looks exactly as it did — so the click reads as having done nothing. This is the only
  // honest thing to draw: it is not the module (nobody knows what it will look like), it is the WAIT.
  const withPending = useMemo(() => {
    if (!laidShown || !pendingInsert) return laidShown;
    const find = (name: string) =>
      laidShown.nodes.find((n) => n.module === name || n.label === name);
    const a = find(pendingInsert.before);
    const b = find(pendingInsert.after);
    if (!a && !b) return laidShown;
    const at = a ?? b!;
    const to = b ?? a!;
    const w = 120;
    const h = 56;
    return {
      ...laidShown,
      nodes: [
        ...laidShown.nodes,
        {
          id: "__pending__",
          label: "…",
          kind: "module" as const,
          dim: false,
          missing: false,
          stub: false,
          notSupported: false,
          unknownPlugin: false,
          hasNativePluginUI: false,
          pending: true,
          w,
          h,
          x: (at.x + at.w / 2 + (to.x + to.w / 2)) / 2 - w / 2,
          y: (at.y + at.h / 2 + (to.y + to.h / 2)) / 2 - h / 2,
        },
      ],
    };
  }, [laidShown, pendingInsert]);

  // Read by bypassModule without making it depend on the layout, which would rebind it on every refetch.
  const laidRef = useRef(laid);
  laidRef.current = laid;

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
  //
  // `setParam` is the same call a knob drag makes, so a value moved by hand and one moved by a
  // controller are indistinguishable downstream — including the optimistic override that makes the
  // widget follow before the engine answers.
  const midi = useMidiControl({
    graph,
    setParam: useCallback(
      (m: MappedParam, value: number) =>
        setPluginParam(m.pluginId, m.param, value),
      [setPluginParam],
    ),
  });
  useEffect(() => {
    if (midiRef) midiRef.current = midi;
  }, [midiRef, midi]);
  useEffect(() => {
    if (!midi.learning) return;
    onMidiStatus?.(
      `MIDI learn: ${midi.learning.module} ${midi.learning.param} — move a control, or run any command to cancel`,
    );
  }, [midi.learning, onMidiStatus]);

  // --- framing a track (a double-click on its timeline header) -----------------------
  //
  // The set is the same one the Graph panel draws: every chain `subgraphForTrack` walks to
  // from this track, so a send that leaves the track's own chain is inside the frame too.
  //
  // Applied ONCE per focus, tracked by its nonce rather than by depending on `laid`: the
  // graph is re-laid out after every command, and re-framing on each would take the camera
  // away from wherever it had been panned since. Off screen it waits — a display:none canvas
  // has no size, and fitTo would frame to zero.
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

  /**
   * Frame the aligned row when the mixer view opens — and only then.
   *
   * Keyed on the LIST, so turning it on frames and turning it off leaves the camera alone: coming
   * back from the mixer to the plain graph is not an invitation to re-frame a view you had panned.
   * Off screen it waits, exactly as `focus` does — a display:none canvas has no size and fitTo
   * would frame to zero.
   */
  const rowKey = (alignModules ?? []).join("|");
  const rowFramed = useRef<string | null>(null);
  /** Where the camera was before the row took it, so closing the view gives it back. */
  const camBeforeRow = useRef<Cam | null>(null);
  useEffect(() => {
    if (!laid || !active) return;
    if (rowFramed.current === rowKey) return;
    if (!rowKey) {
      rowFramed.current = rowKey;
      // Leaving: put the camera back where it was. The row borrowed it to show itself; a view
      // you close should leave you where you were, not where it had taken you.
      const back = camBeforeRow.current;
      camBeforeRow.current = null;
      if (back) camApi.current?.set(back);
      return;
    }
    const wanted = new Set(rowKey.split("|"));
    const nodes = laid.nodes.filter((n) => n.module && wanted.has(n.module));
    // On the HEIGHT: a row framed on both axes shrinks with every strip the song gains, and
    // below WIDGET_MIN_SCALE the cards lose their widgets — a mixer of bare names. Let it run
    // off the right instead, where it pans.
    //
    // Marked done only if it ACTUALLY framed. A pane that is still hidden has no size, and
    // recording that attempt would spend the one chance this key ever gets: the view would open
    // on whatever the camera was showing, which reads as a button that does nothing.
    if (!nodes.length) return;
    const was = camApi.current?.get();
    // …and pulled BACK a fifth from a perfect fit. A row framed exactly fills the pane edge to
    // edge, which reads as a wall: the strips are the subject, but what feeds them is the
    // sentence, and a little air is what says the row belongs to a graph.
    if (camApi.current?.fitTo(nodes, { axis: "height", zoom: ROW_ZOOM_OUT })) {
      rowFramed.current = rowKey;
      // Remembered only once the frame actually happened, and only the FIRST time in: a re-run
      // that saved the row's own camera would hand that back as if it were where you had been.
      if (was && !camBeforeRow.current) camBeforeRow.current = was;
    }
  }, [rowKey, laid, active]);

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

  if (error)
    return (
      <div className="p-4 text-sm text-red-400">
        graph unavailable — {error}
      </div>
    );
  if (!graph || !laid)
    return <div className="p-4 text-sm text-muted-foreground">loading…</div>;

  // Past the guard `laid` is real, so this is the layout with any un-confirmed bypass painted on. The fallback
  // never fires — laidShown is only null when laid is — it is how the narrowing reaches a memo computed above.
  const shown = withPending ?? laid;

  return (
    // min-w-0: without it the canvas's width becomes this flex child's minimum and the page slides sideways.
    <div className="relative flex min-h-0 min-w-0 flex-1">
      {/* The MIDI feedback pass, in a component of its own that draws nothing. It is the one thing
          here that has to watch the param store, which ticks per engine frame — subscribing in
          ChainsTab would re-render the whole graph at that rate, which is exactly what the store
          exists to prevent (see its comment on pluginParamsStore). */}
      <MidiFeedback store={pluginParamsStore} push={midi.pushFeedback} />
      {/* On a phone the chain list is a DRAWER, not a column: 288px of a ~390px screen
          would leave the graph a sliver. It slides over the canvas, starts closed, and
          closes again as soon as a chain is picked — by which point the graph is what
          you want to be looking at. */}
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

      {/* Mount the graph only while the tab is visible: a display:none container
          has no size, so fit() would frame to 0 and never show the graph. */}
      <main className="min-w-0 flex-1">
        {active && (
          <DomChains
            icons={STUDIO_ICONS}
            // The mixer arrangement is a ROW: the wheel walks along it and nothing pans
            // vertically. Derived from the same list that made it a row, so the two cannot
            // disagree about which view is on.
            row={(alignModules?.length ?? 0) > 0}
            graph={shown}
            selected={selected}
            trackOrder={trackOrder}
            onSelect={selectFromGraph}
            onContextMenu={onContextMenu}
            onEdgeInsert={onEdgeInsert}
            onCanvasInsert={onCanvasInsert}
            onCamReady={handleCamReady}
            camStore={camStore}
            command={command}
            onBypassModule={bypassModule}
            onNodeMenu={onNodeMenu}
            onTriggerRack={triggerRack}
            rackLit={rackLit}
            engineWarnings={engineWarnings}
            onSetModuleAsset={onSetModuleAsset}
            onAssetBrowse={onAssetBrowse}
            onWatchWaveform={onWatchWaveform}
            pluginParamsStore={pluginParamsStore}
            setPluginParam={setPluginParam}
            trackControls={trackControls}
            onTrackToggle={onTrackToggle}
            onTrackSet={onTrackSet}
          />
        )}
      </main>
    </div>
  );
}

/**
 * The MIDI feedback pass — the only thing here that watches the engine's param values.
 *
 * A component rather than a hook call in ChainsTab, and one that renders null, because those
 * values arrive per engine frame: subscribing in the parent would re-render the graph at that
 * rate. `usePluginParams` re-renders THIS, which draws nothing, and the push goes out from here.
 */
function MidiFeedback({
  store,
  push,
}: {
  store: PluginParamsStore;
  push: (live: Record<string, Record<string, number>>) => void;
}) {
  const live = usePluginParams(store);
  useEffect(() => push(live), [live, push]);
  return null;
}
