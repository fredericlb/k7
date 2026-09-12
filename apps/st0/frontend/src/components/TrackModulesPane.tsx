// TrackModulesPane.tsx — one track's modules, side by side, drawn where the GRAPH is. The
// signal path of a single lane, laid out horizontally by `moduleRow` in the order the song
// writes it. Nothing here is hand-rolled: each card is the card the chains view draws.
// See docs/shell.md.

import type { PluginParamsStore } from "@studio/engine-browser/params";
import type { TrackControlValues } from "@studio/ui-chains/graph";
import { moduleRow, trackModules } from "@studio/ui-chains/graph";
import { DomChains } from "@studio/ui-chains-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { STUDIO_ICONS } from "../chainsIcons";
import type { MenuCtx, NodeMenuTarget } from "../contextMenu";
import { nodeNameFor } from "../nodeInsert";
import { m } from "../paraglide/messages.js";
import type { WebGraph } from "../types";
import { GraphSlotPane } from "./GraphSlotPane";

/** Cards are drawn 1.5× the width their grid asks for — elbow room, not bigger controls: see moduleRow. */
const CARD_WIDTH_SCALE = 1.5;

export function TrackModulesPane({
  trackId,
  reloadKey,
  command,
  onModuleField,
  onRecorder,
  onProjectField,
  trackOrder,
  pluginParamsStore,
  requestPluginParams,
  watchPluginParams,
  setPluginParam,
  moduleParams,
  trackControls,
  onContextMenu,
  onBypassModule,
  onNodeMenu,
  onAssetBrowse,
  onWatchWaveform,
  onTrackToggle,
  onTrackSet,
  onEdgeInsert,
  engineWarnings,
  onClose,
}: {
  /** The lane whose path this is. */
  trackId: string;
  reloadKey: number;
  command: (line: string) => void | Promise<void>;
  /** …and the RELOADING sender for a module's own field: an intrinsic dropdown draws the file. */
  onModuleField?: (line: string) => void | Promise<void>;
  /** A RECORDER's button, straight through — see DomChains' prop. */
  /** Set a PROJECT setting — the RENDER card's frame dropdown. */
  onProjectField?: (field: string, value: string) => void;
  onRecorder?: (
    verb: "record" | "clear" | "save",
    node: { module: string; pluginId?: string },
  ) => void;
  trackOrder: string[];
  pluginParamsStore: PluginParamsStore;
  requestPluginParams: (id: string) => void;
  watchPluginParams: (id: string, on: boolean) => void;
  setPluginParam: (id: string, name: string, value: number) => void;
  /** What the modules with NO plugin are set to — a deck's tempo node hangs off a track, so it can land in this row too. */
  moduleParams?: Record<string, Record<string, number>>;
  trackControls?: Record<string, TrackControlValues>;
  onContextMenu?: (ctx: MenuCtx, x: number, y: number) => void;
  /** A card's own bypass button — the row draws the graph's cards, so it owes them the graph's answers. */
  onBypassModule?: (module: string) => void;
  /** …the ⋮ bubble on a node, and the file-valued param's browser, for the same reason. */
  onNodeMenu?: (n: NodeMenuTarget, at: { x: number; y: number }) => void;
  onAssetBrowse?: (module: string, kind: string, x: number, y: number) => void;
  onWatchWaveform?: (
    pluginId: string,
    side: "input" | "output",
    on: boolean,
  ) => void;
  /** The LANE leads this row, so its fader, its mute and its solo are controls in it like any other. */
  onTrackToggle?: (id: string, control: "mute" | "solo" | "arm") => void;
  onTrackSet?: (id: string, control: "volume" | "pan", value: number) => void;
  /** A `+` on one of this row's cables: the shell asks WHICH module, exactly as it does on the graph. */
  onEdgeInsert?: (
    info: { before: string; after: string },
    x: number,
    y: number,
    at: { x: number; y: number } | undefined,
    nameFor: (module: string) => string,
  ) => void;
  engineWarnings?: Record<string, string>;
  /** Put the graph back — every other thing that takes its place closes the same way. */
  onClose: () => void;
}) {
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

  // The graph alone answers both halves here: a chain's `use` list is the order, and it is in the graph doc.
  const modules = useMemo(
    () => (graph ? trackModules(graph, trackId) : []),
    [graph, trackId],
  );
  const laid = useMemo(
    () =>
      graph
        ? moduleRow(graph, modules, {
            widthScale: CARD_WIDTH_SCALE,
            // The cables ARE the subject here: one lane's signal path, met on the SIDES because the row is read across.
            links: true,
            // …and the lane leads it: the signal starts on the lane, and its fader is the first thing in the path.
            track: trackId,
          })
        : null,
    [graph, modules, trackId],
  );

  /** The row's coordinates are its OWN, so a pick gets no `at`: where a new node goes is the graph's to decide. */
  const edgeInsert = useMemo(
    () =>
      onEdgeInsert &&
      graph &&
      ((info: { before: string; after: string }, x: number, y: number) =>
        onEdgeInsert(info, x, y, undefined, (module) =>
          nodeNameFor(graph, module, info.before),
        )),
    [onEdgeInsert, graph],
  );

  // The plugins these cards draw, so their knobs show what the engine holds — asked once per row, then followed.
  const pluginIds = useMemo(
    () =>
      (laid?.nodes ?? [])
        .map((n) => n.pluginId)
        .filter((id): id is string => !!id),
    [laid],
  );
  useEffect(() => {
    for (const id of pluginIds) requestPluginParams(id);
  }, [pluginIds, requestPluginParams]);
  useEffect(() => {
    for (const id of pluginIds) watchPluginParams(id, true);
    return () => {
      for (const id of pluginIds) watchPluginParams(id, false);
    };
  }, [pluginIds, watchPluginParams]);

  // Every state keeps the frame, so the ✕ is reachable even with nothing to draw — a view you cannot close is worse than an empty one.
  const frame = (note: React.ReactNode, body: React.ReactNode = null) => (
    <GraphSlotPane title={trackId} note={note} onClose={onClose}>
      {body}
    </GraphSlotPane>
  );

  if (error) return frame(<span className="text-red-500">{error}</span>);
  if (!laid) return frame(m["common.loading"]());
  if (!laid.nodes.length)
    return frame("this lane reaches no module — nothing to show");

  return frame(
    <>
      {/* The MODULES are counted, the lane's own card at the head of them not being one. */}
      {modules.length} module{modules.length > 1 ? "s" : ""}, in signal order ·
      the modules' own panels
    </>,
    <DomChains
      icons={STUDIO_ICONS}
      graph={laid}
      selected={selected}
      onSelect={setSelected}
      trackOrder={trackOrder}
      // Re-frame when the ROW changes, not on every refetch: a param landing must not take the camera back.
      fitKey={modules.join("|")}
      // Fill the HEIGHT and let the row run off the right, which pans: fitting both axes would shrink every card as the lane grows.
      fitAxis="height"
      // A row is read across: the wheel walks along it and nothing pans vertically.
      row
      command={command}
      onModuleField={onModuleField}
      onRecorder={onRecorder}
      onProjectField={onProjectField}
      onContextMenu={onContextMenu}
      onBypassModule={onBypassModule}
      onNodeMenu={onNodeMenu}
      onAssetBrowse={onAssetBrowse}
      onWatchWaveform={onWatchWaveform}
      onTrackToggle={onTrackToggle}
      onTrackSet={onTrackSet}
      onEdgeInsert={edgeInsert || undefined}
      engineWarnings={engineWarnings}
      pluginParamsStore={pluginParamsStore}
      setPluginParam={setPluginParam}
      moduleParams={moduleParams}
      trackControls={trackControls}
    />,
  );
}
