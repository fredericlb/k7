// k7xPosition.test.ts — a schema finding's path lands on the k7x line of its key, in an object and in a chain alike.

import { describe, expect, it } from "vitest";
import { k7xPosition, k7xSchemaIssues } from "./k7xPosition";
import { ModuleSchema } from "./moduleSchema";

const OBJECT = 'project({\n  name: "demo",\n  tempo: "fast",\n})\n';
const CHAIN = 'steps([\n  id(1),\n  id(2).to(["x"]),\n])\n';

describe("a finding's position in k7x text", () => {
  it("is the key's own line and column in an object", () => {
    expect(k7xPosition(OBJECT, ["project", "tempo"])).toEqual({
      line: 3,
      col: 3,
    });
    expect(k7xPosition(OBJECT, "project.name")).toEqual({ line: 2, col: 3 });
  });

  it("is the call's key in a chain, and the item's start for an index", () => {
    expect(k7xPosition(CHAIN, ["steps", 1, "to"])).toEqual({
      line: 3,
      col: 9,
    });
    expect(k7xPosition(CHAIN, "steps.1")).toEqual({ line: 3, col: 3 });
  });

  it("falls back to the deepest part of the path that exists", () => {
    expect(k7xPosition(CHAIN, ["steps", 1, "nope", 4])).toEqual({
      line: 3,
      col: 3,
    });
    expect(k7xPosition(OBJECT, ["nothing"])).toBeUndefined();
    expect(k7xPosition(OBJECT, [])).toBeUndefined();
    expect(k7xPosition("project({", ["project"])).toBeUndefined();
  });

  it("places zod's own findings, an unknown key on its own line", () => {
    const text = 'params({ Level: "loud" })\nnonsense(1)\n';
    const r = ModuleSchema.safeParse({
      params: { Level: "loud" },
      nonsense: 1,
    });
    expect(r.success).toBe(false);
    const issues = r.success ? [] : k7xSchemaIssues(text, r.error.issues);
    const unknown = issues.find((i) => i.path === "nonsense");
    expect(unknown).toMatchObject({ line: 2, col: 1 });
  });
});
