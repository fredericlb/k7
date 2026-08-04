// WidgetGridEditor.tsx — the visual half of the module editor: a module's UI grid,
// authored by placing widgets on cells instead of writing YAML. It owns nothing — every
// edit produces a fresh ModuleUI and calls onChange. A widget is bound by DRAGGING a row
// from the Parameters pane (paramDrag.ts), which carries the range with it, so this
// component needs to know nothing about the engine.

import { Button } from "@frediverse/ui/button";
import { cn } from "@frediverse/ui/lib/utils";
import {
  Activity,
  AudioWaveform,
  Circle,
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
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
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

// Which widget kinds carry a `bind` — a label shows fixed text, tabs/waveform aren't parameter controls.
const bindable = (w: Widget) =>
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

// The first cell (row-major) no widget covers — where a freshly added widget lands.
function firstFree(ui: ModuleUI): { col: number; row: number } {
  const ws = Object.values(ui.widgets);
  for (let r = 0; r < ui.rows; r++)
    for (let c = 0; c < ui.cols; c++)
      if (!ws.some((w) => covers(w, c, r))) return { col: c, row: r };
  return { col: 0, row: 0 }; // full grid — stack on the origin, the user can move it
}

// A stable, unused id. Ids are the base→module override key, so existing widgets must never renumber.
function nextId(widgets: Record<string, Widget>): string {
  for (let i = 1; ; i++) if (!widgets[`w${i}`]) return `w${i}`;
}

export function WidgetGridEditor({
  ui,
  assetParams,
  disabled,
  onChange,
}: {
  ui: ModuleUI;
  // The params that take a FILE rather than a number (moduleTypes.FILE_PARAMS) — a dropdown
  // bound to one offers the module's own assets/ instead of the param's settings.
  assetParams?: string[];
  // The `ui:` block wouldn't parse: show the grid read-only so a save can't clobber text we misread.
  disabled?: boolean;
  onChange: (ui: ModuleUI) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  // The widget a parameter is currently hovering over, so it can light up as the target.
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // Which gesture is live, so pointermove knows whether it's moving or resizing.
  const drag = useRef<{ id: string; mode: "move" | "resize" } | null>(null);

  const patch = useCallback(
    (id: string, w: Partial<Widget>) =>
      onChange({
        ...ui,
        widgets: { ...ui.widgets, [id]: { ...ui.widgets[id], ...w } },
      }),
    [ui, onChange],
  );

  const setGrid = (d: Partial<Pick<ModuleUI, "cols" | "rows">>) =>
    onChange({ ...ui, ...d });

  // Adopt a dropped param's range only while the widget still sits on the placeholder 0..1 — an edited one is the
  // author's. The range is written into the `ui:` block, so the module opens the same with no engine running.
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
    const id = nextId(ui.widgets);
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
    onChange({ ...ui, widgets: { ...ui.widgets, [id]: w } });
    setSelected(id);
  };

  const addWidget = (type: WidgetType) => {
    if (disabled) return;
    const id = nextId(ui.widgets);
    const { col, row } = firstFree(ui);
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
    onChange({ ...ui, widgets: { ...ui.widgets, [id]: w } });
    setSelected(id);
  };

  const removeWidget = (id: string) => {
    const widgets = { ...ui.widgets };
    delete widgets[id];
    onChange({ ...ui, widgets });
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
    const w = ui.widgets[d.id];
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

  const sel = selected ? ui.widgets[selected] : null;

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
            disabled={disabled}
            onClick={() => addWidget(t.type)}
            title={`Add ${t.label}`}
          >
            <t.icon className="mr-1 h-3.5 w-3.5" />
            {t.label}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-3">
          <Stepper
            label="cols"
            value={ui.cols}
            min={1}
            disabled={disabled}
            onChange={(cols) => setGrid({ cols })}
          />
          <Stepper
            label="rows"
            value={ui.rows}
            min={1}
            disabled={disabled}
            onChange={(rows) => setGrid({ rows })}
          />
        </div>
      </div>

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
          {/* Empty cell guides — and drop targets: a parameter dropped on bare grid
              creates the widget for it, rather than making you add one first and then
              bind it. A cell under a widget is covered by that widget (later in the DOM,
              so it takes the drop), which is what keeps the two paths from overlapping. */}
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

          {/* placed widgets */}
          {Object.entries(ui.widgets).map(([id, w]) => {
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
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="mt-0.5 max-w-full truncate text-[10px] leading-tight text-foreground">
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
        {disabled && (
          <p className="mt-3 text-xs text-amber-500">
            This file's <code>ui:</code> block couldn't be parsed for visual
            editing — edit it as text on the left. Fixing it re-enables the
            grid.
          </p>
        )}
        {!disabled && !Object.keys(ui.widgets).length && (
          <p className="mt-3 text-xs text-muted-foreground">
            Empty grid — add a widget above, then drag to place and resize it.
          </p>
        )}
      </div>

      {/* inspector */}
      {sel && selected && (
        <Inspector
          id={selected}
          w={sel}
          assetParams={assetParams}
          disabled={disabled}
          onPatch={(p) => patch(selected, p)}
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
  onDelete,
}: {
  id: string;
  w: Widget;
  assetParams?: string[];
  disabled?: boolean;
  onPatch: (w: Partial<Widget>) => void;
  onDelete: () => void;
}) {
  const isLabel = w.type === "label";
  const isTabs = w.type === "tabs";
  const isWaveform = w.type === "waveform";
  // A library dropdown's `bind` names a FIELD OF THE MODULE, set with the library — so the bind chip steps aside.
  const isLibrary = w.type === "dropdown" && !!w.library;
  const numeric = ranged(w); // same predicate the drop path uses to adopt a range
  const num = (v: string): number | undefined => {
    const t = v.trim();
    if (t === "") return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  };

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
            disabled={disabled}
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
              disabled={disabled}
              onChange={(e) => onPatch({ text: e.target.value })}
            />
          </Field>
        ) : isTabs || isWaveform || isLibrary ? null : (
          // Read-only: a binding is made by dragging a row from the Parameters list. The chip names it, and clears it.
          <Field label="Bound param">
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
                  disabled={disabled}
                  onClick={() => onPatch({ bind: undefined })}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
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
          </Field>
        )}

        <Field label="Label">
          <input
            className={FIELD_CLS}
            value={w.label ?? ""}
            disabled={disabled}
            placeholder="(optional)"
            onChange={(e) => onPatch({ label: e.target.value || undefined })}
          />
        </Field>

        {w.type === "dropdown" && (
          // Where a dropdown's choices come from: empty = the bound param's own settings, else
          // the module's assets/ — the files a file-valued param can be set to.
          <Field label="Files">
            <select
              className={FIELD_CLS}
              value={w.library ?? ""}
              disabled={disabled || !assetParams?.length}
              onChange={(e) => {
                const param = e.target.value;
                onPatch(
                  param
                    ? // The param names both the key written and the files offered, so choosing
                      // one fills the binding too and the old param's settings go with it.
                      { library: param, bind: param, options: undefined }
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
              disabled={disabled}
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
                disabled={disabled}
                onChange={(e) => onPatch({ min: num(e.target.value) })}
              />
            </Field>
            <Field label="Max">
              <input
                className={FIELD_CLS}
                inputMode="decimal"
                value={w.max ?? ""}
                disabled={disabled}
                onChange={(e) => onPatch({ max: num(e.target.value) })}
              />
            </Field>
            <Field label="Step">
              <input
                className={FIELD_CLS}
                inputMode="decimal"
                value={w.step ?? ""}
                disabled={disabled}
                placeholder="(optional)"
                onChange={(e) => onPatch({ step: num(e.target.value) })}
              />
            </Field>
            <Field label="Curve">
              <select
                className={FIELD_CLS}
                value={w.curve ?? "lin"}
                disabled={disabled}
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
                disabled={disabled}
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
                  disabled={disabled}
                  onChange={(e) => renamePage(name, e.target.value)}
                />
                <button
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                  disabled={disabled}
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
