import { yaml } from "@codemirror/lang-yaml";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { valueTokens } from "./entityValues";

// What entityLinks and previewGutter both need: every VALUE in the document, with the field
// it belongs to. The CUE editor answers this with a 55-line text scanner that
// previewGutter's header admits it copies; here it is one walk of the syntax tree, shared.
//
// The cases below are the ones the two CUE scanners had to get right by hand.

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
    // `module: module` would link the wrong half of the line — and a key that happens to
    // name an entity would link at all, which is the bug this guards.
    expect(pairs("module: module\n")).toEqual(["module=module"]);
    const t = at("module: module\n")[0];
    // The token starts at the VALUE, not at the key.
    expect(t.from).toBe("module: ".length);
  });

  it("inherits the field through a sequence", () => {
    // `in: [pad, bass]` must resolve like `in: pad` twice — the CUE scanner pushes the
    // parent key onto its stack for `[`; here the walk skips the sequence node.
    expect(pairs("in: [pad, bass]\n")).toEqual(["in=pad", "in=bass"]);
    expect(pairs("in:\n  - pad\n  - bass\n")).toEqual(["in=pad", "in=bass"]);
  });

  it("reads a chain's flow maps, colons in values and all", () => {
    // A real chains.yaml line. `synth:lead` is an instance ref and must stay whole.
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

  // Building a state parses only the first 3000 characters (Work.InitViewport), under a 20 ms
  // budget, and keeps whatever it got. Reading that tree found a THIRD of an 8.5 kB chains.yaml
  // and reported no error — every link and gutter past the cut simply went dark. The same budget
  // is why a loaded CI runner returned an empty tree for a two-line file: the first parse in a
  // cold worker builds the parse tables, and 20 ms does not always cover that.
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
