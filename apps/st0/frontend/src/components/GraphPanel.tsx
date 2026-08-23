// GraphPanel.tsx — the "Graph" bottom panel: the selected track's signal path, answering
// "where does THIS track go?" without leaving the timeline. Same pipeline as the Chains
// tab (subgraph -> buildGraph -> dagre -> DomChains), only the input set differs; dagre
// already lays the path out, so don't hand-roll a strip — it would lose the routed sends.
// The track comes from the caret, so the panel has no selection state of its own.

import type { PluginParamsStore } from "@studio/engine-browser/params";
import type { LaneSpan } from "@studio/ui-chains/cables";
import type { TrackControlValues } from "@studio/ui-chains/graph";
import { buildGraph, layout, subgraphForTrack } from "@studio/ui-chains/graph";
import { type Cam, DomChains } from "@studio/ui-chains-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { STUDIO_ICONS } from "../chainsIcons";
import type { MenuCtx } from "../contextMenu";
import { useDocument } from "../hooks/useDocument";
import { m } from "../paraglide/messages.js";
import { useLiveRackLit } from "../rackLit";
import type { WebProject } from "../types";

export function GraphPanel({
  reloadKey,
  organizeKey = 0,
  trackId,
  trackOrder,
  videoSpans,
  project,
  command,
  onBypassModule,
  onNodeMenu,
  engineWarnings,
  onContextMenu,
  pluginParamsStore,
  setPluginParam,
  moduleParams,
  trackControls,
  onTrackToggle,
  onTrackSet,
}: {
  reloadKey: number;
  // Bumped when `graph organize` ran — empties the held node positions (see ChainsTab's).
  organizeKey?: number;
  trackId: string | null;
  // The engine's track order; the live-signal set is derived off the store (see ChainsTab).
  trackOrder: string[];
  /** …and when each video lane shows a picture, which nothing meters — straight through, for the
   *  panel that happens to be looking at a subgraph holding one. See ../videoSpans.ts. */
  videoSpans?: Readonly<Record<string, readonly LaneSpan[]>>;
  /** The compiled doc, for the rack pads' lit state — straight through to ChainsTab. */
  project?: WebProject | null;
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
  /** …and the third source, for the modules the engine holds NOTHING of. Same prop, same
   *  reason as ChainsTab's: without it a tempo node draws its file's number forever. */
  moduleParams?: Record<string, Record<string, number>>;
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
  const [selected, setSelected] = useState<string | null>(null);
  // Re-asked when the project moves, and again on a backoff while the service is not answering —
  // see useDocument. This pane is read far more than it is edited, so a failure with nothing to
  // lift it would sit here until a command happened along.
  const { doc: graph, error } = useDocument(() => api.graph(), reloadKey);

  // The session memory ChainsTab keeps, for the same reason: an edit must not reorganize
  // the picture under the pointer. Per TRACK — another track is another picture — and
  // emptied by `graph organize` (organizeKey), the one reorganizing operation.
  const prevLaid = useRef<Map<string, { x: number; y: number }> | null>(null);
  const prevScope = useRef<string | number>("");
  const laid = useMemo(() => {
    if (!graph || !trackId) return null;
    const sub = subgraphForTrack(graph, trackId);
    if (!Object.keys(sub.chains).length) return null; // nothing routes this track
    const { nodes, edges } = buildGraph(sub);
    const scope = `${trackId}:${organizeKey}`;
    if (prevScope.current !== scope) {
      prevScope.current = scope;
      prevLaid.current = null;
    }
    // The pins apply here too: the panel is a window onto the same graph, and a module the
    // person placed must not sit somewhere else depending on which pane is looking. After an
    // organize they are simply gone from the file, so nothing needs suppressing here.
    const out = layout(
      nodes,
      edges,
      graph.positions,
      prevLaid.current ?? undefined,
    );
    prevLaid.current = new Map(
      out.nodes.map((n) => [n.id, { x: n.x, y: n.y }]),
    );
    return out;
  }, [graph, trackId, organizeKey]);

  // A chain selected on one track means nothing once the caret moves to another.
  useEffect(() => setSelected(null), [trackId]);

  // The rack pads light here too: this panel draws the same nodes, so it owes them the same
  // answer. The hook is the whole wiring — see rackLit.ts.
  const rackLit = useLiveRackLit(project, graph);

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
        videoSpans={videoSpans}
        rackLit={rackLit}
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
        moduleParams={moduleParams}
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
