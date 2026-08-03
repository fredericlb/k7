import { describe, expect, it } from "vitest";
import {
  extendsRefOf,
  hasMalformedUi,
  hasParsableUi,
  ioOf,
  readParams,
  readUi,
  writeUi,
} from "./moduleUi";

// The visual module editor writes into a file a person also edits by hand, so the two
// promises that matter are: every line outside `ui:` comes back byte-identical, and what
// the grid writes is something the loader will accept.
//
// Nothing covered this while it was CUE text surgery. The bug the range test pins is real
// and was found by reading that code: a knob retyped to a toggle kept its `min`, and the
// file then failed to load — taking the module's whole graph node with it.

const MODULE = `# the lead voice
extends: instruments/fourosc
params:
  Filter Freq: 90
  Level: -12
ui:
  cols: 4
  rows: 2
  widgets:
    w1: { type: knob, col: 0, row: 0, bind: Filter Freq, min: 0, max: 1 }
`;

describe("reading", () => {
  it("reads the grid and its widgets", () => {
    const ui = readUi(MODULE);
    expect(ui.cols).toBe(4);
    expect(ui.rows).toBe(2);
    expect(ui.widgets.w1).toMatchObject({
      type: "knob",
      col: 0,
      row: 0,
      bind: "Filter Freq",
      min: 0,
      max: 1,
    });
  });

  it("gives an empty grid for a file with no ui, and doesn't call it malformed", () => {
    const bare = "plugin:\n  type: internal\n  name: 4osc\n";
    expect(readUi(bare).widgets).toEqual({});
    expect(hasMalformedUi(bare)).toBe(false); // the grid may create one
    expect(hasParsableUi(bare)).toBe(false);
  });

  it("calls a ui the schema refuses MALFORMED, so the pane stays read-only", () => {
    // Silently replacing text it misread is the one thing the editor must not do.
    const bad =
      "ui:\n  cols: 4\n  rows: 2\n  widgets:\n    w1: { type: nope }\n";
    expect(hasParsableUi(bad)).toBe(false);
    expect(hasMalformedUi(bad)).toBe(true);
  });

  it("reads params as text, including one the schema would refuse", () => {
    // The pane only displays them, and a value that won't load should still be visible —
    // showing what is actually in the file is the point.
    expect(readParams(MODULE)).toEqual({ "Filter Freq": "90", Level: "-12" });
    expect(readParams("params:\n  Drive: loud\n")).toEqual({ Drive: "loud" });
  });

  it("reads the extends ref, and nothing when there is none", () => {
    expect(extendsRefOf(MODULE)).toBe("instruments/fourosc");
    expect(extendsRefOf("plugin:\n  name: 4osc\n")).toBe(null);
  });
});

describe("writing", () => {
  it("leaves every line outside `ui:` byte-identical", () => {
    const ui = readUi(MODULE);
    ui.widgets.w1.col = 2;
    const after = writeUi(MODULE, ui);
    // The comment, the extends and the params survive exactly.
    expect(
      after.startsWith("# the lead voice\nextends: instruments/fourosc\n"),
    ).toBe(true);
    expect(after).toContain("Filter Freq: 90");
    expect(after).toContain("Level: -12");
    expect(after).toContain("col: 2");
  });

  it("writes one widget per line, as a flow mapping", () => {
    // The shape these files already have by hand, and what keeps moving a knob to a
    // one-line diff instead of a five-line one.
    const ui = readUi(MODULE);
    const line = writeUi(MODULE, ui)
      .split("\n")
      .find((l) => l.includes("w1:"));
    expect(line).toMatch(/^\s*w1: \{ type: knob,.*\}$/);
  });

  it("creates the block when the file has none", () => {
    const bare = "plugin:\n  type: internal\n  name: 4osc\n";
    const after = writeUi(bare, {
      cols: 2,
      rows: 1,
      widgets: { a: { type: "toggle", col: 0, row: 0, bind: "Mute" } },
    });
    expect(after).toContain("plugin:");
    expect(after).toContain("ui:");
    expect(readUi(after).widgets.a).toMatchObject({
      type: "toggle",
      bind: "Mute",
    });
  });

  it("drops the defaults, so the block stays as terse as a hand-written one", () => {
    const after = writeUi("", {
      cols: 2,
      rows: 1,
      widgets: {
        a: { type: "knob", col: 0, row: 0, colSpan: 1, rowSpan: 1, label: "" },
      },
    });
    expect(after).not.toContain("colSpan");
    expect(after).not.toContain("rowSpan");
    expect(after).not.toContain("label");
  });

  it("drops a range when the widget is retyped to a kind that can't carry one", () => {
    // THE bug: a knob has min/max; retype it to a toggle and the range must not travel,
    // or the schema refuses the file and the module stops loading entirely.
    const after = writeUi("", {
      cols: 2,
      rows: 1,
      widgets: {
        a: { type: "toggle", col: 0, row: 0, bind: "Mute", min: 0, max: 1 },
      },
    });
    expect(after).not.toContain("min");
    expect(after).not.toContain("max");
    expect(hasParsableUi(after)).toBe(true); // …and the result loads
  });

  it("round-trips: read, write, read gives the same model", () => {
    const once = readUi(MODULE);
    const twice = readUi(writeUi(MODULE, once));
    expect(twice).toEqual(once);
  });

  it("is stable — writing an unchanged model twice changes nothing the second time", () => {
    const first = writeUi(MODULE, readUi(MODULE));
    const second = writeUi(first, readUi(first));
    expect(second).toBe(first);
  });

  it("keeps a tabs widget readable down the page rather than on one line", () => {
    const after = writeUi("", {
      cols: 4,
      rows: 2,
      widgets: {
        t: {
          type: "tabs",
          col: 0,
          row: 0,
          pages: { osc: { k: { type: "knob", col: 0, row: 0, bind: "Mix" } } },
        },
      },
    });
    expect(after).toContain("pages:");
    expect(hasParsableUi(after)).toBe(true);
  });
});

// An `io: in` module runs no plugin — the input IS the module — so the builder has no scanned parameter list to
// offer and its panel had nothing bindable on it. `ioOf` is what tells the two kinds of module apart.
describe("an io module's direction", () => {
  it("reads the direction an io module declares", () => {
    expect(ioOf("io: in\nchannel: [2]\n")).toBe("in");
    expect(ioOf("io: out\n")).toBe("out");
  });

  it("is null for an ordinary plugin module, which has none", () => {
    // The distinction the builder turns on: offering `@gain` on a reverb would name nothing.
    expect(ioOf(MODULE)).toBe(null);
  });

  it("is null rather than throwing on a file that doesn't parse", () => {
    expect(ioOf("io: [unclosed\n")).toBe(null);
  });
});
