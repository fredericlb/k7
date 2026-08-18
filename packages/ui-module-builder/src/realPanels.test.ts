// What "this panel couldn't be parsed" is allowed to mean.
//
// The grid greys itself out and says so — a warning about a FILE, so it had better be about a
// file. It was reported on every module in a library, about panels that parse perfectly: the grid
// took ONE boolean for two reasons, and read-only was the other one. These pin the half that is a
// real fault, and the shapes the repository's own panels actually have.
//
// Fixtures rather than a directory walk, deliberately: this package has no node types and should
// not gain them for a test. It draws a browser's screen; `node:fs` reaching it is the thing that
// absence prevents.

import { builtinPluginForRef } from "@studio/song/builtinParams";
import { paramPanel } from "@studio/song/paramPanel";
import { describe, expect, it } from "vitest";
import { hasMalformedUiFile, readUiFile, writeUiFile } from "./moduleUi";

/** `packages/dsp/modules/tempo/ui.yaml`, verbatim — block mappings, a meter, quoted binds. */
const TEMPO = `# panel for @st0/audio/utility/tempo
cols: 2
rows: 2
widgets:
  target:
    {
      type: knob,
      col: 0,
      row: 0,
      rowSpan: 2,
      label: BPM,
      bind: "Target BPM",
      min: 10,
      max: 300,
      step: 0.1,
    }
  source:
    { type: meter, col: 1, row: 0, rowSpan: 2, label: Source, bind: "Source BPM" }
`;

/** `packages/dsp/modules/eq3/ui.yaml` — one-line flow mappings and an accented label. */
const EQ3 = `# panel for audio/filter/eq3
cols: 3
rows: 1
widgets:
  low:
    { type: knob, col: 0, row: 0, label: Grave, bind: "Low-shelf gain", min: -20, max: 20, step: 0.1 }
  mid:
    { type: knob, col: 1, row: 0, label: Médium, bind: "Mid gain 1", min: -20, max: 20, step: 0.1 }
  high:
    { type: knob, col: 2, row: 0, label: Aigu, bind: "High-shelf gain", min: -20, max: 20, step: 0.1 }
`;

describe("the panels this repo ships", () => {
  for (const [name, text] of [
    ["tempo", TEMPO],
    ["eq3", EQ3],
  ] as const)
    it(`parses ${name}'s, so the grid stays live on it`, () => {
      expect(hasMalformedUiFile(text)).toBe(false);
      // …and reads as something. `readUiFile` answers an EMPTY grid for anything it cannot use,
      // which would pass the check above while drawing nothing at all.
      expect(Object.keys(readUiFile(text).widgets).length).toBeGreaterThan(0);
    });
});

describe("what MALFORMED actually means", () => {
  it("is a panel that states a grid the schema refuses", () => {
    expect(
      hasMalformedUiFile("cols: 4\nwidgets:\n  w1: { type: nope }\n"),
    ).toBe(true);
  });

  it("is NOT an absent or empty panel — the grid creates one", () => {
    // The first save writes it. Calling this malformed would put an amber warning on every
    // module nobody has given a face yet, which is most of them.
    expect(hasMalformedUiFile("")).toBe(false);
    expect(hasMalformedUiFile("# just a comment\n")).toBe(false);
  });

  it("is NOT a file that fails to parse as YAML at all", () => {
    // That is the code pane's news, and it says it better — with a line and a column.
    expect(hasMalformedUiFile("widgets: [unclosed\n")).toBe(false);
  });
});

/**
 * A GENERATED panel, read back by the same parser the builder greys itself out on.
 *
 * st0 writes these through `writeUiFile("")` — the writer the grid itself saves through — so a
 * generated panel and a hand-drawn one are the same file. That is the property worth pinning:
 * the generator produces `ui.yaml`, and `ui.yaml` is what this editor round-trips.
 */
describe("a panel generated from a plugin's parameters", () => {
  for (const ref of ["@engine/chorus-ensemble", "@engine/4osc"])
    it(`round-trips ${ref}`, () => {
      const plugin = builtinPluginForRef(ref);
      expect(plugin, ref).toBeTruthy();
      const text = writeUiFile("", paramPanel(plugin!.params));
      expect(hasMalformedUiFile(text), ref).toBe(false);
      // …and every parameter is still bound after the trip through YAML. A panel that parsed
      // but had lost its binds would be a grid of knobs that move nothing.
      const ui = readUiFile(text);
      const bound = Object.values(ui.widgets).flatMap((w) =>
        w.type === "tabs"
          ? Object.values(w.pages ?? {}).flatMap((p) =>
              Object.values(p).map((x) => x.bind),
            )
          : [w.bind],
      );
      expect(bound.slice().sort()).toEqual(
        plugin!.params
          .map((p) => p.name)
          .slice()
          .sort(),
      );
    });

  it("writes the terse one-line-per-widget shape these files have by hand", () => {
    // The same `writeUiFile` the grid saves through, so a generated file does not read as
    // machine output sitting in a folder of hand-written ones.
    const text = writeUiFile(
      "",
      paramPanel(builtinPluginForRef("@engine/chorus-ensemble")!.params),
    );
    expect(text).toContain(
      "w1: { type: knob, col: 0, row: 0, label: Speed, bind: Speed, min: 0, max: 1 }",
    );
  });
});
