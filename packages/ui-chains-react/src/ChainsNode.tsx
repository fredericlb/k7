// ChainsNode.tsx — one card of the graph: its header, its widget grid, its footer and its
// ports, memoised so a frame that moves nothing on it re-renders nothing — docs/nodeCard.md.

import { Play, Square } from "@frediverse/ui/icons";
import { useEngineStoreOrNull } from "@studio/engine-browser/store";
import type { WebWidget } from "@studio/graph-model";
import { hasTabs } from "@studio/graph-model/panel";
import { columnW, moduleDisplayName } from "@studio/ui-chains/graph";
import { groupEdgeInsets } from "@studio/ui-chains/groupEdge";
import { memo, useMemo, useState } from "react";
import { altBadgesW } from "./AltBadges";
import { ClipList } from "./ClipList";
import { usePluginLoadBadge } from "./chainsStores";
import { useIcons } from "./chainsTypes";
import { onEnter } from "./keyActivate";
import { useChainsLabels } from "./labels";
import { nodeFoot, nodeHeader, nodeTags } from "./NodeHeader";
import { nodePorts } from "./NodePorts";
import { assemblyFrame, farCard, noteCard, pendingCard } from "./NodeShells";
import { nodeTabs } from "./NodeTabs";
import {
  type CornerButton,
  cornerButtons,
  FREEZE_TAG_W,
  groupsFirst,
  HD_ROW_GAP,
} from "./nodeLayout";
import type { NodeProps } from "./nodeProps";
import { useHiddenWidgets } from "./widgetScript";
import { InputMeterBar } from "./widgets/Meters";
import { Spark } from "./widgets/Spark";
import { Widget } from "./widgets/Widget";

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
}: NodeProps) {
  const { ModuleIcon, moduleGlyph, TrackIcon, trackLabel } = useIcons();
  const l = useChainsLabels();
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
  // The name the card wears: its lane's without the code, else the MODULE it uses, else "empty step" — docs/nodeCard.md.
  const empty = n.kind === "module" && !n.uses && !n.category && !!n.stub;
  const headName = trackFace
    ? (trackLabel?.(trackFace) ?? trackFace)
    : n.uses
      ? moduleDisplayName(n.uses)
      : empty
        ? l.emptyStep
        : (n.place ?? n.label);
  // What the node is CALLED where a person reads it: an unnamed node's place, never its uuid (packages/song/docs/chainFiles.md).
  const ownName = n.place ?? n.label;
  // The node's own name goes under the header only when the header says something else.
  const ownNameUnder = !trackFace && headName !== ownName;
  // The card's accessible name: the NODE first, then the module it uses — `pad (surge-xt)`.
  const cardName = ownNameUnder ? `${ownName} (${headName})` : headName;
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
  const tags = nodeTags({ n, warning, l });
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
    ? l.moduleNotFound
    : n.stub
      ? l.missingPlugin
      : n.unknownPlugin
        ? l.unknownPlugin
        : n.notSupported
          ? l.notSupported
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
  if (n.pending) return pendingCard({ n, cls, l });

  // An OPEN assembly: a frame around its members, drawn BEFORE them — packages/song/docs/assemblies.md.
  if (n.assemblyOf?.open)
    return assemblyFrame({ n, onHeaderDrag, onContext, onToggleAssembly, l });

  // A NOTE: a doc module, its text and nothing else, before the LOD branch — docs/nodeCard.md.
  if (n.note !== undefined) return noteCard({ n, cls, onTapNode, onContext });

  // Far LOD: widgets are unreadable at this zoom, so the whole card becomes the name, sized to fill it.
  if (far)
    return farCard({
      n,
      cls,
      headName,
      cardName,
      inLaneRow,
      iconCategory,
      flagCls,
      hasGlyph,
      armBar,
      TrackIcon,
      ModuleIcon,
      onHeaderDrag,
      onZoomTo,
      onTapNode,
      onContext,
    });

  // The widgets on a named group's left edge, drawn clear of its name — a pass over the panel, no state.
  const groupEdge = shownWidgets ? groupEdgeInsets(shownWidgets) : null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: a <fieldset> is a form's, and this card is a node on a canvas
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
      // A group, not a button: the card holds buttons of its own; Enter on the card itself selects it.
      role="group"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Enter selects the card, so it takes the focus
      tabIndex={0}
      aria-label={cardName || n.label}
      onKeyDown={onEnter((e) => onTapNode(n, e.shiftKey))}
      onClick={(e) => onTapNode(n, e.shiftKey)}
      onContextMenu={(e) => onContext(n, e)}
    >
      {/* A curve card has no header: its picture is the whole card, and carries the header's gestures (docs/nodeCard.md). */}
      {n.kind !== "curve" &&
        nodeHeader({
          n,
          glyph,
          headName,
          ownName,
          ownNameUnder,
          flagCls,
          hasGlyph,
          rightW,
          hasFoot,
          tags,
          hasSubRow,
          hasPresets,
          engines,
          load,
          trackInput,
          presetName,
          onHeaderDrag,
          onZoomTo,
          onBypass,
          onPickTrackInput,
          onPresets,
          onPresetStep,
          l,
        })}
      {hasFoot &&
        nodeFoot({
          n,
          ch,
          showWidgets,
          tags,
          load,
          altsW,
          isAutomated,
          depthFor,
          onAlternative,
          onDragStart,
          onTapWidget,
          onPickWidget,
          onPickAsset,
          onContextParam,
          onTypeValue,
        })}
      {/* The native plugin's editor: a corner bubble, not a header item, where it stole width from the longest names. */}
      {corners.includes("plugin") && (
        // biome-ignore lint/a11y/useSemanticElements: a corner bubble styled by chainsCss.ts, where a <button> would bring the UA's own box
        <span
          className="dgx-cbtn dgx-pbtn"
          style={{ "--slot": slot("plugin") } as React.CSSProperties}
          title={l.openPluginUi}
          role="button"
          tabIndex={0}
          aria-label={l.openPluginUi}
          onKeyDown={onEnter(() => n.module && onOpenPlugin(n.module))}
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
        // biome-ignore lint/a11y/useSemanticElements: a corner bubble styled by chainsCss.ts, where a <button> would bring the UA's own box
        <span
          className={`dgx-cbtn dgx-obtn${n.assemblyOf?.open ? " on" : ""}`}
          style={{ "--slot": slot("open") } as React.CSSProperties}
          title={
            n.assemblyOf?.open
              ? l.close(n.label)
              : l.open(n.label, n.assemblyOf?.uses ?? "")
          }
          role="button"
          tabIndex={0}
          aria-expanded={!!n.assemblyOf?.open}
          onKeyDown={onEnter(() => n.module && onToggleAssembly?.(n.module))}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (n.module) onToggleAssembly?.(n.module);
          }}
        >
          <i />
        </span>
      )}

      {/* Ports. `jacksFor` in graph.ts decides which show; NodePorts.tsx spaces them down the edge. */}
      {nodePorts({
        n,
        patchWant,
        onTapJack,
        onStartAutomation,
        onStartEvent,
        onLandEvent,
      })}

      {/* A sink with a declared FACE falls through to the widget branch, its controls children of the CARD — docs/nodeCard.md. */}
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
              title={sinkPlay.title ?? (sinkPlay.playing ? l.stop : l.listen)}
              aria-label={sinkPlay.playing ? l.stop : l.listen}
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
      {hasTabs(n.ui) &&
        showWidgets &&
        nodeTabs({ n, tabs, openTab, setTabAt, onOpenTab, l })}
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
