// autoLayout.ts — a panel PROPOSED from a parameter list alone: read each name, guess which
// family it belongs to, and lay the families out as the pages of one tabs widget. Pure, so the
// guess is testable without a grid; what it returns is an ordinary ModuleUI the editor can then
// take apart by hand. Nothing here is authoritative — see docs/autoLayout.md.

import type { ParamMeta } from "@studio/engine-protocol";
import {
  KNOB_SPAN,
  type ModuleUI,
  type Widget,
  type WidgetType,
} from "./moduleUi";

/** One parameter to place: its name, and its range if anything knows it. */
export interface AutoParam {
  name: string;
  meta?: ParamMeta;
}

/** `@base`'s page and the panel's first tab, holding NOTHING else — see docs/autoLayout.md. */
export const GENERAL_PAGE = "General";

/** The lane's own controls, matched so they can be LEFT OUT — the mixer already draws every one. */
const TRACK_PAGE = "Track";

/** The output stage, LAST in the table, so a name reaching it is one no effect wanted. */
const MIX_PAGE = "Mix";

/** The families IN ORDER, which is the algorithm — reordering rehomes parameters; docs/autoLayout.md. */
const FAMILIES: {
  page: string;
  match: RegExp;
  drop?: true;
}[] = [
  // The `@` namespace first, in two entries whose order is the whole rule — see docs/autoLayout.md.
  { page: GENERAL_PAGE, match: /^@base$/ },
  { page: TRACK_PAGE, drop: true, match: /^@/ },
  {
    page: "Preset",
    drop: true,
    // The plugin's own browser, driven from a controller: these move a selection, not a sound.
    match:
      /\bpreset|browse|navigate|keylab|hardware|controller|\bundo\b|\bredo\b|oct (minus|plus)|(active|multi|selected|clear) filter|filter (preset|category)/,
  },
  {
    page: "MIDI",
    drop: true,
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
    page: MIX_PAGE,
    match:
      /level|volume|\bgain\b|\bmix\b|\bdry\b|\bwet\b|\bpan\b|width|output|master|input|balance/,
  },
];

/** Where a name goes when nothing claims it — a page, not the floor: a guess never loses a name. */
export const OTHER_PAGE = "Other";

/** The families the proposal leaves out entirely — the plugin's plumbing, not its sound. */
const DROPPED = new Set(FAMILIES.filter((f) => f.drop).map((f) => f.page));

/** Whether a parameter is plumbing the proposal skips. Exported so the skip is testable. */
export const isPlumbing = (name: string): boolean =>
  DROPPED.has(familyOf(name));

/** A dry/wet/mix WORD. Alone it proves nothing — `Reverb Dry/Wet` has one too; see `isBlend`. */
const BLEND_WORD = /\b(dry|wet|mix)\b/;

/** Whether a parameter is the module's OWN blend — the test is the FAMILY, not the word; docs/autoLayout.md. */
export const isBlend = (name: string): boolean =>
  familyOf(name) === MIX_PAGE && BLEND_WORD.test(readable(name));

/** `MPE_PitchBend_3` and `Pitch Bend` are the same string to a pattern. */
const readable = (name: string): string =>
  name.replace(/[_-]+/g, " ").toLowerCase();

/** Which family a parameter's NAME suggests. Exported because the guess is the whole feature. */
export function familyOf(name: string): string {
  const s = readable(name);
  for (const f of FAMILIES) if (f.match.test(s)) return f.page;
  return OTHER_PAGE;
}

/** What to draw a parameter with — the same answers `createBound` gives, so both gestures agree. */
function widgetTypeFor(p: AutoParam): WidgetType {
  return p.meta?.states?.length ? "dropdown" : "knob";
}

/** A bound widget's label is the param's name; the "@" of an intrinsic goes, it marks a namespace. */
const labelOf = (name: string) => name.replace(/^@/, "");

/** The pages that got something, never a `drop` one, in the table's own order — docs/autoLayout.md. */
export function groupParams(
  params: readonly AutoParam[],
): { page: string; params: AutoParam[] }[] {
  const byPage = new Map<string, AutoParam[]>();
  for (const p of params) {
    const page = familyOf(p.name);
    if (DROPPED.has(page)) continue;
    const held = byPage.get(page);
    if (held) held.push(p);
    else byPage.set(page, [p]);
  }
  const order = [
    ...FAMILIES.filter((f) => !f.drop).map((f) => f.page),
    OTHER_PAGE,
  ];
  return order
    .filter((page) => byPage.has(page))
    .map((page) => ({ page, params: byPage.get(page) ?? [] }));
}

/** Six knobs a row is what the drawn panels in this repo use. */
export const AUTO_PER_ROW = 6;

/** The one parameter that gets a row to itself. See `placeGroup`. */
const BASE_BIND = "@base";

/** One placement: a parameter and its slot, before either coordinate is multiplied into cells. */
interface Slot {
  p: AutoParam;
  sc: number;
  sr: number;
}

/** How many slot rows a set of placements needs. Zero for none — `Math.max` of nothing is -Infinity. */
const rowsOf = (at: readonly Slot[]): number =>
  at.length ? Math.max(...at.map((x) => x.sr)) + 1 : 0;

/** Where a page's parameters go in SLOTS: row-major, six to a row, `@base` alone — docs/autoLayout.md. */
function placeGroup(params: readonly AutoParam[]): Slot[] {
  const base = params.find((p) => p.name === BASE_BIND);
  const rest = base ? params.filter((p) => p !== base) : params;
  const top = base ? 1 : 0; // which slot row the rest starts on
  return [
    ...(base ? [{ p: base, sc: 0, sr: 0 }] : []),
    ...rest.map((p, i) => ({
      p,
      sc: i % AUTO_PER_ROW,
      sr: top + Math.floor(i / AUTO_PER_ROW),
    })),
  ];
}

/** How wide the proposed panel is: six SLOTS, each `KNOB_SPAN` cells across, since a knob is 2×2. */
export const AUTO_COLS = AUTO_PER_ROW * KNOB_SPAN;

/** A whole panel proposed from a parameter list, sized to the BIGGEST page — see docs/autoLayout.md. */
export function autoOrganize(params: readonly AutoParam[]): ModuleUI {
  const groups = groupParams(params);
  if (!groups.length) return { cols: AUTO_COLS, rows: 1, widgets: {} };

  // Laid out first, a page's height no longer being its parameter count — see docs/autoLayout.md.
  const placed = groups.map((g) => {
    const blend = g.params.filter((x) => isBlend(x.name));
    return {
      page: g.page,
      blend,
      at: placeGroup(g.params.filter((x) => !blend.includes(x))),
    };
  });
  // The tallest page, never under one row: a page holding only a blend still needs the blend's row.
  let rowsNeeded = Math.max(1, ...placed.map((g) => rowsOf(g.at)));
  // …and one more when that row's right-hand end is taken, rather than stacking the blend on a knob.
  if (
    placed.some(
      (g) =>
        g.blend.length &&
        g.at.some(
          (x) =>
            x.sr === rowsNeeded - 1 && x.sc >= AUTO_PER_ROW - g.blend.length,
        ),
    )
  )
    rowsNeeded += 1;
  // The corner, right-aligned and at the far end from `@base` — see docs/autoLayout.md.
  for (const g of placed)
    g.at.push(
      ...g.blend.map((p, i) => ({
        p,
        sc: AUTO_PER_ROW - g.blend.length + i,
        sr: rowsNeeded - 1,
      })),
    );
  // One SLOT row of air under the tallest page, always, and counted last — see docs/autoLayout.md.
  const rowsDrawn = rowsNeeded + 1;
  const pages: Record<string, Record<string, Widget>> = {};
  // Numbered across the WHOLE panel, so `w40` names one widget without also naming its page.
  let n = 0;
  for (const g of placed) {
    const widgets: Record<string, Widget> = {};
    for (const { p, sc, sr } of g.at) {
      const type = widgetTypeFor(p);
      widgets[`w${++n}`] = {
        type,
        // Row 0 is the tab bar's, a page's col/row being the PANEL's grid rather than an offset in it.
        col: sc * KNOB_SPAN,
        row: 1 + sr * KNOB_SPAN,
        bind: p.name,
        label: labelOf(p.name),
        // One slot each so both kinds line up; only the knob fills the slot's height.
        colSpan: KNOB_SPAN,
        ...(type === "knob"
          ? {
              rowSpan: KNOB_SPAN,
              min: p.meta?.min ?? 0,
              max: p.meta?.max ?? 1,
            }
          : { options: p.meta?.states ?? [] }),
      };
    }
    pages[g.page] = widgets;
  }
  return {
    cols: AUTO_COLS,
    rows: 1 + rowsDrawn * KNOB_SPAN,
    widgets: {
      // The bar spans the panel, so a module with a dozen families can still show them all.
      tabs: { type: "tabs", col: 0, row: 0, colSpan: AUTO_COLS, pages },
    },
  };
}
