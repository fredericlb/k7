// ChainsNode.tsx — one card of the graph: its header, its widget grid, its footer and its
// ports, memoised so a frame that moves nothing on it re-renders nothing — docs/nodeCard.md.

import { Play, Snowflake, Square } from "@frediverse/ui/icons";
import { useEngineStoreOrNull } from "@studio/engine-browser/store";
import type { WebSignal, WebWidget } from "@studio/graph-model";
import { hasTabs } from "@studio/graph-model/panel";
import {
  columnW,
  EVENT_IN_AT,
  eventOutBottom,
  FOOTER_H,
  type GraphNode,
  headerFontPx,
  type Jack,
  moduleDisplayName,
  TAB_COL_W,
  TAB_H,
  TAB_MENU_H,
  UI_CONTENT_TOP,
  UI_HEADER,
} from "@studio/ui-chains/graph";
import { groupEdgeInsets } from "@studio/ui-chains/groupEdge";
import { memo, useMemo, useState } from "react";
import { AltBadges, altBadgesW } from "./AltBadges";
import { ClipList } from "./ClipList";
import { cableColorFor, MAUVE } from "./chainsCss";
import { type Channels, usePluginLoadBadge } from "./chainsStores";
import { type SinkPlay, useIcons } from "./chainsTypes";
import {
  type CornerButton,
  cornerButtons,
  FREEZE_TAG_W,
  farIconPx,
  fitFont,
  groupsFirst,
  HD_ROW_GAP,
  hasBypass,
  hasLeadColumn,
  headerNameW,
} from "./nodeLayout";
import { type NodeEngines, PresetButton } from "./PresetButton";
import type { TapAction } from "./TapWidget";
import { useHiddenWidgets } from "./widgetScript";
import { InputMeterBar } from "./widgets/Meters";
import { Spark } from "./widgets/Spark";
import { Widget } from "./widgets/Widget";
import { FOOT_KNOB_PX, FOOT_KNOBS } from "./widgetTarget";

function NodeInner({
  n,
  selected,
  inSelection,
  marked,
  automated,
  showWidgets,
  far,
  ch,
  trackOrder,
  onTapNode,
  onContext,
  onOpenPlugin,
  onBypass,
  onToggleAssembly,
  onAlternative,
  onEngine,
  onPresets,
  onPresetStep,
  presetName,
  onZoomTo,
  warning,
  onDragStart,
  onTapWidget,
  onPickWidget,
  onPickAsset,
  trackInput,
  onPickTrackInput,
  onWatchWaveform,
  onContextParam,
  onTypeValue,
  onTapEdit,
  sinkPlay,
  onTapJack,
  patchWant,
  onLandAutomation,
  onStartAutomation,
  onStartEvent,
  onLandEvent,
  onHeaderDrag,
  hostTab,
  onOpenTab,
}: {
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
}) {
  const { ModuleIcon, moduleGlyph, TrackIcon, trackLabel } = useIcons();
  // The category whose glyph this node wears. A sink has none of its own, but it IS io, so it gets io's arrows.
  const iconCategory =
    n.kind === "sink"
      ? ("io" as const)
      : n.kind === "module"
        ? n.category
        : undefined;
  /** A lane's FADER wears that lane's face — a strip is what a track's level became, so it reads as the track. */
  const trackFace = n.trackFace;
  // The driven params, each with its curve's depth when it has one: `param` or `param<TAB>depth`, one a line.
  const automatedParams = useMemo(
    () =>
      new Map(
        (automated ? automated.split("\n") : []).map((l) => {
          const [param, depth = ""] = l.split("\t");
          return [param, depth] as const;
        }),
      ),
    [automated],
  );
  const isAutomated = (w: WebWidget) => !!w.bind && automatedParams.has(w.bind);
  const depthFor = (w: WebWidget) =>
    (w.bind && automatedParams.get(w.bind)) || undefined;
  // A lane's row (moduleRow's cables, read across) is ABOUT that lane: its colour band would only repeat it.
  const inLaneRow = n.flow === "across";
  // Does this node draw a glyph? Decides whether the accent dot steps aside and the far card reserves height.
  const hasGlyph =
    n.kind === "track" || !!trackFace || !!moduleGlyph(iconCategory, n.missing);
  // What the node IS — its glyph, or the accent dot without one — in the header's left column, else leading the name's row.
  const glyph = !hasGlyph ? (
    <span className="dgx-tri" />
  ) : trackFace ? (
    <TrackIcon name={trackFace} className="dgx-ticon" />
  ) : n.kind === "track" ? (
    <TrackIcon name={n.label} video={n.video} className="dgx-ticon" />
  ) : (
    <ModuleIcon
      category={iconCategory}
      missing={n.missing}
      className="dgx-ticon"
    />
  );
  // The name the card wears: the lane it is the strip of, else the MODULE this node uses — its own underneath (docs/nodeCard.md).
  // A lane's is spelt WITHOUT its instrument code, which the glyph beside it already says; the TRACK node keeps its id, being addressed by it.
  // A step with no module and no plugin plays nothing: said so, its place kept for the tooltip (packages/song/docs/chainFiles.md).
  const empty = n.kind === "module" && !n.uses && !n.category && !!n.stub;
  const headName = trackFace
    ? (trackLabel?.(trackFace) ?? trackFace)
    : n.uses
      ? moduleDisplayName(n.uses)
      : empty
        ? "empty step"
        : (n.place ?? n.label);
  // What the node is CALLED where a person reads it: an unnamed node's place, never its uuid (packages/song/docs/chainFiles.md).
  const ownName = n.place ?? n.label;
  // The node's own name goes under the header only when the header says something else.
  const ownNameUnder = !trackFace && headName !== ownName;
  // The engines the node can run as, when there is a choice and a host to ask — the dropdown's left bar.
  const engines =
    onEngine && n.module && n.engines && n.engines.length > 1
      ? { names: n.engines, current: n.engine ?? n.engines[0] }
      : undefined;
  // A module USED by reference has presets; a self-contained one or `@meta`'s has none.
  const hasPresets =
    n.kind === "module" &&
    !n.missing &&
    !!n.uses?.startsWith("@") &&
    !n.uses.startsWith("@meta/");
  // The header's second line is ONE dropdown — engine and preset — drawn when either has something to offer.
  const hasSubRow = !!onPresets && !!n.module && (hasPresets || !!engines);
  // …and the alternatives' row, on the card's bottom edge — drawn wherever the host can switch them.
  const altsW =
    onAlternative && n.module && !n.strip
      ? altBadgesW(n.alternatives ?? [])
      : 0;
  // The tags right of the name — frozen and the console — everything the name gives way to.
  const frozenTag = !!n.frozen || !!n.autoFrozen;
  const warnTag = !!warning;
  // A module card carries its badges in its BOTTOM BAR; a strip, which has none, keeps them in the header.
  const hasFoot = n.kind === "module" && !n.strip;
  const rightW = hasFoot
    ? 0
    : (warnTag ? FREEZE_TAG_W + HD_ROW_GAP : 0) +
      (frozenTag ? FREEZE_TAG_W + HD_ROW_GAP : 0);
  // What the plugin costs, off the engine's load report — nothing without an engine or a plugin.
  const load = usePluginLoadBadge(useEngineStoreOrNull(), n.pluginId ?? null);
  // The state tags — the engine's warning, frozen, frozen automatically — wherever the card carries them.
  const tags = (
    <>
      {/* What the engine said went wrong with THIS plugin, on hover: often the only word on a module doing nothing. */}
      {warning && (
        <span
          className="dgx-wbtn"
          title={warning}
          role="img"
          aria-label={`engine warning: ${warning}`}
        >
          !
        </span>
      )}
      {/* FROZEN: its own tag rather than a shade of `dim`, which means the opposite — see packages/song/docs/freeze.md. */}
      {n.frozen && (
        <span
          className="dgx-fbtn"
          role="img"
          aria-label="frozen"
          title={
            n.frozen === "at"
              ? "Frozen here — everything upstream is playing as one render. Unfreeze from the right-click menu."
              : "Inside a render — this node is baked and is not running. Unfreeze the point downstream of it."
          }
        >
          <Snowflake />
        </span>
      )}
      {/* AUTOMATICALLY frozen: the same snowflake, saying it gives way to a touch — packages/song/docs/autoFreeze.md. */}
      {!n.frozen && n.autoFrozen && (
        <span
          className="dgx-fbtn auto"
          role="img"
          aria-label="frozen automatically"
          title={
            n.autoFrozen === n.module
              ? "Frozen automatically — this VST and everything upstream play as a render, so an engine without the VST can play it. Touch a control to edit it live."
              : `Inside ${n.autoFrozen}'s automatic render. Touch a control to edit it live.`
          }
        >
          <Snowflake />
        </span>
      )}
    </>
  );
  // The open TAB, the card's own state: which page shows is a view, not a fact about the module (docs/nodeCard.md).
  const [ownTab, setTabAt] = useState(0);
  const tabAt = hostTab ?? ownTab;
  const tabs = n.ui?.tabs ?? [];
  const openTab = tabs.length ? Math.min(tabAt, tabs.length - 1) : -1;
  // What the grid draws: the widgets every tab shows, then the open tab's, less those widgets.js's `visible` hides.
  const hidden = useHiddenWidgets(n.ui?.script, {
    params: n.params ?? {},
    assets: n.assets ?? {},
    ampModel: n.ampModel,
  });
  const shownWidgets = n.ui
    ? Object.fromEntries(
        Object.entries({
          ...n.ui.widgets,
          ...(openTab >= 0 ? tabs[openTab].widgets : {}),
        }).filter(([id]) => !hidden?.has(id)),
      )
    : null;
  // The corner cluster, decided once, since three things read this same list.
  const corners = cornerButtons(n);
  const slot = (b: CornerButton) => corners.indexOf(b);
  const sel =
    !!inSelection ||
    (!!n.chain && n.chain === selected) ||
    (!!n.chains && !!selected && n.chains.includes(selected)) ||
    (n.kind === "module" && !!n.module && n.module === selected);
  // A node with a problem, in TWO colours: amber for a plugin refused, red for one absent — docs/nodeCard.md.
  const amber = !!n.notSupported;
  const red = n.missing || n.stub || n.unknownPlugin || amber;
  const flagCls = amber ? " unsupported" : red ? " stub" : "";
  const flagText = n.missing
    ? "module not found"
    : n.stub
      ? "missing plugin"
      : n.unknownPlugin
        ? "unknown plugin"
        : n.notSupported
          ? "not supported"
          : null;
  // Where the signal ENTERS or LEAVES: a live input, or one of the built-in outputs — docs/nodeCard.md.
  const edge = n.kind === "sink" || n.monitor !== undefined;
  const cls = [
    "dgx-node",
    `k-${amber ? "unsupported" : red ? "stub" : n.kind}`,
    edge ? "edge" : "",
    // The stack view's inputs and outputs: a SOLID bar the width of every column (stackLayout.ts).
    n.bar ? "bar" : "",
    n.bare ? "bare" : "", // no header, its panel lifted into that space (chainsCss.ts)
    "tappable",
    // A lane's row: the cards are one strip, joined at the sides and framed by nothing above or below.
    inLaneRow ? "across" : "",
    sel ? "sel" : "",
    marked ? "marked" : "",
    n.frozen || n.autoFrozen ? "frozen" : "", // the frost wash, on the point and on everything inside its render
    n.pending ? "pending" : "",
    far ? "far" : "", // far ⇒ name only; every other LOD draws header + content
  ]
    .filter(Boolean)
    .join(" ");

  // The armed track's input meter, at every LOD, so an armed track reads as "recording this" at any zoom.
  const armBar =
    n.kind === "track" ? (
      <InputMeterBar trackId={n.label} order={trackOrder} />
    ) : null;

  // The module on its way: a spinner, and the sockets its host wired it by — none are interactive.
  if (n.pending)
    return (
      <div
        className={cls}
        data-node-id={n.id}
        style={{
          left: n.x,
          top: n.y,
          width: n.w,
          height: n.h,
          display: "grid",
        }}
        aria-busy="true"
        aria-label="creating a module"
      >
        <i className="dgx-spin" />
        {(["in", "out"] as const).map((side) =>
          (n.jacks?.[side] ?? []).map((p, i, all) => (
            <span
              key={`${side}:${i}`}
              className={`dgx-port ${side}`}
              style={{
                ["--jc" as string]: cableColorFor(p.type),
                // The same spread as a real card's sockets, so the cables `jackPoint` aims meet them.
                left: `${((i + 1) / (all.length + 1)) * 100}%`,
              }}
            />
          )),
        )}
      </div>
    );

  // An OPEN assembly: a frame around its members, drawn BEFORE them so they sit on top of it. It
  // has no sockets — the members are showing the real ones. See packages/song/docs/assemblies.md.
  if (n.assemblyOf?.open)
    return (
      <div
        className={`dgx-frame${onHeaderDrag ? " grab" : ""}`}
        data-node-id={n.id}
        style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
        onContextMenu={(e) => onContext(n, e)}
      >
        <div
          className="dgx-frame-hd"
          onPointerDown={(e) => onHeaderDrag?.(n, e)}
          title={n.assemblyOf.uses}
        >
          <span className="dgx-frame-nm">{n.label}</span>
          <span
            className="dgx-cbtn dgx-obtn on"
            title={`Close ${n.label}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (n.module) onToggleAssembly?.(n.module);
            }}
          >
            <i />
          </span>
        </div>
      </div>
    );

  // A NOTE: a doc module, its text and nothing else, before the LOD branch — docs/nodeCard.md.
  if (n.note !== undefined)
    return (
      <div
        className={`${cls} dgx-note`}
        style={{
          left: n.x,
          top: n.y,
          width: n.w,
          height: n.h,
          opacity: n.dim ? 0.5 : 1,
        }}
        onClick={(e) => onTapNode(n, e.shiftKey)}
        onContextMenu={(e) => onContext(n, e)}
        title={n.label}
      >
        {/* `pre-wrap`: the author's own line breaks are the shape of the note; `noteSize` reserved the width. */}
        <div className="dgx-note-body">{n.note}</div>
      </div>
    );

  // Far LOD: widgets are unreadable at this zoom, so the whole card becomes the name, sized to fill it.
  if (far) {
    // The module here too, for the header's reason: two LODs answering differently would be two cards.
    const label = headName || (n.kind === "sink" ? "OUT" : n.kind);
    return (
      <div
        className={`${cls}${onHeaderDrag ? " grab" : ""}`}
        data-node-id={n.id}
        // No header at this zoom, so the whole card is the pin gesture's handle — docs/hosting.md.
        onPointerDown={onHeaderDrag ? (e) => onHeaderDrag(n, e) : undefined}
        // …and the double-click's too: at this zoom the name is all there is to aim at.
        onDoubleClick={(e) => {
          e.stopPropagation();
          onZoomTo?.(n);
        }}
        style={{
          left: n.x,
          top: n.y,
          width: n.w,
          height: n.h,
          opacity: n.dim ? 0.5 : 1,
          ...(n.kind === "track" && n.color && !inLaneRow
            ? {
                borderTop: `5px solid ${n.color}`,
                borderTopLeftRadius: 0,
                borderTopRightRadius: 0,
              }
            : {}),
          ...(n.color
            ? { background: `color-mix(in srgb, ${n.color} 12%, var(--card))` }
            : {}),
        }}
        onClick={(e) => onTapNode(n, e.shiftKey)}
        onContextMenu={(e) => onContext(n, e)}
      >
        {/* Stacked, unlike the header: at this zoom the name IS the card, so the glyph spends HEIGHT rather than width. */}
        {n.kind === "track" ? (
          <TrackIcon
            name={label}
            video={n.video}
            className="dgx-ticon"
            style={{ fontSize: farIconPx(n.w, n.h) }}
          />
        ) : (
          <ModuleIcon
            category={iconCategory}
            missing={n.missing}
            className="dgx-ticon"
            style={{ fontSize: farIconPx(n.w, n.h) }}
          />
        )}
        <span
          className={`dgx-far${flagCls}`}
          style={{
            fontSize: fitFont(
              label,
              n.w,
              n.h - (hasGlyph ? farIconPx(n.w, n.h) : 0),
            ),
          }}
        >
          {label}
        </span>
        {armBar}
      </div>
    );
  }

  // The widgets on a named group's left edge, drawn clear of its name — a pass over the panel, no state.
  const groupEdge = shownWidgets ? groupEdgeInsets(shownWidgets) : null;

  return (
    <div
      className={cls}
      data-node-id={n.id}
      style={{
        left: n.x,
        top: n.y,
        width: n.w,
        height: n.h,
        opacity: n.dim ? 0.5 : 1,
        ...(n.kind === "track" && n.color && !inLaneRow
          ? {
              borderTop: `5px solid ${n.color}`,
              borderTopLeftRadius: 0,
              borderTopRightRadius: 0,
            }
          : {}),
        ...(n.color
          ? { background: `color-mix(in srgb, ${n.color} 12%, var(--card))` }
          : {}),
      }}
      onClick={(e) => onTapNode(n, e.shiftKey)}
      onContextMenu={(e) => onContext(n, e)}
    >
      {/* A curve card has no header: its picture is the whole card, and carries the header's gestures (docs/nodeCard.md). */}
      {n.kind !== "curve" && (
        <div
          className={`dgx-hd${onHeaderDrag ? " grab" : ""}${hasLeadColumn(n) ? " byp" : ""}`}
          // Drag the header, move the card — the pin gesture, docs/hosting.md.
          onPointerDown={onHeaderDrag ? (e) => onHeaderDrag(n, e) : undefined}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onZoomTo?.(n);
          }}
        >
          {/* The header's LEFT column: the node's icon — and, on a module, its on/off: the icon IS the switch. */}
          {hasLeadColumn(n) && (
            <span className="dgx-hdlead">
              {hasBypass(n) && n.module ? (
                <span
                  className={`dgx-byp dgx-bbtn${n.bypassed ? " on" : ""}`}
                  title={
                    n.bypassed ? "Bypassed — click to re-enable" : "Bypass"
                  }
                  onPointerDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (n.module) onBypass(n.module);
                  }}
                >
                  {glyph}
                </span>
              ) : (
                <span className="dgx-leadicon">{glyph}</span>
              )}
            </span>
          )}
          {/* The TOP row: the glyph, the module's name, and whatever stands beside them. */}
          <span
            className="dgx-hdtop"
            // The node's own name, which has no line of its own: the second line holds the engine's stage.
            title={ownNameUnder ? ownName : undefined}
          >
            {/* A card with no left column leads its row with the icon itself. */}
            {!hasLeadColumn(n) && glyph}
            {/* The name is SIZED to fit rather than ellipsed, by headerFontPx over headerNameW; see docs/nodeCard.md. */}
            <span
              className={`dgx-nm${flagCls}`}
              // The whole ref, not just the word drawn: the filing is one hover away rather than gone.
              title={[...new Set([n.uses, ownName])].filter(Boolean).join("\n")}
              // Fitted to the card, and capped on SCREEN by the header's --dgx-cap (chainsCss.ts).
              style={{
                fontSize: `min(${headerFontPx(headName, headerNameW(n, hasGlyph, rightW))}px, var(--dgx-cap))`,
              }}
            >
              {headName}
            </span>
            {/* The header keeps only a real sub — the chains a module is shared across; the flag is drawn in the content area. */}
            {n.sub && <span className={`dgx-sub${flagCls}`}>{n.sub}</span>}
            {/* What feeds this track, in the header row rather than on a corner because it carries a NAME. */}
            {trackInput !== undefined && (
              <button
                type="button"
                className={`dgx-tin${trackInput === "aucune" ? " unknown" : ""}`}
                title={`Interface input: ${trackInput} — click to change`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onPickTrackInput(n, e.clientX, e.clientY);
                }}
              >
                {trackInput}
              </button>
            )}
            {/* The node's state tags, in the header only on a card with no bottom bar to carry them. */}
            {!hasFoot && tags}
          </span>
          {/* The SECOND line: one dropdown, the engine the module runs as and its preset — the host draws the list. */}
          {hasSubRow && onPresets && n.module && (
            <span className="dgx-hdsub">
              <PresetButton
                module={n.module}
                current={presetName}
                engines={engines}
                onPresets={onPresets}
                // Only where there are presets to step through: the engines alone are no list.
                onStep={hasPresets ? onPresetStep : undefined}
              />
            </span>
          )}
          {/* On the header's bottom border, so it takes no width from the name — unless the bottom bar carries it. */}
          {load && !hasFoot && (
            <span className="dgx-load" title={load.title}>
              {load.text}
            </span>
          )}
        </div>
      )}
      {/* The BOTTOM BAR: the stage's knobs on the left, the badges centred, the attribute sets on the right — docs/nodeCard.md. */}
      {hasFoot && (
        <div className="dgx-foot" style={{ height: FOOTER_H }}>
          <span className="dgx-footl">
            {showWidgets &&
              FOOT_KNOBS.map((w) =>
                w.bind && n.stage?.includes(w.bind) ? (
                  // The caption is the tooltip: a 16 px knob has no room for one under it.
                  <span key={w.bind} className="dgx-footk" title={w.label}>
                    <Widget
                      n={n}
                      wid={`foot:${w.bind}`}
                      w={{ ...w, label: undefined }}
                      ch={ch}
                      onDragStart={onDragStart}
                      onTap={onTapWidget}
                      onPick={onPickWidget}
                      onPickAsset={onPickAsset}
                      onContextParam={onContextParam}
                      onTypeValue={onTypeValue}
                      knobPx={FOOT_KNOB_PX}
                      automated={isAutomated(w)}
                      automationDepth={depthFor(w)}
                      styleOverride={{
                        position: "relative",
                        flex: "none",
                        width: FOOT_KNOB_PX,
                        height: FOOT_KNOB_PX,
                      }}
                    />
                  </span>
                ) : null,
              )}
          </span>
          {/* The CENTRE: the state tags and what the plugin costs. */}
          <span className="dgx-footc">
            {tags}
            {load && (
              <span className="dgx-load inbar" title={load.title}>
                {load.text}
              </span>
            )}
          </span>
          {/* The RIGHT: the attribute sets — the switch and the copy are the HOST's commands. */}
          <span className="dgx-footr">
            {altsW > 0 && onAlternative && n.module && (
              <AltBadges
                module={n.module}
                names={n.alternatives ?? []}
                current={n.alternative ?? "1"}
                onAlternative={onAlternative}
              />
            )}
          </span>
        </div>
      )}
      {/* The native plugin's editor: a corner bubble, not a header item, where it stole width from the longest names. */}
      {corners.includes("plugin") && (
        <span
          className="dgx-cbtn dgx-pbtn"
          style={{ "--slot": slot("plugin") } as React.CSSProperties}
          title="Open native plugin UI"
          // Keep the press off the pane, as a widget's does — otherwise it arms a pan and the click never reaches the button.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpenPlugin(n.module!);
          }}
        >
          <i />
        </span>
      )}

      {/* Bypass — a module's, never a lane's, where it would read as the mute the mixer strip already carries. */}
      {/* A box's only gesture: open it to see what is inside, close it to get the appliance back. */}
      {corners.includes("open") && (
        <span
          className={`dgx-cbtn dgx-obtn${n.assemblyOf?.open ? " on" : ""}`}
          style={{ "--slot": slot("open") } as React.CSSProperties}
          title={
            n.assemblyOf?.open
              ? `Close ${n.label}`
              : `Open ${n.label} — ${n.assemblyOf?.uses ?? ""}`
          }
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (n.module) onToggleAssembly?.(n.module);
          }}
        >
          <i />
        </span>
      )}

      {/* Ports. `jacksFor` in graph.ts decides which show; here they are only spaced evenly down the edge. */}
      {/* A curve gets one mauve socket and no input, kept out of `jacksFor` because it carries no signal. */}
      {n.kind === "curve" && (
        <span
          className={`dgx-port cout${onStartAutomation ? " plug" : ""}`}
          title={
            onStartAutomation
              ? "automation out — drag onto a knob to bind this curve to it"
              : "automation out — where the cable to the param it drives leaves"
          }
          // Where `curveOutPoint` says its cable leaves: the middle of its right edge (chainsCss's `.cout`).
          style={{ ["--jc" as string]: MAUVE }}
          // The press starts the cable, and is stopped so it does not also arm a pan.
          onPointerDown={
            onStartAutomation
              ? (e) => {
                  e.stopPropagation();
                  onStartAutomation(n);
                }
              : undefined
          }
        >
          <i />
        </span>
      )}
      {/* A curve an event fires LISTENS: one socket on its left edge, where the note-on cable lands. */}
      {n.eventIn && (
        <span
          className={`dgx-port ev evin${
            patchWant?.kind === "event" && n.curveOf?.module ? " plug" : ""
          }`}
          title={
            n.curveOf?.module
              ? "event in — a note-on restarts this envelope"
              : "event in — bind this curve to a param first, then a note-on can fire it"
          }
          style={{
            ["--jc" as string]: cableColorFor("event"),
            // The fraction eventPoint uses, so the cable meets the hole.
            top: `${EVENT_IN_AT * 100}%`,
          }}
          // Only a BOUND envelope can take one: the trigger is written onto the binding.
          onPointerUp={
            patchWant?.kind === "event" && n.curveOf?.module
              ? (e) => {
                  e.stopPropagation();
                  onLandEvent?.(n);
                }
              : undefined
          }
        >
          <i />
        </span>
      )}
      {/* …and a module ANNOUNCES, up its LEFT edge from the bottom, each socket saying which event it is. */}
      {(n.events ?? []).map((name, i) => (
        <span
          key={`ev:${name}`}
          className={`dgx-port ev evout${onStartEvent ? " plug" : ""}`}
          title={`${name} — drag onto a curve's event plug to make it fire that curve`}
          onPointerDown={
            onStartEvent
              ? (e) => {
                  e.stopPropagation();
                  onStartEvent(n, name);
                }
              : undefined
          }
          style={{
            ["--jc" as string]: cableColorFor("event"),
            // The same offset eventPoint uses, so the cable meets the hole.
            top: `calc(100% - ${eventOutBottom(i)}px)`,
          }}
        >
          <i />
          <span className="dgx-evlab evout">{name}</span>
        </span>
      ))}
      {n.kind !== "curve" &&
        (["in", "out"] as const).map((side) =>
          (n.jacks?.[side] ?? []).map((p, i, all) => {
            // Which jacks the patch gesture arms, at rest and with a cable in hand — docs/hosting.md.
            const plug =
              !!onTapJack &&
              (patchWant
                ? p.free &&
                  side === patchWant.seeking &&
                  p.type === patchWant.type &&
                  // …and never back onto the node the cable LEFT, which the verb refuses outright.
                  n.id !== patchWant.node
                : side === "out" || !p.free);
            return (
              <span
                key={`${side}:${p.name ?? i}`}
                className={`dgx-port ${side}${p.free ? " free" : ""}${plug ? " plug" : ""}`}
                title={
                  p.name
                    ? `${p.name} (${p.type})${p.free ? " — free" : ""}`
                    : undefined
                }
                style={{
                  // Coloured by what the port carries, so a socket matches the cable for it.
                  ["--jc" as string]: cableColorFor(p.type),
                  // Spread across the WIDTH, and it MUST agree with `jackPoint` — docs/hosting.md.
                  left: `${((i + 1) / (all.length + 1)) * 100}%`,
                }}
                // The press, not the click, since a cable is drawn by DRAGGING out of a socket.
                onPointerDown={
                  plug
                    ? (e) => {
                        e.stopPropagation();
                        onTapJack?.(n, side, p, i, "down");
                      }
                    : undefined
                }
                // …and the release lands it — on the socket the press armed, that is a CLICK instead.
                onPointerUp={
                  plug
                    ? (e) => {
                        e.stopPropagation();
                        onTapJack?.(n, side, p, i, "up");
                      }
                    : undefined
                }
              >
                <i />
              </span>
            );
          }),
        )}

      {/* A sink with a declared FACE falls through to the widget branch below, so its controls are
          children of the CARD and land on `widgetRect`'s coordinates. Rendering them inside
          `.dgx-out` — which is itself absolute at UI_CONTENT_TOP — added the header's height twice and
          pushed them out the bottom. `mainOutCard` has always sized the OUT card to its `ui`, so
          the room was allocated and the face never drawn. */}
      {n.kind === "sink" && !(n.ui && showWidgets) ? (
        <div className="dgx-out">
          <b>OUT</b>
          <span>stereo</span>
          {/* Auditioning happens at the OUTPUT, where the signal after the whole chain arrives. */}
          {sinkPlay ? (
            <button
              type="button"
              className="dgx-play"
              disabled={!!sinkPlay.disabled}
              // The node is selectable and draggable; a click on the button is neither.
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                sinkPlay.onToggle();
              }}
              // Says WHY it is dead rather than looking broken — no engine, or nothing to play.
              title={sinkPlay.title ?? (sinkPlay.playing ? "Stop" : "Listen")}
              aria-label={sinkPlay.playing ? "Stop" : "Listen"}
            >
              {sinkPlay.playing ? (
                <Square className="size-3 fill-current" />
              ) : (
                <Play className="size-3 fill-current" />
              )}
            </button>
          ) : null}
        </div>
      ) : n.kind === "curve" ? (
        <div
          className={`dgx-curve${onHeaderDrag ? " grab" : ""}`}
          // Its name, which no header shows.
          title={n.label}
          onPointerDown={onHeaderDrag ? (e) => onHeaderDrag(n, e) : undefined}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onZoomTo?.(n);
          }}
        >
          <Spark spec={n.curveSpec} />
        </div>
      ) : shownWidgets && showWidgets ? (
        groupsFirst(shownWidgets).map(([k, w]) => (
          <Widget
            key={k}
            n={n}
            wid={k}
            w={w}
            ch={ch}
            inset={groupEdge?.get(k) ?? 0}
            onDragStart={onDragStart}
            onTap={onTapWidget}
            onPick={onPickWidget}
            onPickAsset={onPickAsset}
            onWatchWaveform={onWatchWaveform}
            onContextParam={onContextParam}
            onTypeValue={onTypeValue}
            onTapEdit={onTapEdit}
            automated={isAutomated(w)}
            automationDepth={depthFor(w)}
            // A curve's cable is in hand and this widget could take it — see onLandAutomation.
            onLandAutomation={
              patchWant?.kind === "automation" ? onLandAutomation : undefined
            }
          />
        ))
      ) : (
        // No grid and no content: keep the card's shape and say what is missing. A flagged module says WHY, in red.
        <div className={`dgx-empty${flagCls}`} style={{ left: columnW(n.ui) }}>
          {flagText ?? "No Options"}
        </div>
      )}
      {/* A NARROW card's tabs: a menu across its top, under the header, since a column would take half its width. */}
      {hasTabs(n.ui) && showWidgets && n.ui?.tabsAs === "dropdown" && (
        <select
          className="dgx-tabmenu"
          style={{ top: UI_CONTENT_TOP, height: TAB_MENU_H - 4 }}
          value={openTab}
          aria-label="page"
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const i = Number(e.target.value);
            setTabAt(i);
            onOpenTab?.(n.id, i);
          }}
        >
          {tabs.map((t, i) => (
            <option key={t.name} value={i}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      {/* The panel's TABS, a column down the card's left under the header — only when there are two to choose from. */}
      {hasTabs(n.ui) && showWidgets && n.ui?.tabsAs !== "dropdown" && (
        <div
          className="dgx-tabs"
          // Down to the bottom bar, which a module card carries and a strip does not.
          style={{
            top: UI_HEADER,
            width: TAB_COL_W,
            bottom: n.kind === "module" && !n.strip ? FOOTER_H : 0,
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {tabs.map((t, i) => (
            <button
              key={t.name}
              type="button"
              ref={i === openTab ? keepTabInView : undefined}
              className={`dgx-tab${i === openTab ? " on" : ""}`}
              style={{ height: TAB_H }}
              title={t.name}
              onClick={(e) => {
                e.stopPropagation();
                setTabAt(i);
                onOpenTab?.(n.id, i);
              }}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
      {/* What this lane HOLDS, under its controls, once the widgets are legible; see docs/nodeCard.md. */}
      {n.kind === "track" && n.clips?.length && showWidgets ? (
        <ClipList clips={n.clips} more={n.clipsMore} color={n.color} />
      ) : null}
      {armBar}
    </div>
  );
}
// Memoised: with `ch` and every handler stable, a pan or a param frame re-renders no card at all.
export const Node = memo(NodeInner);

// The open tab in its column's view: a column longer than its card scrolls, and a lit tab out of sight says nothing.
function keepTabInView(el: HTMLButtonElement | null) {
  const col = el?.parentElement;
  if (!el || !col) return;
  if (el.offsetTop < col.scrollTop) col.scrollTop = el.offsetTop;
  else if (el.offsetTop + el.offsetHeight > col.scrollTop + col.clientHeight)
    col.scrollTop = el.offsetTop + el.offsetHeight - col.clientHeight;
}
