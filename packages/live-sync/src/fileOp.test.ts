// fileOp.test.ts — an edit becomes path ops only when they replay exactly, and two edits commute.

import { K7Document } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import { applyFileOp, fileOpFor, textHash } from "./fileOp.ts";
import { applyK7x, diffK7x } from "./k7xOps.ts";
import { overlaps } from "./ops.ts";

/** The value, failing the test when it is null. */
function must<T>(v: T | null | undefined): T {
  if (v == null) throw new Error("unexpected null");
  return v;
}

const MODULE = `// a mixer node
plugin("mixer")
params({
  gain: 0.5, // unity is 1
  pan: 0,
})
inputs(["kick", "snare"])
start("0:1:0")
`;

/** What a writer does: one document, edited in place. */
const edit = (text: string, f: (d: K7Document) => void): string => {
  const d = new K7Document(text);
  f(d);
  return d.toString();
};

describe("fileOpFor", () => {
  it("sends a value change as one path op, leaving comments alone", () => {
    const after = edit(MODULE, (d) => d.setIn(["params", "gain"], 0.7));
    const op = fileOpFor("song.k7/nodes/mix.k7x", MODULE, after);
    expect(op).toEqual({
      kind: "k7x",
      file: "song.k7/nodes/mix.k7x",
      ops: [{ op: "set", path: ["params", "gain"], k7x: "0.7", was: "0.5" }],
    });
    expect(applyFileOp(MODULE, must(op))).toBe(after);
    expect(after).toContain("// unity is 1");
  });

  it("keeps a timecode and an inline list as written in the value it carries", () => {
    const after = edit(MODULE, (d) => {
      d.setIn(["start"], "0:2:0");
      d.setIn(["inputs"], ["kick", "snare", "hat"]);
    });
    const op = fileOpFor("a.k7x", MODULE, after);
    expect(op?.kind).toBe("k7x");
    expect(applyFileOp(MODULE, must(op))).toBe(after);
  });

  it("treats a list with no natural key as one value: no index ever appears in a path", () => {
    const ops = diffK7x(
      "steps([{ start: 1 }, { start: 2 }])\n",
      "steps([{ start: 1 }, { start: 3 }])\n",
    )?.ops;
    expect(ops).toEqual([
      {
        op: "set",
        path: ["steps"],
        k7x: "[{ start: 1 }, { start: 3 }]",
        was: "[{ start: 1 }, { start: 2 }]",
      },
    ]);
  });

  it("records added and removed keys", () => {
    const after = edit(MODULE, (d) => {
      d.deleteIn(["params", "pan"]);
      d.setIn(["mute"], true);
    });
    const ops = must(diffK7x(MODULE, after)).ops;
    expect(ops).toContainEqual({
      op: "delete",
      path: ["params", "pan"],
      was: "0",
    });
    const set = ops.find((o) => o.op === "set");
    expect(set?.was).toBeNull();
    expect(set?.path).toEqual(["mute"]);
    expect(applyFileOp(MODULE, must(fileOpFor("a.k7x", MODULE, after)))).toBe(
      after,
    );
  });

  it("falls back to the whole text when a comment changed", () => {
    const after = MODULE.replace("// unity is 1", "// unity is one");
    expect(fileOpFor("a.k7x", MODULE, after)).toEqual({
      kind: "text",
      file: "a.k7x",
      text: after,
      was: textHash(MODULE),
    });
  });

  it("falls back to the whole text for other files, new files and k7x that does not read", () => {
    expect(fileOpFor("TODOS.md", "a", "b")?.kind).toBe("text");
    expect(fileOpFor("env.yaml", "a: 1\n", "a: 2\n")?.kind).toBe("text");
    expect(fileOpFor("new.k7x", null, "a(1)\n")?.kind).toBe("text");
    expect(fileOpFor("a.k7x", "a(1)\n", "a([\n")?.kind).toBe("text");
  });

  it("reports a removal and no change", () => {
    expect(fileOpFor("a.k7x", "a(1)\n", null)).toEqual({
      kind: "remove",
      file: "a.k7x",
      was: textHash("a(1)\n"),
    });
    expect(fileOpFor("a.k7x", "a(1)\n", "a(1)\n")).toBeNull();
  });
});

describe("two replicas editing one file", () => {
  it("converge whichever order the edits arrive in, when they touch different values", () => {
    const mine = must(
      diffK7x(
        MODULE,
        edit(MODULE, (d) => d.setIn(["params", "gain"], 0.9)),
      ),
    ).ops;
    const theirs = must(
      diffK7x(
        MODULE,
        edit(MODULE, (d) => d.setIn(["params", "pan"], -0.25)),
      ),
    ).ops;
    expect(overlaps(mine[0].path, theirs[0].path)).toBe(false);
    const oneWay = applyK7x(applyK7x(MODULE, mine), theirs);
    const otherWay = applyK7x(applyK7x(MODULE, theirs), mine);
    expect(oneWay).toBe(otherWay);
    expect(new K7Document(oneWay).getIn(["params"])).toEqual({
      gain: 0.9,
      pan: -0.25,
    });
  });

  it("see a collision exactly when the paths overlap", () => {
    expect(overlaps(["params"], ["params", "gain"])).toBe(true);
    expect(overlaps(["params", "gain"], ["params", "gain"])).toBe(true);
    expect(overlaps(["params", "gain"], ["params", "pan"])).toBe(false);
  });
});
