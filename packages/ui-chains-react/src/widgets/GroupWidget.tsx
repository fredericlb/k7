// GroupWidget.tsx — a GROUP on a card: a box that frames the widgets inside it and holds none of
// them, its label on a spine of its own colour, and — bound to an on/off param — a switch that greys
// its section while off (song-schema's docs/moduleFile.md, docs/widgets.md).

import type { WebWidget } from "@studio/graph-model";
import type { GraphNode } from "@studio/ui-chains/graph";

// A group's colour as its label's spine: the same hue, made opaque enough to read as the section's tab.
function spineColor(color: string): string {
  const hex = color.slice(1);
  const rgb =
    hex.length <= 4
      ? hex.slice(0, 3).replace(/./g, (c) => c + c)
      : hex.slice(0, 6);
  return `#${rgb}73`;
}

/** The group's frame, its label and, when bound, its switch. */
export function groupWidget({
  n,
  w,
  style,
  known,
  t,
  actuable,
  onTap,
  onContextParam,
}: {
  n: GraphNode;
  w: WebWidget;
  style: React.CSSProperties;
  known: boolean;
  t: number;
  actuable: boolean;
  onTap: (n: GraphNode, w: WebWidget) => void;
  onContextParam?: (n: GraphNode, w: WebWidget, x: number, y: number) => void;
}) {
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
