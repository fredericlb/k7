// What "Auto organize" proposes, and the one thing that decides it: which family a NAME suggests.
// The interesting cases are all collisions — a word two families want — and the family table's
// order is what settles them, so most of this file is those pairs pinned in place.

import { UISchema } from "@studio/song/yaml/moduleSchema";
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
    // Best effort means some names have nothing to go on. `String Tension` is a real Piano V3
    // parameter and belongs to no family any word here names — it still gets a widget.
    expect(familyOf("String Tension")).toBe("Other");
    expect(familyOf("Hammer Hardness")).toBe("Other");
  });

  it("reads `_` as a space, so a wire name and a written one look alike", () => {
    expect(familyOf("MPE_PitchBend_3")).toBe("MIDI");
    expect(familyOf("Pitch Bend")).toBe("MIDI");
  });

  // Every one of these is a word two families want. The table's ORDER is the answer, so each
  // pair is pinned: reordering the table to fix one of them silently rehomes the others.
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

  // `familyOf` still NAMES these; `groupParams` is where they are left out. The two are
  // separate on purpose: a name that fell into `Other` would be plumbing nobody recognised.
  it("keeps the plugin's plumbing away from the knobs", () => {
    // Piano V3 publishes sixteen of each of these. Left among the sound controls they are
    // sixteen knobs nobody will ever turn, in the space sixteen real ones could have had.
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
    // `Other` is where the guess gave up: a page of leftovers ahead of a page of reverb
    // controls would say the opposite of what the layout is for.
    const groups = groupParams([
      p("String Tension"),
      p("Master Volume"),
      p("Reverb Room Size"),
    ]);
    expect(groups.map((g) => g.page)).toEqual(["Reverb", "Mix", "Other"]);
  });

  it("leaves the plumbing out — no Preset page, no MIDI page", () => {
    // Matched so they can be recognised, then skipped: a proposal that spends two of its pages
    // on program changes and browser navigation has answered the wrong question. Nothing is
    // lost — the params list still offers every one of them, one drag from a widget.
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

  it("claims the lane's own names early, and opens on them", () => {
    // `@volume` reads as a level to every word test there is, so `General` has to ask before
    // `Mix`. It is also the page to open on: the module's own controls, `@base` among them.
    expect(familyOf("@volume")).toBe(GENERAL_PAGE);
    expect(familyOf("@monitor")).toBe(GENERAL_PAGE);
    expect(familyOf("@base")).toBe(GENERAL_PAGE);
    const groups = groupParams([
      p("Master Volume"),
      p("@volume"),
      p("Hammer Hardness"),
    ]);
    expect(groups.map((g) => g.page)).toEqual([GENERAL_PAGE, "Mix", "Other"]);
  });

  it("moves the module's OWN blend to General, and leaves an effect's alone", () => {
    // The test is the family, not the word: the effect families ask before `Mix` does, so a
    // blend word still sitting in `Mix` at the end is one no effect claimed.
    expect(isBlend("Mix")).toBe(true);
    expect(isBlend("Dry/Wet")).toBe(true);
    expect(isBlend("Reverb Dry/Wet")).toBe(false);
    expect(isBlend("Delay Mix")).toBe(false);
    // …and a level is not a blend, though it lives on the same page.
    expect(isBlend("Master Volume")).toBe(false);
    const groups = groupParams([p("Mix"), p("Reverb Dry/Wet"), p("@volume")]);
    expect(groups.map((g) => g.page)).toEqual([GENERAL_PAGE, "Reverb"]);
    expect(groups[0].params.map((x) => x.name).sort()).toEqual([
      "@volume",
      "Mix",
    ]);
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

  it("is one tabs widget, and every parameter is on a page of it", () => {
    expect(Object.keys(ui.widgets)).toEqual(["tabs"]);
    const bound = Object.values(ui.widgets.tabs.pages ?? {}).flatMap((page) =>
      Object.values(page).map((w) => w.bind),
    );
    expect(bound.sort()).toEqual(params.map((x) => x.name).sort());
  });

  it("leaves row 0 to the tab bar", () => {
    // A page's col/row are the PANEL's grid, not an offset inside the tabs widget's box
    // (docs/pages.md) — so content placed on row 0 would be drawn over the bar.
    const rows = Object.values(ui.widgets.tabs.pages ?? {}).flatMap((page) =>
      Object.values(page).map((w) => w.row),
    );
    expect(Math.min(...rows)).toBe(1);
    expect(ui.widgets.tabs.row).toBe(0);
  });

  it("carries each parameter's own range, so the panel opens right with no engine", () => {
    const filter = ui.widgets.tabs.pages?.Filter ?? {};
    const cutoff = Object.values(filter).find(
      (w) => w.bind === "Filter Cutoff",
    );
    expect(cutoff).toMatchObject({ type: "knob", min: 20, max: 20000 });
  });

  it("lays its knobs out 2×2, six to a row — the one gesture that sizes them", () => {
    // The panel is twelve cells wide because a slot is two — so `Filter Resonance`, the second
    // parameter of its page, starts at column 2 rather than column 1.
    expect(ui.cols).toBe(12);
    const filter = ui.widgets.tabs.pages?.Filter ?? {};
    const res = Object.values(filter).find(
      (w) => w.bind === "Filter Resonance",
    );
    expect(res).toMatchObject({ col: 2, row: 1, colSpan: 2, rowSpan: 2 });
    // A dropdown takes the slot's width and not its height: it is one row of text with
    // nothing to put under it, and a two-row-tall select would just be a tall select.
    const lid = Object.values(ui.widgets.tabs.pages?.Other ?? {}).find(
      (w) => w.bind === "Lid Position",
    );
    expect(lid).toMatchObject({ colSpan: 2 });
    expect(lid?.rowSpan).toBeUndefined();
  });

  it("draws a parameter with named settings as a dropdown, like a dropped one", () => {
    // The same three answers `createBound` gives a DRAGGED parameter, so a panel you
    // auto-organise and one you drag by hand are made of the same widgets.
    const other = ui.widgets.tabs.pages?.Other ?? {};
    const lid = Object.values(other).find((w) => w.bind === "Lid Position");
    expect(lid?.type).toBe("dropdown");
    expect(lid?.options).toHaveLength(2);
  });

  it("gives every widget on the panel its own id", () => {
    const ids = Object.values(ui.widgets.tabs.pages ?? {}).flatMap((page) =>
      Object.keys(page),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("opens on General, whatever order the parameters arrived in", () => {
    // The tab bar's order IS the pages' order, and the first entry is the one that shows.
    const ui = autoOrganize([
      p("Reverb Room Size"),
      p("Filter Cutoff"),
      p("@volume"),
    ]);
    expect(Object.keys(ui.widgets.tabs.pages ?? {})[0]).toBe(GENERAL_PAGE);
  });

  it("gives `@base` the first row to itself, and starts the rest below it", () => {
    // It is not a control like the others: it decides which preset the plugin is BUILT from, so
    // every knob under it is describing that base. Sixth in a row of dials it reads as one more
    // setting; alone on the top line it reads as the choice the rest hangs off.
    const ui = autoOrganize([
      p("@base", {
        min: 0,
        max: 1,
        states: [
          { label: "none", value: 0 },
          { label: "warm", value: 1 },
        ],
      }),
      p("@volume", { min: -60, max: 6 }),
      p("@pan", { min: 0, max: 1 }),
    ]);
    const page = Object.values(ui.widgets.tabs.pages?.[GENERAL_PAGE] ?? {});
    const at = (bind: string) => page.find((w) => w.bind === bind);
    expect(at("@base")).toMatchObject({ type: "dropdown", col: 0, row: 1 });
    // Row 1 is the base's, so the rest starts on the next SLOT row — two cells further down.
    expect(at("@volume")).toMatchObject({ col: 0, row: 3 });
    expect(at("@pan")).toMatchObject({ col: 2, row: 3 });
  });

  it("puts the blend in the bottom-right corner, the pair of them together", () => {
    // Where an output stage sits on a real panel, and the far end from `@base`. A `dry` and a
    // `wet` are two halves of one control, so they travel together and end at the panel's edge.
    const ui = autoOrganize([
      p("Dry"),
      p("Wet"),
      p("Filter Cutoff"),
      p("Filter Resonance"),
      p("Filter Drive"),
    ]);
    const page = Object.values(ui.widgets.tabs.pages?.[GENERAL_PAGE] ?? {});
    const at = (bind: string) => page.find((w) => w.bind === bind);
    // The Filter page is one row tall, so the panel is — and the blend goes on that bottom row,
    // right-aligned: slots 4 and 5 of six, which are columns 8 and 10 of twelve.
    expect(ui.rows).toBe(1 + 1 * 2);
    expect(at("Dry")).toMatchObject({ col: 8, row: 1 });
    expect(at("Wet")).toMatchObject({ col: 10, row: 1 });
  });

  it("grows a row rather than dropping the blend on a knob", () => {
    // Six parameters fill the bottom row to its right-hand edge, which is where the blend goes.
    const ui = autoOrganize([
      ...Array.from({ length: 6 }, (_, i) => p(`@ctl${i}`)),
      p("Mix"),
    ]);
    const page = Object.values(ui.widgets.tabs.pages?.[GENERAL_PAGE] ?? {});
    expect(ui.rows).toBe(1 + 2 * 2);
    expect(page.find((w) => w.bind === "Mix")).toMatchObject({
      col: 10,
      row: 3,
    });
    // …and nothing else is on that slot.
    expect(page.filter((w) => w.row === 3)).toHaveLength(1);
  });

  it("costs nothing on a page with no base", () => {
    const ui = autoOrganize([p("Filter Cutoff"), p("Filter Resonance")]);
    const page = Object.values(ui.widgets.tabs.pages?.Filter ?? {});
    expect(page.map((w) => w.row)).toEqual([1, 1]);
  });

  it("is tall enough for its biggest page", () => {
    // Every page shares the panel's grid, so the tallest one is what the grid has to fit.
    const many = autoOrganize(
      Array.from({ length: 13 }, (_, i) => p(`Filter ${i}`)),
    );
    // 13 knobs six to a row is three rows of them, two cells tall each, plus the bar's one.
    expect(many.rows).toBe(1 + 3 * 2);
    // …and the row `@base` takes for itself counts too, or the page it is on would be cut off.
    const withBase = autoOrganize([
      p("@base", { min: 0, max: 1, states: [{ label: "none", value: 0 }] }),
      p("@volume"),
    ]);
    expect(withBase.rows).toBe(1 + 2 * 2);
  });

  it("proposes something the schema accepts, empty list included", () => {
    // It must never hand back a document that fails to load: a `tabs` widget with no pages
    // is refused by the schema and takes the graph node with it.
    expect(UISchema.safeParse(ui).success).toBe(true);
    const none = autoOrganize([]);
    expect(UISchema.safeParse(none).success).toBe(true);
    expect(none.widgets).toEqual({});
  });
});
