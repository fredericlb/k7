// WidgetGridEditor.tsx — the visual half of the module editor: a module's UI grid,
// authored by placing widgets on cells instead of writing YAML. It owns nothing — every
// edit produces a fresh ModuleUI and calls onChange. A widget is bound by DRAGGING a row
// from the Parameters pane (paramDrag.ts), which carries the range with it, so this
// component needs to know nothing about the engine. It edits ONE widget map at a time —
// the panel's, or one page of a tabs widget — which is docs/pages.md.

import { Button } from "@frediverse/ui/button";
import { cn } from "@frediverse/ui/lib/utils";
import {
  Activity,
  AudioWaveform,
  Circle,
  FileSearch,
  Hash,
  LayoutGrid,
  List,
  type LucideIcon,
  Minus,
  Plus,
  RectangleHorizontal,
  SlidersHorizontal,
  SlidersVertical,
  ToggleLeft,
  Trash2,
  Type,
  Wand2,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { type AutoParam, autoOrganize } from "./autoLayout";
import type { ModuleUI, Widget, WidgetType } from "./moduleUi";
import { isParamDrag, type ParamDrag, readParamDrag } from "./paramDrag";

// Row height in px (columns are elastic), in one place so the pointer→cell maths and the CSS grid agree.
const ROW_PX = 64;

const TYPES: { type: WidgetType; icon: LucideIcon; label: string }[] = [
  { type: "knob", icon: Circle, label: "Knob" },
  { type: "slider", icon: SlidersHorizontal, label: "Slider" },
  { type: "fader", icon: SlidersVertical, label: "Fader" },
  { type: "toggle", icon: ToggleLeft, label: "Toggle" },
  { type: "dropdown", icon: List, label: "Dropdown" },
  { type: "filepicker", icon: FileSearch, label: "File" },
  { type: "button", icon: RectangleHorizontal, label: "Button" },
  { type: "number", icon: Hash, label: "Number" },
  { type: "meter", icon: Activity, label: "Meter" },
  { type: "waveform", icon: AudioWaveform, label: "Waveform" },
  { type: "label", icon: Type, label: "Label" },
  { type: "tabs", icon: LayoutGrid, label: "Tabs" },
];

const ICON: Record<WidgetType, LucideIcon> = Object.fromEntries(
  TYPES.map((t) => [t.type, t.icon]),
) as Record<WidgetType, LucideIcon>;

// The track intrinsics that are on/off: only these are KNOWN discrete, so only these become a toggle on drop.
const TOGGLE_BINDS = new Set(["@mute", "@solo", "@arm"]);

// A bound widget's default label is the param's name; the "@" of an intrinsic goes, it marks a namespace.
const defaultLabel = (param: string) => param.replace(/^@/, "");

// What a fresh button says, named because binding treats it as "no label yet" — a bare "B" would be a mystery.
const BUTTON_PLACEHOLDER_LABEL = "B";
const hasOwnLabel = (w: Widget) =>
  !!w.label && !(w.type === "button" && w.label === BUTTON_PLACEHOLDER_LABEL);

// Which widget kinds carry a `bind`, and so the only three a dragged parameter can bounce off.
export const bindable = (w: Pick<Widget, "type">) =>
  w.type !== "label" && w.type !== "tabs" && w.type !== "waveform";

// …and which carry a RANGE. Not a dropdown: it addresses its param by named setting, and its options are the set.
const ranged = (w: Widget) =>
  w.type === "knob" ||
  w.type === "slider" ||
  w.type === "fader" ||
  w.type === "number";

// A parameter with named settings — what a dropdown is for.
const isDiscrete = (p: ParamDrag) => !!p.meta?.states?.length;

// Changing type must CLEAR the fields the new type lacks: a leftover fails validation and takes the graph down.

// Returns the type plus explicit undefineds; the caller merges, and writeUi drops undefined fields.
function retype(w: Widget, type: WidgetType): Partial<Widget> {
  const next: Widget = { ...w, type };
  return {
    type,
    text: type === "label" ? w.text : undefined,
    bind: bindable(next) ? w.bind : undefined,
    min: ranged(next) ? w.min : undefined,
    max: ranged(next) ? w.max : undefined,
    step: ranged(next) ? w.step : undefined,
    curve: ranged(next) ? w.curve : undefined,
    pages: type === "tabs" ? w.pages : undefined,
    source: type === "waveform" ? w.source : undefined,
    options: type === "dropdown" ? w.options : undefined,
    library: type === "dropdown" ? w.library : undefined,
  };
}

const span = (n?: number) => Math.max(1, n ?? 1);
const covers = (w: Widget, c: number, r: number) =>
  c >= w.col &&
  c < w.col + span(w.colSpan) &&
  r >= w.row &&
  r < w.row + span(w.rowSpan);

// The first free cell, row-major; it takes a MAP because a page's widgets are drawn alone.
function firstFree(
  widgets: Record<string, Widget>,
  cols: number,
  rows: number,
): { col: number; row: number } {
  const ws = Object.values(widgets);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (!ws.some((w) => covers(w, c, r))) return { col: c, row: r };
  return { col: 0, row: 0 }; // full grid — stack on the origin, the user can move it
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
}: {
  ui: ModuleUI;
  // The params taking a FILE, whose dropdown offers the module's own assets/ instead of settings.
  assetParams?: string[];
  /** Every parameter this module can bind — the SAME list the pane drags from; see docs/builder.md. */
  params?: readonly AutoParam[];
  /** WHY the grid takes no gesture: a reason, not a boolean, since only a FAULT warrants a warning. */
  disabled?: false | "unparsable" | "locked";
  onChange: (ui: ModuleUI) => void;
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
  // The widget a parameter is currently hovering over, so it can light up as the target.
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // Which gesture is live, so pointermove knows whether it's moving or resizing.
  const drag = useRef<{ id: string; mode: "move" | "resize" } | null>(null);

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
    const { col, row } = firstFree(widgets, ui.cols, ui.rows);
    const w: Widget =
      type === "label"
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
  const organize = () => {
    if (disabled || !params?.length) return;
    if (
      Object.keys(ui.widgets).length &&
      !window.confirm(
        "Replace this panel with one organized from the parameter list? What is drawn here now is discarded.",
      )
    )
      return;
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
      const c = Math.min(col, ui.cols - span(w.colSpan));
      const r = Math.min(row, ui.rows - span(w.rowSpan));
      if (c !== w.col || r !== w.row)
        patch(d.id, { col: Math.max(0, c), row: Math.max(0, r) });
    } else {
      const colSpan = Math.max(1, col - w.col + 1);
      const rowSpan = Math.max(1, row - w.row + 1);
      if (colSpan !== span(w.colSpan) || rowSpan !== span(w.rowSpan))
        patch(d.id, {
          colSpan: colSpan > 1 ? colSpan : undefined,
          rowSpan: rowSpan > 1 ? rowSpan : undefined,
        });
    }
  };

  const startDrag = (
    e: React.PointerEvent,
    id: string,
    mode: "move" | "resize",
  ) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(id);
    drag.current = { id, mode };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const endDrag = (e: React.PointerEvent) => {
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const sel = selected ? widgets[selected] : null;

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
            onClick={organize}
            title={
              params?.length
                ? `Replace the panel with ${params.length} parameters sorted into tabs, guessed from their names`
                : "No parameters to organize — scan the plugin or open a module that declares some"
            }
          >
            <Wand2 className="mr-1 h-3.5 w-3.5" />
            Auto organize
          </Button>
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
          {Object.entries(widgets).map(([id, w]) => {
            const Icon = ICON[w.type];
            const isSel = id === selected;
            return (
              <div
                key={id}
                onPointerDown={(e) => startDrag(e, id, "move")}
                // Dropping a parameter binds it — refused on kinds with no `bind`, rather than writing a field they don't read.
                onDragOver={(e) => {
                  if (disabled || !bindable(w) || !isParamDrag(e.dataTransfer))
                    return;
                  e.preventDefault(); // "yes, you may drop here"
                  e.dataTransfer.dropEffect = "copy";
                  if (dropTarget !== id) setDropTarget(id);
                }}
                onDragLeave={() => setDropTarget((t) => (t === id ? null : t))}
                onDrop={(e) => {
                  setDropTarget(null);
                  if (disabled || !bindable(w)) return;
                  const p = readParamDrag(e.dataTransfer);
                  if (!p) return;
                  e.preventDefault();
                  bindParam(id, w, p);
                }}
                className={cn(
                  "group relative m-0.5 flex flex-col items-center justify-center overflow-hidden rounded border bg-background/80 px-1 text-center",
                  disabled ? "cursor-default" : "cursor-move",
                  isSel
                    ? "border-primary ring-1 ring-primary"
                    : "border-border hover:border-primary/60",
                  dropTarget === id &&
                    "border-primary bg-primary/20 ring-2 ring-primary",
                  w.hidden && "opacity-40",
                )}
                style={{
                  gridColumn: `${w.col + 1} / span ${span(w.colSpan)}`,
                  gridRow: `${w.row + 1} / span ${span(w.rowSpan)}`,
                }}
                title={w.type === "label" ? w.text : w.bind}
              >
                {/* The glyph and the caption take no pointer, or they steal the tile's drag — ../docs/builder.md. */}
                <Icon className="pointer-events-none h-4 w-4 text-muted-foreground" />
                <span className="pointer-events-none mt-0.5 max-w-full truncate text-[10px] leading-tight text-foreground">
                  {w.type === "label"
                    ? w.text || "label"
                    : w.label || w.bind || w.type}
                </span>
                {!disabled && isSel && (
                  // resize handle (bottom-right)
                  <span
                    onPointerDown={(e) => startDrag(e, id, "resize")}
                    className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize rounded-tl bg-primary"
                  />
                )}
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
        <Inspector
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

// The field editor for the selected widget, mirroring #Widget's conditional shape (label vs bound vs numeric).
function Inspector({
  id,
  w,
  assetParams,
  disabled,
  onPatch,
  onBind,
  onDelete,
}: {
  id: string;
  w: Widget;
  assetParams?: string[];
  disabled?: boolean;
  onPatch: (w: Partial<Widget>) => void;
  /** Bind a dropped parameter, the SAME path a drop on the grid takes — range and settings and all. */
  onBind: (p: ParamDrag) => void;
  onDelete: () => void;
}) {
  const isLabel = w.type === "label";
  const isTabs = w.type === "tabs";
  const isWaveform = w.type === "waveform";
  // A file picker's `bind` is chosen from the File select below, so the bind chip steps aside.
  const isLibrary =
    w.type === "filepicker" || (w.type === "dropdown" && !!w.library);
  const numeric = ranged(w); // same predicate the drop path uses to adopt a range
  const num = (v: string): number | undefined => {
    const t = v.trim();
    if (t === "") return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  };

  // Whether a parameter is over the bind field — the ring that says the drop will land.
  const [over, setOver] = useState(false);

  const pages = w.pages ?? {};
  const pageNames = Object.keys(pages);

  const addPage = () => {
    const name = `Page ${pageNames.length + 1}`;
    onPatch({ pages: { ...pages, [name]: {} } });
  };
  const removePage = (name: string) => {
    const next = { ...pages };
    delete next[name];
    onPatch({ pages: Object.keys(next).length ? next : undefined });
  };
  const renamePage = (oldName: string, newName: string) => {
    if (oldName === newName || !newName.trim()) return;
    const next: Record<string, Record<string, Widget>> = {};
    for (const [k, v] of Object.entries(pages)) {
      next[k === oldName ? newName : k] = v;
    }
    onPatch({ pages: next });
  };

  return (
    <div className="max-h-[38%] shrink-0 space-y-2 overflow-auto border-t border-border bg-card/40 p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">
          {id} · {w.type}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={onDelete}
          title="Delete widget"
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          Delete
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Type">
          <select
            className={FIELD_CLS}
            value={w.type}
            disabled={!!disabled}
            onChange={(e) => onPatch(retype(w, e.target.value as WidgetType))}
          >
            {TYPES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>

        {isLabel ? (
          <Field label="Text">
            <input
              className={FIELD_CLS}
              value={w.text ?? ""}
              disabled={!!disabled}
              onChange={(e) => onPatch({ text: e.target.value })}
            />
          </Field>
        ) : isTabs || isWaveform || isLibrary ? null : (
          // Not a text field: a binding is DRAGGED, and both halves are the same drop target.
          <Field label="Bound param">
            <div
              onDragOver={(e) => {
                if (disabled || !isParamDrag(e.dataTransfer)) return;
                e.preventDefault(); // "yes, you may drop here"
                e.dataTransfer.dropEffect = "copy";
                if (!over) setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                setOver(false);
                if (disabled) return;
                const p = readParamDrag(e.dataTransfer);
                if (!p) return;
                e.preventDefault();
                onBind(p);
              }}
              // The children take no pointer, so every drag event lands on this div, not the chip.
              className={cn(
                "[&_*]:pointer-events-none",
                over && "rounded ring-2 ring-primary",
              )}
            >
              {w.bind ? (
                <div className="flex items-center gap-1">
                  <span
                    className="min-w-0 flex-1 truncate rounded border border-border bg-muted/40 px-2 py-1 font-mono text-xs"
                    title={w.bind}
                  >
                    {w.bind}
                  </span>
                  <button
                    type="button"
                    disabled={!!disabled}
                    onClick={() => onPatch({ bind: undefined })}
                    // …except this one, which is a control and has to stay clickable.
                    className="pointer-events-auto shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="Unbind"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="rounded border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
                  drag a parameter here
                </div>
              )}
            </div>
          </Field>
        )}

        <Field label="Label">
          <input
            className={FIELD_CLS}
            value={w.label ?? ""}
            disabled={!!disabled}
            placeholder="(optional)"
            onChange={(e) => onPatch({ label: e.target.value || undefined })}
          />
        </Field>

        {w.type === "filepicker" && (
          // WHICH file-valued param this picker sets — the whole configuration, so nothing can disagree.
          <Field label="File">
            <select
              className={FIELD_CLS}
              value={w.bind ?? ""}
              disabled={disabled || !assetParams?.length}
              onChange={(e) =>
                onPatch({
                  bind: e.target.value || undefined,
                  library: undefined,
                })
              }
            >
              <option value="">(pick a parameter)</option>
              {(assetParams ?? []).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
        )}

        {w.type === "dropdown" && !!w.library && (
          // The older spelling of a file picker, kept editable — packages/song/docs/filePicker.md.
          <Field label="Files (legacy)">
            <select
              className={FIELD_CLS}
              value={w.library ?? ""}
              disabled={disabled || !assetParams?.length}
              onChange={(e) => {
                const param = e.target.value;
                onPatch(
                  param
                    ? { library: param, bind: param, options: undefined }
                    : { library: undefined, bind: undefined },
                );
              }}
            >
              <option value="">(the parameter's settings)</option>
              {(assetParams ?? []).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
        )}

        {isWaveform && (
          <Field label="Source">
            <select
              className={FIELD_CLS}
              value={w.source ?? "output"}
              disabled={!!disabled}
              onChange={(e) =>
                onPatch({ source: e.target.value as "input" | "output" })
              }
            >
              <option value="output">Output</option>
              <option value="input">Input</option>
            </select>
          </Field>
        )}

        {numeric && (
          <>
            <Field label="Min">
              <input
                className={FIELD_CLS}
                inputMode="decimal"
                value={w.min ?? ""}
                disabled={!!disabled}
                onChange={(e) => onPatch({ min: num(e.target.value) })}
              />
            </Field>
            <Field label="Max">
              <input
                className={FIELD_CLS}
                inputMode="decimal"
                value={w.max ?? ""}
                disabled={!!disabled}
                onChange={(e) => onPatch({ max: num(e.target.value) })}
              />
            </Field>
            <Field label="Step">
              <input
                className={FIELD_CLS}
                inputMode="decimal"
                value={w.step ?? ""}
                disabled={!!disabled}
                placeholder="(optional)"
                onChange={(e) => onPatch({ step: num(e.target.value) })}
              />
            </Field>
            <Field label="Curve">
              <select
                className={FIELD_CLS}
                value={w.curve ?? "lin"}
                disabled={!!disabled}
                onChange={(e) =>
                  onPatch({
                    curve: e.target.value === "log" ? "log" : undefined,
                  })
                }
              >
                <option value="lin">lin</option>
                <option value="log">log</option>
              </select>
            </Field>
          </>
        )}

        {isTabs && (
          <div className="col-span-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Pages
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={!!disabled}
                onClick={addPage}
              >
                <Plus className="mr-1 h-3 w-3" /> Add page
              </Button>
            </div>
            {pageNames.map((name) => (
              <div key={name} className="flex items-center gap-1">
                <input
                  className={FIELD_CLS}
                  value={name}
                  disabled={!!disabled}
                  onChange={(e) => renamePage(name, e.target.value)}
                />
                <button
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                  disabled={!!disabled}
                  onClick={() => removePage(name)}
                  title="Remove page"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const FIELD_CLS =
  "w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-primary";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
