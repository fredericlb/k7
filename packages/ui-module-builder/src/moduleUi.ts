// moduleUi.ts — the bridge between a module file's k7x text and the visual widget editor:
// read its `ui(…)` block into a model, write an edited model back, and resolve `extends` so
// "edit the base module" finds the right file. Runs in the BROWSER (the grid edits the
// editor's buffer) and shares the loader's Zod schema, so the grid can't offer a widget
// the file would be refused for. Writes edit the document value by value (panelWrite.ts).

import { panelWidgets } from "@studio/graph-model/panel";
import { K7Document, type K7Scope } from "@studio/k7x/document";
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
import { mergeLayout, panelSource, writePanelFile } from "./panelWrite";

export type {
  ModuleUI,
  Widget,
  WidgetType,
} from "@studio/song-schema/yaml/moduleSchema";
export { WIDGETS_SCRIPT } from "@studio/song-schema/yaml/moduleSchema";

/** Does the panel draw a screen anywhere, on any tab? That is what earns widgets.js a tab. */
export function hasLcd(ui: ModuleUI | null): boolean {
  return panelWidgets(ui).some(([, w]) => w.type === "lcdscreen");
}

/** A fresh, empty UI for a file that has none yet — small enough to see the whole grid. */
export const EMPTY_UI: ModuleUI = { cols: 4, rows: 2, widgets: {} };

/** How many cells a knob takes in an AUTO-ORGANISED panel, and only there — see docs/builder.md. */
export const KNOB_SPAN = 2;

/** A module file's k7x document. */
export type ModuleDoc = K7Document;

/** The document, or null when the text doesn't parse at all (mid-keystroke); exported so a caller reading several fields parses once. */
export function parseModuleDoc(fileText: string): ModuleDoc | null {
  return docOf(fileText);
}

function docOf(fileText: string): ModuleDoc | null {
  const doc = new K7Document(fileText);
  return doc.contents ? doc : null;
}

/** Runs a writer on a buffer's document; a buffer that does not parse is handed back unchanged. */
function editText(fileText: string, edit: (doc: K7Scope) => void): string {
  const doc = docOf(fileText);
  if (!doc) return fileText;
  edit(doc.at([]));
  return doc.toString();
}

/** The `ui(…)` block validated, or null. */
function parseUi(fileText: string): ModuleUI | null {
  const raw = docOf(fileText)?.getIn(["ui"]);
  if (raw === undefined || raw === null) return null;
  const r = UISchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** The authored `ui(…)` block, or an empty grid when there is none this can read. */
export function readUi(fileText: string): ModuleUI {
  return parseUi(fileText) ?? { ...EMPTY_UI, widgets: {} };
}

/** Whether the `ui(…)` block round-trips; when false the right pane warns rather than misreading it. */
export function hasParsableUi(fileText: string): boolean {
  return parseUi(fileText) !== null;
}

/** True only when a `ui(…)` block is PRESENT and unreadable; absence is not malformed. */
export function hasMalformedUi(fileText: string): boolean {
  const doc = docOf(fileText);
  if (!doc) return false; // the file doesn't parse at all; that is the code editor's news
  const raw = doc.getIn(["ui"]);
  return raw !== undefined && raw !== null && parseUi(fileText) === null;
}

/** The `params(…)` block as name -> value as TEXT, never numbers — see docs/builder.md. */
export function readParams(fileText: string): Record<string, string> {
  const doc = docOf(fileText);
  const params = doc?.getNode(["params"]);
  if (!doc || params?.kind !== "map") return {};
  const out: Record<string, string> = {};
  for (const { key, value } of params.entries) {
    if (value.kind !== "scalar") continue;
    // A string as the text it holds, anything else as it is written: `1.0` stays `1.0`.
    out[key] =
      typeof value.value === "string"
        ? value.value
        : (doc.getSource(["params", key]) ?? "");
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

/** A panel as the plain data its file holds, minimal and pruned. */
export function uiToPlain(ui: ModuleUI): Record<string, unknown> {
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

/** Rewrite the module's `ui(…)` block from the model, in place where it can be, every other line untouched. */
export function writeUiIn(doc: K7Scope, ui: ModuleUI): void {
  const plain = uiToPlain(ui);
  if (!mergeLayout(doc, ["ui"], plain))
    doc.setSourceIn(["ui"], panelSource(plain));
}

/** `writeUiIn` over a buffer's text. */
export function writeUi(fileText: string, ui: ModuleUI): string {
  return editText(fileText, (doc) => writeUiIn(doc, ui));
}

// --- `ui.k7x` panel files ------------------------------------------------------

// The same model at the TOP level of its own file, so it needs its own functions — see docs/builder.md.

/** The panel a `ui.k7x` declares, or null when the text isn't one this can round-trip. */
function parseUiFileText(text: string): ModuleUI | null {
  const raw = docOf(text)?.toJS();
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

/** A `ui.k7x`'s panel, or an empty grid when it has none this can read. */
export function readUiFile(text: string): ModuleUI {
  return parseUiFileText(text) ?? { ...EMPTY_UI, widgets: {} };
}

/** True only when the file HAS a panel this can't read — an empty file is not malformed. */
export function hasMalformedUiFile(text: string): boolean {
  const doc = docOf(text);
  if (!doc) return false; // doesn't parse at all; that's the code editor's news
  const raw = doc.toJS();
  const stated = raw.cols !== undefined || raw.widgets !== undefined;
  return stated && parseUiFileText(text) === null;
}

/** Rewrite a `ui.k7x`'s grid statement by statement, so its header comment survives — see docs/builder.md. */
export function writeUiFileIn(doc: K7Scope, ui: ModuleUI): void {
  writePanelFile(doc, uiToPlain(ui));
}

/** `writeUiFileIn` over a buffer's text. */
export function writeUiFile(text: string, ui: ModuleUI): string {
  return editText(text, (doc) => writeUiFileIn(doc, ui));
}

/** The `plugin(…)` block a module declares, off the FILE and SHALLOW on purpose — see docs/builder.md. */
export function readPlugin(
  fileText: string,
): { type: string; name: string } | null {
  const raw = docOf(fileText)?.getIn(["plugin"]);
  const p = raw as { type?: unknown; name?: unknown } | null | undefined;
  if (!p || typeof p !== "object") return null;
  if (typeof p.type !== "string" || typeof p.name !== "string") return null;
  return { type: p.type, name: p.name };
}

/** A module's `io(…)` direction, from THREE sources because a module rarely says it — see docs/builder.md. */
export function ioOf(fileText: string, path?: string): string | null {
  return ioOfDoc(docOf(fileText), path);
}

/** `ioOf` over a document already parsed (null when it does not parse), so one parse serves every read. */
export function ioOfDoc(doc: ModuleDoc | null, path?: string): string | null {
  const io = doc?.getIn(["io"]);
  if (typeof io === "string" && io) return io;

  const ref = doc?.getIn(["extends"]);
  const base = typeof ref === "string" && ref ? ref : null;
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

/** The channels an `io("in")` module declares, AS AUTHORED — two spellings; see docs/builder.md. */
export function channelOf(fileText: string): number[] | string | null {
  return channelOfDoc(docOf(fileText));
}

/** `channelOf` over a document already parsed; only the `channel` node is turned into data. */
export function channelOfDoc(doc: ModuleDoc | null): number[] | string | null {
  const v = doc?.getIn(["channel"]);
  if (typeof v === "string") return v || null;
  if (Array.isArray(v)) {
    const ns = v.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    return ns.length ? ns : null;
  }
  return null;
}

/** Point an `io("in")` module at interface channels, written on ONE line — see docs/builder.md. */
export function setChannelIn(fileText: string, channels: number[]): string {
  return editText(fileText, (doc) =>
    doc.setIn(["channel"], channels, { inline: true }),
  );
}

/** How this module asks the completions to treat it, read off the TEXT so an unsaved edit shows. */
export function statusOf(fileText: string): ModuleStatus {
  return moduleStatusOf(docOf(fileText)?.toJS());
}

/** Set it, or CLEAR it — the DEFAULT is never written; see docs/builder.md. */
export function setStatusIn(fileText: string, status: ModuleStatus): string {
  return editText(fileText, (doc) => {
    if (status === DEFAULT_MODULE_STATUS) doc.deleteIn(["status"]);
    else doc.setIn(["status"], status);
  });
}

/** A module file's `extends(…)` ref, for resolving the base's file; null when absent. */
export function extendsRefOf(fileText: string): string | null {
  const ref = docOf(fileText)?.getIn(["extends"]);
  return typeof ref === "string" && ref ? ref : null;
}
