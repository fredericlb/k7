// Sync state against real checkouts and a bare origin: dirty paths, commits not pushed, and
// commits another clone pushed — the three things a home-page row says about its workspace.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rootDir } from "./slug.ts";
import { workspaceSync } from "./workspaceSync.ts";

let home: string;
let USER = "";
let n = 0;

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function identity(dir: string): void {
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
}

/** A workspace with one commit; with `bare`, pushed to that origin and tracking it. */
function workspace(name: string, bare?: string): string {
  const root = join(rootDir(), name);
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  identity(root);
  writeFileSync(join(root, "song.yaml"), "name: a\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "one");
  if (bare) {
    // `-b main`: a clone of it must check out the branch the workspace pushed, not an unborn `master`.
    git(home, "init", "-q", "--bare", "-b", "main", bare);
    git(root, "remote", "add", "origin", bare);
    git(root, "push", "-q", "-u", "origin", "main");
  }
  return root;
}

const of = async (name: string) =>
  (await workspaceSync(USER)).find((w) => w.name === name);

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fs-sync-"));
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  process.env.STUDIO_HOME = join(home, ".st0");
  USER = `someone-${process.pid}-${n++}@example.com`;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("workspaceSync", () => {
  it("is clean and level right after a push", async () => {
    workspace("songs", join(home, "songs.git"));
    expect(await of("songs")).toEqual({
      name: "songs",
      dirty: 0,
      ahead: 0,
      behind: 0,
    });
  });

  it("counts uncommitted paths and commits not pushed", async () => {
    const root = workspace("songs", join(home, "songs.git"));
    writeFileSync(join(root, "song.yaml"), "name: b\n");
    writeFileSync(join(root, "new.yaml"), "x: 1\n");
    writeFileSync(join(root, "kept.yaml"), "k: 1\n");
    git(root, "add", "kept.yaml");
    git(root, "commit", "-q", "-m", "kept");
    const s = await of("songs");
    expect(s?.dirty).toBe(2);
    expect(s?.ahead).toBe(1);
    expect(s?.behind).toBe(0);
  });

  it("sees what another clone pushed, through the fetch", async () => {
    const bare = join(home, "songs.git");
    workspace("songs", bare);
    const other = join(home, "other");
    git(home, "clone", "-q", bare, other);
    identity(other);
    writeFileSync(join(other, "theirs.yaml"), "t: 1\n");
    git(other, "add", "-A");
    git(other, "commit", "-q", "-m", "theirs");
    git(other, "push", "-q");
    const s = await of("songs");
    expect(s?.fetchError).toBeUndefined();
    expect(s?.behind).toBe(1);
    expect(s?.ahead).toBe(0);
  });

  it("has no upstream counts for a workspace with no repository", async () => {
    const root = workspace("local");
    writeFileSync(join(root, "draft.yaml"), "d: 1\n");
    expect(await of("local")).toEqual({
      name: "local",
      dirty: 1,
      ahead: null,
      behind: null,
    });
  });
});
