// panelTabs.ts — a panel's TABS as the builder edits them: which widget map the grid writes, and
// adding, removing, renaming and reordering a tab. Pure, so every rule here is a test.
// The one thing a reader would get wrong: a panel with ONE tab writes no `tabs:` at all — the second
// tab is what creates the list, and removing back to one folds it away (docs/pages.md).

import { TAB_NAME_MAX } from "@studio/song-schema/yaml/moduleSchema";
import type { ModuleUI, Widget } from "./moduleUi";

/** Which widget map the grid edits: the widgets every tab shows (`null`), or one tab by position. */
export type PageRef = number | null;

/** The name a new tab is first given, numbered past every tab there is. */
const NEW_TAB = "Tab";
/** …and the name the panel's own widgets take when a second tab turns them into the first. */
const FIRST_TAB = "Main";

/** Where the grid writes when nothing was chosen: the first tab of a tabbed panel, else the panel. */
const defaultPage = (ui: ModuleUI): PageRef => (ui.tabs?.length ? 0 : null);

/** `at` checked against the document: nothing chosen, or a tab that has gone, sends the grid to the default. */
export function pageIn(ui: ModuleUI, at: PageRef | undefined): PageRef {
  if (at === undefined) return defaultPage(ui);
  if (at === null) return null;
  return ui.tabs?.[at] ? at : defaultPage(ui);
}

/** The map `at` names — every tab's widgets, or one tab's. */
export function widgetsAt(ui: ModuleUI, at: PageRef): Record<string, Widget> {
  return at === null ? ui.widgets : (ui.tabs?.[at]?.widgets ?? {});
}

/** `ui` with the map at `at` replaced; the other tabs are untouched. */
export function writeWidgetsAt(
  ui: ModuleUI,
  at: PageRef,
  next: Record<string, Widget>,
): ModuleUI {
  if (at === null) return { ...ui, widgets: next };
  if (!ui.tabs?.[at]) return ui; // the tab has gone: refuse rather than invent one
  return {
    ...ui,
    tabs: ui.tabs.map((t, i) => (i === at ? { ...t, widgets: next } : t)),
  };
}

/** Every widget id on the panel, every tab's included: an id names one widget across the whole panel. */
export function panelIds(ui: ModuleUI): Set<string> {
  const ids = new Set(Object.keys(ui.widgets));
  for (const t of ui.tabs ?? [])
    for (const id of Object.keys(t.widgets)) ids.add(id);
  return ids;
}

/** A tab name as it may be written: trimmed and cut to TAB_NAME_MAX. */
const tabName = (raw: string): string => raw.trim().slice(0, TAB_NAME_MAX);

function freeName(ui: ModuleUI, base: string): string {
  const taken = new Set((ui.tabs ?? []).map((t) => t.name));
  for (let i = (ui.tabs?.length ?? 0) + 1; ; i++) {
    const name = tabName(`${base} ${i}`);
    if (!taken.has(name)) return name;
  }
}

/** A tab added at the end. The FIRST one added makes two: the panel's widgets become tab one. */
export function addTab(ui: ModuleUI): { ui: ModuleUI; at: number } {
  if (!ui.tabs?.length) {
    const first = { name: FIRST_TAB, widgets: ui.widgets };
    const tabs = [
      first,
      { name: freeName({ ...ui, tabs: [first] }, NEW_TAB), widgets: {} },
    ];
    return { ui: { ...ui, widgets: {}, tabs }, at: 1 };
  }
  const tabs = [...ui.tabs, { name: freeName(ui, NEW_TAB), widgets: {} }];
  return { ui: { ...ui, tabs }, at: tabs.length - 1 };
}

/** Tab `at` removed with its widgets. Down to one, the list folds away: its widgets join the panel's. */
export function removeTab(ui: ModuleUI, at: number): ModuleUI {
  if (!ui.tabs?.[at]) return ui;
  const tabs = ui.tabs.filter((_, i) => i !== at);
  if (tabs.length > 1) return { ...ui, tabs };
  const { tabs: _gone, ...rest } = ui;
  return { ...rest, widgets: { ...ui.widgets, ...(tabs[0]?.widgets ?? {}) } };
}

/** Tab `at` renamed — or `ui` unchanged when the name is empty or another tab's. */
export function renameTab(ui: ModuleUI, at: number, raw: string): ModuleUI {
  const name = tabName(raw);
  if (!ui.tabs?.[at] || !name) return ui;
  if (ui.tabs.some((t, i) => i !== at && t.name === name)) return ui;
  return {
    ...ui,
    tabs: ui.tabs.map((t, i) => (i === at ? { ...t, name } : t)),
  };
}

/** Tab `at` moved one place up (-1) or down (+1); the new position, or `at` when it cannot move. */
export function moveTab(
  ui: ModuleUI,
  at: number,
  by: -1 | 1,
): { ui: ModuleUI; at: number } {
  const to = at + by;
  if (!ui.tabs?.[at] || !ui.tabs[to]) return { ui, at };
  const tabs = [...ui.tabs];
  [tabs[at], tabs[to]] = [tabs[to], tabs[at]];
  return { ui: { ...ui, tabs }, at: to };
}
