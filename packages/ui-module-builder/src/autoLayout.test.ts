// What "Auto organize" proposes, and the one thing that decides it: which family a NAME suggests.
// The interesting cases are all collisions — a word two families want — and the family table's
// order is what settles them, so most of this file is those pairs pinned in place.

import { LAYOUT_MAX, twinIssues } from "@studio/panel-rules/layout-twins";
import { UISchema } from "@studio/song-schema/yaml/moduleSchema";
import { describe, expect, it } from "vitest";
import {
  type AutoParam,
  autoOrganize,
  familyOf,
  GENERAL_PAGE,
  groupParams,
  isBlend,
  isPlumbing,
} from "./autoLayout";
import type { ModuleUI, Widget } from "./moduleUi";

/** Every page as name → widgets: the tabs, or the panel itself when one family made no tabs. */
const pagesOf = (ui: ModuleUI): Record<string, Record<string, Widget>> =>
  ui.tabs
    ? Object.fromEntries(ui.tabs.map((t) => [t.name, t.widgets]))
    : { "": ui.widgets };
/** One family's widgets: its tab, or the whole panel when it is the only family. */
const pageOf = (ui: ModuleUI, name: string): Record<string, Widget> =>
  ui.tabs ? (ui.tabs.find((t) => t.name === name)?.widgets ?? {}) : ui.widgets;

const p = (name: string, meta?: AutoParam["meta"]): AutoParam => ({
  name,
  meta,
});

describe("which family a name suggests", () => {
  it("reads a family off the obvious word", () => {
    expect(familyOf("Reverb Room Size")).toBe("Reverb");
    expect(familyOf("Filter Cutoff")).toBe("Filter");
    expect(familyOf("Osc 1 Wave")).toBe("Oscillator");
    expect(familyOf("Master Volume")).toBe("Mix");
  });

  it("sends what nothing claims to a page rather than to the floor", () => {
    // `String Tension` is a real Piano V3 parameter belonging to no family here — it still gets a widget.
    expect(familyOf("String Tension")).toBe("Other");
    expect(familyOf("Hammer Hardness")).toBe("Other");
  });

  it("reads `_` as a space, so a wire name and a written one look alike", () => {
    expect(familyOf("MPE_PitchBend_3")).toBe("MIDI");
    expect(familyOf("Pitch Bend")).toBe("MIDI");
  });

  // Each is a word two families want, pinned because reordering the table to fix one rehomes the others.
  it.each([
    ["Comp Make Up gain", "Dynamics", "a make-up gain is not a level"],
    ["Comp Attack", "Dynamics", "a compressor's attack is not an envelope"],
    ["Low Shelf Gain", "EQ", "a shelf's gain is not a level"],
    ["Bell Freq", "EQ", "a bell is an EQ band, not a filter"],
    ["Reverb Decay Start", "Reverb", "a reverb's decay is not an envelope"],
    ["Reverb Dry/Wet", "Reverb", "a reverb's dry/wet is not the panel's mix"],
    ["MPE_Brightness_0", "MIDI", "an MPE dimension is not a tone control"],
    [
      "Navigate through filters",
      "Preset",
      "the browser's filters are not audio filters",
    ],
    ["Active Filter Category", "Preset", "so is this one"],
    [
      "Pitch Transpose",
      "Tuning",
      "a bare pitch is tuning; only `pitch bend` is MIDI",
    ],
  ])("puts %s under %s — %s", (name, page) => {
    expect(familyOf(name)).toBe(page);
  });

  // `familyOf` still NAMES these and `groupParams` leaves them out: falling into `Other` is not the same.
  it("keeps the plugin's plumbing away from the knobs", () => {
    // Piano V3 publishes sixteen of each: sixteen knobs nobody will turn, in a real one's place.
    for (const n of [
      "VST_ProgramChange_7",
      "VST3_PitchBend",
      "MPE_Aftertouch_2",
    ])
      expect(familyOf(n)).toBe("MIDI");
    for (const n of ["Select Preset", "Next Preset", "HardwareDisplayControl3"])
      expect(familyOf(n)).toBe("Preset");
  });
});

describe("the pages", () => {
  it("keeps the table's order, and puts the leftovers last", () => {
    // `Other` is where the guess gave up, so it cannot come before a page of reverb controls.
    const groups = groupParams([
      p("String Tension"),
      p("Master Volume"),
      p("Reverb Room Size"),
    ]);
    expect(groups.map((g) => g.page)).toEqual(["Reverb", "Mix", "Other"]);
  });

  it("leaves the plumbing out — no Preset page, no MIDI page", () => {
    // Matched so they can be recognised, then skipped; nothing is lost, the params list still has them.
    expect(isPlumbing("Select Preset")).toBe(true);
    expect(isPlumbing("MPE_PitchBend_3")).toBe(true);
    expect(isPlumbing("Filter Cutoff")).toBe(false);
    const groups = groupParams([
      p("Select Preset"),
      p("VST_ProgramChange_7"),
      p("Filter Cutoff"),
    ]);
    expect(groups.map((g) => g.page)).toEqual(["Filter"]);
    expect(groups[0].params).toHaveLength(1);
  });

  it("proposes an empty panel when a plugin publishes nothing else", () => {
    // Not a page of leftovers and not a crash: a schema-valid empty grid, same as no params.
    const ui = autoOrganize([p("Select Preset"), p("MPE_Aftertouch_2")]);
    expect(ui.widgets).toEqual({});
    expect(UISchema.safeParse(ui).success).toBe(true);
  });

  it("claims the lane's own names early — to drop them, `@base` apart", () => {
    // `@pan` reads as a mixer word, so `@` asks before `Mix` — and DROPS them, the strip drawing every one.
    expect(isPlumbing("@pan")).toBe(true);
    expect(isPlumbing("@monitor")).toBe(true);
    expect(isPlumbing("@mute")).toBe(true);
    // …and the one exception, which nothing else draws.
    expect(familyOf("@base")).toBe(GENERAL_PAGE);
    expect(isPlumbing("@base")).toBe(false);
    // Anchored, so a plugin parameter that merely STARTS with the word is not the intrinsic.
    expect(familyOf("@base_mix")).not.toBe(GENERAL_PAGE);
    const groups = groupParams([
      p("Master Volume"),
      p("@pan"),
      p("Hammer Hardness"),
    ]);
    expect(groups.map((g) => g.page)).toEqual(["Mix", "Other"]);
  });

  it("tells the module's OWN blend from an effect's, and moves neither", () => {
    // The test is the FAMILY, not the word: a blend word left in `Mix` is one no effect claimed.
    expect(isBlend("Mix")).toBe(true);
    expect(isBlend("Dry/Wet")).toBe(true);
    expect(isBlend("Reverb Dry/Wet")).toBe(false);
    expect(isBlend("Delay Mix")).toBe(false);
    // …and a level is not a blend, though it lives on the same page.
    expect(isBlend("Master Volume")).toBe(false);
    // It decides a POSITION and never a page: the blend stays in `Mix`, where its family put it.
    const groups = groupParams([p("Mix"), p("Reverb Dry/Wet"), p("@pan")]);
    expect(groups.map((g) => g.page)).toEqual(["Reverb", "Mix"]);
    expect(groups[1].params.map((x) => x.name)).toEqual(["Mix"]);
  });

  it("holds only the families that got something", () => {
    expect(groupParams([p("Filter Cutoff")]).map((g) => g.page)).toEqual([
      "Filter",
    ]);
  });
});

describe("the panel it proposes", () => {
  const params = [
    p("Filter Cutoff", { min: 20, max: 20000 }),
    p("Filter Resonance", { min: 0, max: 1 }),
    p("Master Volume", { min: -60, max: 6 }),
    p("Lid Position", {
      min: 0,
      max: 1,
      states: [
        { label: "Closed", value: 0 },
        { label: "Open", value: 1 },
      ],
    }),
  ];
  const ui = autoOrganize(params);

  it("is the panel's tabs, one a family, and every parameter is on one of them", () => {
    expect(ui.widgets).toEqual({});
    expect(ui.tabs?.length).toBeGreaterThan(1);
    const bound = Object.values(pagesOf(ui)).flatMap((page) =>
      Object.values(page).map((w) => w.bind),
    );
    expect(bound.sort()).toEqual(params.map((x) => x.name).sort());
  });

  it("starts every tab on row 0 — the tabs are a column beside the grid, not a row of it", () => {
    const rows = Object.values(pagesOf(ui)).flatMap((page) =>
      Object.values(page).map((w) => w.row),
    );
    expect(Math.min(...rows)).toBe(0);
  });

  it("carries each parameter's own range, so the panel opens right with no engine", () => {
    const filter = pageOf(ui, "Filter");
    const cutoff = Object.values(filter).find(
      (w) => w.bind === "Filter Cutoff",
    );
    expect(cutoff).toMatchObject({ type: "knob", min: 20, max: 20000 });
  });

  it("draws a parameter with named settings as a dropdown, like a dropped one", () => {
    // The same answers `createBound` gives a DRAGGED parameter, so both gestures make the same widgets.
    const other = pageOf(ui, "Other");
    const lid = Object.values(other).find((w) => w.bind === "Lid Position");
    expect(lid?.type).toBe("dropdown");
    expect(lid?.options).toHaveLength(2);
  });

  it("gives every widget on the panel its own id", () => {
    const ids = Object.values(pagesOf(ui)).flatMap((page) => Object.keys(page));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("opens on General, whatever order the parameters arrived in", () => {
    // The tab bar's order IS the pages' order, and the first entry is the one that shows.
    const ui = autoOrganize([
      p("Reverb Room Size"),
      p("Filter Cutoff"),
      p("@base"),
    ]);
    expect(Object.keys(pagesOf(ui))[0]).toBe(GENERAL_PAGE);
  });

  it("has no General page at all on a module with no base", () => {
    // A page holds only what got something, so a plain effect opens on its own first family.
    const ui = autoOrganize([p("Reverb Room Size"), p("@solo"), p("@pan")]);
    // …and one family is the panel itself: a single tab is never written.
    expect(ui.tabs).toBeUndefined();
    expect(Object.values(ui.widgets).map((w) => w.bind)).toEqual([
      "Reverb Room Size",
    ]);
  });

  it("gives `@base` the front page to itself, and drops the other intrinsics", () => {
    // Not a control like the others: it decides which preset the plugin is BUILT from.
    const ui = autoOrganize([
      p("@base", {
        min: 0,
        max: 1,
        states: [
          { label: "none", value: 0 },
          { label: "warm", value: 1 },
        ],
      }),
      p("@mute"),
      p("@pan", { min: 0, max: 1 }),
    ]);
    const page = Object.values(pageOf(ui, GENERAL_PAGE));
    expect(page).toHaveLength(1);
    expect(page[0]).toMatchObject({
      type: "dropdown",
      bind: "@base",
      col: 0,
      row: 0,
    });
  });

  it("still proposes a grid for an empty list, with nothing to leave room under", () => {
    // The one case with no controls above: `autoOrganize` returns before any of the placement runs.
    expect(autoOrganize([]).rows).toBe(1);
  });

  it("proposes something the schema accepts, empty list included", () => {
    // A panel the schema refuses takes the graph node with it.
    expect(UISchema.safeParse(ui).success).toBe(true);
    const none = autoOrganize([]);
    expect(UISchema.safeParse(none).success).toBe(true);
    expect(none.widgets).toEqual({});
  });
});

describe("the engine's blend", () => {
  it("leaves @mix to the card's header, and the plugin's own dry/wet out", () => {
    const ui = autoOrganize(
      ["Room Size", "Wet Level", "Dry Level", "@mix"].map((name) => ({ name })),
    );
    const binds = JSON.stringify(ui);
    expect(binds).not.toContain('"bind":"@mix"');
    expect(binds).not.toContain("Wet Level");
    expect(binds).not.toContain("Dry Level");
  });

  it("keeps the plugin's own blend where the engine offers none", () => {
    const ui = autoOrganize(["Room Size", "Mix"].map((name) => ({ name })));
    expect(JSON.stringify(ui)).toContain('"bind":"Mix"');
  });
});

describe("the engine's levels", () => {
  it("are the footer's too, and leave the plugin's own input and output out", () => {
    const ui = JSON.stringify(
      autoOrganize(
        ["Drive", "Input", "Output", "@input-volume", "@output-volume"].map(
          (name) => ({ name }),
        ),
      ),
    );
    expect(ui).not.toContain('"bind":"@input-volume"');
    expect(ui).not.toContain('"bind":"@output-volume"');
    expect(ui).not.toContain('"bind":"Input"');
    expect(ui).not.toContain('"bind":"Output"');
  });
});

describe("the two shapes it proposes", () => {
  const knobs = (n: number, family = "Filter") =>
    Array.from({ length: n }, (_, i) =>
      p(`${family} ${i}`, { min: 0, max: 1 }),
    );

  it("lays its knobs out 2×2, a slot two cells — a dropdown the slot's width, one row of text", () => {
    const ui = autoOrganize([
      p("Filter Cutoff"),
      p("Filter Resonance"),
      p("Lid Position", {
        min: 0,
        max: 1,
        states: [{ label: "Open", value: 1 }],
      }),
    ]);
    const res = Object.values(pageOf(ui, "Filter")).find(
      (w) => w.bind === "Filter Resonance",
    );
    expect(res).toMatchObject({ colSpan: 2, rowSpan: 2 });
    const lid = Object.values(pageOf(ui, "Other")).find(
      (w) => w.bind === "Lid Position",
    );
    expect(lid).toMatchObject({ colSpan: 2 });
    expect(lid?.rowSpan).toBeUndefined();
  });

  it("is never taller than four rows across, and wraps a long page onto a second", () => {
    const ui = autoOrganize(knobs(30));
    expect(ui.rows).toBeLessThanOrEqual(LAYOUT_MAX);
    // Six knobs a row, two rows a page: thirty knobs are three pages of the one family.
    expect(ui.tabs?.map((t) => t.name)).toEqual([
      "Filter",
      "Filter 2",
      "Filter 3",
    ]);
  });

  it("adds a vertical twin, four columns wide, only when the panel is wider than that", () => {
    const wide = autoOrganize(knobs(9));
    expect(wide.vertical?.cols).toBeLessThanOrEqual(LAYOUT_MAX);
    expect(twinIssues(wide)).toEqual([]);
    const narrow = autoOrganize(knobs(2));
    expect(narrow.vertical).toBeUndefined();
    expect(twinIssues(narrow)).toEqual([]);
  });

  it("puts `@base` first and the blend last, in both shapes", () => {
    const ui = autoOrganize([
      p("Dry"),
      p("Filter Cutoff"),
      p("Wet"),
      p("@base", { min: 0, max: 1, states: [{ label: "none", value: 0 }] }),
      ...knobs(6, "Filter"),
    ]);
    const mix = Object.values(pageOf(ui, "Mix"));
    expect(mix.map((w) => w.bind)).toEqual(["Dry", "Wet"]);
    expect(twinIssues(ui)).toEqual([]);
  });
});
