// autoLayout.ts — a panel PROPOSED from a parameter list alone: read each name, guess which
// family it belongs to, and lay the families out as the panel's tabs, one each. Pure, so the
// guess is testable without a grid; what it returns is an ordinary ModuleUI the editor can then
// take apart by hand. Nothing here is authoritative — see docs/autoLayout.md.

import type { ParamMeta } from "@studio/engine-protocol";
import {
  INPUT_VOLUME_PARAM,
  MIX_PARAM,
  OUTPUT_VOLUME_PARAM,
  ownLevelSide,
  ownMixSide,
} from "@studio/song-schema/moduleTypes";

/** The engine's stage around any plugin: what the mix corner holds. */
const STAGE = new Set([INPUT_VOLUME_PARAM, MIX_PARAM, OUTPUT_VOLUME_PARAM]);

import { LAYOUT_MAX } from "./layoutTwins";
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
  STAGE.has(name) ||
  (familyOf(name) === MIX_PAGE && BLEND_WORD.test(readable(name)));

/** `MPE_PitchBend_3` and `Pitch Bend` are the same string to a pattern. */
const readable = (name: string): string =>
  name.replace(/[_-]+/g, " ").toLowerCase();

/** Which family a parameter's NAME suggests. Exported because the guess is the whole feature. */
export function familyOf(name: string): string {
  // The ENGINE's stage — blend and levels — is the module's mix corner, never a mixer-strip control like the other `@` binds.
  if (STAGE.has(name)) return MIX_PAGE;
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

/** The preset a plugin is built from, which leads its page. */
const BASE_BIND = "@base";

/** One placement: a parameter and its slot, before either coordinate is multiplied into cells. */
interface Slot {
  p: AutoParam;
  sc: number;
  sr: number;
}

/** One page to lay out: its name, and its parameters in order — `@base` first, the blend last (docs/autoLayout.md). */
interface Page {
  page: string;
  params: AutoParam[];
}

/** A page's parameters row-major, `perRow` slots to a row: the one placement both shapes use. */
const flow = (params: readonly AutoParam[], perRow: number): Slot[] =>
  params.map((p, i) => ({
    p,
    sc: i % perRow,
    sr: Math.floor(i / perRow),
  }));

/** The horizontal shape's height in SLOT rows: two, so the panel is four cells tall (layouts.md). */
const HORIZONTAL_SLOT_ROWS = LAYOUT_MAX / KNOB_SPAN;

/** The vertical shape's width in slots: two knobs, four cells (layouts.md). */
const VERTICAL_PER_ROW = LAYOUT_MAX / KNOB_SPAN;

/** The widest a horizontal page runs before it is wrapped — six knobs, twelve cells, as a hardware strip. */
export const AUTO_PER_ROW = 6;

/** One shape of the panel: every page placed `perRow` to a row, numbered across the whole panel. */
function shape(
  pages: readonly Page[],
  perRow: number,
): {
  cols: number;
  rows: number;
  pages: { name: string; widgets: Record<string, Widget> }[];
} {
  let n = 0;
  let width = 1;
  let height = 1;
  const out = pages.map((g) => {
    const widgets: Record<string, Widget> = {};
    for (const { p, sc, sr } of flow(g.params, perRow)) {
      const type = widgetTypeFor(p);
      width = Math.max(width, (sc + 1) * KNOB_SPAN);
      height = Math.max(height, (sr + 1) * KNOB_SPAN);
      widgets[`w${++n}`] = {
        type,
        col: sc * KNOB_SPAN,
        row: sr * KNOB_SPAN,
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
    return { name: g.page, widgets };
  });
  return { cols: width, rows: height, pages: out };
}

/** A whole panel proposed from a parameter list, in both its shapes — see docs/autoLayout.md and layouts.md. */
export function autoOrganize(params: readonly AutoParam[]): ModuleUI {
  // What the engine's stage offers REPLACES the plugin's own: its dry/wet under `@mix`, its levels under the volumes — engine docs/mix.md.
  const has = (n: string) => params.some((p) => p.name === n);
  const held = (n: string) =>
    (has(MIX_PARAM) && !!ownMixSide(n)) ||
    (has(INPUT_VOLUME_PARAM) && ownLevelSide(n) === "input") ||
    (has(OUTPUT_VOLUME_PARAM) && ownLevelSide(n) === "output");
  // …and the stage itself is the card's FOOTER, never a control on the panel.
  const groups = groupParams(
    params.filter((p) => !held(p.name) && !STAGE.has(p.name)),
  );
  if (!groups.length) return { cols: KNOB_SPAN, rows: 1, widgets: {} };

  // `@base` leads its page and a blend closes it, so both shapes read the same way round.
  const pages: Page[] = groups.map((g) => {
    const base = g.params.filter((x) => x.name === BASE_BIND);
    const blend = g.params.filter((x) => isBlend(x.name));
    const rest = g.params.filter(
      (x) => !base.includes(x) && !blend.includes(x),
    );
    return { page: g.page, params: [...base, ...rest, ...blend] };
  });
  // Horizontal: two slot rows a page, as wide as the biggest page needs — wrapped onto a second page past six.
  const longest = Math.max(...pages.map((g) => g.params.length));
  const perRow = Math.min(
    Math.max(1, Math.ceil(longest / HORIZONTAL_SLOT_ROWS)),
    AUTO_PER_ROW,
  );
  const wrapped = pages.flatMap((g) => {
    const per = perRow * HORIZONTAL_SLOT_ROWS;
    if (g.params.length <= per) return [g];
    const parts: Page[] = [];
    for (let i = 0; i < g.params.length; i += per)
      parts.push({
        page: i ? `${g.page} ${i / per + 1}` : g.page,
        params: g.params.slice(i, i + per),
      });
    return parts;
  });
  const across = shape(wrapped, perRow);
  const down = shape(wrapped, VERTICAL_PER_ROW);
  // One family is a panel, not a tab: the second is what makes the list (docs/autoLayout.md).
  const single = across.pages.length <= 1;
  const panel = (s: typeof across) =>
    single
      ? { cols: s.cols, rows: s.rows, widgets: s.pages[0]?.widgets ?? {} }
      : { cols: s.cols, rows: s.rows, widgets: {}, tabs: s.pages };
  const horizontal = panel(across);
  // The vertical twin only where the panel is too wide to serve both shapes (layouts.md).
  return horizontal.cols > LAYOUT_MAX
    ? { ...horizontal, vertical: panel(down) }
    : horizontal;
}
