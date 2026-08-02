// ChainsTab.tsx — the routing graph: a chain list beside a node viewer, where each chain
// expands into its real signal path (source track, every `use` module, the weighted
// outputs). dagre lays it out and DomChains draws it, following dagre's ROUTED points so a
// send that skips a column doesn't slice through the module between. Shared with GraphPanel.

import { cn } from "@frediverse/ui/lib/utils";
import type { PluginParamsStore } from "@studio/engine-browser/params";
import { useActiveTracks } from "@studio/engine-browser/store";
import type { TrackControlValues } from "@studio/ui-chains/graph";
import { buildGraph, layout } from "@studio/ui-chains/graph";
import { DomChains, type FitToFn } from "@studio/ui-chains-react";
import { ChevronRight, List } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { LANES_ICONS } from "../chainsIcons";
import type { MenuCtx } from "../contextMenu";
import type { WebGraph } from "../types";
import { useIsMobile } from "../useIsMobile";

export function ChainsTab({
  reloadKey,
  active,
  showList,
  trackOrder,
  command,
  onBypassModule,
  engineWarnings,
  onSetModuleAsset,
  onLibraryBrowse,
  onWatchWaveform,
  pendingInsert,
  onPickModule,
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
}: {
  reloadKey: number;
  // VISIBLE, not focused: a display:none container has no size and fit() would frame to 0.
  active: boolean;
  showList: boolean; // the sidebar is fullscreen chrome; the global view's pane is canvas only
  // The engine's track order; liveness is derived off the store here, so only the graph re-runs it.
  trackOrder: string[];
  command: (line: string) => void | Promise<void>;
  // Toggle a module's bypass. The canvas flips the node itself on click and lets the refetch confirm — see
  // pendingBypass; the command no longer reloads the project, so waiting for one would be waiting for nothing.
  onBypassModule?: (module: string) => void;
  /** Engine load problems by plugin id, badged onto the module they concern. */
  engineWarnings?: Record<string, string>;
  // Load a library file into a module: `kind` is the asset, `file` library-relative or "none" to clear.
  onSetModuleAsset?: (module: string, kind: string, file: string) => void;
  /** Open the library browser for a module's asset field, at viewport coords. */
  onLibraryBrowse?: (
    module: string,
    kind: string,
    x: number,
    y: number,
  ) => void;
  /** Place/remove the engine's waveform tap while a waveform widget is on screen. */
  onWatchWaveform?: (
    pluginId: string,
    side: "input" | "output",
    on: boolean,
  ) => void;
  /** The arrow a module is being created on right now, or null. Drawn as a placeholder until real data lands. */
  pendingInsert?: { before: string; after: string } | null;
  // Lifts the tapped module up to the shell so the Docs panel can follow it.
  onPickModule?: (module: string | null) => void;
  // No "edit this module" here on purpose: a module is a WORKSPACE thing — the same file backs every project
  // beside it — so its builder lives in the settings panel (see ModulesPage), not in one song's graph.
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
}) {
  const activeTracks = useActiveTracks(trackOrder);
  const [graph, setGraph] = useState<WebGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const fitToFn = useRef<FitToFn | null>(null);
  // The camera is parked HERE because this stays mounted while DomChains is torn down with its pane.
  const camStore = useRef<{ x: number; y: number; k: number } | null>(null);
  const isMobile = useIsMobile();
  const [listOpen, setListOpen] = useState(false);

  const handleFitToReady = useCallback((fn: FitToFn) => {
    fitToFn.current = fn;
  }, []);

  useEffect(() => {
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

  const laid = useMemo(() => {
    if (!graph) return null;
    const { nodes, edges } = buildGraph(graph);
    return layout(nodes, edges);
  }, [graph]);

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
                      if (willSelect) fitToFn.current?.(chainNodes(name));
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
                                    fitToFn.current?.(nodes, modNode);
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
            icons={LANES_ICONS}
            graph={shown}
            selected={selected}
            activeTracks={activeTracks}
            trackOrder={trackOrder}
            onSelect={selectFromGraph}
            onPickModule={onPickModule}
            onContextMenu={onContextMenu}
            onEdgeInsert={onEdgeInsert}
            onCanvasInsert={onCanvasInsert}
            onFitToReady={handleFitToReady}
            camStore={camStore}
            command={command}
            onBypassModule={bypassModule}
            engineWarnings={engineWarnings}
            onSetModuleAsset={onSetModuleAsset}
            onLibraryBrowse={onLibraryBrowse}
            onWatchWaveform={onWatchWaveform}
            libraryFiles={graph.libraryFiles}
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
