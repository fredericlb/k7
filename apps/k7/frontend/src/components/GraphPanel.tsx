// GraphPanel.tsx — the "Graph" bottom panel: the selected track's signal path, answering
// "where does THIS track go?" without leaving the timeline. Same pipeline as the Chains
// tab (subgraph -> buildGraph -> dagre -> DomChains), only the input set differs; dagre
// already lays the path out, so don't hand-roll a strip — it would lose the routed sends.
// The track comes from the caret, so the panel has no selection state of its own. Given
// `strips`, it is the MIX panel instead: the whole graph with every strip pulled onto one rank.

import type { PluginParamsStore } from "@studio/engine-browser/params";
import { ASPECTS, aspectOf } from "@studio/song-schema/aspect";
import type { LaneSpan } from "@studio/ui-chains/cables";
import type { TrackControlValues } from "@studio/ui-chains/graph";
import {
  alignModuleRank,
  buildGraph,
  layout,
  spaceModulesEvenly,
  subgraphForTrack,
} from "@studio/ui-chains/graph";
import type { LaneNotes } from "@studio/ui-chains/noteLoad";
import {
  type Cam,
  type ChainsCamApi,
  DomChains,
  type TapAction,
} from "@studio/ui-chains-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, thawAutoFreeze } from "../api";
import { STUDIO_ICONS } from "../chainsIcons";
import { withoutNotes } from "../graphNotes";
import { nodePredicate } from "../historyMarks";
import { useDocument } from "../hooks/useDocument";
import { usePendingBypass } from "../hooks/usePendingBypass";
import { useRackTrigger } from "../hooks/useRackTrigger";
import { midiActivity } from "../midiActivity";
import { m } from "../paraglide/messages.js";
import { useLiveRackLit } from "../rackLit";
import { useReloadKey, useShell, useVerbs } from "../state/shellStore";
import type { WebProject } from "../types";

export function GraphPanel({
  onPreviewNote,
  cameras,
  inputDevices,
  midiDevices,
  organizeKey = 0,
  trackId,
  strips,
  trackOrder,
  videoSpans,
  noteLanes,
  viewport,
  project,
  onBypassModule,
  onRecorder,
  onProjectField,
  onAlternative,
  onAssetBrowse,
  onTapEdit,
  onWatchWaveform,
  engineWarnings,
  pluginParamsStore,
  setPluginParam,
  moduleParams,
  trackControls,
  onTrackToggle,
  onTrackSet,
}: {
  /** Play one note through a lane, as the piano roll's click does — what an SFZ kit's pad sounds through. */
  onPreviewNote?: (track: string, key: number, vel: number) => void;
  /** The lenses this browser can see — a camera card's dropdown, packages/song/docs/camera.md. */
  cameras?: readonly string[];
  /** The interface's inputs as the engine groups them — what an audio input's "in" dropdown offers. */
  inputDevices?: readonly { name: string; channels: number[] }[];
  /** The MIDI inputs this browser sees, by name — what a midi-in node's dropdown offers. */
  midiDevices?: readonly string[];
  // Bumped when `graph organize` ran — empties the held node positions (see ChainsTab's).
  organizeKey?: number;
  trackId: string | null;
  /** The mixer strips (mixerStrips.ts): set, the panel draws the whole graph lined up on them rather than one track's path. */
  strips?: readonly string[];
  // The engine's track order; the live-signal set is derived off the store (see ChainsTab).
  trackOrder: string[];
  /** …and when each video lane shows a picture, which nothing meters — straight through, for a subgraph holding one (../videoSpans.ts). */
  videoSpans?: Readonly<Record<string, readonly LaneSpan[]>>;
  /** …and the notes', for a MIDI cable's ripple (../noteSpans.ts). */
  noteLanes?: Readonly<Record<string, LaneNotes>>;
  /** The FRAME's size, so the RENDER card ticks the shape it is (@studio/song-schema/aspect). */
  viewport?: readonly [number, number];
  /** The compiled doc, for the rack pads' lit state — straight through to ChainsTab. */
  project?: WebProject | null;
  // Asks only: the shell's bypass reloads nothing here, so `pendingBypass` is what moves the card.
  onBypassModule?: (module: string) => void;
  /** A RECORDER's button, straight through — see DomChains' prop. */
  /** Set a PROJECT setting — the RENDER card's frame dropdown (../noteSpans.ts's sibling). */
  onProjectField?: (field: string, value: string) => void;
  onRecorder?: (
    verb: "record" | "clear" | "save",
    node: { module: string; pluginId?: string },
  ) => void;
  /** A node's alternative badge → the shell switches to that set, or copies the one on (null). */
  onAlternative?: (module: string, name: string | null) => void;
  /** A file-valued param's browser: the same cards are drawn here, so the same button has to open. */
  onAssetBrowse?: (module: string, kind: string, x: number, y: number) => void;
  /** A rack tap's edit — the shell runs its `node tap` command (packages/song/docs/racks.md). */
  onTapEdit?: (module: string, action: TapAction) => void;
  /** …and the waveform widget's subscription, for the same reason — it draws nothing unwatched. */
  onWatchWaveform?: (
    pluginId: string,
    side: "input" | "output",
    on: boolean,
  ) => void;
  /** Engine load problems by plugin id, badged onto the module they concern. */
  engineWarnings?: Record<string, string>;
  /** The live values, and the way back: without them a widget draws the FILE's number and a drag sends nothing (../../docs/chainsGraph.md). */
  pluginParamsStore: PluginParamsStore;
  setPluginParam: (id: string, name: string, value: number) => void;
  /** …and the third source, for the modules the engine holds NOTHING of — without it a tempo node draws its file's number for ever. */
  moduleParams?: Record<string, Record<string, number>>;
  trackControls?: Record<string, TrackControlValues>;
  onTrackToggle?: (
    trackId: string,
    control: "mute" | "solo" | "arm" | "highlight",
  ) => void;
  onTrackSet?: (
    trackId: string,
    control: "volume" | "pan",
    value: number,
  ) => void;
}) {
  // What a hovered History row touched, lit here — read from the store so a hover re-renders no one else (historyMarks.ts).
  const mark = useShell((s) => s.historyMark);
  const reloadKey = useReloadKey();
  // A card writes the quiet way, an intrinsic field the reloading way, and a right-click opens the shell's menu.
  const {
    quietCommand: command,
    runCommand: onModuleField,
    openContextMenu: onContextMenu,
  } = useVerbs();
  // Parked HERE, because App mounts this panel conditionally: a camera held inside it would be a fresh frame on every reopen.
  const camStore = useRef<Cam | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Re-asked when the project moves, and again on a backoff while the service is not answering — see useDocument.
  const { doc: graph, error } = useDocument(() => api.graph(), reloadKey);

  // The session memory ChainsTab keeps, per TRACK — another track is another picture — and emptied by `graph organize`.
  const prevLaid = useRef<Map<string, { x: number; y: number }> | null>(null);
  const prevScope = useRef<string | number>("");
  /** The ticked row, as a NUMBER and outside the layout memo: the viewport is a fresh array on
   *  every fetch, so depending on it directly would relayout on every poll — and leaving it out
   *  is what left the menu on the old shape (../docs/picture.md). */
  const aspectRow = useMemo(() => {
    const shape = viewport ? aspectOf(viewport[0], viewport[1]) : null;
    return shape ? ASPECTS.findIndex((a) => a.name === shape.name) : undefined;
  }, [viewport]);

  const laid = useMemo(() => {
    if (!graph) return null;
    if (strips) {
      // The mixer row is an ARRANGEMENT: no pins and no held positions, one rank, then a console's even spacing.
      const { nodes, edges } = buildGraph(
        withoutNotes(graph, new Set(Object.keys(graph.modules ?? {}))),
        {
          drawMainOut: true,
          cameras,
          inputDevices,
          midiDevices,
          ...(aspectRow === undefined ? {} : { aspect: aspectRow }),
        },
      );
      return spaceModulesEvenly(
        layout(alignModuleRank(nodes, strips), edges),
        strips,
      );
    }
    if (!trackId) return null;
    const sub = subgraphForTrack(graph, trackId);
    if (!Object.keys(sub.chains).length) return null; // nothing routes this track
    const { nodes, edges } = buildGraph(sub, {
      cameras,
      inputDevices,
      midiDevices,
      ...(aspectRow === undefined ? {} : { aspect: aspectRow }),
    });
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
  }, [
    graph,
    trackId,
    strips,
    organizeKey,
    cameras,
    inputDevices,
    midiDevices,
    aspectRow,
  ]);

  // The mix frames its STRIPS by height, a fifth back from a perfect fit, once — marked done only if it actually framed (docs/shell.md).
  const [cam, setCam] = useState<ChainsCamApi | null>(null);
  const stripsFramed = useRef(false);
  useEffect(() => {
    if (!strips || !laid || !cam || stripsFramed.current) return;
    const wanted = new Set(strips);
    const nodes = laid.nodes.filter((n) => n.module && wanted.has(n.module));
    if (cam.fitTo(nodes, { axis: "height", zoom: 0.8 }))
      stripsFramed.current = true;
  }, [strips, laid, cam]);

  // A chain selected on one track means nothing once the caret moves to another.
  useEffect(() => setSelected(null), [trackId]);

  // The History panel's hover, as the per-card test DomChains reads.
  const marked = useMemo(() => nodePredicate(mark), [mark]);
  // The rack pads light here too: this panel draws the same nodes, so it owes them the same answer (rackLit.ts).
  const rackLit = useLiveRackLit(project, graph);
  // …and they PLAY here too, by the same hook as the chains pane.
  const laidRef = useRef(laid);
  laidRef.current = laid;
  const triggerRack = useRackTrigger(laidRef, onPreviewNote, rackLit.flash);

  // Bypasses clicked but not yet in `graph`, painted on after layout (usePendingBypass.ts).
  const { bypassModule, laidShown } = usePendingBypass(
    laid,
    laidRef,
    graph,
    onBypassModule,
  );

  const body = () => {
    // Only with nothing to draw: a failed RE-read keeps the last graph while useDocument retries.
    if (error && !graph)
      return <Note className="text-red-400">graph unavailable — {error}</Note>;
    if (!graph) return <Note>loading…</Note>;
    if (strips && !strips.length)
      return (
        <Note>
          No strip in this song: a strip is a Mixer module at the end of a
          track.
        </Note>
      );
    if (!strips && !trackId) return <Note>{m["graph.selectTrack"]()}</Note>;
    if (!laidShown) return <Note>No chain takes {trackId} as its source.</Note>;
    return (
      <DomChains
        icons={STUDIO_ICONS}
        graph={laidShown}
        selected={selected}
        trackOrder={trackOrder}
        videoSpans={videoSpans}
        noteLanes={noteLanes}
        rackLit={rackLit}
        midiActivity={midiActivity}
        marked={marked}
        onTriggerRack={triggerRack}
        onSelect={setSelected}
        onContextMenu={onContextMenu}
        // The mix is a ROW: the wheel walks along it.
        row={!!strips}
        onCamReady={setCam}
        // This panel follows the caret's track, so another track IS a different graph and earns a re-frame; a reload isn't.
        fitKey={strips ? "mix" : trackId}
        organizeKey={organizeKey}
        camStore={camStore}
        command={command}
        onBypassModule={bypassModule}
        onThawAutoFreeze={thawAutoFreeze}
        onModuleField={onModuleField}
        onRecorder={onRecorder}
        onProjectField={onProjectField}
        onAlternative={onAlternative}
        onAssetBrowse={onAssetBrowse}
        onTapEdit={onTapEdit}
        onWatchWaveform={onWatchWaveform}
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
        <span className="font-semibold text-primary-text">
          {strips ? "Mix" : "Graph"}
        </span>
        <span className="truncate font-mono text-muted-foreground">
          {strips
            ? `${strips.length} strip${strips.length === 1 ? "" : "s"}`
            : (trackId ?? "no track selected")}
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
