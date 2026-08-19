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

  it("claims the lane's own names early — to drop them, `@base` apart", () => {
    // `@volume` reads as a level to every word test there is, so the `@` namespace has to ask
    // before `Mix`. What it does with them is DROP them: a mixer strip already draws every one,
    // and a proposal repeating them puts a second fader on screen wired to the first.
    expect(isPlumbing("@volume")).toBe(true);
    expect(isPlumbing("@monitor")).toBe(true);
    expect(isPlumbing("@mute")).toBe(true);
    // …and the one exception, which nothing else draws.
    expect(familyOf("@base")).toBe(GENERAL_PAGE);
    expect(isPlumbing("@base")).toBe(false);
    // Anchored, so a plugin parameter that merely STARTS with the word is not the intrinsic.
    expect(familyOf("@base_mix")).not.toBe(GENERAL_PAGE);
    const groups = groupParams([
      p("Master Volume"),
      p("@volume"),
      p("Hammer Hardness"),
    ]);
    expect(groups.map((g) => g.page)).toEqual(["Mix", "Other"]);
  });

  it("tells the module's OWN blend from an effect's, and moves neither", () => {
    // The test is the family, not the word: the effect families ask before `Mix` does, so a
    // blend word still sitting in `Mix` at the end is one no effect claimed.
    expect(isBlend("Mix")).toBe(true);
    expect(isBlend("Dry/Wet")).toBe(true);
    expect(isBlend("Reverb Dry/Wet")).toBe(false);
    expect(isBlend("Delay Mix")).toBe(false);
    // …and a level is not a blend, though it lives on the same page.
    expect(isBlend("Master Volume")).toBe(false);
    // It decides a POSITION and no longer a page: the module's blend stays in `Mix`, where its
    // own family put it. It was pulled onto `General`, which is `@base` alone now.
    const groups = groupParams([p("Mix"), p("Reverb Dry/Wet"), p("@volume")]);
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
      p("@base"),
    ]);
    expect(Object.keys(ui.widgets.tabs.pages ?? {})[0]).toBe(GENERAL_PAGE);
  });

  it("has no General page at all on a module with no base", () => {
    // A page holds only what got something, and `@base` is the only thing that lands here now.
    // So a plain effect opens on its own first family rather than on an empty front page.
    const ui = autoOrganize([p("Reverb Room Size"), p("@volume"), p("@pan")]);
    expect(Object.keys(ui.widgets.tabs.pages ?? {})).toEqual(["Reverb"]);
  });

  it("gives `@base` the front page to itself, and drops the other intrinsics", () => {
    // It is not a control like the others: it decides which preset the plugin is BUILT from, so
    // every parameter on every other page is describing that base. The lane's own controls used
    // to sit under it here; the mixer strip draws all of those, so they are left out.
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
    expect(page).toHaveLength(1);
    expect(page[0]).toMatchObject({
      type: "dropdown",
      bind: "@base",
      col: 0,
      row: 1,
    });
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
    const page = Object.values(ui.widgets.tabs.pages?.Mix ?? {});
    const at = (bind: string) => page.find((w) => w.bind === bind);
    // The Filter page is one row of CONTENT, and the panel is that plus the empty row every
    // proposal ends on — and the blend goes on the content row of its OWN page, right-aligned:
    // slots 4 and 5 of six, which are columns 8 and 10 of twelve. The air is BELOW it.
    expect(ui.rows).toBe(1 + 2 * 2);
    expect(at("Dry")).toMatchObject({ col: 8, row: 1 });
    expect(at("Wet")).toMatchObject({ col: 10, row: 1 });
  });

  it("grows a row rather than dropping the blend on a knob", () => {
    // Six parameters fill the bottom row to its right-hand edge, which is where the blend goes.
    // They have to be the blend's OWN page's now, so they are levels rather than intrinsics.
    const ui = autoOrganize([
      ...Array.from({ length: 6 }, (_, i) => p(`Level ${i}`)),
      p("Mix"),
    ]);
    const page = Object.values(ui.widgets.tabs.pages?.Mix ?? {});
    // Two rows of content — the six, then the row grown for the blend — plus the trailing one.
    expect(ui.rows).toBe(1 + 3 * 2);
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
    // 13 knobs six to a row is three rows of them, two cells tall each, plus the bar's one and
    // the empty one every proposal ends on.
    expect(many.rows).toBe(1 + 4 * 2);
    // …and a panel whose only page is the base is two rows: its one, and the empty one. The
    // lane control beside it is dropped, so it adds nothing to the height either.
    const withBase = autoOrganize([
      p("@base", { min: 0, max: 1, states: [{ label: "none", value: 0 }] }),
      p("@volume"),
    ]);
    expect(withBase.rows).toBe(1 + 2 * 2);
  });

  it("always ends on an empty row, whatever the tallest page holds", () => {
    // Somewhere to DROP the next parameter, and a bottom edge that does not read as cropped.
    // A SLOT row rather than a cell one: what has to fit there is a control.
    const bottomOf = (u: ReturnType<typeof autoOrganize>) =>
      Math.max(
        ...Object.values(u.widgets.tabs.pages ?? {}).flatMap((pg) =>
          Object.values(pg).map((w) => w.row + (w.rowSpan ?? 1)),
        ),
      );
    for (const params of [
      [p("Filter Cutoff")],
      [p("Dry"), p("Wet"), p("Filter Cutoff")],
      Array.from({ length: 13 }, (_, i) => p(`Filter ${i}`)),
      [
        p("@base", { min: 0, max: 1, states: [{ label: "none", value: 0 }] }),
        p("@volume"),
        p("Reverb Decay"),
      ],
    ]) {
      const u = autoOrganize(params);
      expect(u.rows - bottomOf(u)).toBeGreaterThanOrEqual(2);
    }
  });

  it("still proposes a grid for an empty list, with nothing to leave room under", () => {
    // The one case with no controls to sit above: it stays the single empty row it always was,
    // because `autoOrganize` returns before any of the placement above runs.
    expect(autoOrganize([]).rows).toBe(1);
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
