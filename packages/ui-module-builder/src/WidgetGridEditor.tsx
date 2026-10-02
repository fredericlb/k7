// WidgetGridEditor.tsx — the visual half of the module editor: a module's UI grid,
// authored by placing widgets on cells instead of writing YAML. It owns nothing — every
// edit produces a fresh ModuleUI and calls onChange. A widget is bound by DRAGGING a row
// from the Parameters pane (paramDrag.ts), which carries the range with it, so this
// component needs to know nothing about the engine. It edits ONE widget map at a time —
// the one every tab shows, or one tab's (TabsColumn.tsx, docs/pages.md). A group frames what lies
// inside its box and moves it along (groupGeometry.ts); the inspector is WidgetInspector.tsx.

import { Button } from "@frediverse/ui/button";
import {
  ClipboardPaste,
  Copy,
  LoaderCircle,
  Minus,
  Plus,
  Power,
  Scissors,
  Sparkles,
  Wand2,
} from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { askConfirm } from "@studio/project-shell/ask";
import { useCallback, useRef, useState } from "react";
import { type AutoParam, autoOrganize } from "./autoLayout";
import { GridMenu } from "./GridMenu";
import { clash, framedBy, groupOf } from "./groupGeometry";
import type { ModuleUI, Widget, WidgetType } from "./moduleUi";
import {
  type PageRef,
  pageIn,
  panelIds,
  widgetsAt,
  writeWidgetsAt,
} from "./panelTabs";
import { isParamDrag, type ParamDrag, readParamDrag } from "./paramDrag";
import { TabsColumn } from "./TabsColumn";
import { WidgetInspector } from "./WidgetInspector";
import {
  clipIds,
  copyWidgets,
  heldClip,
  holdClip,
  pasteWidgets,
} from "./widgetClipboard";
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

// A stable, unused id across the WHOLE panel, every tab's included — ids are the override key and never renumber.
function nextId(taken: Set<string>): string {
  for (let i = 1; ; i++) if (!taken.has(`w${i}`)) return `w${i}`;
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
  /** WHICH widget map the grid edits: a tab, or `null` for every tab's — undefined until one is chosen. */
  const [page, setPage] = useState<PageRef | undefined>(undefined);
  // …checked against the document, so a tab that has gone takes the grid to the first one.
  const at: PageRef = pageIn(ui, page);
  /** The map being edited — the widgets every tab shows, or one tab's. */
  const widgets = widgetsAt(ui, at);
  const tabs = ui.tabs ?? [];
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
    /** Where in the box the press landed, so a move keeps that cell under the pointer. */
    grab?: Cell;
    /** A widget pressed inside its selected group: selected instead, if the press never moves. */
    tap?: string;
    moved?: boolean;
    /** A group's members AT THE PRESS: what it passes over on the way is not picked up. */
    members?: string[];
  } | null>(null);

  /** Write the edited map back where it came from. Every operation below goes through it. */
  const writeWidgets = useCallback(
    (next: Record<string, Widget>) => onChange(writeWidgetsAt(ui, at, next)),
    [ui, at, onChange],
  );

  /** Open a tab, or the widgets every tab shows. The selection is per map, so it clears. */
  const enter = (p: PageRef | undefined) => {
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
    // A group's bind is its on/off switch: no range, no settings, and its label stays the section's name.
    if (w.type === "group") return patch(id, { bind: p.name });
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
    const id = nextId(panelIds(ui));
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
    const id = nextId(panelIds(ui));
    // With a group selected, a new control lands INSIDE it — which is how a group is filled.
    const into = sel?.type === "group" && type !== "group" ? sel : null;
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
    if (panelIds(ui).size) {
      const agreed = await askConfirm({
        title: "Rearrange the panel?",
        body: "It is replaced by a layout taken from the parameter list; what is drawn here is lost. Ctrl+Z in the code brings it back.",
        confirmLabel: "Rearrange",
        danger: true,
      });
      if (!agreed) return;
    }
    onChange(autoOrganize(params));
    enter(undefined);
  };

  // The right-click menu: on a widget (`id`) or on bare grid (`id: null`), and the cell a paste lands on.
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    id: string | null;
    cell: Cell;
  } | null>(null);
  const openMenu = (e: React.MouseEvent, id: string | null) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    if (id) setSelected(id);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      id,
      cell: cellAt(e.clientX, e.clientY),
    });
  };
  // Every id in the panel, every tab's included: a pasted widget must not take a name another tab uses.
  const takenIds = () => panelIds(ui);
  const copyWidget = (id: string) => {
    const clip = copyWidgets(widgets, id);
    if (clip) holdClip(clip);
  };
  const cutWidget = (id: string) => {
    copyWidget(id);
    const next = { ...widgets };
    for (const i of clipIds(widgets, id)) delete next[i];
    writeWidgets(next);
    setSelected(null);
  };
  const pasteAt = (cell: Cell) => {
    const clip = heldClip();
    if (!clip) return;
    const { widgets: next, first } = pasteWidgets(
      widgets,
      clip,
      cell,
      { cols: ui.cols, rows: ui.rows },
      takenIds(),
    );
    writeWidgets(next);
    setSelected(first);
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
      // Keep the widget wholly inside the grid at its current span, the grabbed cell under the pointer.
      const gc = col - (d.grab?.col ?? 0);
      const gr = row - (d.grab?.row ?? 0);
      const c = Math.max(0, Math.min(gc, ui.cols - span(w.colSpan)));
      const r = Math.max(0, Math.min(gr, ui.rows - span(w.rowSpan)));
      if (c === w.col && r === w.row) return;
      d.moved = true;
      if (w.type !== "group") return patch(d.id, { col: c, row: r });
      // A group carries what it framed when grabbed, so the section moves as one block.
      const next = { ...widgets, [d.id]: { ...w, col: c, row: r } };
      for (const id of d.members ?? framedBy(widgets, w))
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
    // Only the primary button drags: a right-click opens the menu and must not move what it lands on.
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    // With a group selected, a press on a widget it frames grabs the GROUP, so a section moves as one block.
    const pressed = id;
    if (mode === "move" && selected && groupOf(widgets, id) === selected)
      id = selected;
    setSelected(id);
    const w = widgets[id];
    const at = cellAt(e.clientX, e.clientY);
    drag.current =
      mode === "move" || !w
        ? {
            id,
            mode: "move",
            grab: w ? { col: at.col - w.col, row: at.row - w.row } : undefined,
            tap: pressed !== id ? pressed : undefined,
            members: w?.type === "group" ? framedBy(widgets, w) : undefined,
          }
        : { id, mode: "resize", anchor: cornerAnchor(w, mode) };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const endDrag = (e: React.PointerEvent) => {
    // A click that never moved the group it grabbed was meant for the widget under it.
    const d = drag.current;
    if (d?.tap && !d.moved) setSelected(d.tap);
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
            disabled={!!disabled}
            onClick={() => addWidget(t.type)}
            title={`Add ${t.label}`}
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

      {/* The tabs at the grid's LEFT, as the card draws them, then the grid canvas — ../docs/pages.md. */}
      <div className="flex min-h-0 flex-1">
        <TabsColumn
          ui={ui}
          at={at}
          disabled={!!disabled}
          onSelect={enter}
          onChange={(next, to) => {
            onChange(next);
            enter(to);
          }}
        />
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
                  onDragLeave={() =>
                    setDropTarget((t) => (t === key ? null : t))
                  }
                  onContextMenu={(e) => openMenu(e, null)}
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

            {/* What every tab shows, behind the open tab, inert and dim — ../docs/pages.md. */}
            {at !== null &&
              Object.entries(ui.widgets).map(([id, w]) => (
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
                  onContextMenu={(e) => openMenu(e, id)}
                  // A double-click climbs to the group the widget sits in, the one way to grab a group under its widgets.
                  onDoubleClick={(e) => {
                    const g = groupOf(widgets, id);
                    if (!g) return;
                    e.stopPropagation();
                    setSelected(g);
                  }}
                  // Dropping a parameter binds it — refused on kinds with no `bind`, rather than writing a field they don't read.
                  onDragOver={(e) => {
                    if (disabled || !isParamDrag(e.dataTransfer)) return;
                    if (!bindable(w) && !isGroup) return;
                    e.preventDefault(); // "yes, you may drop here"
                    e.dataTransfer.dropEffect = "copy";
                    if (dropTarget !== id) setDropTarget(id);
                  }}
                  onDragLeave={() =>
                    setDropTarget((t) => (t === id ? null : t))
                  }
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
                    // A group's name runs up its left edge, turned 90° counter-clockwise as on the card, under its switch when bound.
                    <span className="pointer-events-none absolute bottom-0 left-0.5 top-0.5 z-10 flex flex-col items-center gap-0.5 overflow-hidden text-[10px] leading-none text-foreground">
                      {w.bind && (
                        <Power className="h-3 w-3 shrink-0 text-primary" />
                      )}
                      <span className="rotate-180 whitespace-nowrap [writing-mode:vertical-rl]">
                        {w.label || "group"}
                      </span>
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
                  {/* A group's handles are drawn in their own layer below: its widgets would cover these. */}
                  {!disabled &&
                    isSel &&
                    !isGroup &&
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

            {/* The selected GROUP's handles, over everything: a widget in its corner must not hide them. */}
            {!disabled &&
              sel?.type === "group" &&
              selected &&
              widgets[selected] && (
                <div
                  className="pointer-events-none relative z-20 m-0.5"
                  style={{
                    gridColumn: `${sel.col + 1} / span ${span(sel.colSpan)}`,
                    gridRow: `${sel.row + 1} / span ${span(sel.rowSpan)}`,
                  }}
                >
                  {CORNERS.map((c) => (
                    <span
                      key={c}
                      onPointerDown={(e) => startDrag(e, selected, c)}
                      className={cn(
                        "pointer-events-auto absolute h-3 w-3 bg-primary",
                        HANDLE_CLS[c],
                      )}
                    />
                  ))}
                </div>
              )}
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
              {at !== null
                ? `"${tabs[at]?.name}" is empty — add a widget above and it lands on this tab.`
                : "Empty grid — add a widget above, then drag to place and resize it."}
            </p>
          )}
        </div>
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
      {menu && (
        <GridMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            ...(menu.id
              ? [
                  {
                    label: "Cut",
                    icon: Scissors,
                    onPick: () => cutWidget(menu.id as string),
                  },
                  {
                    label: "Copy",
                    icon: Copy,
                    onPick: () => copyWidget(menu.id as string),
                  },
                ]
              : []),
            {
              label: "Paste",
              icon: ClipboardPaste,
              disabled: !heldClip(),
              onPick: () => pasteAt(menu.cell),
            },
          ]}
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
