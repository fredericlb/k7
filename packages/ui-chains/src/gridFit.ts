// gridFit.ts — a card's widget grid made RESPONSIVE: capped at so many rows (or columns), what overflows is
// folded onto the free side, as another band of the same width (or height) beside the first. A band is never
// cut through a control (a knob two rows tall moves whole), but a frame is cut and a screen shortened, and
// each tab folds on its own. See docs/graphBuild.md.

import type { WebModuleUI, WebWidget } from "@studio/graph-model";

/** The one side a grid is held to; the other grows to take what overflows. */
export interface GridFit {
  axis: "rows" | "cols";
  max: number;
}

type Span = { at: number; len: number };

const along = (w: WebWidget, axis: GridFit["axis"]): Span =>
  axis === "rows"
    ? { at: w.row, len: Math.max(1, w.rowSpan ?? 1) }
    : { at: w.col, len: Math.max(1, w.colSpan ?? 1) };

/** The `[start, end)` bands `size` lines fold into, each at most `max` long unless a widget leaves no cut in reach. */
export function foldBands(
  size: number,
  max: number,
  spans: readonly Span[],
): [number, number][] {
  // A cut between line c-1 and c is legal when no widget runs across it.
  const legal = (c: number) => !spans.some((s) => s.at < c && c < s.at + s.len);
  const bands: [number, number][] = [];
  let start = 0;
  while (start < size) {
    let end = Math.min(size, start + max);
    while (end > start && end < size && !legal(end)) end--;
    // Nothing legal within reach: the band runs on to the first cut that is.
    if (end === start) {
      end = start + max + 1;
      while (end < size && !legal(end)) end++;
      end = Math.min(end, size);
    }
    bands.push([start, end]);
    start = end;
  }
  return bands;
}

/** A FRAME is drawing, not a control: it never holds a cut back, and is redrawn once per band it crosses. */
const isFrame = (w: WebWidget): boolean => w.type === "group";

/** A SCREEN draws a picture scaled to its box: it never holds a cut back either, and is shortened to end at its band's edge. */
const isElastic = (w: WebWidget): boolean =>
  w.type === "lcdscreen" || w.type === "waveform";

type Widgets = Record<string, WebWidget>;
type Bands = [number, number][];

/** A fold: the bands, how wide each is across, and where each starts — a band is as wide as what it HOLDS, not as the grid. */
interface Fold {
  bands: Bands;
  widths: number[];
  offsets: number[];
}

/** The other axis' span — the columns, when rows are held. */
const crossOf = (w: WebWidget, axis: GridFit["axis"]): Span =>
  along(w, axis === "rows" ? "cols" : "rows");

const bandOf = (bands: Bands, at: number): number =>
  Math.max(
    0,
    bands.findIndex(([s, e]) => at >= s && at < e),
  );

/** `bands` sized to `widgets`: each band as wide as the furthest control or screen in it, a frame's width not counting. */
function sized(
  bands: Bands,
  widgets: WebWidget[],
  axis: GridFit["axis"],
): Fold {
  const widths = bands.map(() => 1);
  for (const w of widgets) {
    if (isFrame(w)) continue;
    const b = bandOf(bands, along(w, axis).at);
    const c = crossOf(w, axis);
    widths[b] = Math.max(widths[b], c.at + c.len);
  }
  const offsets = widths.map((_, i) =>
    widths.slice(0, i).reduce((a, x) => a + x, 0),
  );
  return { bands, widths, offsets };
}

/** Where a fold puts a widget: one piece per band it covers — a frame may cover several, anything else one. */
function placeIn(
  key: string,
  w: WebWidget,
  fold: Fold,
  axis: GridFit["axis"],
): [string, WebWidget][] {
  const { bands, widths, offsets } = fold;
  const { at, len } = along(w, axis);
  const cross = crossOf(w, axis);
  const shift = (
    b: number,
    from: number,
    size: number,
    crossLen: number,
  ): WebWidget =>
    axis === "rows"
      ? {
          ...w,
          row: from - bands[b][0],
          rowSpan: size,
          col: cross.at + offsets[b],
          colSpan: crossLen,
        }
      : {
          ...w,
          col: from - bands[b][0],
          colSpan: size,
          row: cross.at + offsets[b],
          rowSpan: crossLen,
        };
  if (!isFrame(w)) {
    const b = bandOf(bands, at);
    // A screen ends where its band does; anything else keeps its length, its band having been cut around it.
    const fits = isElastic(w) ? Math.min(len, bands[b][1] - at) : len;
    return [[key, shift(b, at, fits, cross.len)]];
  }
  // A frame cut at a band's edge — and at its width: one piece per band, the label on the first only.
  const out: [string, WebWidget][] = [];
  bands.forEach(([s, e], b) => {
    const from = Math.max(at, s);
    const to = Math.min(at + len, e);
    const wide = Math.min(cross.len, widths[b] - cross.at);
    if (to <= from || wide <= 0) return;
    const piece = shift(b, from, to - from, wide);
    out.push(
      out.length
        ? [`${key}~${b}`, { ...piece, label: undefined }]
        : [key, piece],
    );
  });
  return out;
}

/** `ui` folded to `fit`, or `ui` itself when it already fits or there is nowhere legal to fold it. */
export function fitPanel(ui: WebModuleUI, fit: GridFit): WebModuleUI {
  const { axis, max } = fit;
  const size = axis === "rows" ? ui.rows : ui.cols;
  if (!(max >= 1) || size <= max) return ui;
  const spansOf = (ws: WebWidget[]) =>
    ws.filter((w) => !isFrame(w) && !isElastic(w)).map((w) => along(w, axis));
  const common = Object.values(ui.widgets);
  const tabs = (ui.tabs ?? []).map((t) => Object.values(t.widgets));
  // Each TAB folds on its own, the widgets outside the tabs with it: only one tab is ever drawn, so one tab's cuts need not suit another's.
  const perTab = tabs.map((ws) => {
    const drawn = [...common, ...ws];
    return sized(foldBands(size, max, spansOf(drawn)), drawn, axis);
  });
  // …which holds only while the shared widgets land in the SAME place in every tab's fold; otherwise one fold for all.
  const everything = [common, ...tabs].flat();
  const pooled = sized(
    foldBands(size, max, spansOf(everything)),
    everything,
    axis,
  );
  const placeKey = (f: Fold) =>
    JSON.stringify(
      Object.entries(ui.widgets).map(([k, w]) => placeIn(k, w, f, axis)),
    );
  const sharedAgree =
    perTab.length > 0 &&
    perTab.every((f) => placeKey(f) === placeKey(perTab[0]));
  const tabFolds = sharedAgree ? perTab : perTab.map(() => pooled);
  const commonFold = sharedAgree ? perTab[0] : pooled;
  const all = [commonFold, ...tabFolds];
  if (all.every((f) => f.bands.length < 2)) return ui;
  const fold = (ws: Widgets, f: Fold): Widgets =>
    Object.fromEntries(
      Object.entries(ws).flatMap(([k, w]) => placeIn(k, w, f, axis)),
    );
  const long = Math.max(...all.flatMap((f) => f.bands.map(([s, e]) => e - s)));
  const wide = Math.max(...all.map((f) => f.widths.reduce((a, x) => a + x, 0)));
  return {
    ...ui,
    ...(axis === "rows"
      ? { rows: long, cols: wide }
      : { cols: long, rows: wide }),
    widgets: fold(ui.widgets, commonFold),
    ...(ui.tabs
      ? {
          tabs: ui.tabs.map((t, i) => ({
            ...t,
            widgets: fold(t.widgets, tabFolds[i]),
            // Each tab's OWN width, rows held: a card sized to the open tab, not to the widest of them (docs/graphBuild.md).
            ...(axis === "rows"
              ? { cols: tabFolds[i].widths.reduce((a, x) => a + x, 0) }
              : {}),
          })),
        }
      : {}),
  };
}
