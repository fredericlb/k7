// The two writers the builder commits through. What is pinned here is the thing a Document-API
// writer exists for: promoting a param must change the `params:` block and leave every comment,
// every key order and every other line of the file exactly where they were.
// See packages/song/docs/assemblies.md.

import { describe, expect, it } from "vitest";
import {
  dropAssemblyParam,
  formatAssembly,
  parseAssembly,
  parseAssemblyTemplate,
  renameAssemblyMember,
  setAssemblyParam,
} from "./assemblyFile";

const TEMPLATE = `# A TURNTABLE — the deck and its strip, as one box.
label: Turntable
outputs:
  # The channel's own fade, which is one half of the crossfader.
  - { name: mix, type: audio, node: fade }
params:
  # The five a hand actually reaches for.
  Trim: { node: trim, param: Trim }
`;

describe("promoting a param", () => {
  it("adds it and touches nothing else", () => {
    const next = setAssemblyParam(TEMPLATE, "Level", {
      node: "level",
      param: "Gain",
    });
    expect(next).toContain(
      "# A TURNTABLE — the deck and its strip, as one box.",
    );
    expect(next).toContain(
      "# The channel's own fade, which is one half of the crossfader.",
    );
    expect(next).toContain("# The five a hand actually reaches for.");
    expect(next).toContain("Level: { node: level, param: Gain }");
    expect(parseAssemblyTemplate(next).value?.params).toEqual({
      Trim: { node: "trim", param: "Trim" },
      Level: { node: "level", param: "Gain" },
    });
  });

  it("replaces what that name already promoted rather than stacking two", () => {
    const next = setAssemblyParam(TEMPLATE, "Trim", {
      node: "level",
      param: "Gain",
    });
    expect(parseAssemblyTemplate(next).value?.params).toEqual({
      Trim: { node: "level", param: "Gain" },
    });
  });

  it("writes the block on a template that had none", () => {
    const next = setAssemblyParam("label: Box\n", "Trim", {
      node: "trim",
      param: "Trim",
    });
    expect(parseAssemblyTemplate(next).value?.params?.Trim).toEqual({
      node: "trim",
      param: "Trim",
    });
  });
});

describe("taking one back off", () => {
  it("drops the entry and keeps the rest of the file", () => {
    const two = setAssemblyParam(TEMPLATE, "Level", {
      node: "level",
      param: "Gain",
    });
    const next = dropAssemblyParam(two, "Level");
    expect(parseAssemblyTemplate(next).value?.params).toEqual({
      Trim: { node: "trim", param: "Trim" },
    });
    expect(next).toContain("# A TURNTABLE");
  });

  it("takes the empty block with the LAST one — an emptied `params:` says nothing", () => {
    const next = dropAssemblyParam(TEMPLATE, "Trim");
    expect(next).not.toContain("params:");
    expect(parseAssemblyTemplate(next).value?.params).toBeUndefined();
  });

  it("is a no-op for a name nothing promoted", () => {
    expect(dropAssemblyParam(TEMPLATE, "Nope")).toBe(TEMPLATE);
  });
});

const INSTANCE = `# turntableA — deck A's nodes.
uses: "@k7-core/turntable"
members:
  # the record's own lane
  deck: deckA
  fade: fadeA
`;

describe("following a node's rename", () => {
  it("repoints the member and keeps the comments", () => {
    const next = renameAssemblyMember(INSTANCE, "fadeA", "crossA");
    expect(next).toContain("# turntableA — deck A's nodes.");
    expect(next).toContain("# the record's own lane");
    expect(parseAssembly(next).value?.members).toEqual({
      deck: "deckA",
      fade: "crossA",
    });
  });

  it("hands the file back unchanged when no member names that node", () => {
    expect(renameAssemblyMember(INSTANCE, "nowhere", "x")).toBe(INSTANCE);
  });
});

describe("formatAssembly", () => {
  it("writes a document this library reads back", () => {
    const text = formatAssembly(
      { uses: "@k7-core/turntable", members: { deck: "deckA" } },
      "# a header",
    );
    expect(text.startsWith("# a header\n")).toBe(true);
    expect(parseAssembly(text).value).toEqual({
      uses: "@k7-core/turntable",
      members: { deck: "deckA" },
    });
  });
});
