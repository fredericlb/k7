import type { AccountWorkspace } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { anchorProject } from "./workspaceTasks";

const ws = (paths: string[]): AccountWorkspace => ({
  name: "band",
  isSingleProject: paths.length === 1 && paths[0] === ".",
  projects: paths.map((path) => ({ path, app: "st0" })),
});

describe("anchorProject", () => {
  it("finds the project the anchor names by its workspace path", () => {
    expect(
      anchorProject(ws(["a.st0", "albums/b.st0"]), {
        project: "albums/b.st0",
        timecode: "5:1",
      })?.path,
    ).toBe("albums/b.st0");
  });

  it("reads `.` as the workspace that is one project", () => {
    expect(
      anchorProject(ws(["."]), { project: ".", timecode: "1:1" })?.path,
    ).toBe(".");
  });

  it("answers nothing for a project the workspace no longer holds, or no anchor", () => {
    expect(
      anchorProject(ws(["a.st0"]), { project: "gone.st0", timecode: "1:1" }),
    ).toBeUndefined();
    expect(anchorProject(ws(["a.st0"]), undefined)).toBeUndefined();
  });
});
