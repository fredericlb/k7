// moduleUi.ts — the bridge between a module file's text and the visual widget editor:
// read its `ui:` block into a model, write an edited model back, and resolve `extends` so
// "edit the base module" finds the right file. Runs in the BROWSER (the grid edits the
// editor's buffer) and shares the loader's Zod schema, so the grid can't offer a widget
// the file would be refused for. Writing the block REPLACES it: comments inside don't survive.

import {
  type ModuleUI,
  UISchema,
  type Widget,
} from "@lanes/song/yaml/moduleSchema";
import { isMap, parseDocument } from "yaml";

export type {
  ModuleUI,
  Widget,
  WidgetType,
} from "@lanes/song/yaml/moduleSchema";

const OPTS = { version: "1.2" as const, lineWidth: 0 };

/** A fresh, empty UI for a file that has none yet — small enough to see the whole grid. */
export const EMPTY_UI: ModuleUI = { cols: 4, rows: 2, widgets: {} };

/** The document, or null when the text doesn't parse at all (mid-keystroke). */
function docOf(fileText: string): ReturnType<typeof parseDocument> | null {
  try {
    const doc = parseDocument(fileText, OPTS);
    return doc.errors.length ? null : doc;
  } catch {
    return null;
  }
}

/**
 * The `ui:` block as a validated model, or null when there isn't one this can read.
 *
 * Through `toJS`, not `getIn`: `getIn` hands back the NODE, and a YAMLMap has none of the
 * properties a schema looks for — every field reads as undefined and a perfectly good block
 * is reported malformed.
 */
function parseUi(fileText: string): ModuleUI | null {
  const doc = docOf(fileText);
  if (!doc) return null;
  const raw = (doc.toJS() as { ui?: unknown } | null)?.ui;
  if (raw === undefined || raw === null) return null;
  const r = UISchema.safeParse(raw);
  return r.success ? r.data : null;
}

/**
 * The file's authored `ui:` block as a model, or an empty grid when it has none (or one
 * this can't read — the caller can still edit the text directly).
 */
export function readUi(fileText: string): ModuleUI {
  return parseUi(fileText) ?? { ...EMPTY_UI, widgets: {} };
}

/**
 * Whether the file has a `ui:` block this editor can round-trip. When false the right pane
 * warns and stays read-only rather than silently replacing text it misread.
 */
export function hasParsableUi(fileText: string): boolean {
  return parseUi(fileText) !== null;
}

/**
 * True only when the file HAS a `ui:` block that this can't read. Absence is NOT malformed
 * — the grid can create one from scratch.
 */
export function hasMalformedUi(fileText: string): boolean {
  const doc = docOf(fileText);
  if (!doc) return false; // the file doesn't parse at all; that is the code editor's news
  const raw = (doc.toJS() as { ui?: unknown } | null)?.ui;
  return raw !== undefined && raw !== null && parseUi(fileText) === null;
}

/**
 * The values the file's `params:` block sets, as name -> the value as TEXT.
 *
 * Text, not numbers: the params pane only displays them, and a value the schema would
 * refuse should still be readable — showing what is actually in the file is the point.
 * A missing or unreadable `params:` is an empty map, never an error.
 */
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
  const isTabs = w.type === "tabs";
  const isWaveform = w.type === "waveform";
  const isDropdown = w.type === "dropdown";
  const isRanged =
    w.type === "knob" ||
    w.type === "slider" ||
    w.type === "fader" ||
    w.type === "number";
  const pages: Record<string, unknown> | undefined =
    isTabs && w.pages
      ? Object.fromEntries(
          Object.entries(w.pages).map(([name, widgets]) => [
            name,
            Object.fromEntries(
              Object.entries(widgets).map(([id, sub]) => [
                id,
                widgetToPlain(sub),
              ]),
            ),
          ]),
        )
      : undefined;
  return {
    type: w.type,
    col: w.col,
    row: w.row,
    colSpan: w.colSpan && w.colSpan > 1 ? w.colSpan : undefined,
    rowSpan: w.rowSpan && w.rowSpan > 1 ? w.rowSpan : undefined,
    label: w.label || undefined,
    text: isLabel ? w.text || undefined : undefined,
    bind: !isLabel && !isTabs && !isWaveform ? w.bind || undefined : undefined,
    // Range fields belong to the NUMERIC kinds only: a `min` on a toggle fails to load and takes the graph node with
    // it. The old "not label/tabs/waveform" test held only until a knob was retyped into one of them.
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
    pages,
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

function uiToPlain(ui: ModuleUI): Record<string, unknown> {
  const widgets: Record<string, unknown> = {};
  for (const [id, w] of Object.entries(ui.widgets))
    widgets[id] = widgetToPlain(w);
  return prune({ cols: ui.cols, rows: ui.rows, widgets }) as Record<
    string,
    unknown
  >;
}

/**
 * Rewrite (or create) the file's `ui:` block from the model, leaving every other line
 * untouched. This is what the visual editor's changes flow through on their way to the
 * code editor's text.
 *
 * Each widget is written as ONE flow mapping — `w1: { type: knob, col: 0, row: 0 }` — the
 * shape these files already have by hand, and what keeps moving a knob to a one-line diff.
 */
export function writeUi(fileText: string, ui: ModuleUI): string {
  const doc = parseDocument(fileText, OPTS);
  const node = doc.createNode(uiToPlain(ui));
  flowWidgets(node.getIn?.(["widgets"]));
  doc.setIn(["ui"], node);
  return doc.toString({ lineWidth: 0 });
}

/** Put each widget on ONE flow line — what keeps moving a knob a one-line diff. */
function flowWidgets(widgets: unknown): void {
  if (!isMap(widgets)) return;
  for (const item of widgets.items) {
    const w = item.value as { flow?: boolean };
    // …except a `tabs`, whose pages are a nested structure worth reading down the page.
    if (
      w &&
      typeof w === "object" &&
      !(w as { has?(k: string): boolean }).has?.("pages")
    )
      w.flow = true;
  }
}

// --- `_ui` panel files ---------------------------------------------------------
//
// The same model, in a file of its own: `cols`/`rows`/`widgets` at the TOP level beside a `ref:` naming the
// module (see uiLibrary.ts). Separate functions rather than a path parameter, because the two shapes differ at
// the root — you cannot `setIn([])` a document — and because a panel file's `ref:` must survive every write.

/** The panel a `_ui` file declares, or null when the text isn't one this can round-trip. */
function parseUiFileText(text: string): ModuleUI | null {
  const doc = docOf(text);
  if (!doc) return null;
  const raw = doc.toJS() as Record<string, unknown> | null;
  if (!raw) return null;
  const r = UISchema.safeParse({
    cols: raw.cols,
    rows: raw.rows,
    widgets: raw.widgets,
  });
  return r.success ? r.data : null;
}

/** A `_ui` file's panel, or an empty grid when it has none this can read. */
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

/** The module a `_ui` file draws, or null. Read-only here — the editor never rewrites it. */
export function refOfUiFile(text: string): string | null {
  const ref = docOf(text)?.get("ref");
  return typeof ref === "string" && ref ? ref : null;
}

/**
 * Rewrite a `_ui` file's grid from the model, leaving `ref:` and every comment around it alone.
 *
 * Key by key rather than replacing the document, because the file is the one thing that says which module the
 * panel belongs to: a whole-document write that dropped `ref:` would orphan the panel silently.
 */
export function writeUiFile(text: string, ui: ModuleUI): string {
  const doc = parseDocument(text, OPTS);
  const plain = uiToPlain(ui);
  const widgets = doc.createNode(plain.widgets);
  flowWidgets(widgets);
  doc.setIn(["cols"], plain.cols);
  doc.setIn(["rows"], plain.rows);
  doc.setIn(["widgets"], widgets);
  return doc.toString({ lineWidth: 0 });
}

/**
 * A module file's `io:` direction ("in" / "out" / …), or null when it declares none — i.e. when it is an
 * ordinary plugin module. What an INPUT can be bound to differs from what a plugin can (see IO_IN_BINDS).
 */
export function ioOf(fileText: string): string | null {
  const io = docOf(fileText)?.get("io");
  return typeof io === "string" && io ? io : null;
}

/**
 * A module file's `extends:` ref (e.g. "instruments/drumrack"), for resolving the base
 * module's file when the user chooses "edit the base module". Null when absent.
 */
export function extendsRefOf(fileText: string): string | null {
  const ref = docOf(fileText)?.get("extends");
  return typeof ref === "string" && ref ? ref : null;
}
