import type { AccountWorkspace } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { anchorProject } from "./workspaceTasks";

const ws = (paths: string[]): AccountWorkspace => ({
  name: "band",
  isSingleProject: paths.length === 1 && paths[0] === ".",
  projects: paths.map((path) => ({ path, app: "k7" })),
});

describe("anchorProject", () => {
  it("finds the project the anchor names by its workspace path", () => {
    expect(
      anchorProject(ws(["a.k7", "albums/b.k7"]), {
        project: "albums/b.k7",
        timecode: "5:1",
      })?.path,
    ).toBe("albums/b.k7");
  });

  it("reads `.` as the workspace that is one project", () => {
    expect(
      anchorProject(ws(["."]), { project: ".", timecode: "1:1" })?.path,
    ).toBe(".");
  });

  it("answers nothing for a project the workspace no longer holds, or no anchor", () => {
    expect(
      anchorProject(ws(["a.k7"]), { project: "gone.k7", timecode: "1:1" }),
    ).toBeUndefined();
    expect(anchorProject(ws(["a.k7"]), undefined)).toBeUndefined();
  });
});
