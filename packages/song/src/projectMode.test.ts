// What `project_type` means, and what it must never be confused with: the DIALECT (projectType.ts)
// answers which app opens a folder, this answers which of l8's two shapes it has. See
// docs/projectMode.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";
import { DEFAULT_PROJECT_MODE, projectModeOf } from "./projectMode";
import { projectTypeOf } from "./projectType";
import { scaffold } from "./scaffold";
import { ProjectFileSchema } from "./yaml/projectSchema";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-pmode-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A project folder with `body` as its project.yaml. The NAME matters: it is what carries the dialect. */
function project(name: string, body: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "project.yaml"), body);
  return dir;
}

describe("projectModeOf", () => {
  it("reads the declaration", () => {
    expect(projectModeOf(project("rig.l8", "project_type: live\n"))).toBe(
      "live",
    );
    expect(
      projectModeOf(project("song.l8", "project_type: arrangement\n")),
    ).toBe("arrangement");
  });

  it("answers `arrangement` when the file says nothing", () => {
    // Absence is the ANSWER, not a missing value: every song written before `live` existed is an
    // arrangement and none of them says so. A default of anything else would rewrite them all.
    expect(projectModeOf(project("old.l8", "project:\n  tempo: 120\n"))).toBe(
      "arrangement",
    );
    expect(DEFAULT_PROJECT_MODE).toBe("arrangement");
  });

  it("answers the default rather than throwing on a header that will not parse", () => {
    // A broken project.yaml is the COMPILE's error to report, with a line number. A view asking
    // "which shape is this" must not be the surface that raises it.
    expect(projectModeOf(project("broken.l8", "project_type: [\n"))).toBe(
      "arrangement",
    );
  });

  it("answers the default for a value the schema does not know", () => {
    // `.strict()` + the enum refuse it, so loadProjectRoot returns {} and the folder reads as
    // what it was before the typo. What must NOT happen is "live-ish" leaking through as truth.
    expect(projectModeOf(project("typo.l8", "project_type: liveish\n"))).toBe(
      "arrangement",
    );
  });

  it("is INDEPENDENT of the dialect — the two are different questions", () => {
    // The bug this pins: reading one for the other. A `.l8` folder declaring `live` is still l8's
    // to open, and the shape says nothing about which app that is.
    const dir = project("rig.l8", "type: l8\nproject_type: live\n");
    expect(projectTypeOf(dir)).toBe("l8");
    expect(projectModeOf(dir)).toBe("live");
  });
});

describe("the schema", () => {
  it("accepts both shapes at the ROOT, beside `type`", () => {
    for (const mode of ["arrangement", "live"])
      expect(ProjectFileSchema.safeParse({ project_type: mode }).success).toBe(
        true,
      );
  });

  it("refuses a shape it does not know", () => {
    expect(ProjectFileSchema.safeParse({ project_type: "rig" }).success).toBe(
      false,
    );
  });

  it("refuses it inside `project:` — the tier is the point", () => {
    // ProjectSettingsSchema is `.strict()`, so this is what stops the field being written one tier
    // down and silently ignored. See projectSchema.ts on why it is a root sibling.
    expect(
      ProjectFileSchema.safeParse({ project: { project_type: "live" } })
        .success,
    ).toBe(false);
  });
});

// `hasTimeline` was tested here. It is gone: whether a project draws an arrangement is what its
// `surfaces/` folder says now — see surfaces.test.ts and docs/surfaces.md.

describe("the live scaffold", () => {
  it("writes a project that declares itself live, and compiles", () => {
    const dir = join(root, "rig.l8");
    scaffold(dir, "rig", "live");
    expect(projectModeOf(dir)).toBe("live");
    expect(compileNodeProject(dir).mode).toBe("live");
  });

  it("arranges NOTHING — no clip, no sequence, no pattern", () => {
    // The whole point of the shape: those are the things that only mean something on a timeline,
    // and this project has none. Scaffolding them would write material the shell cannot show.
    const dir = join(root, "rig.l8");
    scaffold(dir, "rig", "live");
    const doc = compileNodeProject(dir);
    expect(doc.tracks.flatMap((t) => t.clips)).toEqual([]);
    expect(doc.strudel).toBe(false);
  });

  it("still has a signal path to play THROUGH", () => {
    // A rig with no chain would just be an empty folder. One track, one instrument, the output.
    const dir = join(root, "rig.l8");
    scaffold(dir, "rig", "live");
    expect(compileNodeProject(dir).tracks.length).toBeGreaterThan(0);
  });

  it("leaves the ordinary scaffold an arrangement", () => {
    // The default has to hold without being passed: `scaffold(dir, name)` is what every caller
    // written before this feature calls, l8's own command bar included.
    const dir = join(root, "song.l8");
    scaffold(dir, "song");
    expect(projectModeOf(dir)).toBe("arrangement");
    expect(compileNodeProject(dir).mode).toBe("arrangement");
  });
});
