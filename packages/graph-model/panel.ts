// panel.ts — a panel's widgets on EVERY tab, for whatever looks one up by its bind: MIDI control,
// the automation arrow, a library-file picker's choices. The one thing a reader would get wrong: a
// widget on a closed tab still exists, so a lookup that read only `widgets` would miss it (docs/graph.md).

/** The shape every tier's panel shares: widgets drawn on every tab, then the tabs in order. */
export interface PanelLike<W> {
  widgets?: Record<string, W>;
  tabs?: { name: string; widgets: Record<string, W> }[];
}

/** Every widget of the panel as [id, widget], the shared ones first, then each tab's in order. */
export function panelWidgets<W>(
  ui: PanelLike<W> | null | undefined,
): [string, W][] {
  if (!ui) return [];
  const out = Object.entries(ui.widgets ?? {});
  for (const t of ui.tabs ?? []) out.push(...Object.entries(t.widgets ?? {}));
  return out;
}

/** Whether the panel draws its tabs: two or more, since a single tab is just the panel. */
export const hasTabs = (ui: PanelLike<unknown> | null | undefined): boolean =>
  (ui?.tabs?.length ?? 0) > 1;
