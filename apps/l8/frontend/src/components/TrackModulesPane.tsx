// TrackModulesPane.tsx — one track's modules, side by side, drawn where the GRAPH is. The
// signal path of a single lane, laid out horizontally by `moduleRow` in the order the song
// writes it. Nothing here is hand-rolled: each card is the card the chains view draws.
// See docs/shell.md.

import type { PluginParamsStore } from "@studio/engine-browser/params";
import type { TrackControlValues } from "@studio/ui-chains/graph";
import { moduleRow, trackModules } from "@studio/ui-chains/graph";
import { DomChains } from "@studio/ui-chains-react";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { STUDIO_ICONS } from "../chainsIcons";
import type { MenuCtx } from "../contextMenu";
import { m } from "../paraglide/messages.js";
import type { WebGraph } from "../types";

/** Cards are drawn 1.5× the width their grid asks for — read side by side, a card sized exactly
 *  to its controls reads as cramped. Elbow room, not bigger controls: see moduleRow. */
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

  // The graph alone answers both halves here — which modules the lane reaches, and what each
  // one looks like. Unlike the mixer row, no compiled project is needed: a chain's `use` list
  // is the order, and it is in the graph doc.
  const modules = useMemo(
    () => (graph ? trackModules(graph, trackId) : []),
    [graph, trackId],
  );
  const laid = useMemo(
    () =>
      graph
        ? moduleRow(graph, modules, {
            widthScale: CARD_WIDTH_SCALE,
            // The cables ARE the subject here: this is one lane's signal path, and what feeds
            // what is the whole point of reading it. They meet the cards on the SIDES, because
            // the row is read across — see `flow` in @studio/ui-chains.
            links: true,
          })
        : null,
    [graph, modules],
  );

  // The plugins these cards draw, so their knobs show what the engine holds rather than what the
  // file last said. Asked once per row, then followed — the same pair ChainsTab runs.
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

  /** The strip across the top: what this is, and the ✕ that puts the graph back. */
  const Bar = ({ children }: { children: React.ReactNode }) => (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{trackId}</span>
      <span>· {children}</span>
      <button
        type="button"
        className="ml-auto rounded p-1 hover:bg-accent hover:text-foreground"
        title="Close — back to the graph"
        aria-label="Close this track's modules"
        onClick={onClose}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  // Every state keeps the bar, so the ✕ is reachable even when there is nothing to draw — a view
  // you cannot close is worse than a view that is empty.
  if (error)
    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        <Bar>
          <span className="text-red-500">{error}</span>
        </Bar>
      </div>
    );
  if (!laid)
    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        <Bar>{m["common.loading"]()}</Bar>
      </div>
    );
  if (!laid.nodes.length)
    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        <Bar>this lane reaches no module — nothing to show</Bar>
      </div>
    );

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <Bar>
        {laid.nodes.length} module{laid.nodes.length > 1 ? "s" : ""}, in signal
        order · the modules' own panels
      </Bar>
      <div className="min-h-0 flex-1">
        <DomChains
          icons={STUDIO_ICONS}
          graph={laid}
          selected={selected}
          onSelect={setSelected}
          trackOrder={trackOrder}
          // Re-frame when the ROW changes, not on every refetch: a param landing must not take
          // the camera back from wherever it was panned.
          fitKey={modules.join("|")}
          // Fill the HEIGHT and let the row run off the right, which pans. Fitting both axes
          // would shrink every card as the lane gains modules — see docs/shell.md's measurements.
          fitAxis="height"
          // A row is read across: the wheel walks along it and nothing pans vertically.
          row
          command={command}
          onContextMenu={onContextMenu}
          engineWarnings={engineWarnings}
          pluginParamsStore={pluginParamsStore}
          setPluginParam={setPluginParam}
          trackControls={trackControls}
        />
      </div>
    </div>
  );
}
