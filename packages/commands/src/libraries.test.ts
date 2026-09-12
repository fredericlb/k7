// `project libraries update` over REAL repositories: the account's libraries are their own
// clone, mounted at `_libraries`, and this verb moves a workspace onto their latest version.
// Two mounts exist and both are pinned here — the submodule, and the plain clone a workspace
// that is no repository gets. See packages/file-service/docs/libraries.md.

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
import { updateLibraries } from "./git";

let base = "";
let origin = ""; // the libraries repository everyone clones
let ws = ""; // …and a workspace that mounts it

// A submodule over a FILE path is refused by default since git 2.38, and the ban is re-read by
// every child process — so it is lifted through the env, which they inherit. This is a test, not
// a clone from a stranger.
const FILE_OK = {
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "protocol.file.allow",
  GIT_CONFIG_VALUE_0: "always",
};

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...FILE_OK },
  }).trim();

/** A repository with one commit, configured so a commit needs nothing of the machine's. */
function repo(at: string, branch = "main"): string {
  mkdirSync(at, { recursive: true });
  git(at, "init", "-b", branch);
  git(at, "config", "user.email", "t@t.test");
  git(at, "config", "user.name", "t");
  git(at, "config", "commit.gpgsign", "false");
  return at;
}

const libFile = (dir: string) => join(dir, "modules", "audio", "amp.yaml");

/** Write a module into the libraries and commit it — what somebody else's publish looks like from here. */
function publish(at: string, body: string, message: string) {
  mkdirSync(join(at, "modules", "audio"), { recursive: true });
  writeFileSync(libFile(at), body);
  git(at, "add", "-A");
  git(at, "commit", "-m", message);
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "libs-"));
  origin = repo(join(base, "libraries"));
  publish(origin, "gain: 1\n", "the amp");
  ws = repo(join(base, "workspace"));
  writeFileSync(join(ws, "readme.md"), "a workspace\n");
  git(ws, "add", "-A");
  git(ws, "commit", "-m", "first");
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

/** Mount the libraries as a submodule, the way `ensureLibraries` does on a workspace that IS a repo. */
function mountSubmodule() {
  git(ws, "submodule", "add", "--force", "--", origin, "_libraries");
  git(ws, "commit", "-m", "les bibliotheques");
}

describe("a submodule mount", () => {
  it("moves onto the library's latest commit and records it in the workspace", () => {
    mountSubmodule();
    publish(origin, "gain: 2\n", "louder");

    const r = updateLibraries(ws, FILE_OK);

    expect(r.upToDate).toBe(false);
    expect(r.from).not.toBe(r.to);
    // The file the account published is HERE now, which is the whole point of the verb.
    expect(
      readFileSync(
        join(ws, "_libraries", "modules", "audio", "amp.yaml"),
        "utf8",
      ),
    ).toBe("gain: 2\n");
    // …and the workspace says which version it uses, in a commit of its own.
    expect(r.recorded).toBeTruthy();
    expect(git(ws, "log", "-1", "--pretty=%s")).toBe(`libraries: ${r.to}`);
    expect(git(ws, "status", "--porcelain")).toBe("");
  });

  it("says so and commits nothing when the library has not moved", () => {
    mountSubmodule();
    const before = git(ws, "rev-parse", "HEAD");

    const r = updateLibraries(ws, FILE_OK);

    expect(r).toMatchObject({ upToDate: true });
    expect(r.recorded).toBeUndefined();
    expect(git(ws, "rev-parse", "HEAD")).toBe(before);
  });

  it("works from a PROJECT inside the workspace, which is where the CLI runs", () => {
    mountSubmodule();
    publish(origin, "gain: 3\n", "louder still");
    mkdirSync(join(ws, "song.st0"), { recursive: true });

    expect(updateLibraries(join(ws, "song.st0"), FILE_OK).upToDate).toBe(false);
  });
});

describe("a plain clone", () => {
  it("fast-forwards it, there being no superproject to record anything in", () => {
    // A workspace that is not a repository: `ensureLibraries` clones into the same folder instead.
    const loose = mkdtempSync(join(tmpdir(), "loose-"));
    execFileSync("git", ["clone", "--", origin, join(loose, "_libraries")], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...FILE_OK },
    });
    publish(origin, "gain: 4\n", "louder again");

    const r = updateLibraries(loose, FILE_OK);

    expect(r.upToDate).toBe(false);
    expect(r.recorded).toBeUndefined();
    expect(
      readFileSync(
        join(loose, "_libraries", "modules", "audio", "amp.yaml"),
        "utf8",
      ),
    ).toBe("gain: 4\n");
    rmSync(loose, { recursive: true, force: true });
  });
});

describe("a workspace with no libraries at all", () => {
  it("refuses by name rather than running git on a folder that is not there", () => {
    expect(() => updateLibraries(ws, FILE_OK)).toThrow(
      /no libraries are mounted/,
    );
  });
});
