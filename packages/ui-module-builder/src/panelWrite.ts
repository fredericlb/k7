// panelWrite.ts — a panel's plain data written into a k7x document with the fewest edits, each widget on ONE line.
// A reader would get wrong that a structure is ever rebuilt from scratch: only one that cannot be edited in place is (docs/builder.md).

import type { K7Path } from "@studio/k7x/ast";
import type { K7Scope } from "@studio/k7x/document";
import { stringify } from "@studio/k7x/print";
import { isWidgetAt } from "@studio/panel-rules/panel-text";

type Data = Record<string, unknown>;

const isRecord = (v: unknown): v is Data =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Deep equality of plain data, key order aside. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (!isRecord(a) || !isRecord(b)) return false;
  const ka = Object.keys(a);
  return (
    ka.length === Object.keys(b).length &&
    ka.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]))
  );
}

/** The source of a value as a statement's argument prints it, its widgets one a line. */
export function panelSource(value: unknown): string {
  const text = stringify({ v: value }, { inline: isWidgetAt }).trimEnd();
  return text.slice("v(".length, -1);
}

/** Edits a widget map in place; false when it cannot be, an empty or one-line map growing on its own line. */
function mergeWidgets(scope: K7Scope, path: K7Path, after: unknown): boolean {
  const before = scope.getIn(path);
  if (same(before, after)) return true;
  if (!isRecord(before) || !isRecord(after)) return false;
  if (Object.keys(before).length === 0) return false;
  if (!scope.getSource(path)?.includes("\n")) return false;
  for (const id of Object.keys(before))
    if (!Object.hasOwn(after, id)) scope.deleteIn([...path, id]);
  for (const [id, w] of Object.entries(after)) {
    if (isRecord(before[id])) scope.applyIn([...path, id], w);
    else scope.setIn([...path, id], w, { inline: true });
  }
  return true;
}

/** Edits a tab list in place when it keeps its length; false otherwise. */
function mergeTabs(scope: K7Scope, path: K7Path, after: unknown): boolean {
  const before = scope.getIn(path);
  if (same(before, after)) return true;
  if (!Array.isArray(before) || !Array.isArray(after)) return false;
  if (before.length !== after.length) return false;
  for (let i = 0; i < after.length; i++) {
    const tab = after[i] as Data;
    if (!isRecord(before[i])) return false;
    scope.setIn([...path, i, "name"], tab.name);
    if (!mergeWidgets(scope, [...path, i, "widgets"], tab.widgets))
      return false;
  }
  return true;
}

/** Edits a layout (`cols`, `rows`, `widgets`, `tabs`, `vertical`) in place; false when a part of it cannot be. */
export function mergeLayout(
  scope: K7Scope,
  path: K7Path,
  after: Data,
): boolean {
  if (!isRecord(scope.getIn(path))) return false;
  scope.setIn([...path, "cols"], after.cols);
  scope.setIn([...path, "rows"], after.rows);
  if (!mergeWidgets(scope, [...path, "widgets"], after.widgets)) return false;
  for (const key of ["tabs", "vertical"] as const) {
    const value = after[key];
    if (value === undefined) scope.deleteIn([...path, key]);
    else if (key === "tabs" && !mergeTabs(scope, [...path, key], value))
      return false;
    else if (
      key === "vertical" &&
      !mergeLayout(scope, [...path, key], value as Data)
    )
      return false;
  }
  return true;
}

/** Writes a panel as the top-level statements of a `ui.k7x`, each rebuilt only when it cannot be edited in place. */
export function writePanelFile(scope: K7Scope, plain: Data): void {
  scope.setIn(["cols"], plain.cols);
  scope.setIn(["rows"], plain.rows);
  const parts = [
    ["widgets", mergeWidgets],
    ["tabs", mergeTabs],
    [
      "vertical",
      (s: K7Scope, p: K7Path, v: unknown) => mergeLayout(s, p, v as Data),
    ],
  ] as const;
  for (const [key, merge] of parts) {
    const value = plain[key];
    if (value === undefined) scope.deleteIn([key]);
    else if (!merge(scope, [key], value))
      scope.setSourceIn([key], panelSource(value));
  }
}
