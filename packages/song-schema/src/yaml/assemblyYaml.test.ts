// The two writers the builder commits through. What is pinned here is the thing a document
// writer exists for: promoting a param must change the `params` block and leave every comment,
// every key order and every other line of the file exactly where they were.
// See packages/song/docs/assemblies.md.

import { K7Document, type K7Scope } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import {
  dropAssemblyParam,
  formatAssembly,
  parseAssembly,
  parseAssemblyTemplate,
  renameAssemblyMember,
  setAssemblyParam,
} from "./assemblyFile";

/** Run one writer over a whole file, handing back its text and what the writer answered. */
function edit<T>(text: string, fn: (doc: K7Scope) => T) {
  const doc = new K7Document(text);
  const out = fn(doc.at([]));
  return { text: doc.toString(), out };
}

const TEMPLATE = `// A TURNTABLE — the deck and its strip, as one box.
label("Turntable")
outputs([
  // The channel's own fade, which is one half of the crossfader.
  name("mix").type("audio").node("fade"),
])
// The five a hand actually reaches for.
params({
  Trim: { node: "trim", param: "Trim" },
})
`;

const LEVEL = { node: "level", param: "Gain" };

describe("parsing", () => {
  it("reads a template and places a schema finding on its line", () => {
    expect(parseAssemblyTemplate(TEMPLATE).value?.outputs?.[0].node).toBe(
      "fade",
    );
    const { issues } = parseAssemblyTemplate('label("x")\nplugs([])\n');
    expect(issues[0].path).toBe("plugs");
    expect(issues[0].line).toBe(2);
  });

  it("names what an empty file lacks, and a syntax error's place", () => {
    expect(parseAssembly("").issues[0].message).toMatch(/uses/);
    const bad = parseAssembly('uses("x"\n');
    expect(bad.value).toBeNull();
    expect(bad.issues[0].line).toBeDefined();
  });
});

describe("promoting a param", () => {
  it("adds it and touches nothing else", () => {
    const { text } = edit(TEMPLATE, (d) => setAssemblyParam(d, "Level", LEVEL));
    expect(text).toContain(
      "// A TURNTABLE — the deck and its strip, as one box.",
    );
    expect(text).toContain(
      "// The channel's own fade, which is one half of the crossfader.",
    );
    expect(text).toContain("// The five a hand actually reaches for.");
    expect(parseAssemblyTemplate(text).value?.params).toEqual({
      Trim: { node: "trim", param: "Trim" },
      Level: LEVEL,
    });
  });

  it("replaces what that name already promoted rather than stacking two", () => {
    const { text } = edit(TEMPLATE, (d) => setAssemblyParam(d, "Trim", LEVEL));
    expect(parseAssemblyTemplate(text).value?.params).toEqual({ Trim: LEVEL });
  });

  it("writes the block on a template that had none", () => {
    const { text } = edit('label("Box")\n', (d) =>
      setAssemblyParam(d, "Trim", { node: "trim", param: "Trim" }),
    );
    expect(parseAssemblyTemplate(text).value?.params?.Trim).toEqual({
      node: "trim",
      param: "Trim",
    });
  });
});

describe("taking one back off", () => {
  it("drops the entry and the round trip leaves the file as it was", () => {
    const two = edit(TEMPLATE, (d) => setAssemblyParam(d, "Level", LEVEL)).text;
    const { text, out } = edit(two, (d) => dropAssemblyParam(d, "Level"));
    expect(out).toBe(true);
    expect(text).toBe(TEMPLATE);
  });

  it("takes the empty block with the LAST one — an emptied `params` says nothing", () => {
    const { text } = edit(TEMPLATE, (d) => dropAssemblyParam(d, "Trim"));
    expect(text).not.toContain("params");
    expect(parseAssemblyTemplate(text).value?.params).toBeUndefined();
  });

  it("is a no-op for a name nothing promoted", () => {
    expect(edit(TEMPLATE, (d) => dropAssemblyParam(d, "Nope"))).toEqual({
      text: TEMPLATE,
      out: false,
    });
  });
});

const INSTANCE = `// turntableA — deck A's nodes.
uses("@k7-core/turntable")
members({
  // the record's own lane
  deck: "deckA",
  fade: "fadeA",
})
`;

describe("following a node's rename", () => {
  it("repoints the member and keeps the comments", () => {
    const { text, out } = edit(INSTANCE, (d) =>
      renameAssemblyMember(d, "fadeA", "crossA"),
    );
    expect(out).toBe(true);
    expect(text).toContain("// turntableA — deck A's nodes.");
    expect(text).toContain("// the record's own lane");
    expect(parseAssembly(text).value?.members).toEqual({
      deck: "deckA",
      fade: "crossA",
    });
  });

  it("hands the file back unchanged when no member names that node", () => {
    expect(
      edit(INSTANCE, (d) => renameAssemblyMember(d, "nowhere", "x")),
    ).toEqual({
      text: INSTANCE,
      out: false,
    });
  });
});

describe("formatAssembly", () => {
  it("writes a document this library reads back", () => {
    const text = formatAssembly(
      { uses: "@k7-core/turntable", members: { deck: "deckA" } },
      ["a header"],
    );
    expect(text.startsWith("// a header\n")).toBe(true);
    expect(parseAssembly(text).value).toEqual({
      uses: "@k7-core/turntable",
      members: { deck: "deckA" },
    });
  });
});
