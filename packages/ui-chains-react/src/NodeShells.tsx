// NodeShells.tsx — the cards that are not a full card: a module on its way, an open box's frame,
// a note, and any card at the far LOD, where the name is all there is. Plain render functions,
// called inline by the card, so the tree is the one the card would draw itself — docs/nodeCard.md.

import type { WebModuleCategory } from "@studio/graph-model";
import type { GraphNode } from "@studio/ui-chains/graph";
import type { ReactNode } from "react";
import { cableColorFor } from "./chainsCss";
import type { ChainsIcons } from "./chainsTypes";
import { onEnter } from "./keyActivate";
import { farIconPx, fitFont } from "./nodeLayout";
import type { NodeProps } from "./nodeProps";

/** The module on its way: a spinner, and the sockets its host wired it by — none are interactive. */
export function pendingCard({ n, cls }: { n: GraphNode; cls: string }) {
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
}

/** An OPEN assembly's frame, with no sockets: the members show the real ones — packages/song/docs/assemblies.md. */
export function assemblyFrame({
  n,
  onHeaderDrag,
  onContext,
  onToggleAssembly,
}: Pick<NodeProps, "n" | "onHeaderDrag" | "onContext" | "onToggleAssembly">) {
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
        title={n.assemblyOf?.uses}
      >
        <span className="dgx-frame-nm">{n.label}</span>
        {/* biome-ignore lint/a11y/useSemanticElements: a corner bubble styled by chainsCss.ts, where a <button> would bring the UA's own box */}
        <span
          className="dgx-cbtn dgx-obtn on"
          title={`Close ${n.label}`}
          role="button"
          tabIndex={0}
          aria-label={`Close ${n.label}`}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={onEnter(() => n.module && onToggleAssembly?.(n.module))}
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
}

/** A NOTE: a doc module, its text and nothing else — docs/nodeCard.md. */
export function noteCard({
  n,
  cls,
  onTapNode,
  onContext,
}: Pick<NodeProps, "n" | "onTapNode" | "onContext"> & { cls: string }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a node card holds controls of its own, which a <button> may not contain
    <div
      className={`${cls} dgx-note`}
      style={{
        left: n.x,
        top: n.y,
        width: n.w,
        height: n.h,
        opacity: n.dim ? 0.5 : 1,
      }}
      role="button"
      tabIndex={0}
      onKeyDown={onEnter((e) => onTapNode(n, e.shiftKey))}
      onClick={(e) => onTapNode(n, e.shiftKey)}
      onContextMenu={(e) => onContext(n, e)}
      title={n.label}
    >
      {/* `pre-wrap`: the author's own line breaks are the shape of the note; `noteSize` reserved the width. */}
      <div className="dgx-note-body">{n.note}</div>
    </div>
  );
}

/** The far LOD: the whole card is the name, its glyph stacked above it. */
export function farCard({
  n,
  cls,
  headName,
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
}: Pick<
  NodeProps,
  "n" | "onHeaderDrag" | "onZoomTo" | "onTapNode" | "onContext"
> & {
  cls: string;
  headName: string;
  inLaneRow: boolean;
  iconCategory: WebModuleCategory | undefined;
  flagCls: string;
  hasGlyph: boolean;
  armBar: ReactNode;
  TrackIcon: ChainsIcons["TrackIcon"];
  ModuleIcon: ChainsIcons["ModuleIcon"];
}) {
  // The module here too, for the header's reason: two LODs answering differently would be two cards.
  const label = headName || (n.kind === "sink" ? "OUT" : n.kind);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a node card holds controls of its own, which a <button> may not contain
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
      role="button"
      tabIndex={0}
      aria-label={label}
      onKeyDown={onEnter((e) => onTapNode(n, e.shiftKey))}
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
