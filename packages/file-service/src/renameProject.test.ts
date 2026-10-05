import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activeMarkerOf, Workspace } from "./workspace.ts";

// Renaming a project is `renameEntry` plus the one thing a PROJECT has: a suffix that says which
// app opens the folder. See docs/workspaces.md.

let root: string;
let ws: Workspace;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-ren-"));
  const proj = join(root, "winter.st0");
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, "project.yaml"), "package st0\n");
  ws = new Workspace(root);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(activeMarkerOf(root), { force: true });
});

describe("Workspace.renameProject", () => {
  it("moves the folder and answers where it landed", async () => {
    const { path } = await ws.renameProject("winter.st0", "spring.st0");
    expect(path).toBe("spring.st0");
    expect(existsSync(join(root, "winter.st0"))).toBe(false);
    expect(existsSync(join(root, "spring.st0", "project.yaml"))).toBe(true);
  });

  it("refuses to change the SUFFIX, which is which app opens it", async () => {
    await expect(ws.renameProject("winter.st0", "spring.z0")).rejects.toThrow(
      /suffix/,
    );
    await expect(ws.renameProject("winter.st0", "spring")).rejects.toThrow(
      /suffix/,
    );
    expect(existsSync(join(root, "winter.st0"))).toBe(true);
  });

  it("refuses a folder that is not a project", async () => {
    mkdirSync(join(root, "notes"));
    await expect(ws.renameProject("notes", "other")).rejects.toThrow(
      /not a project/,
    );
  });

  it("refuses to clobber a project that is already there", async () => {
    mkdirSync(join(root, "spring.st0"));
    await expect(ws.renameProject("winter.st0", "spring.st0")).rejects.toThrow(
      /already exists/,
    );
    expect(existsSync(join(root, "winter.st0"))).toBe(true);
  });

  it("STOPS the engine when it is serving the folder, and moves it anyway", async () => {
    ws.setActiveProject("winter.st0");
    const stopped: string[] = [];
    const { path } = await ws.renameProject(
      "winter.st0",
      "spring.st0",
      (abs) => {
        stopped.push(abs);
      },
    );
    // Asked to stop BEFORE the move, with the folder it is holding — the rename is what needs the handles.
    expect(stopped).toEqual([join(root, "winter.st0")]);
    expect(path).toBe("spring.st0");
    expect(existsSync(join(root, "spring.st0", "project.yaml"))).toBe(true);
  });

  it("takes the active project WITH it rather than clearing it", async () => {
    // A rename does not end the project: the marker names the same one, under its new folder.
    ws.setActiveProject("winter.st0");
    await ws.renameProject("winter.st0", "spring.st0", () => {});
    expect(readFileSync(activeMarkerOf(root), "utf8").trim()).toBe(
      "spring.st0",
    );
    expect(ws.workspaceInfo().activeProject).toBe("spring.st0");
  });

  it("does not ask the engine to stop for a project it is NOT serving", async () => {
    mkdirSync(join(root, "other.st0"));
    writeFileSync(join(root, "other.st0", "project.yaml"), "package st0\n");
    ws.setActiveProject("other.st0");
    const stopped: string[] = [];
    await ws.renameProject("winter.st0", "spring.st0", (abs) => {
      stopped.push(abs);
    });
    // The callback is handed the folder either way; what it does about it is the host's business.
    expect(stopped).toEqual([join(root, "winter.st0")]);
    expect(ws.workspaceInfo().activeProject).toBe("other.st0");
  });

  it("keeps the name it has as a no-op rather than an error", async () => {
    const { path } = await ws.renameProject("winter.st0", "winter.st0");
    expect(path).toBe("winter.st0");
    expect(existsSync(join(root, "winter.st0", "project.yaml"))).toBe(true);
  });
});
