// The attribute-set writers: a knob turned on a set lands in THAT set, never under it.

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { addAlternative, setAlternativeParam } from "./alternativeFile";
import { setModuleAutomation } from "./moduleFile";
import { AlternativeSchema } from "./moduleSchema";

const read = (text: string) => parse(text, { version: "1.2" });

describe("setAlternativeParam", () => {
  it("writes the module's own params while the first set is on", () => {
    const out = setAlternativeParam("params: { Gain: 3 }\n", "Gain", 5);
    expect(read(out).params).toEqual({ Gain: 5 });
  });

  it("writes into the set that is on, leaving the module's own alone", () => {
    const text =
      "params: { Gain: 3 }\nalternatives:\n  - name: crunch\n    params: { Gain: 9 }\nalternative: crunch\n";
    const out = read(setAlternativeParam(text, "Tone", 2));
    expect(out.params).toEqual({ Gain: 3 });
    expect(out.alternatives[0].params).toEqual({ Gain: 9, Tone: 2 });
  });

  it("opens an empty set written `{}` into block style, a param per line", () => {
    // The shape `node alternative create` writes, and the case where every knob used to land on set 1.
    const out = setAlternativeParam(
      'params: { Gain: 3 }\nalternatives:\n  - {}\nalternative: "2"\n',
      "Gain",
      7,
    );
    expect(read(out).alternatives[0].params).toEqual({ Gain: 7 });
    expect(read(out).params).toEqual({ Gain: 3 });
    expect(out).toMatch(/^ {6}Gain: 7$/m);
  });

  it("removes a param on null, under the engine named, and leaves a file without it untouched", () => {
    const text =
      "engine: nam\nengines:\n  nam:\n    params:\n      model: a.nam\n      ir: b.wav\n";
    const out = read(setAlternativeParam(text, "model", null, "nam"));
    expect(out.engines.nam.params).toEqual({ ir: "b.wav" });
    const bare = "params: { Gain: 3 }\n";
    expect(setAlternativeParam(bare, "model", null)).toBe(bare);
  });
});

describe("setModuleAutomation on a module with sets", () => {
  const swapped = `extends: a
alternatives:
  - extends: b
alternative: "2"
`;

  it("binds inside a set that swaps the module, since the node no longer reads its own fields", () => {
    const out = read(
      setModuleAutomation(swapped, "Geometry", "@meta/curves/x"),
    );
    expect(out.automations).toBeUndefined();
    expect(out.alternatives[0].automations).toEqual([
      { param: "Geometry", curve: "@meta/curves/x" },
    ]);
    const off = setModuleAutomation(
      setModuleAutomation(swapped, "Geometry", "@meta/curves/x"),
      "Geometry",
      null,
    );
    expect(read(off).alternatives[0].automations).toBeUndefined();
  });

  it("binds on the node itself under a patch set, which inherits the node's list", () => {
    const patch = 'alternatives:\n  - params: { Gain: 1 }\nalternative: "2"\n';
    const out = read(setModuleAutomation(patch, "Gain", "@meta/curves/x"));
    expect(out.automations).toHaveLength(1);
    expect(out.alternatives[0].automations).toBeUndefined();
  });
});

describe("addAlternative", () => {
  it("copies a chain step's settings, never its own id or bypass", () => {
    const step =
      'id: 8339210a\nextends: "@k7-core/fx/drive"\nbypass: true\nparams: { Gain: 3 }\n';
    const out = read(addAlternative(step, undefined, { copy: true }).text);
    expect(out.alternatives).toEqual([{ params: { Gain: 3 } }]);
    expect(out.id).toBe("8339210a");
    expect(AlternativeSchema.safeParse(out.alternatives[0]).success).toBe(true);
  });
});
