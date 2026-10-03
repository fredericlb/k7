// Compacting against real git checkouts: the old history must be GONE from the object store and
// from origin, the working tree untouched, and an unusual git state refused before anything moves.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
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
import { compactWorkspace } from "./compactWorkspace.ts";
import { rootDir } from "./slug.ts";

let home: string;
let USER = "";
let n = 0;

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** A workspace with two commits, a file deleted in the second, and a bare origin it was pushed to. */
function workspace(name: string): { root: string; bare: string } {
  const root = join(rootDir(), name);
  const bare = join(home, `${name}.git`);
  mkdirSync(root, { recursive: true });
  git(home, "init", "-q", "--bare", bare);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  writeFileSync(join(root, ".gitignore"), "_recycle_bin/\n");
  writeFileSync(join(root, "song.yaml"), "name: a\n");
  // Random, so zlib cannot shrink it to nothing and "freed" has something to measure.
  writeFileSync(join(root, "old.wav"), randomBytes(200_000));
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "one");
  rmSync(join(root, "old.wav"));
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "two");
  git(root, "remote", "add", "origin", bare);
  git(root, "push", "-q", "-u", "origin", "main");
  return { root, bare };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fs-compact-"));
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  process.env.STUDIO_HOME = join(home, ".st0");
  USER = `someone-${process.pid}-${n++}@example.com`;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("compactWorkspace", () => {
  it("leaves one commit holding the working tree, here and on origin", async () => {
    const { root, bare } = workspace("songs");
    const oldBlob = git(root, "rev-parse", "HEAD~1:old.wav");
    writeFileSync(join(root, "song.yaml"), "name: edited\n");
    mkdirSync(join(root, "_recycle_bin", "gone.st0"), { recursive: true });
    writeFileSync(join(root, "_recycle_bin", "gone.st0", "a.txt"), "bin");
    git(root, "branch", "side");
    git(root, "tag", "v1");

    const out = await compactWorkspace(USER, "songs");

    expect(out.pushed).toBe(true);
    expect(out.freed).toBeGreaterThan(0);
    expect(git(root, "rev-list", "--count", "HEAD")).toBe("1");
    expect(git(bare, "rev-list", "--count", "main")).toBe("1");
    // The uncommitted edit is IN the new commit, and the working tree still holds it.
    expect(git(root, "show", "HEAD:song.yaml")).toBe("name: edited");
    expect(readFileSync(join(root, "song.yaml"), "utf8")).toBe(
      "name: edited\n",
    );
    expect(existsSync(join(root, "_recycle_bin"))).toBe(false);
    expect(git(root, "for-each-ref", "--format=%(refname)")).toBe(
      "refs/heads/main\nrefs/remotes/origin/main",
    );
    const objects = git(
      root,
      "cat-file",
      "--batch-all-objects",
      "--batch-check",
    );
    expect(objects).not.toContain(oldBlob);
  });

  it("drops a tracked file that .gitignore now excludes, keeping it on disk", async () => {
    const { root } = workspace("songs");
    writeFileSync(join(root, "a.cache"), "c");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "cache");
    writeFileSync(join(root, ".gitignore"), "_recycle_bin/\n*.cache\n");

    await compactWorkspace(USER, "songs");

    expect(git(root, "ls-files")).not.toContain("a.cache");
    expect(existsSync(join(root, "a.cache"))).toBe(true);
  });

  it("refuses on an alternative, touching nothing", async () => {
    const { root } = workspace("songs");
    git(root, "switch", "-q", "-c", "alt");
    git(root, "config", "branch.alt.studioParent", "main");
    mkdirSync(join(root, "_recycle_bin"), { recursive: true });

    await expect(compactWorkspace(USER, "songs")).rejects.toThrow(
      /alternative/,
    );
    expect(git(root, "rev-list", "--count", "HEAD")).toBe("2");
    expect(existsSync(join(root, "_recycle_bin"))).toBe(true);
  });

  it("compacts locally and reports a refused push", async () => {
    const { root, bare } = workspace("songs");
    rmSync(bare, { recursive: true, force: true });

    const out = await compactWorkspace(USER, "songs");

    expect(out.pushed).toBe(false);
    expect(out.pushError).toBeTruthy();
    expect(git(root, "rev-list", "--count", "HEAD")).toBe("1");
  });
});
