// sugar.test.ts — a short form reads as the data it stands for, and a write keeps it until what it expands to changes.

import { applyYaml, toYaml } from "@studio/k7x/yaml-bridge";
import { describe, expect, it } from "vitest";
import { parseDocument, parse as parseYaml, stringify } from "yaml";
import { expandNotes, sugarFor } from "./sugar";
import { validateFile } from "./validate";

const n = (t: number, d: number, k: number, v?: number) =>
  v === undefined ? { t, d, k } : { t, d, k, v };

describe("the notes short form", () => {
  it("lays one step a beat, a rest leaving its beat empty", () => {
    expect(expandNotes("c4 d4 ~ e4")).toEqual([
      n(0, 1, 60),
      n(1, 1, 62),
      n(3, 1, 64),
    ]);
  });

  it("splits a step with [ ], stacks a chord with a comma", () => {
    expect(expandNotes("[c4 d4] e4")).toEqual([
      n(0, 0.5, 60),
      n(0.5, 0.5, 62),
      n(1, 1, 64),
    ]);
    expect(expandNotes("[c4,e4,g4] ~")).toEqual([
      n(0, 1, 60),
      n(0, 1, 64),
      n(0, 1, 67),
    ]);
  });

  it("lengthens a step with @ and repeats it with !", () => {
    expect(expandNotes("c4@2 d4")).toEqual([n(0, 2, 60), n(2, 1, 62)]);
    expect(expandNotes("c4!3")).toEqual([
      n(0, 1, 60),
      n(1, 1, 60),
      n(2, 1, 60),
    ]);
  });

  it("takes a step length and a velocity, sharps, flats and MIDI numbers", () => {
    expect(expandNotes("c#4 db4 64", 0.5, 0.8)).toEqual([
      n(0, 0.5, 61, 0.8),
      n(0.5, 0.5, 61, 0.8),
      n(1, 0.5, 64, 0.8),
    ]);
    expect(expandNotes("a-1")).toEqual([n(0, 1, 9)]);
  });

  it("names what does not read", () => {
    expect(() => expandNotes("c4 h4")).toThrow(
      'notes: "h4" is neither a note name',
    );
    expect(() => expandNotes("[c4 d4")).toThrow('"]" missing');
  });
});

describe("the runs short form", () => {
  it("adds each run's segments after what modules already says", () => {
    const sugar = sugarFor("song/graph.k7x");
    expect(
      sugar?.expand({
        modules: { MIX: ["OUT"] },
        runs: [
          ["melody", "lead", "MIX"],
          ["pad", "MIX"],
        ],
      }),
    ).toEqual({
      modules: { MIX: ["OUT"], melody: ["lead"], lead: ["MIX"], pad: ["MIX"] },
    });
  });

  it("belongs to the graph and the segments file, not to a chain file", () => {
    expect(sugarFor("song/graph.yaml")).not.toBeNull();
    expect(sugarFor("song/chains/chains.k7x")).toBeNull();
    expect(sugarFor("song/sequences/m.k7x")?.parts[0].key).toBe("notes");
    expect(sugarFor("song/project.k7x")).toBeNull();
  });
});

describe("a .k7x file written with a short form", () => {
  it("passes its schema, and a note that does not read is placed on its line", () => {
    expect(
      validateFile("song/sequences/m.k7x", 'notes("c4 d4 e4")\nto("2:1")\n').ok,
    ).toBe(true);
    const v = validateFile(
      "song/sequences/m.k7x",
      '// a riff\nnotes("c4 x9")\n',
    );
    expect(v.ok).toBe(false);
    expect(v.issues[0]).toMatchObject({ path: "notes", line: 2, col: 1 });
  });

  const SEQ = '// the riff\nnotes("c4 d4 e4 f4")\nto("2:1")\n';
  const path = "song/sequences/riff.k7x";
  /** What a YAML writer does through the bridge: read the expanded YAML, change it, write it back. */
  const write = (
    text: string,
    file: string,
    f: (d: ReturnType<typeof parseDocument>) => void,
  ) => {
    const d = parseDocument(toYaml(text, sugarFor(file)));
    f(d);
    return applyYaml(text, d.toString(), sugarFor(file));
  };

  it("reads as the notes it stands for", () => {
    expect(parseYaml(toYaml(SEQ, sugarFor(path))).notes).toEqual(
      expandNotes("c4 d4 e4 f4"),
    );
  });

  it("keeps the short form through an edit that leaves the notes alone", () => {
    expect(write(SEQ, path, (d) => d.set("to", "3:1"))).toBe(
      SEQ.replace('"2:1"', '"3:1"'),
    );
  });

  it("is written as the full note list once a note changes", () => {
    const out = write(SEQ, path, (d) => d.setIn(["notes", 1, "v"], 0.5));
    expect(out).toContain("// the riff");
    expect(out).not.toContain('notes("');
    expect(parseYaml(toYaml(out, sugarFor(path))).notes).toEqual([
      n(0, 1, 60),
      { ...n(1, 1, 62), v: 0.5 },
      n(2, 1, 64),
      n(3, 1, 65),
    ]);
  });

  const GRAPH = 'runs([["melody", "lead", "MIX", "OUT"]])\nbypassed([])\n';
  const graph = "song/graph.k7x";

  it("keeps the runs through an edit elsewhere in the graph", () => {
    expect(write(GRAPH, graph, (d) => d.set("bypassed", ["lead"]))).toBe(
      GRAPH.replace("bypassed([])", 'bypassed(["lead"])'),
    );
  });

  it("writes the segments in full once one changes, and never brings a removed one back", () => {
    const out = write(GRAPH, graph, (d) => d.setIn(["modules", "lead"], []));
    expect(out).not.toContain("runs(");
    expect(parseYaml(toYaml(out, sugarFor(graph))).modules).toEqual({
      melody: ["lead"],
      lead: [],
      MIX: ["OUT"],
    });
  });

  it("is unchanged by a write that changes nothing", () => {
    expect(
      applyYaml(
        SEQ,
        stringify(parseYaml(toYaml(SEQ, sugarFor(path)))),
        sugarFor(path),
      ),
    ).toBe(SEQ);
  });
});
