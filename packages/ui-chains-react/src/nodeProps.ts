// nodeProps.ts — what DomChains hands each card: the node, its channels, and every gesture it may
// report. Every handler is bound once upstream, which is what lets the card's memo hold —
// docs/nodeCard.md.

import type { WebSignal, WebWidget } from "@studio/graph-model";
import type { GraphNode, Jack } from "@studio/ui-chains/graph";
import type { Channels } from "./chainsStores";
import type { SinkPlay } from "./chainsTypes";
import type { NodeEngines } from "./PresetButton";
import type { TapAction } from "./TapWidget";

export interface NodeProps {
  n: GraphNode;
  selected: string | null;
  /** In the Shift+click selection, beside the host's one — multiSelect.ts. */
  inSelection?: boolean;
  /** Lit by the host for a reason of its own — k7's History panel, what a step touched. */
  marked?: boolean;
  /** The params a curve drives on this node, newline-joined — a STRING, so the memoised card sees a change only when there is one. */
  automated?: string;
  showWidgets: boolean;
  // The camera is too far for the node's content: draw just its name, fitted to the card.
  far: boolean;
  ch: Channels;
  // The engine level index order, so a track's meter bar can find its slot; the node itself never reads levels.
  trackOrder: string[];
  onTapNode: (n: GraphNode, shift?: boolean) => void;
  onContext: (n: GraphNode, e: React.MouseEvent) => void;
  onOpenPlugin: (module: string) => void;
  onBypass: (module: string) => void;
  /** Open or close an assembly's box. Session state: nothing about it is written to the project. */
  onToggleAssembly?: (name: string) => void;
  /** An alternative badge was clicked: a set's name to switch to, or null to copy the one on — the badges exist only when given. */
  onAlternative?: (module: string, name: string | null) => void;
  /** An engine was picked in the node's dropdown — drawn only when given, and only on a module with several. */
  onEngine?: (module: string, name: string) => void;
  /** The node's preset dropdown was pressed: the host lists this node's presets at that point. */
  onPresets?: (
    module: string,
    x: number,
    y: number,
    engines?: NodeEngines,
  ) => void;
  /** The arrows beside it: load this node's previous (-1) or next (+1) preset. */
  onPresetStep?: (module: string, step: -1 | 1) => void;
  /** The preset last loaded on this node, shown on the dropdown. */
  presetName?: string;
  /** A double-click on the header, or on the whole card when zoomed out: frame this node. */
  onZoomTo?: (n: GraphNode) => void;
  /** What the engine reported about THIS node's plugin, if anything. */
  warning?: string;
  onDragStart: (n: GraphNode, w: WebWidget, e: React.PointerEvent) => void;
  onTapWidget: (n: GraphNode, w: WebWidget) => void;
  onPickWidget: (n: GraphNode, w: WebWidget, value: number) => void;
  /** Open the library browser for this widget — a FILE for the module field the widget names. */
  onPickAsset: (
    n: GraphNode,
    param: string,
    x: number,
    y: number,
    family?: string,
  ) => void;
  /** What this TRACK is fed from, as a chip on its header; undefined draws none. */
  trackInput?: string;
  onPickTrackInput: (n: GraphNode, x: number, y: number) => void;
  /** Place/remove the engine's waveform tap for a module — see WaveformWidget. */
  onWatchWaveform?: (
    pluginId: string,
    side: "input" | "output",
    on: boolean,
  ) => void;
  /** Right-click on one of this node's controls — the menu for the PARAM, not for the module. */
  onContextParam?: (n: GraphNode, w: WebWidget, x: number, y: number) => void;
  /** A value TYPED into a control after a double-click — the host commits it as a drag's release would. */
  onTypeValue?: (n: GraphNode, w: WebWidget, value: number) => void;
  /** A rack TAP's edit — note, sample, add, remove — asked of the host, which writes the node's file. */
  onTapEdit?: (n: GraphNode, action: TapAction) => void;
  sinkPlay?: SinkPlay;
  /** A jack was pressed or released — BOTH halves, since `phase` is what tells the two gestures apart. */
  onTapJack?: (
    n: GraphNode,
    side: "in" | "out",
    jack: Jack,
    index: number,
    phase: "down" | "up",
  ) => void;
  /** The cable in hand: the side its loose end seeks, its signal, its node — what gates a landing. */
  patchWant?: {
    seeking: "in" | "out";
    type: WebSignal;
    node: string;
    kind: "signal" | "automation" | "event";
  } | null;
  /** A curve's cable landed on one of this node's widgets — bind it to that param. */
  onLandAutomation?: (n: GraphNode, w: WebWidget) => void;
  /** Its other end: a press on this curve's output starts that cable. */
  onStartAutomation?: (n: GraphNode) => void;
  /** A press on one of this module's event sockets starts an event cable. */
  onStartEvent?: (n: GraphNode, event: string) => void;
  /** …and it landed on this envelope's ear. */
  onLandEvent?: (n: GraphNode) => void;
  /** The header was pressed on a node the host lets you move — absent, the press pans instead. */
  onHeaderDrag?: (n: GraphNode, e: React.PointerEvent) => void;
  /** The tab a HOST holds open on this card — given, it wins over the card's own state. */
  hostTab?: number;
  /** …and told when the card's tab changes, so a host sizing cards by tab can reflow. */
  onOpenTab?: (nodeId: string, tab: number) => void;
}
