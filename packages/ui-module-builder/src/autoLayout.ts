// autoLayout.ts — a panel PROPOSED from a parameter list alone: read each name, guess which
// family it belongs to, and lay the families out as the pages of one tabs widget. Pure, so the
// guess is testable without a grid; what it returns is an ordinary ModuleUI the editor can then
// take apart by hand. Nothing here is authoritative — see docs/autoLayout.md.

import type { ParamMeta } from "@studio/engine-protocol";
import type { ModuleUI, Widget, WidgetType } from "./moduleUi";

/** One parameter to place: its name, and its range if anything knows it. */
export interface AutoParam {
  name: string;
  meta?: ParamMeta;
}

/**
 * The families, IN ORDER — the first whose pattern matches a name takes it.
 *
 * Order is the algorithm. Nearly every conflict here is one word claimed by two families, and
 * the specific one has to ask first: `Comp Make Up gain` is dynamics and not a level, `Low Shelf
 * Gain` is an EQ and not a level, `Bell Freq` is an EQ and not a filter, `Reverb Decay Start` is
 * a reverb and not an envelope, `Comp Attack` is dynamics and not an envelope. Reordering this
 * table silently rehomes parameters, which is why the pairs above are pinned by tests.
 *
 * `Preset` and `MIDI` lead because they are not sound at all. A modern instrument publishes
 * dozens of them — Arturia's Piano V3 alone publishes sixteen `VST_ProgramChange_*`, sixteen
 * `MPE_PitchBend_*` and a whole KeyLab remote — and every one of those left among the knobs is
 * a knob nobody will ever turn, sitting where a real one could have been.
 *
 * The patterns are matched against the name LOWERCASED with `_` read as a space, so
 * `MPE_PitchBend_3` and `Pitch Bend` are the same string to look at.
 */
const FAMILIES: { page: string; match: RegExp; tail?: true }[] = [
  // By NAMESPACE rather than by word, and first, because `@volume` and `@gain` would otherwise
  // read as levels: the `@` names are not the plugin's parameters at all — they are the lane's
  // and the input's, and the params list offers them on every module because a panel may want
  // them. `tail` puts the page LAST all the same, one delete away on a module that does not.
  { page: "Track", match: /^@/, tail: true },
  {
    page: "Preset",
    // The plugin's own browser, driven from a controller: these move a selection, not a sound.
    match:
      /\bpreset|browse|navigate|keylab|hardware|controller|\bundo\b|\bredo\b|oct (minus|plus)|(active|multi|selected|clear) filter|filter (preset|category)/,
  },
  {
    page: "MIDI",
    // `pitch bend` and never a bare `pitch`, which is a tuning word — see the Tuning family.
    match:
      /\bmpe\b|\bmidi\b|pitch ?bend|program ?change|aftertouch|\bctrl|mod ?wheel|\bpedal\b|channel pressure|\bnote (on|off)/,
  },
  { page: "Reverb", match: /reverb|\breverb|\bhall\b|\bplate\b|pre.?delay/ },
  { page: "Delay", match: /\bdelay|\becho\b|feedback|\btape\b/ },
  {
    page: "Modulation",
    match: /chorus|flanger|phaser|ensemble|tremolo|vibrato|\blfo\b/,
  },
  {
    page: "Drive",
    match:
      /disto|drive|saturat|overdrive|\bfuzz\b|harmonic|bit ?crush|waveshap/,
  },
  {
    page: "Dynamics",
    match:
      /\bcomp\b|compress|limit|\bgate\b|expander|threshold|\bratio\b|make ?up|sidechain|\bknee\b/,
  },
  {
    page: "EQ",
    match:
      /\beq\b|equali|shelf|\bbell\b|presence|treble|\btone\b|bright|\bband\b/,
  },
  {
    page: "Filter",
    match: /filter|cutoff|resonance|formant|\bhpf?\b|\blpf?\b/,
  },
  {
    page: "Envelope",
    match:
      /\benv\b|envelope|\badsr\b|attack|\bdecay\b|sustain|release|\bhold\b/,
  },
  {
    page: "Oscillator",
    match: /\bosc\b|oscillator|\bwave\b|pulse|\bsaw\b|square|\bsub\b|\bnoise\b/,
  },
  {
    page: "Tuning",
    match:
      /tune|tuning|detune|transpose|\bpitch\b|octave|semitone|\bcent\b|glide|portamento|\bscale\b|unison/,
  },
  {
    page: "Mix",
    match:
      /level|volume|\bgain\b|\bmix\b|\bdry\b|\bwet\b|\bpan\b|width|output|master|input|balance/,
  },
];

/** Where a name goes when nothing claims it — a page, not the floor: nothing is dropped. */
export const OTHER_PAGE = "Other";

/** `MPE_PitchBend_3` and `Pitch Bend` are the same string to a pattern. */
const readable = (name: string): string =>
  name.replace(/[_-]+/g, " ").toLowerCase();

/** Which family a parameter's NAME suggests. Exported because the guess is the whole feature. */
export function familyOf(name: string): string {
  const s = readable(name);
  for (const f of FAMILIES) if (f.match.test(s)) return f.page;
  return OTHER_PAGE;
}

/**
 * What to draw a parameter with — the same three answers a DROPPED parameter gets in
 * WidgetGridEditor's `createBound`, on purpose.
 *
 * One rule for both gestures, so a panel you auto-organise and a panel you drag by hand are made
 * of the same widgets. A discrete parameter with two settings is a case for a toggle and is
 * still a dropdown here: the dropdown sends the value the plugin named, and a toggle would have
 * to guess which of the two 0 and 1 mean.
 */
function widgetTypeFor(p: AutoParam): WidgetType {
  return p.meta?.states?.length ? "dropdown" : "knob";
}

/** A bound widget's label is the param's name; the "@" of an intrinsic goes, it marks a namespace. */
const labelOf = (name: string) => name.replace(/^@/, "");

/**
 * The pages, holding only the families that got something.
 *
 * Which family CLAIMS a name and which order the pages are read in are two different questions,
 * and one list cannot answer both: `Track` has to ask before `Mix` (else `@volume` reads as a
 * level) and still be drawn after it (else every plugin's panel opens on the lane's own knobs).
 * So the table is the matching order and `tail` is the reading order.
 *
 * `Other` after even those: it is where the guess gave up, and a page of leftovers ahead of a
 * page of reverb controls would say the opposite of what the layout is for.
 */
export function groupParams(
  params: readonly AutoParam[],
): { page: string; params: AutoParam[] }[] {
  const byPage = new Map<string, AutoParam[]>();
  for (const p of params) {
    const page = familyOf(p.name);
    const held = byPage.get(page);
    if (held) held.push(p);
    else byPage.set(page, [p]);
  }
  const order = [
    ...FAMILIES.filter((f) => !f.tail).map((f) => f.page),
    ...FAMILIES.filter((f) => f.tail).map((f) => f.page),
    OTHER_PAGE,
  ];
  return order
    .filter((page) => byPage.has(page))
    .map((page) => ({ page, params: byPage.get(page) ?? [] }));
}

/** How wide the proposed panel is. Six knobs a row is what the drawn panels in this repo use. */
export const AUTO_COLS = 6;

/**
 * A whole panel proposed from a parameter list: one tabs widget across the top, one page per
 * family, each page's parameters laid out row-major under it.
 *
 * The grid is sized to the BIGGEST page, because every page shares the panel's grid — that is the
 * renderer's rule (docs/pages.md), so a panel tall enough for the reverb page is what makes the
 * oscillator page fit too. It is a proposal: the caller replaces the panel with it, and the
 * author then deletes, moves and renames like any other panel.
 *
 * An empty list still returns a panel — an empty grid, which is what a module with no known
 * parameters honestly has. It must never return something the schema would refuse: a `tabs`
 * widget with no pages fails to load and takes the graph node with it.
 */
export function autoOrganize(params: readonly AutoParam[]): ModuleUI {
  const groups = groupParams(params);
  if (!groups.length) return { cols: AUTO_COLS, rows: 1, widgets: {} };

  const rowsNeeded = Math.max(
    ...groups.map((g) => Math.ceil(g.params.length / AUTO_COLS)),
  );
  const pages: Record<string, Record<string, Widget>> = {};
  // Numbered across the WHOLE panel rather than restarting on each page. Nothing requires it —
  // pages are separate maps and the hand editor's `nextId` does restart — but a panel where `w40`
  // names one widget is a panel you can talk about without also saying which page it is on.
  let n = 0;
  for (const g of groups) {
    const widgets: Record<string, Widget> = {};
    g.params.forEach((p, i) => {
      const type = widgetTypeFor(p);
      widgets[`w${++n}`] = {
        type,
        // Row 0 is the tab bar's. A page's col/row are the PANEL's grid, not an offset inside
        // the tabs widget's box — so the content starts below the bar rather than inside it.
        col: i % AUTO_COLS,
        row: 1 + Math.floor(i / AUTO_COLS),
        bind: p.name,
        label: labelOf(p.name),
        ...(type === "knob"
          ? { min: p.meta?.min ?? 0, max: p.meta?.max ?? 1 }
          : { options: p.meta?.states ?? [] }),
      };
    });
    pages[g.page] = widgets;
  }
  return {
    cols: AUTO_COLS,
    rows: 1 + rowsNeeded,
    widgets: {
      // The bar spans the panel, so a module with a dozen families can still show them all.
      tabs: { type: "tabs", col: 0, row: 0, colSpan: AUTO_COLS, pages },
    },
  };
}
