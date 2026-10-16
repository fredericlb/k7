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
  widgetText,
  widgetTyped,
} from "@studio/ui-chains/graph";
import { memo, useState } from "react";
import { CTRL, RING } from "../chainsCss";
import {
  type Channels,
  useMidiActivity,
  useOverride,
  useOverrideMap,
  useRackLit,
  useRecorderState,
} from "../chainsStores";
import { LcdScreenWidget } from "../LcdScreenWidget";
import { type TapAction, TapWidget } from "../TapWidget";
import { ValueEditor } from "../ValueEditor";
import {
  draggable,
  targetKey,
  widgetTarget,
  widgetValue,
} from "../widgetTarget";
import { Knob } from "./Knob";
import { FaderMeter } from "./Meters";
import { WaveformWidget } from "./WaveformWidget";

// A group's colour as its label's spine: the same hue, made opaque enough to read as the section's tab.
function spineColor(color: string): string {
  const hex = color.slice(1);
  const rgb =
    hex.length <= 4
      ? hex.slice(0, 3).replace(/./g, (c) => c + c)
      : hex.slice(0, 6);
  return `#${rgb}73`;
}

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

  // …and a RECORDER's, the same way and for the same reason: what lights it is the engine
  // saying it is rolling, never the click, which would light on a refusal too.
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
      : // …and a PROJECT setting needs a host that can run a verb: a preview card is looking at
        // no project, so its dropdown reads and does not write.
        tgt.kind === "project"
        ? ch.projectWritable
        : // …and a recorder's button needs a host wired to the ENGINE, which a rehearsal has not
          // got: a preview card must not start a take in somebody's project.
          tgt.kind === "recorder"
          ? ch.recorderWired
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
  if (w.type === "group") {
    // Bound to an on/off param, it carries that param's switch and greys its section out while off.
    const switched = !!w.bind;
    // A MUTE or BYPASS bind is on while the param is OFF; the tap still flips the param, whichever way it reads.
    const lit = known && (w.invert ? t < 0.5 : t >= 0.5);
    // An unknown value greys nothing: a section drawn dead because its state has not arrived would lie.
    const off = switched && known && !lit;
    return (
      <div
        className={`dgx-w dgx-group${off ? " off" : ""}`}
        style={{ ...style, ...(w.color ? { background: w.color } : {}) }}
      >
        {switched && (
          <button
            type="button"
            className={`dgx-gswitch${lit ? " on" : ""}${known ? "" : " unknown"}`}
            disabled={!actuable}
            title={w.bind}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onTap(n, w);
            }}
            onContextMenu={
              actuable && onContextParam
                ? (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onContextParam(n, w, e.clientX, e.clientY);
                  }
                : undefined
            }
          />
        )}
        {w.label && (
          <span
            className={`dgx-wlab dgx-glab${switched ? " sw" : ""}`}
            style={
              w.color
                ? ({ "--spine": spineColor(w.color) } as React.CSSProperties)
                : undefined
            }
          >
            {w.label}
          </span>
        )}
        {off && <span className="dgx-gveil" />}
      </div>
    );
  }

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

  let body: React.ReactNode = null;
  if (w.type === "knob") {
    const size = Math.min(r.w, r.h - (caption ? 11 : 0)) - 4;
    body = (
      <Knob
        t={t}
        known={known}
        span={span}
        size={knobPx ?? Math.max(14, size)}
        text={isMixKnob(w) ? `${Math.round(t * 100)}%` : widgetText(w, value)}
      />
    );
  } else if (w.type === "slider") {
    body = (
      <div className="dgx-slider">
        <i style={{ width: `${(known ? t : 0) * 100}%` }} />
      </div>
    );
  } else if (w.type === "fader") {
    // Readout first, then the rail with whatever height is left — see .dgx-fader.
    body = (
      <>
        <span className={`dgx-fval${known ? "" : " unknown"}`}>
          {widgetText(w, value)}
        </span>
        <div className={`dgx-fader${known ? "" : " unknown"}`}>
          {/* The VU rides left of the throw, and only on a chain that IS a track. */}
          {n.chain && <FaderMeter trackId={n.chain} order={ch.trackOrder} />}
          <div className="rail">
            <i
              className="fill"
              style={{ height: `${(known ? t : 0) * 100}%` }}
            />
            <i
              className="cap"
              style={{ top: `${(1 - (known ? t : 0)) * 100}%` }}
            />
          </div>
        </div>
      </>
    );
  } else if (w.type === "toggle") {
    const on = known && t >= 0.5;
    body = (
      <div className={`dgx-toggle${on ? " on" : ""}`}>
        <i />
      </div>
    );
  } else if (w.type === "button") {
    // A rack pad has no value, so `t` says nothing about it: what lights it is its own note.
    // A recorder's `record` is the same shape: lit while the ENGINE says it is rolling.
    const on = padSymbol
      ? padLit
      : tgt?.kind === "recorder"
        ? tgt.verb === "record" && (recState?.recording ?? false)
        : known && t >= 0.5;
    const c = (w.bind && CTRL[w.bind]) ?? RING;
    // `clear` and `save` need a take to act on, and `save` needs one that is FINISHED — drawn
    // faint rather than hidden, so the card reads the same whether or not anything is recorded.
    // A take being ROLLING is something `clear` can act on: it stops it and drops it, one press.
    const none =
      (recState?.takes.length ?? 0) === 0 && !(recState?.recording ?? false);
    const idle =
      tgt?.kind === "recorder" &&
      tgt.verb !== "record" &&
      (tgt.verb === "save"
        ? (recState?.takes.length ?? 0) === 0 || (recState?.recording ?? false)
        : none);
    body = (
      <b
        className={`dgx-btn${on ? " on" : ""}${idle ? " unknown" : ""}`}
        style={{ ["--c" as string]: c }}
      >
        {/* A rack PAD draws bare, its symbol left to the tooltip; see docs/widgets.md. */}
        {padSymbol ? "" : (w.label ?? "?")}
      </b>
    );
  } else if (w.type === "number") {
    body = (
      <span className={`dgx-num${known ? "" : " unknown"}`}>
        {widgetText(w, value)}
      </span>
    );
  } else if (w.type === "label") {
    body = <span className="dgx-wtext">{w.text ?? ""}</span>;
  } else if (w.type === "meter") {
    body = <div className="dgx-meter" />;
  } else if (w.type === "filepicker" || (w.type === "dropdown" && w.library)) {
    // Picks a FILE the module carries, through a button rather than a <select> — docs/widgets.md.
    // The param is the BIND, in both spellings: an older panel's `library:` names a folder (`nam`), not a param.
    const param = String(
      w.type === "filepicker" ? (w.bind ?? "") : (w.bind ?? w.library),
    );
    const current = n.assets?.[param] ?? "";
    const shown = current
      ? current.slice(current.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "")
      : "—";
    body = (
      <button
        type="button"
        className={`dgx-sel dgx-file${current ? "" : " unknown"}`}
        // The whole path, since the face shows only the basename, which two packs may share.
        title={current || `pick a ${w.library} file`}
        disabled={!n.module}
        onClick={(e) => {
          e.stopPropagation();
          // …and the family the widget names, for a param whose name says nothing about its files.
          onPickAsset(n, param, e.clientX, e.clientY, w.library);
        }}
      >
        {shown}
      </button>
    );
  } else if (w.type === "dropdown") {
    // Options carry their own values, so the current setting is the NEAREST one — a plugin's states aren't evenly spaced.
    const opts = w.options ?? [];
    const cur =
      known && opts.length
        ? opts.reduce((best, o) =>
            Math.abs(o.value - value) < Math.abs(best.value - value) ? o : best,
          ).value
        : undefined;
    const select = (
      <select
        className={`dgx-sel${known ? "" : " unknown"}`}
        value={cur ?? ""}
        disabled={!actuable || !opts.length}
        onChange={(e) => onPick(n, w, Number(e.target.value))}
      >
        {/* Only until the first value arrives, so the first option is never shown as the setting. */}
        {cur === undefined && <option value="">—</option>}
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
    // A MIDI device's dropdown carries the LED that says the keyboard is reaching this browser.
    body =
      tgt?.kind === "module" && tgt.field === "device" ? (
        <span className="dgx-ledrow">
          <i className={`dgx-led${midiLit ? " on" : ""}`} />
          {select}
        </span>
      ) : (
        select
      );
  }

  // A curve's cable is in hand and this PLUGIN param can take it — docs/widgets.md.
  // Not a crossfade knob: a curve drives ONE param, and wet alone would break the equal-power pair.
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
