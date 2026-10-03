// TrackModulesPane.tsx — one track's modules, side by side, drawn where the GRAPH is. The
// signal path of a single lane, laid out horizontally by `moduleRow` in the order the song
// writes it. Nothing here is hand-rolled: each card is the card the chains view draws.
// See docs/shell.md.

import type { PluginParamsStore } from "@studio/engine-browser/params";
import type { TrackControlValues } from "@studio/ui-chains/graph";
import { moduleRow, trackModules } from "@studio/ui-chains/graph";
import { DomChains, type TapAction } from "@studio/ui-chains-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, thawAutoFreeze } from "../api";
import { STUDIO_ICONS } from "../chainsIcons";
import type { MenuCtx } from "../contextMenu";
import { useRackTrigger } from "../hooks/useRackTrigger";
import { nodeNameFor } from "../nodeInsert";
import { m } from "../paraglide/messages.js";
import type { WebGraph } from "../types";
import { GraphSlotPane } from "./GraphSlotPane";

export function TrackModulesPane({
  trackId,
  cameras,
  midiDevices,
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
  onAlternative,
  onEngine,
  onPresets,
  presetNames,
  onAssetBrowse,
  onTapEdit,
  onWatchWaveform,
  onTrackToggle,
  onTrackSet,
  onEdgeInsert,
  engineWarnings,
  onClose,
}: {
  /** The lane whose path this is. */
  trackId: string;
  /** The cameras and MIDI devices this browser sees — what those nodes' dropdowns offer, as in the full graph. */
  cameras?: readonly string[];
  midiDevices?: readonly string[];
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
  /** A card's own bypass button — asks only; `pendingBypass` is what moves the card, nothing reloads. */
  onBypassModule?: (module: string) => void;
  /** …the alternative badges on a node, and the file-valued param's browser, for the same reason. */
  onAlternative?: (module: string, name: string | null) => void;
  /** A node's engine dropdown — straight through, the command being the SHELL's (packages/song/docs/engines.md). */
  onEngine?: (module: string, name: string) => void;
  /** A node's preset dropdown — the shell draws the list (packages/song/docs/userPresets.md). */
  onPresets?: (module: string, x: number, y: number) => void;
  /** The preset each node last loaded, by node. */
  presetNames?: Record<string, string>;
  onAssetBrowse?: (module: string, kind: string, x: number, y: number) => void;
  /** A rack tap's edit — the shell runs its `node tap` command (packages/song/docs/racks.md). */
  onTapEdit?: (module: string, action: TapAction) => void;
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
            // The cards the graph draws, at the graph's size: this is a view of the same nodes, not a bigger one.
            asDrawn: true,
            // …and with the same lists in their dropdowns: a lens, a MIDI device.
            devices: { cameras, midiDevices },
            // The cables ARE the subject here: one lane's signal path, met on the SIDES because the row is read across.
            links: true,
            // …and the lane leads it: the signal starts on the lane, and its fader is the first thing in the path.
            track: trackId,
          })
        : null,
    [graph, modules, trackId, cameras, midiDevices],
  );

  // A pad on a card in this row PLAYS, by the same hook as the chains pane.
  const laidRef = useRef(laid);
  laidRef.current = laid;
  const triggerRack = useRackTrigger(laidRef);

  // Bypasses clicked but not yet in `graph`: a bypass bumps no reloadKey, which is all this row refetches on (docs/shell.md).
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

  // The optimistic flag painted on after layout: it changes how a node READS, never where it sits.
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

  // No bar: the row IS the view, the lane's own card names it, and the ✕ floats top right (GraphSlotPane).
  // Every state keeps the frame, so the ✕ is reachable even with nothing to draw — a view you cannot close is worse than an empty one.
  const frame = (body: React.ReactNode) => (
    <GraphSlotPane onClose={onClose}>{body}</GraphSlotPane>
  );
  // What the pane says when there is no row to draw, where the row would be.
  const say = (text: React.ReactNode) =>
    frame(
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
        {text}
      </div>,
    );

  if (error) return say(<span className="text-red-500">{error}</span>);
  if (!laidShown) return say(m["common.loading"]());
  if (!laidShown.nodes.length)
    return say("this lane reaches no module — nothing to show");

  return frame(
    <DomChains
      icons={STUDIO_ICONS}
      graph={laidShown}
      selected={selected}
      onSelect={setSelected}
      trackOrder={trackOrder}
      // Re-frame when the ROW changes, not on every refetch: a param landing must not take the camera back.
      fitKey={modules.join("|")}
      // Fill the HEIGHT and let the row run off the right, which pans: fitting both axes would shrink every card as the lane grows.
      fitAxis="height"
      // …all of it: the tallest card is the pane's height, the others centred on its line.
      fitPad={1}
      // A lane's few modules are what this pane is FOR: they never collapse to their far, name-only card.
      alwaysDetailed
      // A row is read across: the wheel walks along it and nothing pans vertically.
      row
      command={command}
      onModuleField={onModuleField}
      onRecorder={onRecorder}
      onProjectField={onProjectField}
      onContextMenu={onContextMenu}
      onBypassModule={bypassModule}
      onThawAutoFreeze={thawAutoFreeze}
      onAlternative={onAlternative}
      onEngine={onEngine}
      onPresets={onPresets}
      presetNames={presetNames}
      onAssetBrowse={onAssetBrowse}
      onTapEdit={onTapEdit}
      onTriggerRack={triggerRack}
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
