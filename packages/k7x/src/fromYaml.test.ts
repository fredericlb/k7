// fromYaml.test.ts — a conversion keeps the author's layout: what YAML wrote on one line stays on one line, however wide.

import { describe, expect, it } from "vitest";
import { parse } from "./edit.ts";
import { fromYaml } from "./fromYaml.ts";

const WIDE = `widgets:
  cutoff: { type: knob, col: 0, row: 3, label: "Filter cutoff frequency", bind: "Filter Cutoff", min: 20, max: 20000, curve: log }
  mix: { type: knob, col: 1, row: 3, bind: Mix }
`;

describe("a conversion's layout", () => {
  it("keeps a one-line map on one line past the width, and the map around it broken", () => {
    const k7x = fromYaml(WIDE);
    expect(k7x).toBe(
      "widgets({\n" +
        '  cutoff: { type: "knob", col: 0, row: 3, label: "Filter cutoff frequency", bind: "Filter Cutoff", min: 20, max: 20000, curve: "log" },\n' +
        '  mix: { type: "knob", col: 1, row: 3, bind: "Mix" },\n' +
        "})\n",
    );
    expect(parse(k7x)).toEqual({
      widgets: {
        cutoff: {
          type: "knob",
          col: 0,
          row: 3,
          label: "Filter cutoff frequency",
          bind: "Filter Cutoff",
          min: 20,
          max: 20000,
          curve: "log",
        },
        mix: { type: "knob", col: 1, row: 3, bind: "Mix" },
      },
    });
  });

  it("keeps a one-line list item on one line, as a chain", () => {
    expect(
      fromYaml("outputs:\n  - { name: mix, type: audio, node: fade }\n"),
    ).toBe('outputs([name("mix").type("audio").node("fade")])\n');
  });

  it("still breaks a wide multi-line map, and compacts a short one", () => {
    const block = `steps:
  - id: c0947697-42ed-4aa8-a225-cca0430f1c18
    extends: "@k7-core/audio/compressor"
    engine: tracktion
    engines:
      tracktion:
        params:
          Ratio: 0.125
`;
    expect(fromYaml(block)).toBe(
      "steps([\n" +
        '  id("c0947697-42ed-4aa8-a225-cca0430f1c18")\n' +
        '    .extends("@k7-core/audio/compressor")\n' +
        '    .engine("tracktion")\n' +
        "    .engines({ tracktion: { params: { Ratio: 0.125 } } }),\n" +
        "])\n",
    );
    expect(fromYaml("project:\n  name: demo\n  tempo: 120\n")).toBe(
      'project({ name: "demo", tempo: 120 })\n',
    );
  });
});
