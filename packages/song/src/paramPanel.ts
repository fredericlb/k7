// paramPanel.ts — a plugin's parameter list turned into a panel: every param bound to a widget,
// grouped into tabs by what its NAME says it belongs to. Browser-safe (no filesystem), because
// the médiathèque generates these in a tab and writes them through its own routes.
// Full rationale: docs/paramPanel.md.

import type { BuiltinParam } from "./builtinParams";
import type { ModuleUI, Widget } from "./yaml/moduleSchema";

/** Columns in a page's grid. Four knobs across is what a panel of this size reads as. */
export const PANEL_COLS = 4;

/**
 * How many params sharing a leading word make that word a tab.
 *
 * THREE, and the number is doing real work. At two, `Master Level` and `Master Tune` would open
 * a "Master" tab holding two knobs while the general one beside it holds thirty — a tab that
 * costs a click and saves nothing. At four, 4OSC's `Amp` group (six) survives but a plugin with
 * three delay controls loses its Delay tab into the general pile.
 */
const FAMILY_MIN = 3;

/**
 * …and how many params a panel needs before it is worth splitting at all.
 *
 * Under this, one page. A tabbed panel of nine knobs is a filing cabinet for a drawer: every
 * one of them fits on screen at once, and the tabs only hide two thirds of them behind a click.
 */
const TABS_MIN = 12;

/** The tab everything unclaimed lands in. Last, because it is the remainder and not the subject. */
const GENERAL = "Général";

/**
 * A param's name split into what it is and which of them it is — `Tune 3` → `Tune`, 3.
 *
 * `#` is deliberately NOT a separator. `Mix #2` is Tracktion disambiguating three params all
 * called `Mix` — one per built-in effect — and reading it as "the second Mix" would file the
 * delay's mix under the number the second OSCILLATOR uses. A dedup suffix says these names
 * collided, which is the opposite of saying they belong together.
 */
export function splitIndex(name: string): {
  stem: string;
  index: number | null;
} {
  const m = /^(.*?)[ _-]+(\d+)$/.exec(name.trim());
  if (!m || !m[1]) return { stem: name.trim(), index: null };
  return { stem: m[1].trim(), index: Number(m[2]) };
}

/** …and the first word of it, which is what a family is named by. */
const leadWord = (name: string): string =>
  splitIndex(name).stem.split(/[ _-]+/)[0] ?? "";

/**
 * The token that says WHICH ONE — `Tune 1` → `1`, `Width Osc1` → `Osc1` — or null.
 *
 * Two spellings of one signal, and the second is what real plugins use. Tracktion separates the
 * index (`Tune 1`); Arturia glues it to a word (`Width Osc1`, `Amount FM1 Osc1`), and so do most
 * VSTs — a bare index is rare outside a plugin whose parts have no names of their own.
 *
 * The tell is the same either way: **the last token ends in a digit**. A trailing `Osc1` is not a
 * control called Osc1, it is the first oscillator; `1` is that statement with the noun left out.
 * Grouping on the whole token rather than on the digits keeps the tab named the way the plugin
 * names it — `Osc1` where it said Osc1, `1` where it said 1.
 *
 * The separators are `splitIndex`'s, and for the same reasons: space, underscore and hyphen split;
 * a ` #n` dedup suffix is excluded, exactly as it is excluded from the word families below.
 */
export function familyToken(name: string): string | null {
  const last =
    name
      .trim()
      .split(/[ _-]+/)
      .pop() ?? "";
  if (!last || last.startsWith("#") || !/\d$/.test(last)) return null;
  return last;
}

/**
 * How many params a tab needs to be worth being one.
 *
 * A tab holding ONE knob is a click that shows you one knob — the same trade `FAMILY_MIN`
 * refuses, arriving from the other end. Measured on a real VST: Arturia's ARP 2600 names eight
 * params `HardwareDisplayControl1`…`8`, a perfect family signal and eight tabs of one.
 */
const TAB_MIN_PARAMS = 2;

/**
 * Which tab each param belongs in, in the order the tabs should appear.
 *
 * Two signals, and which one gets to speak about a given param is the whole design.
 *
 * 1. **A trailing token ending in a digit** — `Tune 1`, `Level 1`, `Pan 1`, or `Width Osc1`,
 *    `Fine Tune Osc1` — puts a param on the page of the thing it belongs to. Four oscillators of
 *    seven controls are four pages of seven, whichever of the two spellings the plugin uses.
 * 2. **A shared leading word**, among the params that carry NO number — `Filter Freq`,
 *    `Filter Type`, `Filter Slope`. An author who prefixes a dozen params has already grouped
 *    them, and the panel's job is to notice rather than to re-decide.
 *
 * The number goes first, and the alternative is what proves it: reading the word first makes a
 * tab of `Tune` holding `Tune 1..4`, another of `Pan` holding `Pan 1..4` — a page per CONTROL
 * instead of a page per oscillator, which is the wall of knobs turned on its side. A number says
 * WHICH ONE; among params that have one, that is the only question left.
 *
 * A numbered tab is named by its number and nothing else. `Tune 1`…`Pan 1` are plainly one
 * oscillator, and "Osc 1" is what a person would write — but nothing in the parameter list says
 * `osc`, and a label invented here would be this code claiming to know a plugin it has never
 * seen. The plugin's own naming is what the tab repeats.
 */
export function groupParams(
  params: readonly BuiltinParam[],
): { tab: string; params: BuiltinParam[] }[] {
  if (params.length < TABS_MIN)
    return params.length ? [{ tab: GENERAL, params: [...params] }] : [];

  const tabs: { tab: string; params: BuiltinParam[] }[] = [];
  const put = (tab: string, p: BuiltinParam) => {
    const found = tabs.find((t) => t.tab === tab);
    if (found) found.params.push(p);
    else tabs.push({ tab, params: [p] });
  };

  // Numbered first. At least TWO tokens, or it is not a family — one `Band 1` is a param that
  // happens to end in a digit, and a tab of it would be a page with one knob on it.
  const tokens = new Set(
    params.map((p) => familyToken(p.name)).filter((t) => t !== null),
  );
  const byToken = tokens.size >= 2;
  const plain: BuiltinParam[] = [];
  for (const p of params) {
    const token = familyToken(p.name);
    if (byToken && token) put(token, p);
    else plain.push(p);
  }

  // …then the un-numbered, by their leading word — except the DEDUPLICATED ones. `Mix`,
  // `Mix #2` and `Mix #3` are the reverb's, the delay's and the chorus's, and Tracktion
  // suffixed them precisely because the names collided. A ` #n` says "these three are
  // unrelated and happen to be spelt alike", so letting it make a family of them groups by
  // the one thing that proves they do not belong together.
  const deduped = (name: string) => name.includes("#");
  const byWord = new Map<string, number>();
  for (const p of plain)
    if (!deduped(p.name))
      byWord.set(leadWord(p.name), (byWord.get(leadWord(p.name)) ?? 0) + 1);
  // A family only if enough of them share the word AND it is not the whole name: `Volume` on its
  // own is a control, not a heading, and a tab called Volume holding one knob called Volume is
  // a click that shows you what its own label already said.
  const families = new Set(
    [...byWord]
      .filter(
        ([w, n]) =>
          n >= FAMILY_MIN &&
          plain.some((p) => leadWord(p.name) === w && p.name !== w),
      )
      .map(([w]) => w),
  );
  for (const p of plain) {
    const w = leadWord(p.name);
    put(!deduped(p.name) && families.has(w) ? w : GENERAL, p);
  }

  return settle(tabs);
}

/**
 * Fold away the tabs too small to be worth one, and put the remainder last.
 *
 * There is no cap on how MANY tabs come out, and that is a measurement rather than an omission.
 * A ceiling of twelve looked obviously right until the numbers came back: on Arturia's ARP 2600
 * V3 (312 params) it gave a tidy bar of twelve tabs and a `Général` holding 193 of them — the
 * wall of knobs rebuilt behind one click, three quarters of it. Without the cap: 35 tabs,
 * remainder 82. A cap does not remove knobs, it moves NAMED ones (`Tracking1`…`4`, `Envelope1`,
 * `Chorus`, `Mix`) into the one pile that has no name, which is the worst place for them.
 * Thirty-five tabs on a plugin with three hundred parameters is what that plugin IS.
 */
function settle(
  tabs: { tab: string; params: BuiltinParam[] }[],
): { tab: string; params: BuiltinParam[] }[] {
  const general = tabs.find((t) => t.tab === GENERAL) ?? {
    tab: GENERAL,
    params: [],
  };
  const kept: { tab: string; params: BuiltinParam[] }[] = [];
  for (const t of tabs) {
    if (t.tab === GENERAL) continue;
    if (t.params.length < TAB_MIN_PARAMS) general.params.push(...t.params);
    else kept.push(t);
  }
  // The remainder last, wherever it was picked up. It is what did not sort, so it reads as the
  // end of the list rather than as one subject among the others.
  if (general.params.length) kept.push(general);
  return kept;
}

/**
 * The widget one param gets.
 *
 * A DROPDOWN when the plugin named its settings, a knob otherwise. Nothing here guesses a
 * toggle: a 0..1 param is a knob unless the plugin said it has two named states, and inferring
 * one from a range would draw a switch over every mix control on the panel.
 *
 * The range travels with it, which is the point of generating this at all — a widget bound with
 * no range is drawn 0..1, and on a `-36..+36` semitone knob that writes the wrong number.
 */
export function paramWidget(p: BuiltinParam, col: number, row: number): Widget {
  const label = p.name;
  if (p.states?.length)
    return {
      type: "dropdown",
      col,
      row,
      label,
      bind: p.name,
      options: p.states.map((s) => ({ label: s.label, value: s.value })),
    };
  return {
    type: "knob",
    col,
    row,
    label,
    bind: p.name,
    min: p.min,
    max: p.max,
  };
}

/** One group's widgets, laid left to right and wrapped at `PANEL_COLS`. */
function pageWidgets(params: readonly BuiltinParam[]): Record<string, Widget> {
  const out: Record<string, Widget> = {};
  params.forEach((p, i) => {
    out[`w${i + 1}`] = paramWidget(
      p,
      i % PANEL_COLS,
      Math.floor(i / PANEL_COLS),
    );
  });
  return out;
}

const rowsFor = (n: number): number => Math.max(1, Math.ceil(n / PANEL_COLS));

/**
 * A whole panel for a plugin's parameters — the file `ui.yaml` carries.
 *
 * One page per group, inside a single `tabs` widget that fills the grid. A panel of fewer than
 * `TABS_MIN` params comes back FLAT, with no tabs at all: the tabs exist to stop a wall of
 * knobs, and a plugin with eight of them has no wall.
 *
 * Every param is bound. That is the requirement this function answers and the one worth stating,
 * because the alternative — a curated panel of the interesting ones — is a judgement about a
 * plugin nobody here has heard, and the parameters nobody thought interesting are exactly the
 * ones somebody will come looking for.
 */
export function paramPanel(params: readonly BuiltinParam[]): ModuleUI {
  const groups = groupParams(params);
  if (!groups.length) return { cols: PANEL_COLS, rows: 1, widgets: {} };
  if (groups.length === 1)
    return {
      cols: PANEL_COLS,
      rows: rowsFor(groups[0].params.length),
      widgets: pageWidgets(groups[0].params),
    };
  // The tallest page decides the grid: a `tabs` widget is one cell of the outer grid and its
  // pages are drawn inside it, so a grid sized to the shortest page would clip the rest.
  const rows = Math.max(...groups.map((g) => rowsFor(g.params.length)));
  return {
    cols: PANEL_COLS,
    rows,
    widgets: {
      tabs: {
        type: "tabs",
        col: 0,
        row: 0,
        colSpan: PANEL_COLS,
        rowSpan: rows,
        pages: Object.fromEntries(
          groups.map((g) => [g.tab, pageWidgets(g.params)]),
        ),
      },
    },
  };
}
