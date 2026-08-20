// The repo -> workspace lookup, against real git checkouts: it is the thing that decides
// whether st0 clones or opens, and a wrong answer costs either a duplicate clone or a 404.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// STATIC, not `await import(...)` inside a test: this module pulls in most of the file
// service, and paying that in the first test body put it over the 5 s default timeout under a
// parallel run. Safe to hoist because nothing here reads the environment at import — every
// path goes through `homedir()` at call time, which is what the override below steers.
import { slugify, userRoot } from "./slug.ts";
import {
  listMachineWorkspaces,
  workspaceForRepo,
  workspaceNameFor,
} from "./workspaces.ts";

let home: string;
/**
 * A DIFFERENT user per test, on purpose. `homedir()` is read per call and this file steers it
 * with `$USERPROFILE`/`$HOME`, but vitest may run several files in one process — so another
 * file's own env juggling can put `homedir()` back for a moment. A unique slug per test keeps
 * "this user has nothing on this machine" true wherever the root lands.
 */
let USER = "";
let n = 0;

/** A checkout with an origin, which is all `workspaceForRepo` reads. */
function checkout(root: string, name: string, origin: string): void {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "project.yaml"), "name: x\n");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  git("remote", "add", "origin", origin);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fs-repo-"));
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  USER = `someone-${process.pid}-${n++}@example.com`;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const myRoot = (): string => {
  const root = userRoot(slugify(USER));
  mkdirSync(root, { recursive: true });
  return root;
};

describe("workspaceForRepo", () => {
  it("is null when the user has nothing on this machine", async () => {
    expect(await workspaceForRepo(USER, "git@github.com:me/songs.git")).toBe(
      null,
    );
  });

  it("finds a checkout whose origin is spelled differently", async () => {
    // Cloned with the scp spelling; asked for with the ssh:// one.
    checkout(myRoot(), "songs", "git@github.com:me/songs.git");
    expect(await workspaceForRepo(USER, "ssh://git@github.com/me/songs")).toBe(
      "songs",
    );
  });

  it("does not match a different repository on the same host", async () => {
    checkout(myRoot(), "songs", "git@github.com:me/songs.git");
    expect(await workspaceForRepo(USER, "git@github.com:me/other.git")).toBe(
      null,
    );
  });

  it("ignores a folder that is not a repository at all", async () => {
    mkdirSync(join(myRoot(), "plain"), { recursive: true });
    expect(await workspaceForRepo(USER, "git@github.com:me/songs.git")).toBe(
      null,
    );
  });

  it("refuses a uri git must never be handed, rather than answering null", async () => {
    await expect(
      workspaceForRepo(USER, "https://github.com/me/songs"),
    ).rejects.toThrow();
  });
});

describe("workspaceNameFor", () => {
  it("is the repository's own name", () => {
    expect(workspaceNameFor(USER, "git@github.com:me/my-songs.git")).toBe(
      "my-songs",
    );
  });

  it("steps aside for a folder that is already there", () => {
    mkdirSync(join(myRoot(), "songs"), { recursive: true });
    expect(workspaceNameFor(USER, "git@github.com:me/songs.git")).toBe(
      "songs-2",
    );
  });
});

describe("listMachineWorkspaces", () => {
  it("reports a project sitting at a depth, which the flat count missed", async () => {
    const root = myRoot();
    checkout(root, "songs", "git@github.com:me/songs.git");
    mkdirSync(join(root, "songs", "albums", "hiver.st0"), { recursive: true });

    const [ws] = await listMachineWorkspaces(USER);
    expect(ws.name).toBe("songs");
    expect(ws.projects).toEqual([{ path: "albums/hiver.st0", app: "st0" }]);
  });

  it("names the repository itself, without asking pl8", async () => {
    checkout(myRoot(), "songs", "git@github.com:me/my-songs.git");
    const [ws] = await listMachineWorkspaces(USER);
    // The SHORT name — the half of an address a person reads. Derived from the origin git
    // wrote, so the link this page draws costs no round trip to the service that holds the URI.
    expect(ws.repoName).toBe("my-songs");
    expect(ws.uniqueName).toBe(true);
  });

  it("reports no unique name when two clones answer to the same short one", async () => {
    const root = myRoot();
    checkout(root, "songs", "git@github.com:me/songs.git");
    checkout(root, "songs-2", "git@gitlab.com:someone-else/songs.git");
    const rows = await listMachineWorkspaces(USER);
    // `/songs/…` names two repositories, and pl8 answers 409 for exactly this rather than
    // picking one. Both rows go through @local, which names the workspace and cannot collide.
    expect(rows.map((r) => r.uniqueName)).toEqual([false, false]);
    expect(rows.map((r) => r.repoName)).toEqual(["songs", "songs"]);
  });

  it("gives a workspace with no repository a row, and no name to address it by", async () => {
    const root = myRoot();
    mkdirSync(join(root, "Examples", "synth-demo.st0"), { recursive: true });
    const [ws] = await listMachineWorkspaces(USER);
    // This is the row that did not exist at all while pl8's mirror was the source: no
    // repository, so nothing to mirror, so nothing to list. Its demos are what a new account
    // has on the day it has nothing else.
    expect(ws.name).toBe("Examples");
    expect(ws.origin).toBe(null);
    expect(ws.repoName).toBe(null);
    expect(ws.uniqueName).toBe(false);
    expect(ws.projects).toEqual([{ path: "synth-demo.st0", app: "st0" }]);
  });

  it("reports a workspace that IS a project as one project, named `.`", async () => {
    mkdirSync(join(myRoot(), "hiver.st0"), { recursive: true });
    const [ws] = await listMachineWorkspaces(USER);
    expect(ws.isSingleProject).toBe(true);
    // `.` is what every other route already calls the workspace root, and what `parseLaunch`
    // answers for an address whose repository IS the project.
    expect(ws.projects).toEqual([{ path: ".", app: "st0" }]);
  });

  it("sees a .z0 beside a .st0, each named by the app its folder claims", async () => {
    const root = myRoot();
    mkdirSync(join(root, "ws", "hiver.st0"), { recursive: true });
    mkdirSync(join(root, "ws", "quiz.z0"), { recursive: true });
    const [ws] = await listMachineWorkspaces(USER);
    expect(ws.projects).toEqual([
      { path: "hiver.st0", app: "st0" },
      { path: "quiz.z0", app: "z0" },
    ]);
  });
});
