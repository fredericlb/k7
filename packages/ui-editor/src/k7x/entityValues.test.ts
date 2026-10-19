import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { valueTokens } from "./entityValues";

// What entityLinks needs: every string VALUE with its field, as one walk of the buffer's k7x tree.

const at = (doc: string) => valueTokens(EditorState.create({ doc }));
const pairs = (doc: string) => at(doc).map((t) => `${t.field}=${t.value}`);

describe("values and the field they belong to", () => {
  it("reads a flat file", () => {
    expect(pairs('extends("audio/verb")\nir("ir/marshall.wav")\n')).toEqual([
      "extends=audio/verb",
      "ir=ir/marshall.wav",
    ]);
  });

  it("never mistakes a key for a value", () => {
    // `module("module")` would otherwise link the wrong half of the line, which is the bug this guards.
    expect(pairs('module("module")\n')).toEqual(["module=module"]);
    expect(at('module("module")\n')[0].from).toBe('module("'.length);
  });

  it("inherits the field through a list", () => {
    expect(pairs('in(["pad", "bass"])\n')).toEqual(["in=pad", "in=bass"]);
    expect(pairs('in("pad", "bass")\n')).toEqual(["in=pad", "in=bass"]);
  });

  it("reads a chain inside a list, colons in values and all", () => {
    expect(
      pairs('chains([[track("melody").as("lead"), module("synth:lead")]])\n'),
    ).toEqual(["track=melody", "as=lead", "module=synth:lead"]);
  });

  it("gives offsets that exclude the quotes", () => {
    const doc = "module('synth:lead')\n";
    const t = at(doc)[0];
    expect(doc.slice(t.from, t.to)).toBe("synth:lead");
  });

  it("attributes a nested value to its own key, not its parent's", () => {
    expect(
      pairs('ui({ widgets: { w1: { type: "knob", bind: "Depth" } } })\n'),
    ).toEqual(["type=knob", "bind=Depth"]);
  });

  it("skips comments, numbers and empty strings", () => {
    expect(
      pairs('// module("not-a-value")\nir("ir/a.wav")\ngain(3)\nx("")\n'),
    ).toEqual(["ir=ir/a.wav"]);
  });

  it("answers nothing for a buffer that never parsed", () => {
    expect(at('module("reverb"\n')).toEqual([]);
  });
});
