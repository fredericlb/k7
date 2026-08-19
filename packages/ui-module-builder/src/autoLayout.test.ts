// What "Auto organize" proposes, and the one thing that decides it: which family a NAME suggests.
// The interesting cases are all collisions — a word two families want — and the family table's
// order is what settles them, so most of this file is those pairs pinned in place.

import { UISchema } from "@studio/song/yaml/moduleSchema";
import { describe, expect, it } from "vitest";
import {
  type AutoParam,
  autoOrganize,
  familyOf,
  groupParams,
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
      p("Select Preset"),
    ]);
    expect(groups.map((g) => g.page)).toEqual([
      "Preset",
      "Reverb",
      "Mix",
      "Other",
    ]);
  });

  it("claims the lane's own names early and still draws them late", () => {
    // `@volume` reads as a level to every word test there is, so `Track` has to ask before
    // `Mix` — and a plugin's panel that OPENED on the lane's knobs would be the other mistake.
    expect(familyOf("@volume")).toBe("Track");
    expect(familyOf("@monitor")).toBe("Track");
    const groups = groupParams([
      p("@volume"),
      p("Master Volume"),
      p("Hammer Hardness"),
    ]);
    expect(groups.map((g) => g.page)).toEqual(["Mix", "Track", "Other"]);
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

  it("is tall enough for its biggest page", () => {
    // Every page shares the panel's grid, so the tallest one is what the grid has to fit.
    const many = autoOrganize(
      Array.from({ length: 13 }, (_, i) => p(`Filter ${i}`)),
    );
    expect(many.rows).toBe(1 + 3); // 13 over 6 columns is three rows, plus the bar
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
