// The attribute-set writers: a knob turned on a set lands in THAT set, never under it.

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { setAlternativeParam } from "./alternativeFile";

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
});
