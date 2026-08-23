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
import type { MenuCtx } from "../contextMenu";
import { m } from "../paraglide/messages.js";
import type { WebGraph } from "../types";
import { GraphSlotPane } from "./GraphSlotPane";

/** Cards are drawn 1.5× the width their grid asks for — elbow room, not bigger controls: see moduleRow. */
const CARD_WIDTH_SCALE = 1.5;

export function TrackModulesPane({
  trackId,
  reloadKey,
  command,
  trackOrder,
  pluginParamsStore,
  requestPluginParams,
  watchPluginParams,
  setPluginParam,
  moduleParams,
  trackControls,
  onContextMenu,
  engineWarnings,
  onClose,
}: {
  /** The lane whose path this is. */
  trackId: string;
  reloadKey: number;
  command: (line: string) => void | Promise<void>;
  trackOrder: string[];
  pluginParamsStore: PluginParamsStore;
  requestPluginParams: (id: string) => void;
  watchPluginParams: (id: string, on: boolean) => void;
  setPluginParam: (id: string, name: string, value: number) => void;
  /** What the modules with NO plugin are set to — a deck's tempo node hangs off a track, so it can land in this row too. */
  moduleParams?: Record<string, Record<string, number>>;
  trackControls?: Record<string, TrackControlValues>;
  onContextMenu?: (ctx: MenuCtx, x: number, y: number) => void;
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
          })
        : null,
    [graph, modules],
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
      {laid.nodes.length} module{laid.nodes.length > 1 ? "s" : ""}, in signal
      order · the modules' own panels
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
      onContextMenu={onContextMenu}
      engineWarnings={engineWarnings}
      pluginParamsStore={pluginParamsStore}
      setPluginParam={setPluginParam}
      moduleParams={moduleParams}
      trackControls={trackControls}
    />,
  );
}
