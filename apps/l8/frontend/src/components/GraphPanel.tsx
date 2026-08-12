// GraphPanel.tsx — the "Graph" bottom panel: the selected track's signal path, answering
// "where does THIS track go?" without leaving the timeline. Same pipeline as the Chains
// tab (subgraph -> buildGraph -> dagre -> DomChains), only the input set differs; dagre
// already lays the path out, so don't hand-roll a strip — it would lose the routed sends.
// The track comes from the caret, so the panel has no selection state of its own.

import type { PluginParamsStore } from "@studio/engine-browser/params";
import type { TrackControlValues } from "@studio/ui-chains/graph";
import { buildGraph, layout, subgraphForTrack } from "@studio/ui-chains/graph";
import { type Cam, DomChains } from "@studio/ui-chains-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { STUDIO_ICONS } from "../chainsIcons";
import type { MenuCtx } from "../contextMenu";
import { m } from "../paraglide/messages.js";
import type { WebGraph } from "../types";

export function GraphPanel({
  reloadKey,
  trackId,
  trackOrder,
  command,
  onBypassModule,
  onNodeMenu,
  engineWarnings,
  onContextMenu,
  pluginParamsStore,
  setPluginParam,
  trackControls,
  onTrackToggle,
  onTrackSet,
}: {
  reloadKey: number;
  trackId: string | null;
  // The engine's track order; the live-signal set is derived off the store (see ChainsTab).
  trackOrder: string[];
  command: (line: string) => void | Promise<void>;
  // Bypass must RELOAD, unlike `command`'s quiet path, or the canvas keeps drawing the pre-bypass state.
  onBypassModule?: (module: string) => void;
  /** The ⋮ bubble on a node → the shell opens that node's menu (alternatives, freeze). */
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
  // Right-click a node → the shell opens its context menu.
  onContextMenu?: (ctx: MenuCtx, x: number, y: number) => void;
  /**
   * The live values, and the way back.
   *
   * This panel had NEITHER, and was the only host of DomChains in the repo without them. A
   * widget with no store falls back to `n.params` — the number the project file declares,
   * never the one the engine holds — and a widget with no setter is still draggable: it moves
   * its optimistic override and sends nothing, with no frame arriving to correct it. It looked
   * like it worked. See ../../docs/chainsGraph.md.
   */
  pluginParamsStore: PluginParamsStore;
  setPluginParam: (id: string, name: string, value: number) => void;
  trackControls?: Record<string, TrackControlValues>;
  onTrackToggle?: (trackId: string, control: "mute" | "solo" | "arm") => void;
  onTrackSet?: (
    trackId: string,
    control: "volume" | "pan",
    value: number,
  ) => void;
}) {
  // Parked HERE, because App mounts this panel conditionally: it is torn down every time the
  // panel is closed, and a camera held inside it would be a fresh frame on every reopen. Same
  // rule as ChainsTab's, and the reason DomChains takes the ref rather than owning it.
  const camStore = useRef<Cam | null>(null);
  const [graph, setGraph] = useState<WebGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    api
      .graph()
      .then((g) => {
        setGraph(g);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }, [reloadKey]);

  const laid = useMemo(() => {
    if (!graph || !trackId) return null;
    const sub = subgraphForTrack(graph, trackId);
    if (!Object.keys(sub.chains).length) return null; // nothing routes this track
    const { nodes, edges } = buildGraph(sub);
    return layout(nodes, edges);
  }, [graph, trackId]);

  // A chain selected on one track means nothing once the caret moves to another.
  useEffect(() => setSelected(null), [trackId]);

  const body = () => {
    if (error)
      return <Note className="text-red-400">graph unavailable — {error}</Note>;
    if (!graph) return <Note>loading…</Note>;
    if (!trackId) return <Note>{m["graph.selectTrack"]()}</Note>;
    if (!laid) return <Note>No chain takes {trackId} as its source.</Note>;
    return (
      <DomChains
        icons={STUDIO_ICONS}
        graph={laid}
        selected={selected}
        trackOrder={trackOrder}
        onSelect={setSelected}
        onContextMenu={onContextMenu}
        // This panel follows the caret's track, so another track IS a different graph and earns a re-frame; a reload isn't.
        fitKey={trackId}
        camStore={camStore}
        command={command}
        onBypassModule={onBypassModule}
        onNodeMenu={onNodeMenu}
        engineWarnings={engineWarnings}
        pluginParamsStore={pluginParamsStore}
        setPluginParam={setPluginParam}
        trackControls={trackControls}
        onTrackToggle={onTrackToggle}
        onTrackSet={onTrackSet}
      />
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1 text-xs">
        <span className="font-semibold text-primary">Graph</span>
        <span className="truncate font-mono text-muted-foreground">
          {trackId ?? "no track selected"}
        </span>
      </div>
      <div className="min-h-0 flex-1">{body()}</div>
    </div>
  );
}

function Note({
  children,
  className = "text-muted-foreground",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`p-4 text-sm ${className}`}>{children}</div>;
}
