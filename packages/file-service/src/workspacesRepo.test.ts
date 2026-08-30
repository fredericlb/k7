// The repo -> workspace lookup, against real git checkouts: it is the thing that decides
// whether st0 clones or opens, and a wrong answer costs either a duplicate clone or a 404.

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// STATIC, not `await import(...)`: paying this module's load in the first test body blew the 5 s timeout.
import { rootDir } from "./slug.ts";
import {
  createWorkspace,
  listMachineWorkspaces,
  setWorkspaceRemote,
  workspaceForRepo,
  workspaceNameFor,
} from "./workspaces.ts";

let home: string;
/** A DIFFERENT user per test, so "nothing on this machine" holds wherever another file's env juggling lands. */
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
  const root = rootDir();
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
    expect(workspaceNameFor("git@github.com:me/my-songs.git")).toBe("my-songs");
  });

  it("steps aside for a folder that is already there", () => {
    mkdirSync(join(myRoot(), "songs"), { recursive: true });
    expect(workspaceNameFor("git@github.com:me/songs.git")).toBe("songs-2");
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
    // The SHORT name, derived from the origin git wrote, so the link costs no round trip to pl8.
    expect(ws.repoName).toBe("my-songs");
    expect(ws.uniqueName).toBe(true);
  });

  it("reports no unique name when two clones answer to the same short one", async () => {
    const root = myRoot();
    checkout(root, "songs", "git@github.com:me/songs.git");
    checkout(root, "songs-2", "git@gitlab.com:someone-else/songs.git");
    const rows = await listMachineWorkspaces(USER);
    // `/songs/…` names two repositories, and pl8 answers 409 for this rather than picking one.
    expect(rows.map((r) => r.uniqueName)).toEqual([false, false]);
    expect(rows.map((r) => r.repoName)).toEqual(["songs", "songs"]);
  });

  it("gives a workspace with no repository a row, and no name to address it by", async () => {
    const root = myRoot();
    mkdirSync(join(root, "Examples", "synth-demo.st0"), { recursive: true });
    const [ws] = await listMachineWorkspaces(USER);
    // The row pl8's mirror could not have: no repository, so nothing to mirror and nothing to list.
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
    // `.` is what every other route calls the workspace root, and what `parseLaunch` answers.
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

describe("a workspace made here, which starts with no repository", () => {
  const gitIn = (dir: string, ...args: string[]): string =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

  it("is a git repository with nothing to push to", async () => {
    myRoot();
    expect(await createWorkspace(USER, "hiver")).toBe(true);
    const dir = join(rootDir(), "hiver");
    expect(gitIn(dir, "rev-parse", "--is-inside-work-tree")).toBe("true");
    // No remote: that is the whole point, and what the row draws as "on this machine only".
    expect(gitIn(dir, "remote")).toBe("");
    expect(await workspaceForRepo(USER, "git@github.com:me/hiver.git")).toBe(
      null,
    );
  });

  it("can commit with no git identity on the machine", async () => {
    // GIT_CONFIG_GLOBAL is pinned to /dev/null, so the repo-local identity is the only one there is.
    myRoot();
    await createWorkspace(USER, "hiver");
    const dir = join(rootDir(), "hiver");
    writeFileSync(join(dir, "a.yaml"), "x: 1\n");
    gitIn(dir, "add", "-A");
    gitIn(dir, "-c", "core.hooksPath=", "commit", "-m", "first");
    expect(gitIn(dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });

  it("ignores what a workspace makes and no repository should carry", async () => {
    myRoot();
    await createWorkspace(USER, "hiver");
    const ignored = readFileSync(
      join(rootDir(), "hiver", ".gitignore"),
      "utf8",
    );
    for (const line of [
      "_recycle_bin/",
      "_history/",
      "*.cache",
      ".studio-active",
    ])
      expect(ignored).toContain(line);
  });

  it("refuses a second repository rather than re-pointing the first", async () => {
    checkout(myRoot(), "songs", "git@github.com:me/songs.git");
    await expect(
      setWorkspaceRemote(USER, "songs", "git@github.com:me/other.git"),
    ).rejects.toThrow(/already has a repository/);
  });

  it("refuses a uri git must never be handed, before touching the workspace", async () => {
    myRoot();
    await createWorkspace(USER, "hiver");
    await expect(
      setWorkspaceRemote(USER, "hiver", "https://github.com/me/hiver"),
    ).rejects.toThrow(/not an SSH git URI/);
    expect(
      execFileSync("git", ["remote"], {
        cwd: join(rootDir(), "hiver"),
        encoding: "utf8",
      }).trim(),
    ).toBe("");
  });

  it("leaves no half-published workspace when the push is refused", async () => {
    myRoot();
    await createWorkspace(USER, "hiver");
    // A host that does not answer: the remote is added, the push fails, and the remote goes back.
    await expect(
      setWorkspaceRemote(USER, "hiver", "git@127.0.0.1:nope/nope.git"),
    ).rejects.toThrow();
    expect(
      execFileSync("git", ["remote"], {
        cwd: join(rootDir(), "hiver"),
        encoding: "utf8",
      }).trim(),
    ).toBe("");
  });
});
