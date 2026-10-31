// widgetBody.tsx — what a widget draws inside its box, by type: the knob's dial, a slider's or a
// fader's throw, a toggle, a button or pad, a number, a label, a file picker, a dropdown. Drawing
// only: the gestures and the value are Widget.tsx's — docs/widgets.md.

import type { RecorderState } from "@studio/engine-protocol";
import type { WebWidget } from "@studio/graph-model";
import { type GraphNode, isMixKnob, widgetText } from "@studio/ui-chains/graph";
import { CTRL, RING } from "../chainsCss";
import type { Channels } from "../chainsStores";
import type { WidgetTarget } from "../widgetTarget";
import { Knob } from "./Knob";
import { FaderMeter } from "./Meters";

/** The body of one widget, or null for a type that draws nothing of its own. */
export function widgetBody({
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
}: {
  n: GraphNode;
  w: WebWidget;
  ch: Channels;
  r: { w: number; h: number };
  tgt: WidgetTarget | null;
  value: number | undefined;
  t: number;
  span: [number, number] | undefined;
  caption: string | undefined;
  knobPx: number | undefined;
  padSymbol: string | null;
  padLit: boolean;
  recState: RecorderState | undefined;
  midiLit: boolean;
  actuable: boolean;
  onPick: (n: GraphNode, w: WebWidget, value: number) => void;
  onPickAsset: (
    n: GraphNode,
    param: string,
    x: number,
    y: number,
    family?: string,
  ) => void;
}): React.ReactNode {
  // The same alias Widget draws with, so the narrowing of `value` holds here too.
  const known = value !== undefined;
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
          {/* An unknown level draws a bare rail: a cap at the floor would read as a lane pulled all the way down. */}
          <div className="rail">
            {known && (
              <>
                <i className="fill" style={{ height: `${t * 100}%` }} />
                <i className="cap" style={{ top: `${(1 - t) * 100}%` }} />
              </>
            )}
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
    // A pad is lit by its own note, a recorder's `record` while the ENGINE says it rolls — never by `t`.
    const on = padSymbol
      ? padLit
      : tgt?.kind === "recorder"
        ? tgt.verb === "record" && (recState?.recording ?? false)
        : known && t >= 0.5;
    const c = (w.bind && CTRL[w.bind]) ?? RING;
    // `clear` needs a take, rolling or not, and `save` a FINISHED one; faint when not — docs/widgets.md.
    const none =
      (recState?.takes.length ?? 0) === 0 && !(recState?.recording ?? false);
    // All three draw faint until the engine's frame lists the node: a press before that is refused.
    const idle =
      tgt?.kind === "recorder" &&
      (recState === undefined ||
        (tgt.verb === "save"
          ? recState.takes.length === 0 || recState.recording
          : tgt.verb === "clear" && none));
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
    // Picks a FILE the module carries, by its BIND in both spellings, through a button — docs/widgets.md.
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
  return body;
}
