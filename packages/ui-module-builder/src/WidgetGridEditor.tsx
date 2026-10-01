// WidgetGridEditor.tsx — the visual half of the module editor: a module's UI grid,
// authored by placing widgets on cells instead of writing YAML. It owns nothing — every
// edit produces a fresh ModuleUI and calls onChange. A widget is bound by DRAGGING a row
// from the Parameters pane (paramDrag.ts), which carries the range with it, so this
// component needs to know nothing about the engine. It edits ONE widget map at a time —
// the panel's, or one page of a tabs widget — which is docs/pages.md. A group frames what lies
// inside its box and moves it along (groupGeometry.ts); the inspector is WidgetInspector.tsx.

import { Button } from "@frediverse/ui/button";
import {
  LoaderCircle,
  Minus,
  Plus,
  Sparkles,
  Wand2,
} from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { askConfirm } from "@studio/project-shell/ask";
import { useCallback, useRef, useState } from "react";
import { type AutoParam, autoOrganize } from "./autoLayout";
import { clash, framedBy } from "./groupGeometry";
import type { ModuleUI, Widget, WidgetType } from "./moduleUi";
import { isParamDrag, type ParamDrag, readParamDrag } from "./paramDrag";
import { WidgetInspector } from "./WidgetInspector";
import { bindable, GROUP_COLOR, ICON, ranged, TYPES } from "./widgetKinds";

// Row height in px (columns are elastic), in one place so the pointer→cell maths and the CSS grid agree.
const ROW_PX = 64;

// The track intrinsics that are on/off: only these are KNOWN discrete, so only these become a toggle on drop.
const TOGGLE_BINDS = new Set(["@mute", "@solo", "@arm"]);

// A bound widget's default label is the param's name; the "@" of an intrinsic goes, it marks a namespace.
const defaultLabel = (param: string) => param.replace(/^@/, "");

// What a fresh button says, named because binding treats it as "no label yet" — a bare "B" would be a mystery.
const BUTTON_PLACEHOLDER_LABEL = "B";
const hasOwnLabel = (w: Widget) =>
  !!w.label && !(w.type === "button" && w.label === BUTTON_PLACEHOLDER_LABEL);

// A parameter with named settings — what a dropdown is for.
const isDiscrete = (p: ParamDrag) => !!p.meta?.states?.length;

const span = (n?: number) => Math.max(1, n ?? 1);
const covers = (w: Widget, c: number, r: number) =>
  c >= w.col &&
  c < w.col + span(w.colSpan) &&
  r >= w.row &&
  r < w.row + span(w.rowSpan);

// The first cell in `box` no widget covers, row-major; a group frames cells rather than filling them.
function firstFree(
  widgets: Record<string, Widget>,
  box: { col: number; row: number; cols: number; rows: number },
): { col: number; row: number } {
  const ws = Object.values(widgets).filter((w) => w.type !== "group");
  for (let r = box.row; r < box.row + box.rows; r++)
    for (let c = box.col; c < box.col + box.cols; c++)
      if (!ws.some((w) => covers(w, c, r))) return { col: c, row: r };
  return { col: box.col, row: box.row }; // full — stack on the corner, the user can move it
}

/** Which widget map the grid edits: the panel itself (`null`), or one page of a tabs widget. */
export type PageRef = { tabs: string; name: string } | null;

/** The map `at` names — the panel's widgets, or the page's (empty if it has none yet). */
export function widgetsAt(ui: ModuleUI, at: PageRef): Record<string, Widget> {
  return at ? (ui.widgets[at.tabs]?.pages?.[at.name] ?? {}) : ui.widgets;
}

/** `ui` with the map at `at` replaced, spread at EVERY level so a tabs widget keeps its other pages. */
export function writeWidgetsAt(
  ui: ModuleUI,
  at: PageRef,
  next: Record<string, Widget>,
): ModuleUI {
  if (!at) return { ...ui, widgets: next };
  const tabs = ui.widgets[at.tabs];
  if (!tabs) return ui; // the page's owner has gone: refuse rather than invent one
  return {
    ...ui,
    widgets: {
      ...ui.widgets,
      [at.tabs]: { ...tabs, pages: { ...tabs.pages, [at.name]: next } },
    },
  };
}

type Cell = { col: number; row: number };

/** A resize handle, named by the corner it sits on. */
export type Corner = "nw" | "ne" | "sw" | "se";
const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];
const HANDLE_CLS: Record<Corner, string> = {
  nw: "left-0 top-0 cursor-nw-resize rounded-br",
  ne: "right-0 top-0 cursor-ne-resize rounded-bl",
  sw: "bottom-0 left-0 cursor-sw-resize rounded-tr",
  se: "bottom-0 right-0 cursor-se-resize rounded-tl",
};

/** The cell a corner's resize keeps still — the widget's OPPOSITE corner cell. */
export function cornerAnchor(w: Widget, corner: Corner): Cell {
  return {
    col: corner.includes("w") ? w.col + span(w.colSpan) - 1 : w.col,
    row: corner.includes("n") ? w.row + span(w.rowSpan) - 1 : w.row,
  };
}

/** The box spanning two cells, whichever way round they are — so a handle dragged past the anchor flips. */
export function boxBetween(a: Cell, b: Cell) {
  return {
    col: Math.min(a.col, b.col),
    row: Math.min(a.row, b.row),
    colSpan: Math.abs(a.col - b.col) + 1,
    rowSpan: Math.abs(a.row - b.row) + 1,
  };
}

// A group is drawn UNDER what it frames, so it comes first; the sort is stable for everything else.
const groupsFirst = (ws: Record<string, Widget>): [string, Widget][] =>
  Object.entries(ws).sort(
    ([, a], [, b]) => +(b.type === "group") - +(a.type === "group"),
  );

// A stable, unused id. Ids are the base→module override key, so existing widgets must never renumber.
function nextId(widgets: Record<string, Widget>): string {
  for (let i = 1; ; i++) if (!widgets[`w${i}`]) return `w${i}`;
}

export function WidgetGridEditor({
  ui,
  assetParams,
  params,
  disabled,
  onChange,
  onAiOrganize,
  aiBusy,
}: {
  ui: ModuleUI;
  // The params taking a FILE, whose dropdown offers the module's own assets/ instead of settings.
  assetParams?: string[];
  /** Every parameter this module can bind — the SAME list the pane drags from; see docs/builder.md. */
  params?: readonly AutoParam[];
  /** WHY the grid takes no gesture: a reason, not a boolean, since only a FAULT warrants a warning. */
  disabled?: false | "unparsable" | "locked";
  onChange: (ui: ModuleUI) => void;
  /** Ask Claude for a whole panel — drawn only when the host offers it; docs/aiOrganize.md. */
  onAiOrganize?: () => void;
  /** What the running request is doing, or null when none is. */
  aiBusy?: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  /** WHICH widget map the grid edits: the panel (`null`), or one PAGE of a tabs widget — docs/pages.md. */
  const [page, setPage] = useState<PageRef>(null);
  // …checked against the document, so a page that has gone takes the grid back to the panel.
  const at: PageRef =
    page && ui.widgets[page.tabs]?.pages?.[page.name] ? page : null;
  /** The map being edited — the panel's widgets, or the page's. */
  const widgets = widgetsAt(ui, at);
  /** The panel's tabs widgets, whose pages the breadcrumb offers. Top level only, per addWidget. */
  const tabsWidgets = Object.entries(ui.widgets).filter(
    ([, w]) => w.type === "tabs",
  );
  const sel = selected ? (widgets[selected] ?? null) : null;
  // The widget a parameter is currently hovering over, so it can light up as the target.
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // Which gesture is live, so pointermove knows whether it's moving or resizing.
  const drag = useRef<{
    id: string;
    mode: "move" | "resize";
    /** The cell a resize keeps still: the corner OPPOSITE the handle, fixed at the press. */
    anchor?: Cell;
  } | null>(null);

  /** Write the edited map back where it came from. Every operation below goes through it. */
  const writeWidgets = useCallback(
    (next: Record<string, Widget>) => onChange(writeWidgetsAt(ui, at, next)),
    [ui, at, onChange],
  );

  /** Enter a page, or come back to the panel. The selection is per map, so it clears. */
  const enter = (p: PageRef) => {
    setPage(p);
    setSelected(null);
  };

  const patch = useCallback(
    (id: string, w: Partial<Widget>) =>
      writeWidgets({ ...widgets, [id]: { ...widgets[id], ...w } }),
    [widgets, writeWidgets],
  );

  const setGrid = (d: Partial<Pick<ModuleUI, "cols" | "rows">>) =>
    onChange({ ...ui, ...d });

  // Adopt a dropped param's range only on the placeholder 0..1: an edited one is the author's.
  const bindParam = (id: string, w: Widget, p: ParamDrag) => {
    const untouched = ranged(w) && (w.min ?? 0) === 0 && (w.max ?? 1) === 1;
    patch(id, {
      bind: p.name,
      ...(p.meta && untouched ? { min: p.meta.min, max: p.meta.max } : {}),
      // A dropdown's options ARE replaced on a re-bind: keeping the old param's would send values the new one rejects.
      ...(w.type === "dropdown" ? { options: p.meta?.states ?? [] } : {}),
      // Same rule as the range: fill the label in when the author hasn't, never over a deliberate one.
      ...(hasOwnLabel(w) ? {} : { label: defaultLabel(p.name) }),
    });
    setSelected(id);
  };

  // A param dropped on empty grid makes its widget there, already bound and sized to the param's range.
  const createBound = (col: number, row: number, p: ParamDrag) => {
    const type: WidgetType = isDiscrete(p)
      ? "dropdown"
      : TOGGLE_BINDS.has(p.name)
        ? "toggle"
        : "knob";
    const id = nextId(widgets);
    const w: Widget = {
      type,
      col,
      row,
      bind: p.name,
      label: defaultLabel(p.name),
      // Only a knob carries a range here; a toggle has none, and a dropdown's options stand in for one.
      ...(type === "knob"
        ? { min: p.meta?.min ?? 0, max: p.meta?.max ?? 1 }
        : {}),
      ...(type === "dropdown" ? { options: p.meta?.states ?? [] } : {}),
    };
    writeWidgets({ ...widgets, [id]: w });
    setSelected(id);
  };

  const addWidget = (type: WidgetType) => {
    if (disabled) return;
    // One level of pages deliberately, the button disabled rather than silently doing nothing.
    if (type === "tabs" && at) return;
    const id = nextId(widgets);
    // With a group selected, a new control lands INSIDE it — which is how a group is filled.
    const into =
      sel?.type === "group" && type !== "group" && type !== "tabs" ? sel : null;
    const { col, row } = firstFree(
      widgets,
      into
        ? {
            col: into.col,
            row: into.row,
            cols: span(into.colSpan),
            rows: span(into.rowSpan),
          }
        : { col: 0, row: 0, cols: ui.cols, rows: ui.rows },
    );
    const w: Widget =
      type === "group"
        ? {
            type,
            col,
            row,
            colSpan: 4,
            rowSpan: 2,
            label: "Group",
            color: GROUP_COLOR,
          }
        : type === "label"
          ? { type, col, row, text: "Label" }
          : type === "button"
            ? { type, col, row, label: BUTTON_PLACEHOLDER_LABEL } // a button draws its label inside itself
            : type === "tabs"
              ? {
                  type,
                  col,
                  row,
                  colSpan: 2,
                  rowSpan: 2,
                  pages: { "Page 1": {} },
                }
              : type === "waveform"
                ? { type, col, row, colSpan: 2, rowSpan: 2, source: "output" }
                : type === "lcdscreen"
                  ? { type, col, row, colSpan: 3, rowSpan: 2 }
                  : // A fader placed one cell tall would be a worse slider. Three rows is a strip's throw, and the
                    // author can still drag it shorter — the widget reads whatever height it ends up with.
                    type === "fader"
                    ? { type, col, row, rowSpan: 3 }
                    : {
                        type,
                        col,
                        row,
                        ...(type !== "toggle" && type !== "meter"
                          ? { min: 0, max: 1 }
                          : {}),
                      };
    writeWidgets({ ...widgets, [id]: w });
    setSelected(id);
  };

  /** Replace the whole panel with a proposal, asking first only when there is something to lose — docs/autoLayout.md. */
  const organize = async () => {
    if (disabled || !params?.length) return;
    if (Object.keys(ui.widgets).length) {
      const agreed = await askConfirm({
        title: "Rearrange the panel?",
        body: "It is replaced by a layout taken from the parameter list; what is drawn here is lost. Ctrl+Z in the code brings it back.",
        confirmLabel: "Rearrange",
        danger: true,
      });
      if (!agreed) return;
    }
    onChange(autoOrganize(params));
    enter(null);
  };

  const removeWidget = (id: string) => {
    const next = { ...widgets };
    delete next[id];
    writeWidgets(next);
    setSelected((s) => (s === id ? null : s));
  };

  // The grid cell under a client point, clamped to the grid.
  const cellAt = (clientX: number, clientY: number) => {
    const el = gridRef.current;
    if (!el) return { col: 0, row: 0 };
    const rect = el.getBoundingClientRect();
    const cw = rect.width / ui.cols;
    const col = Math.min(
      ui.cols - 1,
      Math.max(0, Math.floor((clientX - rect.left) / cw)),
    );
    const row = Math.min(
      ui.rows - 1,
      Math.max(0, Math.floor((clientY - rect.top) / ROW_PX)),
    );
    return { col, row };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const w = widgets[d.id];
    if (!w) return;
    const { col, row } = cellAt(e.clientX, e.clientY);
    if (d.mode === "move") {
      // Keep the widget wholly inside the grid at its current span.
      const c = Math.max(0, Math.min(col, ui.cols - span(w.colSpan)));
      const r = Math.max(0, Math.min(row, ui.rows - span(w.rowSpan)));
      if (c === w.col && r === w.row) return;
      if (w.type !== "group") return patch(d.id, { col: c, row: r });
      // A group carries what it frames, so the section moves as one block.
      const next = { ...widgets, [d.id]: { ...w, col: c, row: r } };
      for (const id of framedBy(widgets, w))
        next[id] = {
          ...widgets[id],
          col: widgets[id].col + c - w.col,
          row: widgets[id].row + r - w.row,
        };
      writeWidgets(next);
    } else if (d.anchor) {
      const b = boxBetween(d.anchor, { col, row });
      if (
        b.col !== w.col ||
        b.row !== w.row ||
        b.colSpan !== span(w.colSpan) ||
        b.rowSpan !== span(w.rowSpan)
      )
        patch(d.id, {
          col: b.col,
          row: b.row,
          colSpan: b.colSpan > 1 ? b.colSpan : undefined,
          rowSpan: b.rowSpan > 1 ? b.rowSpan : undefined,
        });
    }
  };

  const startDrag = (
    e: React.PointerEvent,
    id: string,
    mode: "move" | Corner,
  ) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(id);
    const w = widgets[id];
    drag.current =
      mode === "move" || !w
        ? { id, mode: "move" }
        : { id, mode: "resize", anchor: cornerAnchor(w, mode) };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const endDrag = (e: React.PointerEvent) => {
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* palette + grid size */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Add
        </span>
        {TYPES.map((t) => (
          <Button
            key={t.type}
            size="sm"
            variant="secondary"
            disabled={!!disabled || (t.type === "tabs" && !!at)}
            onClick={() => addWidget(t.type)}
            title={
              t.type === "tabs" && at
                ? "Tabs inside a page is not editable here — go back to Panel"
                : `Add ${t.label}`
            }
          >
            <t.icon className="mr-1 h-3.5 w-3.5" />
            {t.label}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-3">
          {/* Set apart from the Add buttons: this one throws the panel away and draws another. */}
          <Button
            size="sm"
            variant="secondary"
            disabled={!!disabled || !params?.length}
            onClick={() => void organize()}
            title={
              params?.length
                ? `Replace the panel with ${params.length} parameters sorted into tabs, guessed from their names`
                : "No parameters to organize — scan the plugin or open a module that declares some"
            }
          >
            <Wand2 className="mr-1 h-3.5 w-3.5" />
            Auto organize
          </Button>
          {onAiOrganize && (
            <Button
              size="sm"
              variant="secondary"
              disabled={!!disabled || !params?.length || !!aiBusy}
              onClick={onAiOrganize}
              title={
                aiBusy ??
                (params?.length
                  ? `Ask Claude to design a panel for ${params.length} parameters, with screens where a picture helps`
                  : "No parameters to organize — scan the plugin or open a module that declares some")
              }
            >
              {aiBusy ? (
                <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1 h-3.5 w-3.5" />
              )}
              {aiBusy ?? "AI organize"}
            </Button>
          )}
          <Stepper
            label="cols"
            value={ui.cols}
            min={1}
            disabled={!!disabled}
            onChange={(cols) => setGrid({ cols })}
          />
          <Stepper
            label="rows"
            value={ui.rows}
            min={1}
            disabled={!!disabled}
            onChange={(rows) => setGrid({ rows })}
          />
        </div>
      </div>

      {/* Where the grid is writing, drawn only once the panel HAS a tabs widget — ../docs/pages.md. */}
      {tabsWidgets.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1">
          <button
            type="button"
            onClick={() => enter(null)}
            className={cn(
              "rounded px-2 py-0.5 text-xs",
              at
                ? "text-muted-foreground hover:text-foreground"
                : "bg-secondary text-foreground",
            )}
          >
            Panel
          </button>
          {tabsWidgets.map(([tid, tw]) => (
            <span key={tid} className="flex items-center gap-1">
              <span className="text-muted-foreground/50">/</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {tid}
              </span>
              {Object.keys(tw.pages ?? {}).map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => enter({ tabs: tid, name })}
                  className={cn(
                    "rounded px-2 py-0.5 text-xs",
                    at?.tabs === tid && at.name === name
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {name}
                </button>
              ))}
              {!Object.keys(tw.pages ?? {}).length && (
                <span className="px-1 text-[10px] text-muted-foreground/60">
                  no pages
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* the grid canvas */}
      <div
        className="min-h-0 flex-1 overflow-auto p-4"
        onPointerDown={() => setSelected(null)}
      >
        <div
          ref={gridRef}
          className="relative rounded-md border border-border bg-card/40"
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${ui.cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${ui.rows}, ${ROW_PX}px)`,
          }}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
        >
          {/* Empty cell guides, and drop targets: a parameter dropped on bare grid creates its widget. */}
          {Array.from({ length: ui.cols * ui.rows }).map((_, i) => {
            const col = i % ui.cols;
            const row = Math.floor(i / ui.cols);
            const key = `cell:${col}:${row}`;
            return (
              <div
                key={i}
                onDragOver={(e) => {
                  if (disabled || !isParamDrag(e.dataTransfer)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  if (dropTarget !== key) setDropTarget(key);
                }}
                onDragLeave={() => setDropTarget((t) => (t === key ? null : t))}
                onDrop={(e) => {
                  setDropTarget(null);
                  if (disabled) return;
                  const p = readParamDrag(e.dataTransfer);
                  if (!p) return;
                  e.preventDefault();
                  createBound(col, row, p);
                }}
                className={cn(
                  "border border-dashed border-border/40",
                  dropTarget === key &&
                    "border-solid border-primary bg-primary/20",
                )}
                style={{ gridColumn: col + 1, gridRow: row + 1 }}
              />
            );
          })}

          {/* The PANEL behind the page, inert and dim, minus the tabs widget — ../docs/pages.md. */}
          {at &&
            Object.entries(ui.widgets)
              .filter(([id]) => id !== at.tabs)
              .map(([id, w]) => (
                <div
                  key={`under:${id}`}
                  className="pointer-events-none m-0.5 flex flex-col items-center justify-center overflow-hidden rounded border border-dashed border-border/50 bg-background/30 px-1 text-center opacity-40"
                  style={{
                    gridColumn: `${w.col + 1} / span ${span(w.colSpan)}`,
                    gridRow: `${w.row + 1} / span ${span(w.rowSpan)}`,
                  }}
                >
                  <span className="max-w-full truncate text-[10px] leading-tight text-muted-foreground">
                    {w.type === "label"
                      ? w.text || "label"
                      : w.label || w.bind || w.type}
                  </span>
                </div>
              ))}

          {/* placed widgets */}
          {groupsFirst(widgets).map(([id, w]) => {
            const Icon = ICON[w.type];
            const isSel = id === selected;
            const isGroup = w.type === "group";
            // Crossing a group's edge, or another widget's cells, is what the checks refuse: say so here first.
            const crossed = Object.entries(widgets).some(
              ([o, ow]) => o !== id && clash(w, ow),
            );
            return (
              <div
                key={id}
                onPointerDown={(e) => startDrag(e, id, "move")}
                // Dropping a parameter binds it — refused on kinds with no `bind`, rather than writing a field they don't read.
                onDragOver={(e) => {
                  if (disabled || !isParamDrag(e.dataTransfer)) return;
                  if (!bindable(w) && !isGroup) return;
                  e.preventDefault(); // "yes, you may drop here"
                  e.dataTransfer.dropEffect = "copy";
                  if (dropTarget !== id) setDropTarget(id);
                }}
                onDragLeave={() => setDropTarget((t) => (t === id ? null : t))}
                onDrop={(e) => {
                  setDropTarget(null);
                  if (disabled || (!bindable(w) && !isGroup)) return;
                  const p = readParamDrag(e.dataTransfer);
                  if (!p) return;
                  e.preventDefault();
                  // A group covers its cells, so a parameter dropped on it makes its widget in the cell below.
                  if (!isGroup) return bindParam(id, w, p);
                  const cell = cellAt(e.clientX, e.clientY);
                  createBound(cell.col, cell.row, p);
                }}
                className={cn(
                  "group relative m-0.5 flex flex-col overflow-hidden rounded border px-1",
                  isGroup
                    ? "items-start justify-start pt-0.5 text-left"
                    : "items-center justify-center bg-background/80 text-center",
                  disabled ? "cursor-default" : "cursor-move",
                  isSel
                    ? "border-primary ring-1 ring-primary"
                    : "border-border hover:border-primary/60",
                  dropTarget === id &&
                    "border-primary bg-primary/20 ring-2 ring-primary",
                  w.hidden && "opacity-40",
                  crossed && !isSel && "border-amber-500",
                )}
                style={{
                  gridColumn: `${w.col + 1} / span ${span(w.colSpan)}`,
                  gridRow: `${w.row + 1} / span ${span(w.rowSpan)}`,
                  ...(isGroup ? { background: w.color ?? GROUP_COLOR } : {}),
                }}
                title={w.type === "label" ? w.text : w.bind}
              >
                {/* The glyph and the caption take no pointer, or they steal the tile's drag — ../docs/builder.md. */}
                {isGroup ? (
                  // A group's name is stacked down its left edge, as on the card, over the tiles it frames.
                  <span className="pointer-events-none absolute bottom-0 left-0.5 top-0.5 z-10 overflow-hidden text-[10px] leading-none text-foreground [text-orientation:upright] [writing-mode:vertical-rl]">
                    {w.label || "group"}
                  </span>
                ) : (
                  <>
                    <Icon className="pointer-events-none h-4 w-4 text-muted-foreground" />
                    <span className="pointer-events-none mt-0.5 max-w-full truncate text-[10px] leading-tight text-foreground">
                      {w.type === "label"
                        ? w.text || "label"
                        : w.label || w.bind || w.type}
                    </span>
                  </>
                )}
                {!disabled &&
                  isSel &&
                  CORNERS.map((c) => (
                    <span
                      key={c}
                      onPointerDown={(e) => startDrag(e, id, c)}
                      className={cn(
                        "absolute h-3 w-3 bg-primary",
                        HANDLE_CLS[c],
                      )}
                    />
                  ))}
              </div>
            );
          })}
        </div>
        {/* Only the FAULT gets a warning: a locked module already says so in the header. */}
        {disabled === "unparsable" && (
          <p className="mt-3 text-xs text-amber-500">
            This panel couldn't be parsed for visual editing — edit it as text
            on the left. Fixing it re-enables the grid.
          </p>
        )}
        {!disabled && !Object.keys(widgets).length && (
          <p className="mt-3 text-xs text-muted-foreground">
            {at
              ? `"${at.name}" is empty — add a widget above and it lands on this page.`
              : "Empty grid — add a widget above, then drag to place and resize it."}
          </p>
        )}
      </div>

      {/* inspector */}
      {sel && selected && (
        <WidgetInspector
          key={selected}
          id={selected}
          w={sel}
          assetParams={assetParams}
          disabled={!!disabled}
          onPatch={(p) => patch(selected, p)}
          onBind={(p) => bindParam(selected, sel, p)}
          onDelete={() => removeWidget(selected)}
        />
      )}
    </div>
  );
}

function Stepper({
  label,
  value,
  min,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <button
        className="grid h-6 w-6 place-items-center rounded border border-border hover:bg-accent disabled:opacity-40"
        disabled={disabled || value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Minus className="h-3 w-3" />
      </button>
      <span className="w-4 text-center font-mono text-foreground">{value}</span>
      <button
        className="grid h-6 w-6 place-items-center rounded border border-border hover:bg-accent disabled:opacity-40"
        disabled={disabled}
        onClick={() => onChange(value + 1)}
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}
