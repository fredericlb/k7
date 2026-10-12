// fileOp.test.ts — an edit becomes path ops only when they replay exactly, and two edits commute.

import { describe, expect, it } from "vitest";
import { applyFileOp, fileOpFor, textHash } from "./fileOp.ts";
import { overlaps } from "./ops.ts";
import { applyYaml, diffYaml } from "./yamlOps.ts";

/** The value, failing the test when it is null. */
function must<T>(v: T | null | undefined): T {
  if (v == null) throw new Error("unexpected null");
  return v;
}

const MODULE = `# a mixer node
plugin: mixer
params:
  gain: 0.5 # unity is 1
  pan: 0
inputs: [kick, snare]
start: "0:1:0"
`;

describe("fileOpFor", () => {
  it("sends a value change as one path op, leaving comments alone", () => {
    const after = MODULE.replace("gain: 0.5", "gain: 0.7");
    const op = fileOpFor("song.st0/nodes/mix.yaml", MODULE, after);
    expect(op).toEqual({
      kind: "yaml",
      file: "song.st0/nodes/mix.yaml",
      ops: [
        {
          op: "set",
          path: ["params", "gain"],
          yaml: "0.7 # unity is 1\n",
          was: "0.5 # unity is 1\n",
        },
      ],
    });
    expect(applyFileOp(MODULE, must(op))).toBe(after);
  });

  it("keeps a timecode's quotes and an inline list's style in the value it carries", () => {
    const after = MODULE.replace('"0:1:0"', '"0:2:0"').replace(
      "[kick, snare]",
      "[kick, snare, hat]",
    );
    const op = fileOpFor("a.yaml", MODULE, after);
    expect(op?.kind).toBe("yaml");
    expect(applyFileOp(MODULE, must(op))).toBe(after);
  });

  it("treats a list with no natural key as one value: no index ever appears in a path", () => {
    const ops = diffYaml(
      "steps:\n  - start: 1\n  - start: 2\n",
      "steps:\n  - start: 1\n  - start: 3\n",
    );
    expect(ops).toEqual([
      {
        op: "set",
        path: ["steps"],
        yaml: "- start: 1\n- start: 3\n",
        was: "- start: 1\n- start: 2\n",
      },
    ]);
  });

  it("records added and removed keys", () => {
    const after = MODULE.replace("  pan: 0\n", "").replace(
      "plugin: mixer\n",
      "plugin: mixer\nmute: true\n",
    );
    const ops = diffYaml(MODULE, after);
    expect(ops).toContainEqual({
      op: "delete",
      path: ["params", "pan"],
      was: "0\n",
    });
    expect(ops?.find((o) => o.op === "set")?.was).toBeNull();
    expect(ops?.find((o) => o.op === "set")?.path).toEqual(["mute"]);
  });

  it("falls back to the whole text when a comment changed", () => {
    const after = MODULE.replace("# unity is 1", "# unity is one");
    expect(fileOpFor("a.yaml", MODULE, after)).toEqual({
      kind: "text",
      file: "a.yaml",
      text: after,
      was: textHash(MODULE),
    });
  });

  it("falls back to the whole text for non-YAML, new files and unparseable YAML", () => {
    expect(fileOpFor("TODOS.md", "a", "b")?.kind).toBe("text");
    expect(fileOpFor("new.yaml", null, "a: 1\n")?.kind).toBe("text");
    expect(fileOpFor("a.yaml", "a: 1\n", "a: [\n")?.kind).toBe("text");
  });

  it("reports a removal and no change", () => {
    expect(fileOpFor("a.yaml", "a: 1\n", null)).toEqual({
      kind: "remove",
      file: "a.yaml",
      was: textHash("a: 1\n"),
    });
    expect(fileOpFor("a.yaml", "a: 1\n", "a: 1\n")).toBeNull();
  });
});

describe("two replicas editing one file", () => {
  it("converge whichever order the edits arrive in, when they touch different values", () => {
    const mine = must(
      diffYaml(MODULE, MODULE.replace("gain: 0.5", "gain: 0.9")),
    );
    const theirs = must(
      diffYaml(MODULE, MODULE.replace("pan: 0", "pan: -0.25")),
    );
    expect(overlaps(mine[0].path, theirs[0].path)).toBe(false);
    const oneWay = applyYaml(applyYaml(MODULE, mine), theirs);
    const otherWay = applyYaml(applyYaml(MODULE, theirs), mine);
    expect(oneWay).toBe(otherWay);
    expect(oneWay).toContain("gain: 0.9");
    expect(oneWay).toContain("pan: -0.25");
  });

  it("see a collision exactly when the paths overlap", () => {
    expect(overlaps(["params"], ["params", "gain"])).toBe(true);
    expect(overlaps(["params", "gain"], ["params", "gain"])).toBe(true);
    expect(overlaps(["params", "gain"], ["params", "pan"])).toBe(false);
  });
});
