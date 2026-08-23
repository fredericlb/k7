import { yaml } from "@codemirror/lang-yaml";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { valueTokens } from "./entityValues";

// What entityLinks and previewGutter both need: every VALUE with its field, as one shared walk of the syntax tree.

const at = (doc: string) =>
  valueTokens(EditorState.create({ doc, extensions: [yaml()] }));
const pairs = (doc: string) => at(doc).map((t) => `${t.field}=${t.value}`);

describe("values and the field they belong to", () => {
  it("reads a flat file", () => {
    expect(pairs('extends: "audio/verb"\nir: ir/marshall.wav\n')).toEqual([
      "extends=audio/verb",
      "ir=ir/marshall.wav",
    ]);
  });

  it("never mistakes a key for a value", () => {
    // `module: module` would otherwise link the wrong half of the line, which is the bug this guards.
    expect(pairs("module: module\n")).toEqual(["module=module"]);
    const t = at("module: module\n")[0];
    // The token starts at the VALUE, not at the key.
    expect(t.from).toBe("module: ".length);
  });

  it("inherits the field through a sequence", () => {
    // `in: [pad, bass]` must resolve like `in: pad` twice, which the walk gets by skipping the sequence node.
    expect(pairs("in: [pad, bass]\n")).toEqual(["in=pad", "in=bass"]);
    expect(pairs("in:\n  - pad\n  - bass\n")).toEqual(["in=pad", "in=bass"]);
  });

  it("reads a chain's flow maps, colons in values and all", () => {
    // A real chains.yaml line. `synth:lead` is a node ref and must stay whole.
    expect(
      pairs(
        "chains:\n  - [ { track: melody, as: lead }, { module: synth:lead }, { module: OUT } ]\n",
      ),
    ).toEqual(["track=melody", "as=lead", "module=synth:lead", "module=OUT"]);
  });

  it("gives offsets that exclude the quotes", () => {
    // A decoration must underline the text, not the punctuation round it.
    const doc = 'module: "synth:lead"\n';
    const t = at(doc)[0];
    expect(doc.slice(t.from, t.to)).toBe("synth:lead");
  });

  it("attributes a nested value to its own key, not its parent's", () => {
    expect(
      pairs("ui:\n  widgets:\n    w1: { type: knob, bind: Depth }\n"),
    ).toEqual(["type=knob", "bind=Depth"]);
  });

  it("skips comments and empty values", () => {
    expect(pairs("# module: not-a-value\nir: ir/a.wav\n")).toEqual([
      "ir=ir/a.wav",
    ]);
  });

  // Building a state parses only the first 3000 characters under a 20 ms budget — see docs/completion.md.
  it("reads past the init viewport, on a file longer than 3000 characters", () => {
    const n = 400;
    const doc = `modules:\n${Array.from(
      { length: n },
      (_, i) => `  mod${i}: [ dest${i} ]`,
    ).join("\n")}\n`;
    expect(doc.length).toBeGreaterThan(3000); // the fixture only works if it crosses the cap
    const t = at(doc);
    expect(t).toHaveLength(n);
    expect(t[n - 1].value).toBe(`dest${n - 1}`); // the LAST one, well past the cut
  });
});
