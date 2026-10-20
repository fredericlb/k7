// Widget.tsx — one widget at its box on a card: a knob, slider or number dragged, a toggle or
// button tapped, a pad fired, painted off the override store so a drag re-renders the widget it
// moves and nothing else — docs/widgets.md.

import { usePluginParamValue } from "@studio/engine-browser/params";
import { useEngineStoreOrNull } from "@studio/engine-browser/store";
import type { WebWidget } from "@studio/graph-model";
import { decodeDepth, depthSpan } from "@studio/ui-chains/automationDepth";
import {
  columnW,
  type GraphNode,
  isMixKnob,
  menuH,
  rackBindSymbol,
  stripWidgetRect,
  widgetNorm,
  widgetTyped,
} from "@studio/ui-chains/graph";
import { memo, useState } from "react";
import {
  type Channels,
  useMidiActivity,
  useOverride,
  useOverrideMap,
  useRackLit,
  useRecorderState,
} from "../chainsStores";
import { onEnter } from "../keyActivate";
import { LcdScreenWidget } from "../LcdScreenWidget";
import { type TapAction, TapWidget } from "../TapWidget";
import { ValueEditor } from "../ValueEditor";
import {
  draggable,
  tapName,
  targetKey,
  widgetTarget,
  widgetValue,
} from "../widgetTarget";
import { groupWidget } from "./GroupWidget";
import { WaveformWidget } from "./WaveformWidget";
import { widgetBody } from "./widgetBody";

// A box drawn `inset` px in from its left edge, its right edge kept: the grid is untouched, only the drawing moves.
const insetRect = <R extends { x: number; w: number }>(
  r: R,
  inset: number,
): R => (inset ? { ...r, x: r.x + inset, w: r.w - inset } : r);
const insetStyle = (
  s: React.CSSProperties,
  inset: number,
): React.CSSProperties =>
  inset && typeof s.left === "number" && typeof s.width === "number"
    ? { ...s, left: s.left + inset, width: s.width - inset }
    : s;

// One widget at its widgetRect box: knob/slider/number drag, toggle/button tap, painted off the override.
function WidgetInner({
  n,
  wid,
  w,
  ch,
  onDragStart,
  onTap,
  onPick,
  onPickAsset,
  onWatchWaveform,
  onContextParam,
  onTypeValue,
  onTapEdit,
  onLandAutomation,
  styleOverride,
  knobPx,
  automated,
  automationDepth,
  inset = 0,
}: {
  n: GraphNode;
  /** The widget's key in its map — what a panel's `widgets.js` names an lcdscreen by. */
  wid: string;
  w: WebWidget;
  ch: Channels;
  onDragStart: (n: GraphNode, w: WebWidget, e: React.PointerEvent) => void;
  onTap: (n: GraphNode, w: WebWidget) => void;
  // A dropdown picks an exact value rather than flipping one, so it can't go through onTap.
  onPick: (n: GraphNode, w: WebWidget, value: number) => void;
  /** Open the library browser for this widget, at the click's viewport coords — it picks a FILE. */
  onPickAsset: (
    n: GraphNode,
    param: string,
    x: number,
    y: number,
    family?: string,
  ) => void;
  /** Place/remove the engine's waveform tap for a module — see WaveformWidget. */
  onWatchWaveform?: (
    pluginId: string,
    side: "input" | "output",
    on: boolean,
  ) => void;
  /** Right-click on this control — the host's menu for the PARAM it drives (see GraphMenuCtx). */
  onContextParam?: (n: GraphNode, w: WebWidget, x: number, y: number) => void;
  /** A value TYPED into a control after a double-click — the host commits it as a drag's release would. */
  onTypeValue?: (n: GraphNode, w: WebWidget, value: number) => void;
  /** A rack TAP's edit — note, sample, add, remove — asked of the host, which writes the node's file. */
  onTapEdit?: (n: GraphNode, action: TapAction) => void;
  /** A curve's cable is in hand and this widget is a LANDING TARGET — passed only while one is out. */
  onLandAutomation?: (n: GraphNode, w: WebWidget) => void;
  styleOverride?: React.CSSProperties;
  /** A knob drawn at this size whatever its rect — the bottom bar's. */
  knobPx?: number;
  /** A curve drives this param: the control glows the automation cable's mauve. */
  automated?: boolean;
  /** …and how far, `encodeDepth`'s string: a knob draws the stretch it sweeps as a mauve gauge. */
  automationDepth?: string;
  /** Pixels its box is drawn in from the left, on a group's named edge — see `groupEdgeInsets`. */
  inset?: number;
}) {
  // Right of the tab column when the panel draws one — `tabColumnW`, the same figure the card is widened by.
  const r = insetRect(stripWidgetRect(n, w, columnW(n.ui), menuH(n.ui)), inset);
  styleOverride = styleOverride && insetStyle(styleOverride, inset);
  // Hoisted above the two delegating returns, since the subscription below is a hook.
  const tgt = widgetTarget(n, w, ch.offlineChannel);
  // This control's own override: a drag elsewhere does not re-render it, its own value does.
  useOverride(
    ch.overrides,
    tgt && tgt.kind !== "rack" && tgt.kind !== "project"
      ? targetKey(tgt)
      : null,
  );
  const lcdOverride = useOverrideMap(
    w.type === "lcdscreen" ? ch.overrides : null,
  );
  // This control's own live value: a plugin frame re-renders this widget, not the graph.
  const live = usePluginParamValue(
    ch.params,
    tgt?.kind === "plugin" ? tgt.pluginId : null,
    tgt?.kind === "plugin" ? tgt.name : null,
  );
  // …and a rack pad's own tap, so one sound firing lights one pad rather than the graph.
  const padSymbol = tgt?.kind === "rack" ? tgt.symbol : null;
  const padLit = useRackLit(
    ch.rackLit,
    tgt?.kind === "rack" ? tgt.module : null,
    padSymbol
      ? (n.rack?.find((s) => s.symbol === padSymbol)?.note ?? null)
      : null,
  );

  // …and a RECORDER's, lit by the engine saying it is rolling, never by the click — docs/widgets.md.
  const recNode = tgt?.kind === "recorder" ? (tgt.pluginId ?? null) : null;
  const recState = useRecorderState(useEngineStoreOrNull(), recNode);
  // …and a midi-in card's device dropdown, whose LED lights while that keyboard is sending.
  const midiLit = useMidiActivity(
    ch.midiActivity,
    tgt?.kind === "module" && tgt.field === "device" ? (n.device ?? "") : null,
  );
  // A double-click swaps the control for a text field, so an exact value can be typed — docs/widgets.md.
  const [editing, setEditing] = useState(false);

  // A rack's TAP: its own pad, note and sample — the sound it names is on the node.
  if (w.type === "tap") {
    const symbol = rackBindSymbol(w.bind);
    return (
      <TapWidget
        bind={w.bind}
        sound={symbol ? n.rack?.find((s) => s.symbol === symbol) : undefined}
        fixed={!!n.rackKit}
        lit={padLit}
        style={
          styleOverride ?? { left: r.x, top: r.y, width: r.w, height: r.h }
        }
        onTrigger={
          ch.rackTriggerable && tgt?.kind === "rack"
            ? () => onTap(n, w)
            : undefined
        }
        onEdit={onTapEdit && n.module ? (a) => onTapEdit(n, a) : undefined}
        onMenu={
          symbol && onContextParam
            ? (x, y) => onContextParam(n, w, x, y)
            : undefined
        }
      />
    );
  }

  // Waveform widget: delegate to WaveformWidget
  if (w.type === "waveform") {
    return (
      <WaveformWidget
        n={n}
        w={w}
        onWatch={onWatchWaveform}
        style={
          styleOverride ?? { left: r.x, top: r.y, width: r.w, height: r.h }
        }
      />
    );
  }

  if (w.type === "lcdscreen") {
    return (
      <LcdScreenWidget
        n={n}
        id={wid}
        params={ch.params}
        override={lcdOverride}
        onWatch={onWatchWaveform}
        style={
          styleOverride ?? { left: r.x, top: r.y, width: r.w, height: r.h }
        }
      />
    );
  }

  // Read-only where the host gave no way back — honest, where draggable-and-ignored is not.
  const actuable =
    tgt !== null &&
    // A pad needs a host that can make a SOUND, which a rehearsal cannot invent — so it is asked first.
    (tgt.kind === "rack"
      ? ch.rackTriggerable
      : // …and a PROJECT setting a host that runs a verb, which a preview card has not got.
        tgt.kind === "project"
        ? ch.projectWritable
        : // …and a recorder's button a host wired to an ENGINE that holds the node, or the press is refused.
          tgt.kind === "recorder"
          ? ch.recorderWired && recState !== undefined
          : // A rehearsal has nowhere to send a value and needs nowhere: the override is the answer.
            ch.rehearsal ||
            (tgt.kind === "offline"
              ? ch.offlineWritable
              : tgt.kind === "track"
                ? ch.trackWritable
                : ch.pluginWritable));
  const value = widgetValue(n, w, ch, live);
  const known = value !== undefined;
  const t = known ? widgetNorm(w, value) : 0;
  // The stretch a curve sweeps, around the AUTHORED value when bipolar — what the engine rides around, not the moving one.
  const depth = decodeDepth(automationDepth);
  const authored = tgt?.kind === "plugin" ? n.params?.[tgt.name] : undefined;
  const span = depth
    ? depthSpan(
        depth,
        typeof authored === "number" ? widgetNorm(w, authored) : t,
      )
    : undefined;
  const style: React.CSSProperties = styleOverride ?? {
    left: r.x,
    top: r.y,
    width: r.w,
    height: r.h,
  };
  const caption =
    w.type === "label" || w.type === "button" ? undefined : w.label;
  // The widgets drawn as a field — a select, the file picker's button, a number — are captioned like one.
  const fieldLike =
    w.type === "dropdown" || w.type === "filepicker" || w.type === "number";

  // A GROUP frames the widgets inside its box and holds none of them — song-schema's docs/moduleFile.md.
  if (w.type === "group")
    return groupWidget({
      n,
      w,
      style,
      known,
      t,
      actuable,
      onTap,
      onContextParam,
    });

  // A control never selects the node; an inert one (label, meter, undrivable knob) lets the click fall through.
  const interact: React.HTMLAttributes<HTMLDivElement> & { className: string } =
    actuable && draggable(w)
      ? {
          className: "dgx-w drag",
          onPointerDown: (e) => onDragStart(n, w, e),
          onClick: (e) => e.stopPropagation(),
        }
      : w.type === "dropdown" || w.type === "filepicker"
        ? {
            className: "dgx-w",
            onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
            onClick: (e: React.MouseEvent) => e.stopPropagation(),
          }
        : actuable && (w.type === "toggle" || w.type === "button")
          ? {
              className: "dgx-w tap",
              // A button to assistive technology and the keyboard too, named by what it does.
              role: "button",
              tabIndex: 0,
              "aria-label": tapName(w, tgt, padSymbol),
              onKeyDown: onEnter(() => onTap(n, w)),
              onClick: (e) => {
                e.stopPropagation();
                onTap(n, w);
              },
            }
          : { className: "dgx-w" };
  if (automated) interact.className += " auto";

  // Only a value that is a NUMBER along a range can be typed: a knob, a slider, a fader, a number.
  if (actuable && draggable(w) && onTypeValue)
    interact.onDoubleClick = (e) => {
      e.stopPropagation();
      setEditing(true);
    };

  // A control that drives something can be right-clicked for what drives IT, and stopped there.
  if (actuable && onContextParam)
    interact.onContextMenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      onContextParam(n, w, e.clientX, e.clientY);
    };

  const body = widgetBody({
    n,
    w,
    ch,
    r,
    tgt,
    value,
    t,
    span,
    caption,
    knobPx,
    padSymbol,
    padLit,
    recState,
    midiLit,
    actuable,
    onPick,
    onPickAsset,
  });

  // A curve's cable is in hand and this PLUGIN param, never a crossfade pair, can take it — docs/widgets.md.
  const landing =
    !!onLandAutomation && !!w.bind && !w.bind.startsWith("@") && !w.pair;
  if (landing)
    return (
      <div
        className="dgx-w dgx-land"
        style={style}
        title={`bind the curve to ${w.label || w.bind}`}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => {
          e.stopPropagation();
          onLandAutomation?.(n, w);
        }}
      >
        {body}
        {caption && <span className="dgx-wlab">{caption}</span>}
      </div>
    );

  return (
    <div
      {...interact}
      style={style}
      // An unlabelled pad has to say what it is somewhere, and only a pad needs the tooltip for it.
      title={padSymbol ?? undefined}
    >
      {/* A field's caption — dropdown, file picker, number — sits on top of it, left-aligned; every other one is underneath. */}
      {fieldLike ? (
        <div className="dgx-selcol">
          {caption && <span className="dgx-wlab">{caption}</span>}
          {body}
        </div>
      ) : (
        body
      )}
      {caption && !fieldLike && <span className="dgx-wlab">{caption}</span>}
      {editing && (
        <ValueEditor
          initial={isMixKnob(w) && known ? Math.round(t * 100) : value}
          onDone={(text) => {
            setEditing(false);
            const typed = text === null ? null : widgetTyped(w, text);
            if (typed !== null && typed !== value) onTypeValue?.(n, w, typed);
          }}
        />
      )}
    </div>
  );
}

// Memoised: it holds its own param tap, so a frame that did not move THIS number must not redraw it.
export const Widget = memo(WidgetInner);
