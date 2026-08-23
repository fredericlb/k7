// The file tree's right-click "New folder…". A short operation, but one that takes a name a person typed and
// turns it into a path on disk — so what it must refuse matters more than what it creates.

import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeYaml } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

let root: string;
let ws: Workspace;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-mkdir-"));
  // `.st0` is what makes a folder a project; the project's own `name` stays unsuffixed.
  const proj = join(root, "song.st0");
  mkdirSync(join(proj, "clips"), { recursive: true });
  writeYaml(join(proj, "project.yaml"), { project: { name: "song" } });
  ws = new Workspace(root);
  ws.setActiveProject("song.st0");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("Workspace.createFolder", () => {
  it("creates it inside the target and reports the path", () => {
    // Workspace-relative, like uploadFile's, because that is what the tree addresses entries by.
    const { path } = ws.createFolder("song.st0/clips", "takes");
    expect(path).toBe("song.st0/clips/takes");
    expect(existsSync(join(root, "song.st0", "clips", "takes"))).toBe(true);
  });

  it("refuses to clobber an existing entry", () => {
    ws.createFolder("song.st0/clips", "takes");
    expect(() => ws.createFolder("song.st0/clips", "takes")).toThrow(
      /already exists/,
    );
  });

  it("takes ONE segment — a name with separators can't escape the folder", () => {
    // `basename()` reduces rather than rejects, as uploadFile does: nothing lands outside the clicked folder.
    const { path } = ws.createFolder("song.st0/clips", "../../evil");
    expect(path).toBe("song.st0/clips/evil");
    expect(existsSync(join(root, "evil"))).toBe(false);
  });

  it("rejects a name that is only dots or blank", () => {
    for (const bad of ["..", ".", "   "])
      expect(() => ws.createFolder("song.st0/clips", bad)).toThrow(
        /invalid folder name/,
      );
  });

  it("stays out of the recycle bin, where a new folder would be invisible", async () => {
    // deleteEntry creates the bin; the tree hides it, so a folder made in there would look like a silent failure.
    await ws.deleteEntry("song.st0/clips");
    expect(() => ws.createFolder("_recycle_bin", "nope")).toThrow(
      /recycle bin/,
    );
  });
});
