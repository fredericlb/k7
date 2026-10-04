// The home page tree's git reads against a real checkout: every kind of uncommitted path, and
// a diff refused for a path that leaves the workspace.

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parsePorcelainZ,
  workspaceChanges,
  workspaceDiff,
} from "./workspaceChanges.ts";

let root: string;
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ws-changes-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(root, "song.yaml"), "tempo: 120\nkey: C\n");
  writeFileSync(join(root, "gone.yaml"), "x: 1\n");
  writeFileSync(join(root, "old.yaml"), "a: 1\nb: 2\nc: 3\nd: 4\n");
  git("add", "-A");
  git("commit", "-q", "-m", "one");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("workspaceChanges", () => {
  it("lists modified, deleted, staged renames and untracked files one by one", async () => {
    writeFileSync(join(root, "song.yaml"), "tempo: 120\nkey: D\n");
    unlinkSync(join(root, "gone.yaml"));
    git("mv", "old.yaml", "new.yaml");
    mkdirSync(join(root, "a.st0", "tracks"), { recursive: true });
    writeFileSync(join(root, "a.st0", "tracks", "x.yaml"), "y: 1\n");
    const byPath = Object.fromEntries(
      (await workspaceChanges(root)).map((c) => [c.path, c]),
    );
    expect(byPath["song.yaml"].code).toBe(" M");
    expect(byPath["gone.yaml"].code).toBe(" D");
    expect(byPath["new.yaml"]).toMatchObject({ code: "R ", from: "old.yaml" });
    expect(byPath["a.st0/tracks/x.yaml"].code).toBe("??");
  });

  it("is empty for a folder that is not a repository", async () => {
    const plain = mkdtempSync(join(tmpdir(), "ws-plain-"));
    expect(await workspaceChanges(plain)).toEqual([]);
    rmSync(plain, { recursive: true, force: true });
  });
});

describe("workspaceDiff", () => {
  it("diffs a modified file against HEAD", async () => {
    writeFileSync(join(root, "song.yaml"), "tempo: 120\nkey: D\n");
    const diff = await workspaceDiff(root, "song.yaml");
    expect(diff).toContain("-key: C");
    expect(diff).toContain("+key: D");
  });

  it("refuses a path out of the workspace", async () => {
    await expect(workspaceDiff(root, "../etc/passwd")).rejects.toThrow(
      /bad path/,
    );
    await expect(workspaceDiff(root, "/etc/passwd")).rejects.toThrow(
      /bad path/,
    );
  });
});

describe("parsePorcelainZ", () => {
  it("takes a rename's second entry as its origin", () => {
    expect(parsePorcelainZ("R  b\0a\0 M c\0")).toEqual([
      { path: "b", code: "R ", from: "a" },
      { path: "c", code: " M" },
    ]);
  });
});
