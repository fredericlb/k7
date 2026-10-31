// NodeHeader.tsx — a card's header and its bottom bar: the lead column that is the on/off, the
// fitted name, the input chip, the engine and preset dropdown, the stage's knobs, the state tags
// and the attribute sets. Plain render functions, called inline by the card — docs/nodeCard.md.

import { Snowflake } from "@frediverse/ui/icons";
import type { WebWidget } from "@studio/graph-model";
import {
  FOOTER_H,
  type GraphNode,
  headerFontPx,
} from "@studio/ui-chains/graph";
import type { ReactNode } from "react";
import { AltBadges } from "./AltBadges";
import type { Channels } from "./chainsStores";
import { onEnter } from "./keyActivate";
import type { ChainsLabels } from "./labels";
import { hasBypass, hasLeadColumn, headerNameW } from "./nodeLayout";
import type { NodeProps } from "./nodeProps";
import { type NodeEngines, PresetButton } from "./PresetButton";
import { Widget } from "./widgets/Widget";
import { FOOT_KNOB_PX, FOOT_KNOBS } from "./widgetTarget";

/** The state tags — the engine's warning, frozen, frozen automatically — wherever the card carries them. */
export function nodeTags({
  n,
  warning,
  l,
}: {
  n: GraphNode;
  warning?: string;
  l: ChainsLabels;
}) {
  return (
    <>
      {/* What the engine said went wrong with THIS plugin, on hover: often the only word on a module doing nothing. */}
      {warning && (
        <span
          className="dgx-wbtn"
          title={warning}
          role="img"
          aria-label={l.engineWarning(warning)}
        >
          !
        </span>
      )}
      {/* FROZEN: its own tag rather than a shade of `dim`, which means the opposite — see packages/song/docs/freeze.md. */}
      {n.frozen && (
        <span
          className="dgx-fbtn"
          role="img"
          aria-label={l.frozen}
          title={n.frozen === "at" ? l.frozenAt : l.frozenInside}
        >
          <Snowflake />
        </span>
      )}
      {/* AUTOMATICALLY frozen: the same snowflake, saying it gives way to a touch — packages/song/docs/autoFreeze.md. */}
      {!n.frozen && n.autoFrozen && (
        <span
          className="dgx-fbtn auto"
          role="img"
          aria-label={l.frozenAuto}
          title={
            n.autoFrozen === n.module
              ? l.frozenAutoHere
              : l.frozenAutoInside(n.autoFrozen)
          }
        >
          <Snowflake />
        </span>
      )}
    </>
  );
}

/** The header: the lead column, the name's row, and the engine and preset dropdown under it. */
export function nodeHeader({
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
}: Pick<
  NodeProps,
  | "n"
  | "trackInput"
  | "presetName"
  | "onHeaderDrag"
  | "onZoomTo"
  | "onBypass"
  | "onPickTrackInput"
  | "onPresets"
  | "onPresetStep"
> & {
  glyph: ReactNode;
  headName: string;
  ownName: string;
  ownNameUnder: boolean;
  flagCls: string;
  hasGlyph: boolean;
  rightW: number;
  hasFoot: boolean;
  tags: ReactNode;
  hasSubRow: boolean;
  hasPresets: boolean;
  engines: NodeEngines | undefined;
  load: { text: string; title: string } | null;
  l: ChainsLabels;
}) {
  return (
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
            // biome-ignore lint/a11y/useSemanticElements: a corner bubble styled by chainsCss.ts, where a <button> would bring the UA's own box
            <span
              className={`dgx-byp dgx-bbtn${n.bypassed ? " on" : ""}`}
              title={n.bypassed ? l.bypassed : l.bypass}
              role="button"
              tabIndex={0}
              aria-pressed={!!n.bypassed}
              aria-label={l.bypass}
              onKeyDown={onEnter(() => n.module && onBypass(n.module))}
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
            title={l.interfaceInput(trackInput)}
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
            l={l}
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
  );
}

/** The BOTTOM BAR: the stage's knobs on the left, the badges centred, the attribute sets on the right — docs/nodeCard.md. */
export function nodeFoot({
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
}: Pick<
  NodeProps,
  | "n"
  | "showWidgets"
  | "onAlternative"
  | "onDragStart"
  | "onTapWidget"
  | "onPickWidget"
  | "onPickAsset"
  | "onContextParam"
  | "onTypeValue"
> & {
  ch: Channels;
  tags: ReactNode;
  load: { text: string; title: string } | null;
  altsW: number;
  isAutomated: (w: WebWidget) => boolean;
  depthFor: (w: WebWidget) => string | undefined;
}) {
  return (
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
  );
}
