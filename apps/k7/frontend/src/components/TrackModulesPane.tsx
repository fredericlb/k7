// TrackModulesPane.tsx — one track's modules, side by side, drawn where the GRAPH is. The
// signal path of a single lane, laid out horizontally by `moduleRow` in the order the song
// writes it. Nothing here is hand-rolled: each card is the card the chains view draws.
// See docs/shell.md.

import { KeyboardMusic, Mic, Spline } from "@frediverse/ui/icons";
import type { PluginParamsStore } from "@studio/engine-browser/params";
import { splitTrailingMixer } from "@studio/ui-chains/anchorRight";
import type { EdgeInsert, TrackControlValues } from "@studio/ui-chains/graph";
import { moduleRow, trackInputs, trackModules } from "@studio/ui-chains/graph";
import type { GridFit } from "@studio/ui-chains/gridFit";
import { rowExit, rowSeams } from "@studio/ui-chains/rowSeams";
import {
  DomChains,
  type NodeEngines,
  type TapAction,
} from "@studio/ui-chains-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, thawAutoFreeze } from "../api";
import { STUDIO_ICONS } from "../chainsIcons";
import type { MenuCtx } from "../contextMenu";
import { type HistoryMark, nodePredicate } from "../historyMarks";
import { useLatest } from "../hooks/useLatest";
import { usePendingBypass } from "../hooks/usePendingBypass";
import { useRackTrigger } from "../hooks/useRackTrigger";
import { laneHasInput } from "../laneInput";
import { midiActivity } from "../midiActivity";
import { ModeStrip, stripButton } from "../modeIcons";
import { nodeNameFor } from "../nodeInsert";
import { m } from "../paraglide/messages.js";
import { useLiveRackLit } from "../rackLit";
import type { WebGraph, WebProject } from "../types";
import { useIsMobile } from "../useIsMobile";
import { GraphSlotPane } from "./GraphSlotPane";
import { usePanelInside } from "./PanelClose";

/** A card here is HORIZONTAL on a desktop, at most 4 rows, and VERTICAL on a phone, at most 4 columns — a panel without that shape is folded to it. */
const TRACK_ROW_FIT: GridFit = { axis: "rows", max: 4 };
const TRACK_COL_FIT: GridFit = { axis: "cols", max: 4 };

/** The strip's modes: none — the row has no tools, only the toggles under them. */
const NO_MODES: readonly string[] = [];

/** The two inputs a lane can be given from here, each the `track input` kind it runs. */
const INPUTS = [
  { kind: "audio", label: "audio in", Icon: Mic },
  { kind: "midi", label: "midi in", Icon: KeyboardMusic },
] as const;

/** A greyed button still shows its tooltip, which is what says why it is greyed. */
const DISABLED =
  "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground";

export function TrackModulesPane({
  mark,
  onPreviewNote,
  project,
  trackId,
  nodes,
  lead,
  cameras,
  inputDevices,
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
  onPresetStep,
  presetNames,
  onAssetBrowse,
  onTapEdit,
  onWatchWaveform,
  onTrackToggle,
  onTrackSet,
  onEdgeInsert,
  engineWarnings,
  showCurves = false,
  onToggleCurves,
  onTrackInput,
}: {
  /** What a hovered History row touched, lit on these cards (historyMarks.ts). */
  mark?: HistoryMark | null;
  /** Play one note through a lane, as the piano roll's click does — what an SFZ kit's pad sounds through. */
  onPreviewNote?: (track: string, key: number, vel: number) => void;
  /** The arrangement, so the pads light as its notes play under the playhead (rackLit.ts). */
  project?: WebProject | null;
  /** The lane whose path this is. */
  trackId: string;
  /** These nodes alone, in order, instead of the lane's row: no lane card, no inputs and no frame — a popin's cards. */
  nodes?: string[];
  /** …led by a node that only says where their signal comes from — a subchain's "input" (moduleRow's `lead`). */
  lead?: { id: string; label: string; sub?: string };
  /** The cameras and MIDI devices this browser sees — what those nodes' dropdowns offer, as in the full graph. */
  cameras?: readonly string[];
  /** The interface's inputs as the engine groups them — what an audio input's "in" dropdown offers. */
  inputDevices?: readonly { name: string; channels: number[] }[];
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
  /** The arrows beside a node's preset dropdown: load its previous (-1) or next (+1) preset. */
  onPresetStep?: (module: string, step: -1 | 1) => void;
  onPresets?: (
    module: string,
    x: number,
    y: number,
    engines?: NodeEngines,
  ) => void;
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
  onTrackToggle?: (
    id: string,
    control: "mute" | "solo" | "arm" | "highlight",
  ) => void;
  onTrackSet?: (id: string, control: "volume" | "pan", value: number) => void;
  /** A `+` on one of this row's cables: the shell asks WHICH module, exactly as it does on the graph. */
  onEdgeInsert?: (
    info: EdgeInsert,
    x: number,
    y: number,
    at: { x: number; y: number } | undefined,
    nameFor: (module: string) => string,
  ) => void;
  engineWarnings?: Record<string, string>;
  /** Whether the row draws each card's curve cards, spaced in before it — `ui curves`. */
  showCurves?: boolean;
  /** The top-right button's: the shell's `ui curves`, so the button and the command are one. */
  onToggleCurves?: () => void;
  /** The "audio in" and "midi in" buttons: the shell's `track input`, run on this lane. */
  onTrackInput?: (kind: "audio" | "midi") => void;
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
    () => nodes ?? (graph ? trackModules(graph, trackId) : []),
    [graph, trackId, nodes],
  );
  // …and what feeds the lane, drawn ahead of it: the signal starts at the input, not at the lane.
  const inputs = useMemo(
    () => (graph && !nodes ? trackInputs(graph, trackId) : []),
    [graph, trackId, nodes],
  );
  // The tab each card has open: a folded card is as wide as the page it shows, so a switch reflows the row (ui-chains' `tabW`).
  const [openTabs, setOpenTabs] = useState<Record<string, number>>({});
  // The phone's narrow card, its tabs a menu: the panel's `vertical` layout (song-schema's LayoutSchema).
  const mobile = useIsMobile();
  const onOpenTab = useCallback(
    (id: string, tab: number) =>
      setOpenTabs((prev) => (prev[id] === tab ? prev : { ...prev, [id]: tab })),
    [],
  );
  const laid = useMemo(
    () =>
      graph
        ? moduleRow(graph, modules, {
            inputs,
            // The cards the graph draws, at the graph's size: this is a view of the same nodes, not a bigger one.
            asDrawn: true,
            // …and with the same lists in their dropdowns: a lens, a MIDI device.
            devices: { cameras, inputDevices, midiDevices },
            // The cables ARE the subject here: one lane's signal path, met on the SIDES because the row is read across.
            links: true,
            // …and the lane leads it: the signal starts on the lane, and its fader is the first thing in the path.
            ...(nodes ? {} : { track: trackId }),
            // …glued: a lane's path is one strip, two cards sharing ONE border (two would draw it twice as thick).
            gap: -1,
            // …and a STACK — a subchain run in place — one column, its cards one under another.
            stack: true,
            // …and, asked for, each card's curves in a column before it, the neighbours spaced to make room.
            curves: showCurves,
            // …and RESPONSIVE: no card taller than six rows, its overflow folded to the right.
            fit: mobile ? TRACK_COL_FIT : TRACK_ROW_FIT,
            layout: mobile ? "vertical" : "horizontal",
            // …and, in a popin, the input its chain is fed from, named and nothing more.
            ...(lead ? { lead } : {}),
            // …and each card as wide as its OPEN tab, not the widest of them.
            tabOf: openTabs,
          })
        : null,
    [
      graph,
      modules,
      inputs,
      trackId,
      cameras,
      inputDevices,
      midiDevices,
      showCurves,
      lead,
      nodes,
      openTabs,
      mobile,
    ],
  );

  // A pad on a card in this row PLAYS, by the same hook as the chains pane.
  // The pads light here too, as in the graph panes: the notes under the playhead, and a pad just clicked.
  const rackLit = useLiveRackLit(project, graph);
  const laidRef = useLatest(laid);
  const triggerRack = useRackTrigger(laidRef, onPreviewNote, rackLit.flash);

  // Bypasses clicked but not yet in `graph`, painted on after layout (usePendingBypass.ts).
  const { bypassModule, laidShown } = usePendingBypass(
    laid,
    laidRef,
    graph,
    onBypassModule,
  );

  /** The row's coordinates are its OWN, so a pick gets no `at`: where a new node goes is the graph's to decide. */
  const edgeInsert = useMemo(
    () =>
      onEdgeInsert &&
      graph &&
      ((info: EdgeInsert, x: number, y: number) =>
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

  // An input already feeding the lane, or no graph yet to say: either way the input buttons wait.
  const hasInput = !graph || laneHasInput(graph, trackId);

  // A row ending on the lane's mixer pins that mixer to the right, headerless — @studio/ui-chains's anchorRight.ts.
  const split = useMemo(
    () => (laidShown ? splitTrailingMixer(laidShown) : null),
    [laidShown],
  );

  // The seams' `+`, and one past the last card — before a pinned mixer, the mixer being where the row's path ENDS.
  const glued = useMemo(() => {
    if (!laidShown || !graph) return null;
    const row = split?.row ?? laidShown;
    // A branch on each seam only where it can make a subchain: `stacks` is there exactly in a chain project.
    return rowSeams(row, rowExit(laidShown, row, graph), !!graph.stacks);
  }, [laidShown, split, graph]);

  // In a bottom panel the strip always shows, being where the panel's ✕ goes (PanelClose.tsx); peeked, not claimed — ModeStrip claims.
  const inPanel = usePanelInside();
  // The History panel's hover, as the per-card test DomChains reads — above the early returns, like every hook.
  const marked = useMemo(() => nodePredicate(mark), [mark]);

  // No bar: the row IS the view, the lane's own card names it, and the ✕ is the strip's first item (PanelClose.tsx).
  // Every state keeps the frame, so the ✕ is reachable even with nothing to draw — a view you cannot close is worse than an empty one.
  const frame = (body: React.ReactNode, aside?: React.ReactNode) =>
    nodes ? body : <GraphSlotPane aside={aside}>{body}</GraphSlotPane>;
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
    return say(
      nodes
        ? "no module here yet"
        : "this lane reaches no module — nothing to show",
    );

  // What both halves share: the same callbacks and stores, so the pinned mixer is a card like any other.
  const shared = {
    icons: STUDIO_ICONS,
    marked,
    selected,
    onSelect: setSelected,
    trackOrder,
    // The open tabs, held here since they size the cards; DomChains reports each switch.
    openTabs,
    onOpenTab,
    // Re-frame when a card is added, removed or replaced by one of another size — never on a refetch or a param landing.
    fitKey: laidShown.nodes.map((n) => `${n.id}:${n.w}x${n.h}`).join("|"),
    // Fill the HEIGHT and let the row run off the right, which pans: fitting both axes would shrink every card as the lane grows.
    fitAxis: "height" as const,
    // …all of it: the tallest card is the pane's height, the others centred on its line.
    fitPad: 1,
    // A lane's few modules are what this pane is FOR: they never collapse to their far, name-only card.
    alwaysDetailed: true,
    // A row is read across: the wheel walks along it and nothing pans vertically.
    row: true,
    command,
    onModuleField,
    onRecorder,
    onProjectField,
    onContextMenu,
    onBypassModule: bypassModule,
    onThawAutoFreeze: thawAutoFreeze,
    onAlternative,
    onEngine,
    onPresets,
    onPresetStep,
    rackLit,
    midiActivity,
    presetNames,
    onAssetBrowse,
    onTapEdit,
    onTriggerRack: triggerRack,
    onWatchWaveform,
    onTrackToggle,
    onTrackSet,
    engineWarnings,
    pluginParamsStore,
    setPluginParam,
    moduleParams,
    trackControls,
  };

  // The pinned column is exactly as wide as the mixer at the row's scale: one height, one aspect ratio.
  const mixer = split?.mixer;
  const aside = mixer && (
    <div
      className="h-full flex-none"
      style={{
        aspectRatio: `${mixer.width - mixer.left} / ${mixer.height - mixer.top}`,
      }}
    >
      <DomChains {...shared} graph={mixer} fixed />
    </div>
  );

  return frame(
    <div className="flex h-full min-h-0">
      {/* The view's toggles down its left edge, the timeline's column: no modes here, only what the row SHOWS (docs/shell.md). */}
      {(onToggleCurves || onTrackInput || inPanel) && (
        <ModeStrip
          modes={NO_MODES}
          current=""
          onPick={() => {}}
          title={() => ""}
          footer={
            <>
              {onTrackInput &&
                INPUTS.map(({ kind, label, Icon }) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => onTrackInput(kind)}
                    disabled={hasInput}
                    aria-label={label}
                    title={
                      hasInput
                        ? `${label} — this lane already has an input`
                        : `${label} — an input feeding this lane, ahead of its first node`
                    }
                    className={`${stripButton(false)} ${DISABLED}`}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                ))}
              {onToggleCurves && (
                <button
                  type="button"
                  onClick={onToggleCurves}
                  aria-pressed={showCurves}
                  title={
                    showCurves ? "hide the curve cards" : "show the curve cards"
                  }
                  className={stripButton(showCurves)}
                >
                  <Spline className="h-4 w-4" />
                </button>
              )}
            </>
          }
        />
      )}
      <div className="relative min-h-0 min-w-0 flex-1">
        <DomChains
          {...shared}
          graph={glued?.graph ?? split?.row ?? laidShown}
          onEdgeInsert={edgeInsert || undefined}
          seams={glued?.seams}
        />
      </div>
    </div>,
    aside,
  );
}
