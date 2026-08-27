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
  cameras,
  organizeKey = 0,
  trackId,
  trackOrder,
  videoSpans,
  project,
  command,
  onBypassModule,
  onModuleField,
  onRecorder,
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
  /** The lenses this browser can see — a camera card's dropdown, packages/song/docs/camera.md. */
  cameras?: readonly string[];
  // Bumped when `graph organize` ran — empties the held node positions (see ChainsTab's).
  organizeKey?: number;
  trackId: string | null;
  // The engine's track order; the live-signal set is derived off the store (see ChainsTab).
  trackOrder: string[];
  /** …and when each video lane shows a picture, which nothing meters — straight through, for a subgraph holding one (../videoSpans.ts). */
  videoSpans?: Readonly<Record<string, readonly LaneSpan[]>>;
  /** The compiled doc, for the rack pads' lit state — straight through to ChainsTab. */
  project?: WebProject | null;
  command: (line: string) => void | Promise<void>;
  // Bypass must RELOAD, unlike `command`'s quiet path, or the canvas keeps drawing the pre-bypass state.
  onBypassModule?: (module: string) => void;
  /** …and so must an intrinsic, which has no optimistic value at all — see DomChains' prop. */
  onModuleField?: (line: string) => void | Promise<void>;
  /** A RECORDER's button, straight through — see DomChains' prop. */
  onRecorder?: (
    verb: "record" | "clear" | "save",
    node: { module: string; pluginId?: string },
  ) => void;
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
  /** The live values, and the way back: without them a widget draws the FILE's number and a drag sends nothing (../../docs/chainsGraph.md). */
  pluginParamsStore: PluginParamsStore;
  setPluginParam: (id: string, name: string, value: number) => void;
  /** …and the third source, for the modules the engine holds NOTHING of — without it a tempo node draws its file's number for ever. */
  moduleParams?: Record<string, Record<string, number>>;
  trackControls?: Record<string, TrackControlValues>;
  onTrackToggle?: (trackId: string, control: "mute" | "solo" | "arm") => void;
  onTrackSet?: (
    trackId: string,
    control: "volume" | "pan",
    value: number,
  ) => void;
}) {
  // Parked HERE, because App mounts this panel conditionally: a camera held inside it would be a fresh frame on every reopen.
  const camStore = useRef<Cam | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Re-asked when the project moves, and again on a backoff while the service is not answering — see useDocument.
  const { doc: graph, error } = useDocument(() => api.graph(), reloadKey);

  // The session memory ChainsTab keeps, per TRACK — another track is another picture — and emptied by `graph organize`.
  const prevLaid = useRef<Map<string, { x: number; y: number }> | null>(null);
  const prevScope = useRef<string | number>("");
  const laid = useMemo(() => {
    if (!graph || !trackId) return null;
    const sub = subgraphForTrack(graph, trackId);
    if (!Object.keys(sub.chains).length) return null; // nothing routes this track
    const { nodes, edges } = buildGraph(sub, { cameras });
    const scope = `${trackId}:${organizeKey}`;
    if (prevScope.current !== scope) {
      prevScope.current = scope;
      prevLaid.current = null;
    }
    // The pins apply here too: the panel is a window onto the same graph, and a placed module must not move with the pane.
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
  }, [graph, trackId, organizeKey, cameras]);

  // A chain selected on one track means nothing once the caret moves to another.
  useEffect(() => setSelected(null), [trackId]);

  // The rack pads light here too: this panel draws the same nodes, so it owes them the same answer (rackLit.ts).
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
        onModuleField={onModuleField}
        onRecorder={onRecorder}
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
