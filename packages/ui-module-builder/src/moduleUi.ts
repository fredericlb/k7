// moduleUi.ts — the bridge between a module file's text and the visual widget editor:
// read its `ui:` block into a model, write an edited model back, and resolve `extends` so
// "edit the base module" finds the right file. Runs in the BROWSER (the grid edits the
// editor's buffer) and shares the loader's Zod schema, so the grid can't offer a widget
// the file would be refused for. Writing the block REPLACES it: comments inside don't survive.

import { panelWidgets } from "@studio/graph-model/panel";
import {
  DEFAULT_MODULE_STATUS,
  IO_MODULES,
  META_NS,
  type ModuleStatus,
  moduleStatusOf,
} from "@studio/song-schema/moduleTypes";
import {
  type ModuleUI,
  UISchema,
  type Widget,
} from "@studio/song-schema/yaml/moduleSchema";
import { isMap, parseDocument } from "yaml";

export type {
  ModuleUI,
  Widget,
  WidgetType,
} from "@studio/song-schema/yaml/moduleSchema";
export { WIDGETS_SCRIPT } from "@studio/song-schema/yaml/moduleSchema";

const OPTS = { version: "1.2" as const, lineWidth: 0 };

/** Does the panel draw a screen anywhere, on any tab? That is what earns widgets.js a tab. */
export function hasLcd(ui: ModuleUI | null): boolean {
  return panelWidgets(ui).some(([, w]) => w.type === "lcdscreen");
}

/** A fresh, empty UI for a file that has none yet — small enough to see the whole grid. */
export const EMPTY_UI: ModuleUI = { cols: 4, rows: 2, widgets: {} };

/** How many cells a knob takes in an AUTO-ORGANISED panel, and only there — see docs/builder.md. */
export const KNOB_SPAN = 2;

/** The document, or null when the text doesn't parse at all (mid-keystroke). */
function docOf(fileText: string): ReturnType<typeof parseDocument> | null {
  try {
    const doc = parseDocument(fileText, OPTS);
    return doc.errors.length ? null : doc;
  } catch {
    return null;
  }
}

/** The `ui:` block validated, or null; through `toJS` and never `getIn` — see docs/builder.md. */
function parseUi(fileText: string): ModuleUI | null {
  const doc = docOf(fileText);
  if (!doc) return null;
  const raw = (doc.toJS() as { ui?: unknown } | null)?.ui;
  if (raw === undefined || raw === null) return null;
  const r = UISchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** The authored `ui:` block, or an empty grid when there is none this can read. */
export function readUi(fileText: string): ModuleUI {
  return parseUi(fileText) ?? { ...EMPTY_UI, widgets: {} };
}

/** Whether the `ui:` block round-trips; when false the right pane warns rather than misreading it. */
export function hasParsableUi(fileText: string): boolean {
  return parseUi(fileText) !== null;
}

/** True only when a `ui:` block is PRESENT and unreadable; absence is not malformed. */
export function hasMalformedUi(fileText: string): boolean {
  const doc = docOf(fileText);
  if (!doc) return false; // the file doesn't parse at all; that is the code editor's news
  const raw = (doc.toJS() as { ui?: unknown } | null)?.ui;
  return raw !== undefined && raw !== null && parseUi(fileText) === null;
}

/** The `params:` block as name -> value as TEXT, never numbers — see docs/builder.md. */
export function readParams(fileText: string): Record<string, string> {
  const doc = docOf(fileText);
  if (!doc) return {};
  const params = doc.getIn(["params"]);
  if (!isMap(params)) return {};
  const out: Record<string, string> = {};
  for (const item of params.items) {
    const key = (item.key as { value?: unknown })?.value;
    if (typeof key !== "string") continue;
    const value = (item.value as { value?: unknown })?.value;
    if (value !== undefined) out[key] = String(value);
  }
  return out;
}

// A widget as MINIMAL source: drop defaults and empty optionals, so the block stays as terse as a hand-written one.
function widgetToPlain(w: Widget): Record<string, unknown> {
  const isLabel = w.type === "label";
  const isWaveform = w.type === "waveform";
  const isLcd = w.type === "lcdscreen";
  const isGroup = w.type === "group";
  const isDropdown = w.type === "dropdown";
  const isRanged =
    w.type === "knob" ||
    w.type === "slider" ||
    w.type === "fader" ||
    w.type === "number";
  return {
    type: w.type,
    col: w.col,
    row: w.row,
    colSpan: w.colSpan && w.colSpan > 1 ? w.colSpan : undefined,
    rowSpan: w.rowSpan && w.rowSpan > 1 ? w.rowSpan : undefined,
    label: w.label || undefined,
    text: isLabel ? w.text || undefined : undefined,
    bind: !isLabel && !isWaveform && !isLcd ? w.bind || undefined : undefined,
    // Range fields belong to the NUMERIC kinds only: a `min` on a toggle fails to load — docs/builder.md.
    min: isRanged ? w.min : undefined,
    max: isRanged ? w.max : undefined,
    step: isRanged ? w.step : undefined,
    curve: isRanged ? w.curve : undefined,
    hidden: w.hidden ? true : undefined,
    source: isWaveform ? (w.source ?? "output") : undefined,
    // A dropdown's settings, written out in full: the module must draw the same with no engine to re-fetch them.
    options: isDropdown && w.options?.length ? w.options : undefined,
    // …or the library its choices come from. Both are written when both are set: the file says what the author put.
    library: isDropdown ? w.library || undefined : undefined,
    color: isGroup ? w.color || undefined : undefined,
    // Written only on a group that binds: without a switch there is nothing to read backwards.
    invert: isGroup && w.bind && w.invert ? true : undefined,
    pair: w.type === "knob" ? w.pair || undefined : undefined,
  };
}

/** Drop the `undefined` entries, recursively — they are "not written", not "written null". */
function prune(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(prune);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      if (v !== undefined) out[k] = prune(v);
    return out;
  }
  return value;
}

const plainWidgets = (ws: Record<string, Widget>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(ws).map(([id, w]) => [id, widgetToPlain(w)]),
  );

function uiToPlain(ui: ModuleUI): Record<string, unknown> {
  return prune({
    cols: ui.cols,
    rows: ui.rows,
    widgets: plainWidgets(ui.widgets),
    // Written only when there ARE tabs: a one-page panel has no list, the second tab is what makes one.
    tabs: ui.tabs?.length
      ? ui.tabs.map((t) => ({ name: t.name, widgets: plainWidgets(t.widgets) }))
      : undefined,
    // The narrow twin, written the same way (layouts.md).
    vertical: ui.vertical
      ? {
          cols: ui.vertical.cols,
          rows: ui.vertical.rows,
          widgets: plainWidgets(ui.vertical.widgets),
          tabs: ui.vertical.tabs?.length
            ? ui.vertical.tabs.map((t) => ({
                name: t.name,
                widgets: plainWidgets(t.widgets),
              }))
            : undefined,
        }
      : undefined,
  }) as Record<string, unknown>;
}

/** Rewrite the file's `ui:` block from the model, leaving every other line untouched. */
export function writeUi(fileText: string, ui: ModuleUI): string {
  const doc = parseDocument(fileText, OPTS);
  const node = doc.createNode(uiToPlain(ui));
  flowPanel(node);
  doc.setIn(["ui"], node);
  return doc.toString({ lineWidth: 0 });
}

/** Put each widget on ONE flow line — what keeps moving a knob a one-line diff. */
function flowWidgets(widgets: unknown): void {
  if (!isMap(widgets)) return;
  for (const item of widgets.items) {
    const w = item.value as { flow?: boolean };
    if (w && typeof w === "object") w.flow = true;
  }
}

/** …on the panel's own widgets and on every tab's, a tab's name staying on its own line above them. */
function flowPanel(panel: unknown): void {
  const p = panel as { getIn?(path: unknown[]): unknown } | null;
  flowWidgets(p?.getIn?.(["widgets"]));
  const tabs = p?.getIn?.(["tabs"]) as { items?: unknown[] } | undefined;
  for (let i = 0; i < (tabs?.items?.length ?? 0); i++)
    flowWidgets(p?.getIn?.(["tabs", i, "widgets"]));
}

// --- `ui.yaml` panel files -----------------------------------------------------

// The same model at the TOP level of its own file, so it needs its own functions — see docs/builder.md.

/** The panel a `ui.yaml` declares, or null when the text isn't one this can round-trip. */
function parseUiFileText(text: string): ModuleUI | null {
  const doc = docOf(text);
  if (!doc) return null;
  const raw = doc.toJS() as Record<string, unknown> | null;
  if (!raw) return null;
  const r = UISchema.safeParse({
    cols: raw.cols,
    rows: raw.rows,
    widgets: raw.widgets,
    ...(raw.tabs !== undefined ? { tabs: raw.tabs } : {}),
    ...(raw.vertical !== undefined ? { vertical: raw.vertical } : {}),
  });
  return r.success ? r.data : null;
}

/** A `ui.yaml`'s panel, or an empty grid when it has none this can read. */
export function readUiFile(text: string): ModuleUI {
  return parseUiFileText(text) ?? { ...EMPTY_UI, widgets: {} };
}

/** True only when the file HAS a panel this can't read — an empty file is not malformed. */
export function hasMalformedUiFile(text: string): boolean {
  const doc = docOf(text);
  if (!doc) return false; // doesn't parse at all; that's the code editor's news
  const raw = doc.toJS() as Record<string, unknown> | null;
  const stated = raw?.cols !== undefined || raw?.widgets !== undefined;
  return stated && parseUiFileText(text) === null;
}

/** Rewrite a `ui.yaml`'s grid key by key, so its header comment survives — see docs/builder.md. */
export function writeUiFile(text: string, ui: ModuleUI): string {
  const doc = parseDocument(text, OPTS);
  const plain = uiToPlain(ui);
  const widgets = doc.createNode(plain.widgets);
  flowWidgets(widgets);
  doc.setIn(["cols"], plain.cols);
  doc.setIn(["rows"], plain.rows);
  doc.setIn(["widgets"], widgets);
  if (plain.tabs) {
    const tabs = doc.createNode(plain.tabs);
    doc.setIn(["tabs"], tabs);
    flowPanel(doc);
  } else doc.delete("tabs");
  // The vertical layout as a block of its own, its widgets one a line like the panel's.
  if (plain.vertical) {
    const vertical = doc.createNode(plain.vertical);
    flowPanel(vertical);
    doc.setIn(["vertical"], vertical);
  } else doc.delete("vertical");
  return doc.toString({ lineWidth: 0 });
}

/** The `plugin:` block a module declares, off the FILE and SHALLOW on purpose — see docs/builder.md. */
export function readPlugin(
  fileText: string,
): { type: string; name: string } | null {
  const raw = (docOf(fileText)?.toJS() as { plugin?: unknown } | null)?.plugin;
  const p = raw as { type?: unknown; name?: unknown } | null | undefined;
  if (!p || typeof p !== "object") return null;
  if (typeof p.type !== "string" || typeof p.name !== "string") return null;
  return { type: p.type, name: p.name };
}

/** A module's `io:` direction, from THREE sources because a module rarely says it — see docs/builder.md. */
export function ioOf(fileText: string, path?: string): string | null {
  const io = docOf(fileText)?.get("io");
  if (typeof io === "string" && io) return io;

  const base = extendsRefOf(fileText);
  const engine = base?.startsWith(`${META_NS}/`)
    ? IO_MODULES[base.slice(META_NS.length + 1)]
    : undefined;
  if (engine) return engine.io;

  // The two-segment shape matched here rather than borrowed: this needs only the pair, not the root.
  const parts = (path ?? "").split(/[/\\]/);
  for (let i = 0; i + 1 < parts.length; i++)
    if (parts[i] === "io" && IO_MODULES[parts[i + 1]])
      return IO_MODULES[parts[i + 1]].io;
  return null;
}

/** The channels an `io: in` module declares, AS AUTHORED — two spellings; see docs/builder.md. */
export function channelOf(fileText: string): number[] | string | null {
  const ch = docOf(fileText)?.toJS?.()?.channel;
  if (typeof ch === "string") return ch || null;
  if (Array.isArray(ch)) {
    const ns = ch.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    return ns.length ? ns : null;
  }
  return null;
}

/** Point an `io: in` module at interface channels, written as a FLOW sequence — see docs/builder.md. */
export function setChannelIn(fileText: string, channels: number[]): string {
  const doc = parseDocument(fileText, OPTS);
  const node = doc.createNode(channels);
  // `flow` on the NODE, not at stringify time: a document-wide setting would reflow every other list.
  (node as { flow?: boolean }).flow = true;
  doc.setIn(["channel"], node);
  return doc.toString({ lineWidth: 0 });
}

/** How this module asks the completions to treat it, read off the TEXT so an unsaved edit shows. */
export function statusOf(fileText: string): ModuleStatus {
  return moduleStatusOf(docOf(fileText)?.toJS?.());
}

/** Set it, or CLEAR it — the DEFAULT is never written; see docs/builder.md. */
export function setStatusIn(fileText: string, status: ModuleStatus): string {
  const doc = parseDocument(fileText, OPTS);
  if (status === DEFAULT_MODULE_STATUS) doc.delete("status");
  else doc.setIn(["status"], status);
  return doc.toString({ lineWidth: 0 });
}

/** A module file's `extends:` ref, for resolving the base's file; null when absent. */
export function extendsRefOf(fileText: string): string | null {
  const ref = docOf(fileText)?.get("extends");
  return typeof ref === "string" && ref ? ref : null;
}
