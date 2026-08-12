import { describe, expect, it } from "vitest";
import { chainNodes, chainsVocabulary } from "./chainsVocabulary";

// A real médiathèque template, shape and all: one pseudo-track feeding the first module,
// each module naming the next, the last one leaving through `@out`.
const CHAIN = `modules:
  "@in": [ wobble ]
  wobble: [ bitcrush ]
  bitcrush: [ "@out" ]
`;

const PATH = "chains/blindtest/houdini/chains.yaml";
const vocab = chainsVocabulary(PATH, chainNodes(CHAIN));
const values = (keyPath: string[], field: string) =>
  vocab.valuesAt?.(keyPath, field) ?? [];

describe("chainNodes", () => {
  it("reads the nodes the template declares", () => {
    // `@in` is a node like the rest now — one `modules:` map, so the template's source is in it.
    expect(chainNodes(CHAIN)).toEqual(["@in", "wobble", "bitcrush"]);
  });

  it("says null while the text is half-typed", () => {
    // Not an empty list: the caller keeps its last readable set, so completion survives the
    // keystroke that broke the document.
    expect(chainNodes("modules:\n  wobble: [ bitcr")).toBeNull();
  });
});

describe("the chains vocabulary", () => {
  it("offers a node's destinations under `modules:`", () => {
    // The key is the node's own name, so what is completed is where its signal goes.
    expect(values(["modules"], "wobble")).toEqual([
      "@in",
      "wobble",
      "bitcrush",
      "@out",
    ]);
  });

  it("offers the same for the template's input", () => {
    expect(values(["modules"], "@in")).toContain("wobble");
  });

  it("offers modules for `bypassed`, and not the sink", () => {
    // A sink has nothing to pass through, so it does not belong in a list of things the
    // signal skips.
    expect(values([], "bypassed")).toEqual(["@in", "wobble", "bitcrush"]);
    expect(values(["bypassed"], "0")).not.toContain("@out");
  });

  it("keeps the file's two sections from the schema", () => {
    expect(vocab.fieldsAt([])).toEqual(["modules", "bypassed"]);
    // Inside one, the keys are node names — a vocabulary the schema cannot invent.
    expect(vocab.fieldsAt(["modules"])).toEqual([]);
  });

  it("still offers the way out of a template nobody has written yet", () => {
    // An empty file has no nodes, but `@out` is where a segment ends whatever it declares.
    expect(chainsVocabulary(PATH, null).valuesAt?.(["modules"], "x")).toEqual([
      "@out",
    ]);
  });
});
