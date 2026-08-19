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

/**
 * `@base`'s page, and the panel's first tab — and it holds NOTHING else.
 *
 * `@base` decides which `.vstpreset` the plugin is built from, so every parameter on every other
 * page is describing that choice. It opens the panel for that reason, and it is alone there for
 * the same one: a page is a place to look for a control, and a page holding the one thing the
 * rest hangs off says what it is at a glance.
 *
 * It held every `@` name once — the lane's volume and pan, an input's gain and monitoring — on
 * the argument that those are the module's own controls rather than the plugin's. True, and not
 * a reason to draw them: a mixer strip already shows all of them, so a proposal that repeats them
 * spends its front page on a second copy of a fader you have. They are dropped now (see
 * `TRACK_PAGE`), which left `@base` holding this page by itself.
 *
 * Named in English like every other page here, though the tabs are what a musician reads — one
 * language per bar, and the other eleven are `Reverb`, `Filter`, `Envelope`…
 */
export const GENERAL_PAGE = "General";

/**
 * The lane's own controls, matched so they can be LEFT OUT — the third dropped family, beside
 * `Preset` and `MIDI`, and dropped for a different reason than either.
 *
 * Those two are plumbing nobody turns. These are controls somebody turns constantly — and that
 * is the point: `@volume`, `@pan`, `@mute`, `@solo`, `@arm` are the LANE's, `@gain` and
 * `@monitor` an input's, and every one of them is already drawn by the strip the mixer shows for
 * that lane. Proposing them again puts a second fader on screen wired to the first, which is a
 * question about which one is real that the panel cannot answer.
 *
 * `@base` is the exception and asks first: it names no strip control, and nothing else draws it.
 */
const TRACK_PAGE = "Track";

/** The output stage — levels, pan, width, and the blend words `isBlend` asks about. LAST in the
 *  table, so a name reaching it is one no effect wanted. */
const MIX_PAGE = "Mix";

/**
 * The families, IN ORDER — the first whose pattern matches a name takes it.
 *
 * Order is the algorithm. Nearly every conflict here is one word claimed by two families, and
 * the specific one has to ask first: `Comp Make Up gain` is dynamics and not a level, `Low Shelf
 * Gain` is an EQ and not a level, `Bell Freq` is an EQ and not a filter, `Reverb Decay Start` is
 * a reverb and not an envelope, `Comp Attack` is dynamics and not an envelope. Reordering this
 * table silently rehomes parameters, which is why the pairs above are pinned by tests.
 *
 * `Preset` and `MIDI` lead because they are not sound at all, and they are the two families the
 * layout then LEAVES OUT (`drop`). A modern instrument publishes dozens of them — Arturia's
 * Piano V3 alone publishes sixteen `VST_ProgramChange_*`, sixteen `MPE_PitchBend_*` and a whole
 * KeyLab remote — and every one of those left among the knobs is a knob nobody will ever turn,
 * sitting where a real one could have been. They stay matched rather than unmatched so they are
 * recognised on purpose instead of falling into `Other`; `familyOf` still names them, and a
 * parameter left out here is still one drag away from the params list.
 *
 * The patterns are matched against the name LOWERCASED with `_` read as a space, so
 * `MPE_PitchBend_3` and `Pitch Bend` are the same string to look at.
 */
const FAMILIES: {
  page: string;
  match: RegExp;
  drop?: true;
}[] = [
  // The `@` namespace, first, because `@volume` and `@gain` would otherwise read as levels: these
  // are not the plugin's parameters at all, and the params list offers them on every module.
  //
  // TWO entries, and the order between them is the whole rule: `@base` takes the front page, and
  // every OTHER intrinsic is recognised in order to be dropped. Anchored `^@base$` rather than a
  // prefix — `@base_mix` would be a plugin parameter that happens to start with the word.
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

/**
 * Whether a parameter is the module's OWN blend — how much of this module you hear at all, as
 * against how much of what went into it.
 *
 * The test is the FAMILY, not the word. `Reverb Dry/Wet`, `Delay Mix` and `Chorus Wet` carry the
 * word too and each belongs to its effect — and the effect families ask before `Mix` does, so a
 * blend word still sitting in `Mix` at the end is one no effect claimed: a bare `Mix`, `Dry/Wet`,
 * `Dry`, `Wet`. That one is the module's own. The table's order does the work; there is no
 * second list of effect names to keep in step with the first.
 *
 * It decides a POSITION and no longer a page. It used to be pulled onto `General`, with the other
 * controls that were about the module rather than about its sound; `General` is `@base` alone
 * now, and a blend is a level — so it stays in `Mix`, where its family already put it, and only
 * the corner treatment below survives.
 *
 * Exported because that position is not guessable from a name.
 */
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
 * The pages, holding only the families that got something — and never a `drop` one.
 *
 * Three are matched so they can be LEFT OUT: a hundred and fifty parameters is the case this
 * exists for, and a proposal that spends its pages on program changes and browser navigation has
 * answered the wrong question. `Track` is dropped for a different reason than the other two —
 * not plumbing but a duplicate, since the mixer already draws every control in it. None of them
 * is lost: the params list still offers every one, and a panel that really wants a preset button
 * is one drag away from it.
 *
 * One order answers both questions — which family CLAIMS a name, and which order the pages are
 * read in. The `@` namespace has to ask before `Mix` (else `@volume` reads as a level), and
 * `General` is also the page to open on, so the table's own order is the tab bar's.
 *
 * `Other` after all of them: it is where the guess gave up, and a page of leftovers ahead of a
 * page of reverb controls would say the opposite of what the layout is for.
 */
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

/**
 * Where each of a page's parameters goes, in SLOTS — column and row, before either is multiplied
 * out into cells.
 *
 * Row-major, six to a row, with one exception: `@base` takes the first row alone. It is not a
 * control like the others — it is which `.vstpreset` the plugin is built from, so it decides what
 * every parameter on every other page is even doing (`@studio/song`'s docs/userPresets.md).
 *
 * The exception is QUIET today, and kept rather than deleted. `@base` is the only thing that
 * lands on `General` now — the other intrinsics are dropped — so the row it takes for itself is
 * also the only row on that page, and `top` never shifts anything. It stops being quiet the day
 * something else joins it, which is a smaller change than rediscovering why a base needs its own
 * line. Every other page is laid out from the first row down.
 */
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

  // Laid out first, because the panel's height is the tallest PAGE and a page's height is no
  // longer its parameter count: the one holding `@base` spends a row on it, and a blend sits on
  // the bottom row whether or not anything else reaches that far.
  const placed = groups.map((g) => {
    const blend = g.params.filter((x) => isBlend(x.name));
    return {
      page: g.page,
      blend,
      at: placeGroup(g.params.filter((x) => !blend.includes(x))),
    };
  });
  // The tallest page, and never less than one row: a page holding only a blend still needs the
  // row the blend goes on.
  let rowsNeeded = Math.max(1, ...placed.map((g) => rowsOf(g.at)));
  // …and one row more when that bottom row's right-hand end is already spoken for, rather than
  // stacking the blend on a knob where nothing on screen would say which of the two is which.
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
  // The corner, right-aligned: a `dry` and a `wet` are two halves of one control and travel
  // together, ending at the panel's edge. Set apart the way an output stage is set apart on a
  // real panel — and at the far end from `@base`, which holds the opposite corner.
  for (const g of placed)
    g.at.push(
      ...g.blend.map((p, i) => ({
        p,
        sc: AUTO_PER_ROW - g.blend.length + i,
        sr: rowsNeeded - 1,
      })),
    );
  // One slot row of air under the tallest page, always. Two reasons, and the second is the one
  // that made it a rule: a panel whose bottom control sits flush against its edge reads as
  // cropped — as though the next row were there and not being drawn — and the grid editor needs
  // somewhere to DROP a parameter that is not already on top of a widget. Without it, adding the
  // first control past the proposal means resizing the panel before you can aim at anything.
  //
  // A SLOT row (`KNOB_SPAN` cells), not a cell row: what has to fit there is a control, and half
  // a knob of clearance is a margin rather than a place to put one.
  //
  // Counted after the blend is placed, so the air is under the bottom row rather than instead of
  // it — `rowsNeeded` stays the height of the CONTENT and nothing above reads this.
  const rowsDrawn = rowsNeeded + 1;
  const pages: Record<string, Record<string, Widget>> = {};
  // Numbered across the WHOLE panel rather than restarting on each page. Nothing requires it —
  // pages are separate maps and the hand editor's `nextId` does restart — but a panel where `w40`
  // names one widget is a panel you can talk about without also saying which page it is on.
  let n = 0;
  for (const g of placed) {
    const widgets: Record<string, Widget> = {};
    for (const { p, sc, sr } of g.at) {
      const type = widgetTypeFor(p);
      widgets[`w${++n}`] = {
        type,
        // Row 0 is the tab bar's. A page's col/row are the PANEL's grid, not an offset inside
        // the tabs widget's box — so the content starts below the bar rather than inside it.
        col: sc * KNOB_SPAN,
        row: 1 + sr * KNOB_SPAN,
        bind: p.name,
        label: labelOf(p.name),
        // One slot each, so the two kinds line up in the same columns; only the knob fills the
        // slot's height, a dropdown being one row of text with nothing to put under it.
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
