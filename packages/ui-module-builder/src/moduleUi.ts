// moduleUi.ts — the bridge between a module file's text and the visual widget editor:
// read its `ui:` block into a model, write an edited model back, and resolve `extends` so
// "edit the base module" finds the right file. Runs in the BROWSER (the grid edits the
// editor's buffer) and shares the loader's Zod schema, so the grid can't offer a widget
// the file would be refused for. Writing the block REPLACES it: comments inside don't survive.

import {
  type ModuleUI,
  PresetsFileSchema,
  UISchema,
  type Widget,
} from "@studio/song/yaml/moduleSchema";
import { isMap, parseDocument } from "yaml";

export type {
  ModuleUI,
  Widget,
  WidgetType,
} from "@studio/song/yaml/moduleSchema";

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

// --- `ui.yaml` panel files -----------------------------------------------------
//
// The same model, in a file of its own: `cols`/`rows`/`widgets` at the TOP level, with nothing naming the
// module — the folder it sits in does that (see uiLibrary.ts). Separate functions rather than a path parameter,
// because the two shapes differ at the root: you cannot `setIn([])` a document.

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

/**
 * Rewrite a `ui.yaml`'s grid from the model, leaving every comment around it alone.
 *
 * Key by key rather than replacing the document: the header comment names the module the panel was drawn for,
 * and a whole-document write would drop it along with anything else an author wrote in the margins.
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
 * The interface channels an `io: in` module declares, as AUTHORED.
 *
 * Two spellings, and they are not the same question. A list of numbers is the rig's channels
 * directly (`[1]` mono, `[1, 2]` stereo). A STRING is a label from the machine's preferences,
 * resolved to numbers by whoever has them (`@studio/song`'s `resolveInput`) — a rig's own
 * naming, which this editor must not silently rewrite into numbers.
 *
 * Null when the module declares none, which is an ordinary state: an input with no channel is
 * one nobody has pointed at a socket yet.
 */
export function channelOf(fileText: string): number[] | string | null {
  const ch = docOf(fileText)?.toJS?.()?.channel;
  if (typeof ch === "string") return ch || null;
  if (Array.isArray(ch)) {
    const ns = ch.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    return ns.length ? ns : null;
  }
  return null;
}

/**
 * Point an `io: in` module at a set of interface channels.
 *
 * Written as a FLOW sequence (`channel: [1, 2]`), which is how every input in this repo is
 * written and how the docs show it: a two-element block list costs three lines to say one
 * thing. Through the Document API like every other edit here, so the comments and the key
 * order of a file somebody hand-wrote survive it.
 */
export function setChannelIn(fileText: string, channels: number[]): string {
  const doc = parseDocument(fileText, OPTS);
  const node = doc.createNode(channels);
  // `flow` is set on the node rather than at stringify time: only THIS sequence should be
  // inline, and a document-wide setting would reflow every other list in the file.
  (node as { flow?: boolean }).flow = true;
  doc.setIn(["channel"], node);
  return doc.toString({ lineWidth: 0 });
}

/**
 * A module file's `extends:` ref (e.g. "instruments/drumrack"), for resolving the base
 * module's file when the user chooses "edit the base module". Null when absent.
 */
export function extendsRefOf(fileText: string): string | null {
  const ref = docOf(fileText)?.get("extends");
  return typeof ref === "string" && ref ? ref : null;
}

// --- `presets.yaml` — the module's named settings ---------------------------------
//
// `<name>: { <param>: <number> }` at the top level, and the folder says which module (see `@studio/song`'s
// presets.ts). Read here rather than fetched as a list, because the builder edits the FILE like the other two:
// a shelf is something you type into as readily as you click.

/** The shelf a `presets.yaml` declares. A file the schema refuses reads as EMPTY — one bad shelf costs its
 *  presets, never the module. */
export function readPresetsFile(
  text: string,
): Record<string, Record<string, number>> {
  const doc = docOf(text);
  const raw = doc?.toJS() as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") return {};
  const r = PresetsFileSchema.safeParse(raw);
  return r.success ? r.data : {};
}

/** True only when the file HAS content this can't read — an empty shelf is not malformed. */
export function hasMalformedPresets(text: string): boolean {
  const doc = docOf(text);
  if (!doc) return false; // doesn't parse at all; that's the code editor's news
  const raw = doc.toJS() as Record<string, unknown> | null;
  return (
    !!raw &&
    Object.keys(raw).length > 0 &&
    !PresetsFileSchema.safeParse(raw).success
  );
}

/**
 * Stamp a preset's values onto a module file's `params:`, leaving every other line untouched.
 *
 * Applying a preset is an EDIT to the module file and nothing more — there is no state to push and no engine
 * to ask. It lands in the buffer, so it is visible before it is saved and undoable by not saving.
 */
export function applyPresetToText(
  fileText: string,
  values: Record<string, number>,
): string {
  const doc = parseDocument(fileText, OPTS);
  for (const [name, value] of Object.entries(values))
    doc.setIn(["params", name], value);
  return doc.toString({ lineWidth: 0 });
}
