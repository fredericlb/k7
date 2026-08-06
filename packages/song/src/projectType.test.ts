import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { declaredType, projectTypeIssues, projectTypeOf } from "./projectType";

// Two signals say what a project is — the folder's suffix and its own `type:` — and the whole
// design is which one wins. The suffix does, because st0 answers "which app opens this" from a
// blobless git mirror with no file bodies in it, so the name is the only signal available
// everywhere. These pin that order, and that a disagreement is REPORTED rather than resolved.

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-ptype-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A project folder named `name`, with `project.yaml` holding `body`. */
function project(name: string, body: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "project.yaml"), body, "utf8");
  return dir;
}

describe("what kind of project a folder is", () => {
  it("takes the suffix, even when the file agrees", () => {
    expect(projectTypeOf(project("live.m9", "type: m9\n"))).toBe("m9");
    expect(projectTypeOf(project("winter.l8", "type: l8\n"))).toBe("l8");
  });

  it("takes the suffix even when the file DISAGREES", () => {
    // The app that opened the folder decided from the name; a loader that decided otherwise
    // would be reading a different project than the one on screen.
    expect(projectTypeOf(project("live.m9", "type: l8\n"))).toBe("m9");
  });

  it("falls back to the file when there is no suffix", () => {
    // The case `type:` exists for: a repository can BE the project, and then there is no
    // suffix to read at all (see project-shell's launch.md).
    expect(projectTypeOf(project("lemo_mante", "type: m9\n"))).toBe("m9");
  });

  it("is l8 when neither says anything", () => {
    // Every song written before m9 existed, and none of them declares a type.
    expect(projectTypeOf(project("old", "project:\n  tempo: 120\n"))).toBe(
      "l8",
    );
  });

  it("reads nothing out of a project.yaml that will not parse", () => {
    expect(declaredType(project("broken.m9", "type: [\n"))).toBe(null);
    expect(projectTypeOf(project("broken2.m9", "type: [\n"))).toBe("m9");
  });

  it("refuses a type the schema does not know", () => {
    // `.strict()` all the way down: an invented dialect is a parse error, not a silent l8.
    expect(declaredType(project("weird.m9", "type: k7\n"))).toBe(null);
  });
});

describe("a folder whose name and file disagree", () => {
  it("is reported, on the line to fix", () => {
    const issues = projectTypeIssues(project("live.m9", "type: l8\n"));
    expect(issues.length).toBe(1);
    expect(issues[0].file).toBe("project.yaml");
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("`.m9`");
    expect(issues[0].message).toContain("type: l8");
  });

  it("says nothing when they agree, or when only one of them speaks", () => {
    expect(projectTypeIssues(project("live.m9", "type: m9\n"))).toEqual([]);
    expect(projectTypeIssues(project("live.m9", "project: {}\n"))).toEqual([]);
    expect(projectTypeIssues(project("plain", "type: m9\n"))).toEqual([]);
  });
});
