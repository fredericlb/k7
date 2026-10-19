// What "this panel couldn't be parsed" is allowed to mean, and what writing a `ui.k7x` keeps.
//
// The grid greys itself out and says so — a warning about a FILE, so it had better be about a
// file. One boolean for two reasons puts it on every panel that parses perfectly but is merely
// read-only. These pin the half that is a real fault, and the shapes the repo's panels have.
//
// Fixtures rather than a directory walk, deliberately: this package has no node types and should
// not gain them for a test. It draws a browser's screen; `node:fs` reaching it is the thing that
// absence prevents.

import { describe, expect, it } from "vitest";
import { hasMalformedUiFile, readUiFile, writeUiFile } from "./moduleUi";

/** A library `tempo` panel — a widget spread over lines, a meter, quoted binds. */
const TEMPO = `// panel for @k7-core/cold/tempo
cols(2)
rows(2)
widgets({
  target: {
    type: "knob",
    col: 0,
    row: 0,
    rowSpan: 2,
    label: "BPM",
    bind: "Target BPM",
    min: 10,
    max: 300,
    step: 0.1,
  },
  source: { type: "meter", col: 1, row: 0, rowSpan: 2, label: "Source", bind: "Source BPM" },
})
`;

/** A library `auto-wah` panel, verbatim in shape — groups, faders, a screen and its vertical twin. */
const WAH = `// auto-wah — a touch wah, a resonant band pass swept by the playing level
cols(6)
rows(4)
widgets({
  filter: { type: "group", col: 0, row: 0, colSpan: 4, rowSpan: 4, label: "FILTER", color: "#3d7dff26" },
  low: { type: "fader", col: 0, row: 0, rowSpan: 4, label: "Low", bind: "Low", min: 60, max: 8000, curve: "log" },
  high: { type: "fader", col: 1, row: 0, rowSpan: 4, label: "High", bind: "High", min: 60, max: 8000, curve: "log" },
  res: { type: "knob", col: 2, row: 0, colSpan: 2, rowSpan: 2, label: "Res", bind: "Resonance", min: 0.5, max: 20, curve: "log" },
  sweep: { type: "lcdscreen", col: 4, row: 0, colSpan: 2, rowSpan: 4 },
})
vertical({
  cols: 4,
  rows: 6,
  widgets: {
    filter: { type: "group", col: 0, row: 0, colSpan: 4, rowSpan: 4, label: "FILTER", color: "#3d7dff26" },
    low: { type: "fader", col: 0, row: 0, rowSpan: 4, label: "Low", bind: "Low", min: 60, max: 8000, curve: "log" },
    high: { type: "fader", col: 1, row: 0, rowSpan: 4, label: "High", bind: "High", min: 60, max: 8000, curve: "log" },
    res: { type: "knob", col: 2, row: 0, colSpan: 2, rowSpan: 2, label: "Res", bind: "Resonance", min: 0.5, max: 20, curve: "log" },
    sweep: { type: "lcdscreen", col: 0, row: 4, colSpan: 4, rowSpan: 2 },
  },
})
`;

describe("the panels this repo ships", () => {
  for (const [name, text] of [
    ["tempo", TEMPO],
    ["auto-wah", WAH],
  ] as const)
    it(`parses ${name}'s, so the grid stays live on it`, () => {
      expect(hasMalformedUiFile(text)).toBe(false);
      // …and reads as something: `readUiFile` answers an EMPTY grid for anything it cannot use.
      expect(Object.keys(readUiFile(text).widgets).length).toBeGreaterThan(0);
    });
});

describe("what MALFORMED actually means", () => {
  it("is a panel that states a grid the schema refuses", () => {
    expect(
      hasMalformedUiFile('cols(4)\nwidgets({ w1: { type: "nope" } })\n'),
    ).toBe(true);
  });

  it("is NOT an absent or empty panel — the grid creates one", () => {
    // The first save writes it; calling this malformed warns about every module with no face yet.
    expect(hasMalformedUiFile("")).toBe(false);
    expect(hasMalformedUiFile("// just a comment\n")).toBe(false);
  });

  it("is NOT a file that fails to parse at all", () => {
    // That is the code pane's news, and it says it better — with a line and a column.
    expect(hasMalformedUiFile("widgets([unclosed\n")).toBe(false);
  });
});

/** Writing back into a hand-written file: the grid's gestures, as the diff a reviewer reads. */
describe("a `ui.k7x` the grid edits", () => {
  const changed = (before: string, after: string) => {
    const a = before.split("\n");
    const b = after.split("\n");
    expect(b).toHaveLength(a.length);
    return b.filter((l, i) => l !== a[i]);
  };

  it("moves a knob as a one-line diff, the header kept", () => {
    const ui = readUiFile(WAH);
    ui.widgets.res.row = 2;
    expect(changed(WAH, writeUiFile(WAH, ui))).toEqual([
      '  res: { type: "knob", col: 2, row: 2, colSpan: 2, rowSpan: 2, label: "Res", bind: "Resonance", min: 0.5, max: 20, curve: "log" },',
    ]);
  });

  it("edits the vertical twin in place too", () => {
    const ui = readUiFile(WAH);
    if (ui.vertical) ui.vertical.widgets.sweep.row = 3;
    expect(changed(WAH, writeUiFile(WAH, ui))).toEqual([
      '    sweep: { type: "lcdscreen", col: 0, row: 3, colSpan: 4, rowSpan: 2 },',
    ]);
  });

  it("changes nothing when nothing changed, a widget spread over lines included", () => {
    expect(writeUiFile(TEMPO, readUiFile(TEMPO))).toBe(TEMPO);
    expect(writeUiFile(WAH, readUiFile(WAH))).toBe(WAH);
  });

  it("adds a widget on a line of its own, and removes one by its line", () => {
    const ui = readUiFile(WAH);
    ui.widgets.mix = { type: "knob", col: 2, row: 2, bind: "Mix" };
    const added = writeUiFile(WAH, ui);
    expect(added).toContain(
      '  mix: { type: "knob", col: 2, row: 2, bind: "Mix" },\n})\nvertical(',
    );
    const gone = readUiFile(added);
    delete gone.widgets.mix;
    expect(writeUiFile(added, gone)).toBe(WAH);
  });

  it("adds the tabs as a statement of their own, a widget a line", () => {
    const ui = readUiFile(TEMPO);
    ui.tabs = [
      {
        name: "Main",
        widgets: {
          gain: {
            type: "knob",
            col: 0,
            row: 0,
            label: "Gain",
            bind: "Output gain",
            min: -24,
            max: 24,
            step: 0.1,
          },
        },
      },
    ];
    const after = writeUiFile(TEMPO, ui);
    expect(after.startsWith(TEMPO.slice(0, -1))).toBe(true);
    expect(readUiFile(after).tabs?.[0].widgets.gain.bind).toBe("Output gain");
  });
});

/** A panel BUILT rather than parsed: whatever this editor writes, it must be able to read back. */
describe("a panel written by the grid rather than by hand", () => {
  it("round-trips every widget's bind", () => {
    // A panel that parsed but had lost its binds would be a grid of knobs that move nothing.
    const built = {
      cols: 2,
      rows: 2,
      widgets: {
        w1: {
          type: "fader" as const,
          col: 0,
          row: 0,
          rowSpan: 2,
          label: "Volume",
          bind: "Volume",
          min: -60,
          max: 6,
        },
        w2: {
          type: "knob" as const,
          col: 1,
          row: 0,
          label: "Pan",
          bind: "Pan",
          min: -1,
          max: 1,
        },
      },
    };
    const text = writeUiFile("", built);
    expect(hasMalformedUiFile(text)).toBe(false);
    const ui = readUiFile(text);
    expect(
      Object.values(ui.widgets)
        .map((w) => w.bind)
        .sort(),
    ).toEqual(["Pan", "Volume"]);
    // The span survives, which is the half a parameter list could never have supplied.
    expect(ui.widgets.w1.rowSpan).toBe(2);
  });

  it("writes the terse shape these files have by hand", () => {
    // The same `writeUiFile` the grid saves through, so its output sits among hand-written files.
    const text = writeUiFile("", {
      cols: 4,
      rows: 1,
      widgets: {
        w1: {
          type: "knob" as const,
          col: 0,
          row: 0,
          label: "Speed",
          bind: "Speed",
          min: 0,
          max: 1,
        },
      },
    });
    expect(text).toContain(
      'w1: { type: "knob", col: 0, row: 0, label: "Speed", bind: "Speed", min: 0, max: 1 }',
    );
  });
});
