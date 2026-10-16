// layoutTwins.ts — a panel in its two shapes: the panel itself HORIZONTAL (at most 4 rows, a card read
// across) and `vertical` (at most 4 columns, a card read down). The rule a reader would miss: the two are one
// panel, so each page must offer the same controls in both — a knob missing from one shape is a control that
// vanishes when the screen turns. Geometry is checked as the builder checks it. See packages/ui-module-builder/docs/layouts.md.

import type { ModuleUI, Widget } from "@studio/song-schema/yaml/moduleSchema";
import { clash } from "./groupGeometry";

/** The horizontal layout's height, and the vertical one's width. */
export const LAYOUT_MAX = 4;

const span = (n?: number) => Math.max(1, n ?? 1);

type Grid = Pick<ModuleUI, "cols" | "rows">;

/** Every way a set of widgets drawn TOGETHER can break a grid: out of bounds, or on top of another. */
export function gridIssues(
  grid: Grid,
  where: string,
  ws: readonly [string, Widget][],
): string[] {
  const out: string[] = [];
  for (const [id, w] of ws)
    if (
      w.col < 0 ||
      w.row < 0 ||
      w.col + span(w.colSpan) > grid.cols ||
      w.row + span(w.rowSpan) > grid.rows
    )
      out.push(
        `${where}: \`${id}\` runs outside the ${grid.cols}×${grid.rows} grid`,
      );
  for (let i = 0; i < ws.length; i++)
    for (let j = i + 1; j < ws.length; j++)
      if (clash(ws[i][1], ws[j][1]))
        out.push(
          ws[i][1].type === "group" || ws[j][1].type === "group"
            ? `${where}: \`${ws[i][0]}\` and \`${ws[j][0]}\` cross — a widget lies wholly inside a group or wholly outside it, and groups never overlap`
            : `${where}: \`${ws[i][0]}\` overlaps \`${ws[j][0]}\``,
        );
  return out;
}

/** What a page OFFERS: its controls' binds (a bind may appear twice, so counted), frames, labels and screens aside. */
function offered(ws: readonly [string, Widget][]): Map<string, number> {
  const out = new Map<string, number>();
  for (const [, w] of ws)
    if (w.bind && w.type !== "group" && w.type !== "label")
      out.set(w.bind, (out.get(w.bind) ?? 0) + 1);
  return out;
}

const sameOffer = (
  a: Map<string, number>,
  b: Map<string, number>,
): string[] => {
  const out: string[] = [];
  for (const k of new Set([...a.keys(), ...b.keys()]))
    if ((a.get(k) ?? 0) !== (b.get(k) ?? 0)) out.push(k);
  return out;
};

/** The pages of a layout, each drawn with the widgets every page shares: [name, widgets drawn]. */
function pages(
  layout: Pick<ModuleUI, "widgets" | "tabs">,
): [string, [string, Widget][]][] {
  const top = Object.entries(layout.widgets);
  if (!layout.tabs?.length) return [["panel", top]];
  return layout.tabs.map((t) => [
    `tab ${t.name}`,
    [...top, ...Object.entries(t.widgets)],
  ]);
}

/** Every way a panel's two shapes break the rules: sizes, the twin's own geometry, and controls one shape lacks. */
export function twinIssues(ui: ModuleUI): string[] {
  const issues: string[] = [];
  if (ui.rows > LAYOUT_MAX)
    issues.push(
      `the panel is ${ui.rows} rows tall: the horizontal layout holds at most ${LAYOUT_MAX}`,
    );
  const v = ui.vertical;
  if (!v) {
    if (ui.cols > LAYOUT_MAX)
      issues.push(
        `the panel is ${ui.cols} columns wide and has no \`vertical\` layout: one of at most ${LAYOUT_MAX} columns is needed`,
      );
    return issues;
  }
  if (v.cols > LAYOUT_MAX)
    issues.push(
      `the vertical layout is ${v.cols} columns wide: it holds at most ${LAYOUT_MAX}`,
    );
  const hp = pages(ui);
  const vp = pages(v);
  for (const [where, ws] of vp)
    issues.push(...gridIssues(v, `vertical ${where}`, ws));
  hp.forEach(([where, ws], i) => {
    const twin = vp[i]?.[1] ?? [];
    const differ = sameOffer(offered(ws), offered(twin));
    if (differ.length)
      issues.push(
        `${where}: the vertical layout does not offer the same controls — ${differ.map((b) => `\`${b}\``).join(", ")}`,
      );
  });
  // A screen is drawn by the panel's script, keyed by its id: a twin's screen must be one the script already draws.
  const screens = new Set(
    [
      ...Object.entries(ui.widgets),
      ...(ui.tabs ?? []).flatMap((t) => Object.entries(t.widgets)),
    ]
      .filter(([, w]) => w.type === "lcdscreen")
      .map(([id]) => id),
  );
  for (const [, ws] of vp)
    for (const [id, w] of ws)
      if (w.type === "lcdscreen" && !screens.has(id))
        issues.push(
          `vertical: screen \`${id}\` is not one of the panel's screens — reuse the panel's id, which its draw function is keyed by`,
        );
  return [...new Set(issues)];
}

type Layout = NonNullable<ModuleUI["vertical"]>;

/** A first VERTICAL layout from the panel: every control kept at its size (at most 4 wide), packed into 4 columns in reading order, frames left for the author. */
export function reflowNarrow(ui: ModuleUI): Layout {
  const pack = (
    taken: boolean[][],
    ws: Record<string, Widget>,
  ): Record<string, Widget> => {
    const out: Record<string, Widget> = {};
    const order = Object.entries(ws)
      .filter(([, w]) => w.type !== "group")
      .sort(([, a], [, b]) => a.row - b.row || a.col - b.col);
    for (const [id, w] of order) {
      const cw = Math.min(LAYOUT_MAX, span(w.colSpan));
      const ch = span(w.rowSpan);
      const free = (r: number, c: number) => {
        for (let y = r; y < r + ch; y++)
          for (let x = c; x < c + cw; x++) if (taken[y]?.[x]) return false;
        return true;
      };
      let r = 0;
      let c = 0;
      for (; ; r++) {
        c =
          [...Array(LAYOUT_MAX - cw + 1).keys()].find((x) => free(r, x)) ?? -1;
        if (c >= 0) break;
      }
      for (let y = r; y < r + ch; y++) {
        taken[y] ??= [];
        for (let x = c; x < c + cw; x++) taken[y][x] = true;
      }
      out[id] = { ...w, col: c, row: r, ...(cw > 1 ? { colSpan: cw } : {}) };
    }
    return out;
  };
  const shared: boolean[][] = [];
  const widgets = pack(shared, ui.widgets);
  // Each tab packs around the shared widgets, which every tab draws.
  const tabs = (ui.tabs ?? []).map((t) => ({
    name: t.name,
    widgets: pack(
      shared.map((row) => [...row]),
      t.widgets,
    ),
  }));
  const all = [widgets, ...tabs.map((t) => t.widgets)].flatMap((m) =>
    Object.values(m),
  );
  const rows = Math.max(1, ...all.map((w) => w.row + span(w.rowSpan)));
  return {
    cols: LAYOUT_MAX,
    rows,
    widgets,
    ...(tabs.length ? { tabs } : {}),
  };
}

/** The vertical layout's tabs brought in line with the panel's: renamed by position when the count holds, matched by name when it does not. */
export function alignTabs(ui: ModuleUI): ModuleUI {
  const v = ui.vertical;
  if (!v) return ui;
  const tabs = ui.tabs ?? [];
  const mine = v.tabs ?? [];
  const next = tabs.map((t, i) => ({
    name: t.name,
    widgets:
      (mine.length === tabs.length
        ? mine[i]?.widgets
        : mine.find((x) => x.name === t.name)?.widgets) ?? {},
  }));
  const { tabs: _drop, ...rest } = v;
  return {
    ...ui,
    vertical: next.length ? { ...rest, tabs: next } : rest,
  };
}
