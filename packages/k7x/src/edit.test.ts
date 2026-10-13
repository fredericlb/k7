// edit.test.ts — every edit changes the value it names and nothing else: the exact text after each one.

import { describe, expect, it } from "vitest";
import { parseDocument } from "./edit.ts";

const edit = (
  text: string,
  f: (d: ReturnType<typeof parseDocument>) => void,
): string => {
  const d = parseDocument(text);
  f(d);
  return d.toString();
};

const NODE = `// synth-pad
extends("@workspace/instruments/synth")
params({
  "Filter Freq": 40, // darker than the lead
  Level: -12,
})
automations([])
`;

describe("setIn", () => {
  it("rewrites one scalar in place, comments kept", () => {
    expect(edit(NODE, (d) => d.setIn(["params", "Filter Freq"], 55))).toBe(
      NODE.replace("40,", "55,"),
    );
  });

  it("changes nothing when the value is already there", () => {
    expect(edit(NODE, (d) => d.setIn(["params", "Level"], -12))).toBe(NODE);
  });

  it("adds an entry to a multi-line object on a line of its own", () => {
    expect(edit(NODE, (d) => d.setIn(["params", "Detune"], 3))).toBe(
      NODE.replace("  Level: -12,\n", "  Level: -12,\n  Detune: 3,\n"),
    );
  });

  it("adds a root statement after the last one", () => {
    expect(edit(NODE, (d) => d.setIn(["bypass"], true))).toBe(
      `${NODE}bypass(true)\n`,
    );
  });

  it("creates the maps on the way", () => {
    expect(
      edit("a(1)\n", (d) =>
        d.setIn(["engines", "tracktion", "params", "Ratio"], 0.5),
      ),
    ).toBe("a(1)\nengines({ tracktion: { params: { Ratio: 0.5 } } })\n");
  });

  it("extends a one-line chain inline and a broken chain on a new line", () => {
    expect(
      edit("steps([id(1).x(2)])", (d) => d.setIn(["steps", 0, "y"], 3)),
    ).toBe("steps([id(1).x(2).y(3)])");
    const broken = "steps([\n  id(1)\n    .x(2), // two\n])\n";
    expect(edit(broken, (d) => d.setIn(["steps", 0, "y"], 3))).toBe(
      "steps([\n  id(1)\n    .x(2)\n    .y(3), // two\n])\n",
    );
  });

  it("fills an empty object and an empty list", () => {
    expect(
      edit("markers({})", (d) => d.setIn(["markers", "1:1"], "intro")),
    ).toBe('markers({ "1:1": "intro" })');
    expect(edit("tags([])", (d) => d.addIn(["tags"], "a"))).toBe('tags(["a"])');
  });

  it("appends to a one-line list and to a multi-line one", () => {
    expect(edit("tags([1, 2])", (d) => d.addIn(["tags"], 3))).toBe(
      "tags([1, 2, 3])",
    );
    expect(
      edit("notes([\n  t(0).k(60),\n  t(1).k(62)\n])", (d) =>
        d.addIn(["notes"], { t: 2, k: 64 }),
      ),
    ).toBe("notes([\n  t(0).k(60),\n  t(1).k(62),\n  t(2).k(64),\n])");
  });

  it("keeps a call's bare argument list bare while it stays one", () => {
    expect(edit("to(1, 2)", (d) => d.setIn(["to"], [1, 2, 3]))).toBe(
      "to(1, 2, 3)",
    );
    expect(edit("to(1, 2)", (d) => d.setIn(["to"], [1]))).toBe("to([1])");
    expect(edit("to(1, 2)", (d) => d.addIn(["to"], 3))).toBe("to(1, 2, 3)");
  });

  it("sets an empty call", () => {
    expect(edit("bypass() x(1)", (d) => d.setIn(["bypass"], false))).toBe(
      "bypass(false) x(1)",
    );
  });
});

describe("deleteIn", () => {
  it("removes an object entry's whole line, its comment with it", () => {
    expect(edit(NODE, (d) => d.deleteIn(["params", "Filter Freq"]))).toBe(
      NODE.replace('  "Filter Freq": 40, // darker than the lead\n', ""),
    );
  });

  it("removes a root statement's line", () => {
    expect(edit(NODE, (d) => d.deleteIn(["automations"]))).toBe(
      NODE.replace("automations([])\n", ""),
    );
  });

  it("removes a call from a chain: its dot inline, its line when broken, the head too", () => {
    expect(edit("s([a(1).b(2).c(3)])", (d) => d.deleteIn(["s", 0, "b"]))).toBe(
      "s([a(1).c(3)])",
    );
    expect(edit("s([a(1).b(2).c(3)])", (d) => d.deleteIn(["s", 0, "a"]))).toBe(
      "s([b(2).c(3)])",
    );
    expect(
      edit("s([\n  a(1)\n    .b(2)\n    .c(3),\n])", (d) =>
        d.deleteIn(["s", 0, "b"]),
      ),
    ).toBe("s([\n  a(1)\n    .c(3),\n])");
  });

  it("leaves {} where a chain loses its only call", () => {
    expect(edit("s([a(1), b(2)])", (d) => d.deleteIn(["s", 1, "b"]))).toBe(
      "s([a(1), {}])",
    );
  });

  it("removes list items with their commas", () => {
    expect(edit("l([1, 2, 3])", (d) => d.deleteIn(["l", 1]))).toBe("l([1, 3])");
    expect(edit("l([1, 2, 3])", (d) => d.deleteIn(["l", 2]))).toBe("l([1, 2])");
    expect(edit("l([1])", (d) => d.deleteIn(["l", 0]))).toBe("l([])");
    expect(edit("l(1, 2)", (d) => d.deleteIn(["l", 0]))).toBe("l([2])");
  });

  it("says when there was nothing to remove", () => {
    const d = parseDocument(NODE);
    expect(d.deleteIn(["nope"])).toBe(false);
    expect(d.toString()).toBe(NODE);
  });
});

describe("a document", () => {
  it("records a syntax error instead of throwing, and refuses edits", () => {
    const d = parseDocument("a(");
    expect(d.errors).toHaveLength(1);
    expect(() => d.setIn(["a"], 1)).toThrow();
  });

  it("reads values at paths", () => {
    const d = parseDocument(NODE);
    expect(d.getIn(["params", "Level"])).toBe(-12);
    expect(d.hasIn(["params", "Nope"])).toBe(false);
    expect(d.toJS().automations).toEqual([]);
  });
});
