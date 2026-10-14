// k7xIssues.test.ts — a .k7x buffer is checked like its YAML spelling, and every finding lands on the k7x text's own line.

import { describe, expect, it } from "vitest";
import { fileKindFor } from "./fields";
import { locateK7x } from "./k7xIssues";
import { validateFile } from "./validate";

const MODULE = `// a node
extends("@workspace/instruments/synth")
params({
  "Filter Freq": 40,
  Level: -12,
})
`;

describe("a .k7x buffer", () => {
  it("is the same kind of file as its YAML spelling", () => {
    expect(fileKindFor("song/nodes/pad.k7x")).toBe("module");
    expect(fileKindFor("song/project.k7x")).toBe("project");
    expect(fileKindFor("song/chains/main.k7x")).toBe("chain");
  });

  it("passes when the compiler could read it", () => {
    expect(validateFile("song/nodes/pad.k7x", MODULE)).toMatchObject({
      ok: true,
      depth: "schema",
    });
  });

  it("reports a syntax error at its own line and column", () => {
    const v = validateFile("song/nodes/pad.k7x", `${MODULE}bogus(1)\noops`);
    expect(v).toMatchObject({ ok: false, malformed: true });
    expect(v.issues[0]).toMatchObject({ line: 8, col: 5 });
    expect(v.issues[0].message).toBe('expected "(" after oops');
  });

  it("reports a schema finding on the k7x line of the key it is about", () => {
    const v = validateFile("song/nodes/pad.k7x", `${MODULE}nonsense(1)\n`);
    expect(v.ok).toBe(false);
    expect(v.issues).toHaveLength(1);
    expect(v.issues[0]).toMatchObject({ line: 7, col: 1 });
  });

  it("places a nested finding inside its object", () => {
    const text = 'project({\n  name: "demo",\n  tempo: "fast",\n})\n';
    const v = validateFile("song/project.k7x", text);
    expect(v.ok).toBe(false);
    expect(v.issues[0]).toMatchObject({
      path: "project.tempo",
      line: 3,
      col: 3,
    });
  });

  it("locates a path to the deepest entry or item that exists", () => {
    const text = 'steps([\n  id(1),\n  id(2).to(["x"]),\n])\n';
    expect(locateK7x(text, ["steps", 1, "to"])).toEqual({ line: 3, col: 9 });
    expect(locateK7x(text, ["steps", 1, "nope"])).toEqual({ line: 3, col: 3 });
    expect(locateK7x(text, [])).toEqual({});
  });
});
