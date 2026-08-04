// GraphPanel.tsx — the "Graph" bottom panel: the selected track's signal path, answering
// "where does THIS track go?" without leaving the timeline. Same pipeline as the Chains
// tab (subgraph -> buildGraph -> dagre -> DomChains), only the input set differs; dagre
// already lays out LR, so don't hand-roll a strip — it would lose the routed sends.
// The track comes from the caret, so the panel has no selection state of its own.

import { useActiveTracks } from "@studio/engine-browser/store";
import { buildGraph, layout, subgraphForTrack } from "@studio/ui-chains/graph";
import { DomChains } from "@studio/ui-chains-react";
import { useEffect, useMemo, useState } from "react";
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
  engineWarnings,
  onContextMenu,
}: {
  reloadKey: number;
  trackId: string | null;
  // The engine's track order; the live-signal set is derived off the store (see ChainsTab).
  trackOrder: string[];
  command: (line: string) => void | Promise<void>;
  // Bypass must RELOAD, unlike `command`'s quiet path, or the canvas keeps drawing the pre-bypass state.
  onBypassModule?: (module: string) => void;
  /** Engine load problems by plugin id, badged onto the module they concern. */
  engineWarnings?: Record<string, string>;
  // Right-click a node → the shell opens its context menu.
  onContextMenu?: (ctx: MenuCtx, x: number, y: number) => void;
}) {
  const activeTracks = useActiveTracks(trackOrder);
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
        activeTracks={activeTracks}
        trackOrder={trackOrder}
        onSelect={setSelected}
        onContextMenu={onContextMenu}
        // This panel follows the caret's track, so another track IS a different graph and earns a re-frame; a reload isn't.
        fitKey={trackId}
        command={command}
        onBypassModule={onBypassModule}
        engineWarnings={engineWarnings}
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
