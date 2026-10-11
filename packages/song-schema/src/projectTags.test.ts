import { describe, expect, it } from "vitest";
import {
  normalizeTag,
  projectTagsOf,
  withoutTag,
  withTag,
} from "./projectTags.ts";

describe("project tags", () => {
  it("normalizes what was typed", () => {
    expect(normalizeTag("  to   mix ")).toBe("to mix");
    expect(normalizeTag("   ")).toBeNull();
    expect(normalizeTag("x".repeat(40))).toHaveLength(32);
  });

  it("adds and removes without regard to case", () => {
    expect(withTag(["Live"], "live")).toEqual(["Live"]);
    expect(withTag(["Live"], "demo")).toEqual(["Live", "demo"]);
    expect(withoutTag(["Live", "demo"], "LIVE")).toEqual(["demo"]);
  });

  it("reads project.tags and tolerates a broken file", () => {
    expect(projectTagsOf("project:\n  name: a\n  tags: [live, 3]\n")).toEqual([
      "live",
    ]);
    expect(projectTagsOf("project:\n  name: a\n")).toEqual([]);
    expect(projectTagsOf("project: [\n")).toEqual([]);
  });
});
