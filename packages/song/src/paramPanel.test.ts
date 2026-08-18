// A plugin's parameters turned into a panel. The interesting half is the GROUPING, and the
// fixture that matters is 4OSC's real 88 — the richest thing the engine ships, and the one this
// was asked for on the basis of. It comes from the generated table, so a regeneration that
// renames a parameter fails here rather than quietly re-filing it.

import { describe, expect, it } from "vitest";
import { BUILTIN_PLUGINS, type BuiltinParam } from "./builtinParams";
import {
  groupParams,
  PANEL_COLS,
  paramPanel,
  paramWidget,
  splitIndex,
} from "./paramPanel";
import { UISchema } from "./yaml/moduleSchema";

const FOUR_OSC = BUILTIN_PLUGINS["4osc"].params;

/** n knobs with distinct names, for the threshold tests. */
const knobs = (names: string[]): BuiltinParam[] =>
  names.map((name) => ({ name, min: 0, max: 1 }));

describe("splitIndex", () => {
  it("takes a trailing number off, and leaves a name that has none", () => {
    expect(splitIndex("Tune 3")).toEqual({ stem: "Tune", index: 3 });
    expect(splitIndex("Filter Freq")).toEqual({
      stem: "Filter Freq",
      index: null,
    });
  });

  it("does not eat a name that is ONLY a number", () => {
    // `1` as a param name is a plugin being unhelpful, not a numbered family — and a stem of ""
    // would file it under a tab with no name.
    expect(splitIndex("1").index).toBeNull();
  });

  it("takes the separator with it", () => {
    expect(splitIndex("osc_2").stem).toBe("osc");
    expect(splitIndex("Band-3").stem).toBe("Band");
  });
});

describe("grouping 4OSC's 88 parameters", () => {
  const tabs = groupParams(FOUR_OSC);
  const named = (t: string) => tabs.find((g) => g.tab === t)?.params ?? [];

  it("keeps every parameter, exactly once", () => {
    // The requirement: all of them. A panel that quietly dropped the ones it could not file
    // would be the curated list this exists instead of.
    const all = tabs.flatMap((t) => t.params.map((p) => p.name));
    expect(all.slice().sort()).toEqual(
      FOUR_OSC.map((p) => p.name)
        .slice()
        .sort(),
    );
    expect(new Set(all).size).toBe(FOUR_OSC.length);
  });

  it("makes a tab of each family the plugin named by prefixing it", () => {
    // The author already grouped these, and the panel's job is to notice rather than re-decide.
    // Three families, and they are the ones 4OSC actually spells out.
    expect(named("Filter").map((p) => p.name)).toContain("Filter Freq");
    expect(named("Filter").map((p) => p.name)).toContain("Filter Type");
    expect(named("Amp").map((p) => p.name)).toContain("Amp Attack");
    for (const w of ["Filter", "Amp"])
      expect(named(w).length, w).toBeGreaterThanOrEqual(3);
    // NOT `Mod`: `Mod Attack 1` carries a number, so it went to page 1 with the rest of what
    // is numbered 1. A word only speaks for the params that have no number to speak for them.
    expect(tabs.map((t) => t.tab)).not.toContain("Mod");
  });

  it("puts the four oscillators on four pages, not nine", () => {
    // The signal that fires second: seven controls repeated across four numbers. Four pages of
    // nine reads; nine pages of four does not.
    for (const n of ["1", "2", "3", "4"]) {
      const page = named(n).map((p) => p.name);
      expect(page, n).toContain(`Tune ${n}`);
      expect(page, n).toContain(`Wave Shape ${n}`);
      expect(page, n).toContain(`Pan ${n}`);
    }
  });

  /**
   * WHAT NAMES CANNOT DO, pinned so it is a known cost rather than a surprise.
   *
   * 4OSC's built-in effects register their params with NO prefix at all — the reverb is `Size`,
   * `Damping`, `Width`, `Mix`; the delay is `Feedback`, `Crossfeed`, `Mix #2`; the chorus is
   * `Speed`, `Depth`, `Width #2`, `Mix #3`. The ` #n` is Tracktion deduplicating three params
   * called `Mix`, not a family. Nothing in those names says which effect they belong to, so
   * nothing that reads names can file them — and the only other signal, registration ORDER, says
   * where a run begins and never where it ends.
   *
   * They land in the remainder, which is the honest answer. What is NOT acceptable is a table of
   * 4OSC's effect layout hidden inside a generic function: it would be right for this plugin and
   * a lie for the next, and nothing would say which.
   */
  it("leaves the effects in the remainder, because their names say nothing", () => {
    const rest = named("Général").map((p) => p.name);
    for (const n of ["Size", "Damping", "Feedback", "Crossfeed", "Speed"])
      expect(rest, n).toContain(n);
  });

  it("puts everything numbered 1 on ONE page, LFO and envelope included", () => {
    // The cost of the number winning, said out loud. 4OSC gives its two LFOs and its two mod
    // envelopes bare stems over the same 1..2 the oscillators use, so page 1 is oscillator one
    // AND LFO one AND envelope one. Nothing in the names separates them — `Rate 1` says which
    // one, never which KIND — and a table of 4OSC's layout hidden in a generic function would
    // be right here and a lie for the next plugin.
    const page1 = named("1").map((p) => p.name);
    expect(page1).toContain("Tune 1");
    expect(page1).toContain("Rate 1");
    expect(page1).toContain("Mod Attack 1");
    // …and the pages with no LFO on them stay the size of an oscillator.
    expect(named("3")).toHaveLength(9);
  });

  it("does not make a family out of a DEDUP suffix", () => {
    // `Mix`, `Mix #2`, `Mix #3` are the reverb's, the delay's and the chorus's. Tracktion
    // suffixed them because the names collided — so the ` #n` is proof they are unrelated, and
    // grouping on it would file three effects' mix knobs together as if they were one thing.
    expect(tabs.map((t) => t.tab)).not.toContain("Mix");
    const rest = named("Général").map((p) => p.name);
    expect(rest).toContain("Mix");
    expect(rest).toContain("Mix #2");
  });

  it("ends with the remainder, in a tab that is last", () => {
    // What did not sort — `Voice Mode`, `Legato`, `Master Level`. Last because it is the
    // leftovers and not one subject among the others.
    expect(tabs[tabs.length - 1].tab).toBe("Général");
    expect(tabs[tabs.length - 1].params.length).toBeGreaterThan(0);
  });
});

describe("when NOT to make tabs", () => {
  it("leaves a small panel flat", () => {
    // Tabs exist to stop a wall of knobs. Eight of them is not a wall, and filing them behind
    // three clicks hides two thirds of a panel that fitted on screen.
    const ui = paramPanel(knobs(["a", "b", "c", "d", "e", "f", "g", "h"]));
    expect(ui.widgets.tabs).toBeUndefined();
    expect(Object.keys(ui.widgets)).toHaveLength(8);
  });

  it("does not make a family of a word that IS the whole name", () => {
    // A tab called Volume holding one knob called Volume is a click that shows you what its own
    // label already said.
    const ui = groupParams(
      knobs([
        "Volume",
        "Pan",
        "Low",
        "Mid",
        "High",
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "g",
      ]),
    );
    expect(ui.map((t) => t.tab)).toEqual(["Général"]);
  });

  it("does not make a numbered family out of ONE number", () => {
    // `Band 1` alone is a param that happens to end in a digit.
    const groups = groupParams(
      knobs(["Band 1", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"]),
    );
    expect(groups.map((t) => t.tab)).toEqual(["Général"]);
  });

  it("has nothing to say about a plugin with no parameters", () => {
    // Patch Bay, Text, Insert — their state is not parameters. An empty grid, not a crash.
    const ui = paramPanel([]);
    expect(ui.widgets).toEqual({});
    expect(UISchema.safeParse(ui).success).toBe(true);
  });
});

describe("the widget a parameter gets", () => {
  it("is a dropdown when the plugin NAMED its settings", () => {
    const shape = FOUR_OSC.find((p) => p.name === "Wave Shape 1")!;
    const w = paramWidget(shape, 0, 0);
    expect(w.type).toBe("dropdown");
    expect(w.options?.map((o) => o.label)).toContain("Sine");
    // The VALUE rides with each label: the mapping is the plugin's, not index/(n-1).
    expect(w.options?.find((o) => o.label === "Sine")?.value).toBe(1);
  });

  it("is a knob carrying the REAL range otherwise", () => {
    // The half a hand-typed binding never has. A knob drawn 0..1 on a -36..+36 semitone param
    // does not look wrong; it writes the wrong number.
    const w = paramWidget(FOUR_OSC.find((p) => p.name === "Tune 1")!, 1, 2);
    expect(w).toMatchObject({
      type: "knob",
      min: -36,
      max: 36,
      col: 1,
      row: 2,
    });
    expect(w.bind).toBe("Tune 1");
  });

  it("never guesses a toggle from a 0..1 range", () => {
    // Inferring one would draw a switch over every mix control on the panel.
    expect(paramWidget({ name: "Mix", min: 0, max: 1 }, 0, 0).type).toBe(
      "knob",
    );
  });
});

describe("the panel it builds", () => {
  const ui = paramPanel(FOUR_OSC);

  it("is a file the schema accepts", () => {
    // It is written to disk as `ui.yaml` and read back by the same parser the editor uses, so
    // a panel this refused would be a generated file the builder greys itself out on.
    expect(UISchema.safeParse(ui).success).toBe(true);
  });

  it("is one tabs widget filling the grid", () => {
    expect(Object.keys(ui.widgets)).toEqual(["tabs"]);
    expect(ui.widgets.tabs).toMatchObject({
      type: "tabs",
      col: 0,
      row: 0,
      colSpan: PANEL_COLS,
    });
    expect(ui.widgets.tabs.rowSpan).toBe(ui.rows);
  });

  it("binds all 88, across its pages", () => {
    const bound = Object.values(ui.widgets.tabs.pages ?? {}).flatMap((page) =>
      Object.values(page).map((w) => w.bind),
    );
    expect(bound.slice().sort()).toEqual(
      FOUR_OSC.map((p) => p.name)
        .slice()
        .sort(),
    );
  });

  it("lays every page out inside the grid it declares", () => {
    // A widget past `cols` or `rows` is drawn nowhere. The grid is sized to the TALLEST page,
    // because the pages share one cell of the outer one.
    for (const [name, page] of Object.entries(ui.widgets.tabs.pages ?? {}))
      for (const w of Object.values(page)) {
        expect(w.col, name).toBeLessThan(PANEL_COLS);
        expect(w.row, name).toBeLessThan(ui.rows);
      }
  });
});
