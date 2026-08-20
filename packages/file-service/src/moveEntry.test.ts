// The file tree's drag-and-drop move.
//
// The tree already refuses the obviously wrong drops — a folder onto itself, a folder onto its own child — but
// the route is reachable without the tree, and the filesystem's answer to "move a folder inside itself" is either
// an obscure errno or a folder that has swallowed its own subtree. So the refusals live here, and are tested here.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeYaml } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

let root: string;
let ws: Workspace;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-move-"));
  const proj = join(root, "song.st0");
  mkdirSync(join(proj, "clips", "takes"), { recursive: true });
  mkdirSync(join(proj, "sequences"), { recursive: true });
  writeYaml(join(proj, "project.yaml"), { project: { name: "song" } });
  writeFileSync(join(proj, "clips", "riff.yaml"), "source: riff.wav\n", "utf8");
  ws = new Workspace(root);
  ws.setActiveProject("song.st0");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const at = (...p: string[]) => existsSync(join(root, "song.st0", ...p));

describe("Workspace.moveEntry", () => {
  it("moves a file into another folder", async () => {
    const { path } = await ws.moveEntry(
      "song.st0/clips/riff.yaml",
      "song.st0/sequences",
    );
    expect(path).toBe("song.st0/sequences/riff.yaml");
    expect(at("sequences", "riff.yaml")).toBe(true);
    expect(at("clips", "riff.yaml")).toBe(false);
  });

  it("moves a folder, subtree and all", async () => {
    writeFileSync(
      join(root, "song.st0", "clips", "takes", "a.yaml"),
      "",
      "utf8",
    );
    await ws.moveEntry("song.st0/clips/takes", "song.st0/sequences");
    expect(at("sequences", "takes", "a.yaml")).toBe(true);
    expect(at("clips", "takes")).toBe(false);
  });

  it("is a no-op onto the folder it already sits in", async () => {
    const { path } = await ws.moveEntry(
      "song.st0/clips/riff.yaml",
      "song.st0/clips",
    );
    expect(path).toBe("song.st0/clips/riff.yaml");
    expect(at("clips", "riff.yaml")).toBe(true);
  });

  it("refuses to swallow itself", async () => {
    await expect(
      ws.moveEntry("song.st0/clips", "song.st0/clips/takes"),
    ).rejects.toThrow(/into itself/);
    expect(at("clips", "takes")).toBe(true);
  });

  it("refuses to clobber a name already at the destination", async () => {
    writeFileSync(join(root, "song.st0", "sequences", "riff.yaml"), "", "utf8");
    await expect(
      ws.moveEntry("song.st0/clips/riff.yaml", "song.st0/sequences"),
    ).rejects.toThrow(/already exists/);
    // …and the original is still where it was: a refused move must not be a half-move.
    expect(at("clips", "riff.yaml")).toBe(true);
  });

  it("refuses a destination that is a file, not a folder", async () => {
    await expect(
      ws.moveEntry("song.st0/clips/takes", "song.st0/clips/riff.yaml"),
    ).rejects.toThrow(/not a folder/);
  });

  it("refuses to move the active project's own folder", async () => {
    // Its engine is running out of that path. guardMutable says so for rename and delete; a move is the same act.
    mkdirSync(join(root, "elsewhere"), { recursive: true });
    await expect(ws.moveEntry("song.st0", "elsewhere")).rejects.toThrow(
      /active project/,
    );
  });

  it("refuses the recycle bin as a destination — deleting is the way to do that", async () => {
    await ws.deleteEntry("song.st0/sequences");
    await expect(
      ws.moveEntry("song.st0/clips/riff.yaml", "_recycle_bin"),
    ).rejects.toThrow(/recycle bin/);
  });
});
