// The account's libraries over REAL git: the list and its legacy form, cloning one to
// `<studioHome>/libraries/<name>`, keeping it at its latest without ever losing work, publishing
// an edit back, and taking a workspace's OLD `_libraries` (submodule or clone) out of it. A mocked
// git would prove the opposite of what is claimed. See docs/libraries.md.

import { execFileSync } from "node:child_process";
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
import { sshDir } from "@studio/engine-client/paths";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  commitLibrary,
  defaultLibraryName,
  libraryDir,
  libraryFailure,
  librarySettings,
  pruneLibraries,
  retireWorkspaceLibraries,
  setLibrarySettings,
  settingsProblem,
  syncLibrary,
} from "./libraries.ts";
import { slugify } from "./slug.ts";

// Every fixture drives REAL git — a dozen subprocesses per test, well past vitest's 5 s default.
vi.setConfig({ testTimeout: 30_000 });

const EMAIL = "someone@example.test";
/** What the setting says: an SSH URI, which is all the service accepts… */
const URI = "git@example.test:studio/st0.git";
/** …rewritten by git, through the environment, to a bare repository on disk. */
let origin: string;

let tmp: string;
const saved: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "STUDIO_HOME",
  "STUDIO_LIBRARIES_FILE",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_KEY_0",
  "GIT_CONFIG_VALUE_0",
  "GIT_CONFIG_KEY_1",
  "GIT_CONFIG_VALUE_1",
];

/** git for the FIXTURES, blind to the developer's own config (a `commit.gpgsign` would stop every commit). */
const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t.test",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t.test",
    },
  }).trim();

/** Somebody else's publish, as seen from here: a commit pushed to the origin from another clone. */
function publishElsewhere(file: string, body: string): void {
  const other = mkdtempSync(join(tmp, "other-"));
  git(other, "clone", "-q", origin, ".");
  mkdirSync(join(other, "modules"), { recursive: true });
  writeFileSync(join(other, file), body);
  git(other, "add", "-A");
  git(other, "commit", "-q", "-m", `publish ${file}`);
  git(other, "push", "-q", "origin", "HEAD");
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "fs-libs-"));
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.STUDIO_HOME = join(tmp, "home");
  delete process.env.STUDIO_LIBRARIES_FILE;
  // A key already "there", so `ensureKey` makes none: CI's image has git and no ssh-keygen, and
  // the SSH URI below is rewritten to a path on disk, so no key is ever used.
  const keyDir = sshDir(slugify(EMAIL));
  mkdirSync(keyDir, { recursive: true });
  writeFileSync(join(keyDir, "id_ed25519"), "placeholder\n");
  origin = join(tmp, "origin.git");
  git(tmp, "init", "-q", "--bare", "--initial-branch=main", origin);
  publishElsewhere("modules/amp.yaml", "gain: 1\n");
  // `insteadOf` as COMMAND-LEVEL config: it survives the GIT_CONFIG_GLOBAL=/dev/null the service sets.
  process.env.GIT_CONFIG_COUNT = "2";
  process.env.GIT_CONFIG_KEY_0 = `url.${origin}.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = URI;
  process.env.GIT_CONFIG_KEY_1 = "protocol.file.allow";
  process.env.GIT_CONFIG_VALUE_1 = "always";
});

afterEach(() => {
  for (const k of ENV_KEYS)
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  rmSync(tmp, { recursive: true, force: true });
});

describe("the origin's list", () => {
  const ownFile = () =>
    join(process.env.STUDIO_HOME as string, "libraries.json");
  beforeEach(() => {
    process.env.STUDIO_LIBRARIES_FILE = join(tmp, "data", "libraries.json");
  });

  it("reads the account's own file until an admin first saves the origin's", () => {
    mkdirSync(process.env.STUDIO_HOME as string, { recursive: true });
    writeFileSync(ownFile(), JSON.stringify({ uri: URI }));
    expect(librarySettings()).toEqual([{ name: "st0", uri: URI }]);
    const list = [{ name: "drums", uri: "git@example.test:studio/drums.git" }];
    setLibrarySettings(list);
    expect(librarySettings()).toEqual(list);
    expect(
      JSON.parse(
        readFileSync(process.env.STUDIO_LIBRARIES_FILE as string, "utf8"),
      ),
    ).toEqual({ libraries: list });
    // The account's file is left as it was: nothing reads it once the origin's exists.
    expect(JSON.parse(readFileSync(ownFile(), "utf8"))).toEqual({ uri: URI });
  });

  it("remembers why a clone failed, until one succeeds", async () => {
    const bad = { name: "gone", uri: "git@example.test:studio/gone.git" };
    const r = await syncLibrary(EMAIL, bad);
    expect(r.state).toBe("failed");
    expect(libraryFailure("gone")).toBe(r.note);
    expect((await syncLibrary(EMAIL, { name: "gone", uri: URI })).state).toBe(
      "cloned",
    );
    expect(libraryFailure("gone")).toBeUndefined();
  });
});

describe("the setting", () => {
  it("reads the old single `{ uri }` as a library called st0", () => {
    mkdirSync(process.env.STUDIO_HOME as string, { recursive: true });
    writeFileSync(
      join(process.env.STUDIO_HOME as string, "libraries.json"),
      JSON.stringify({ uri: URI }),
    );
    expect(librarySettings()).toEqual([{ name: "st0", uri: URI }]);
  });

  it("writes and reads back a list, in order", () => {
    const list = [
      { name: "st0", uri: URI },
      { name: "drums", uri: "git@example.test:studio/drums.git" },
    ];
    setLibrarySettings(list);
    expect(librarySettings()).toEqual(list);
  });

  it("refuses a list it could not honour, saying which line", () => {
    const other = "git@example.test:studio/other.git";
    expect(settingsProblem([{ name: "engine", uri: URI }])).toMatch(/engine/);
    expect(settingsProblem([{ name: "Big Drums", uri: URI }])).toMatch(
      /cannot name/,
    );
    expect(
      settingsProblem([
        { name: "a", uri: URI },
        { name: "a", uri: other },
      ]),
    ).toMatch(/two libraries/);
    expect(
      settingsProblem([
        { name: "a", uri: URI },
        { name: "b", uri: URI },
      ]),
    ).toMatch(/twice/);
    expect(settingsProblem([{ name: "a", uri: "/tmp/repo" }])).toMatch(/SSH/);
    expect(() => setLibrarySettings([{ name: "engine", uri: URI }])).toThrow();
  });

  it("names the first library st0 and any other after its repository", () => {
    expect(defaultLibraryName(URI, [])).toBe("st0");
    expect(
      defaultLibraryName("git@example.test:studio/Drum_Kits.git", [
        { name: "st0", uri: URI },
      ]),
    ).toBe("drum-kits");
  });
});

describe("syncLibrary", () => {
  const lib = { name: "st0", uri: URI };

  it("clones a library this machine has none of, where resolution looks for it", async () => {
    expect((await syncLibrary(EMAIL, lib)).state).toBe("cloned");
    expect(
      readFileSync(join(libraryDir("st0"), "modules/amp.yaml"), "utf8"),
    ).toBe("gain: 1\n");
  });

  it("brings a clone to the latest commit, and says when there was nothing new", async () => {
    await syncLibrary(EMAIL, lib);
    expect((await syncLibrary(EMAIL, lib)).state).toBe("current");
    publishElsewhere("modules/amp.yaml", "gain: 2\n");
    expect((await syncLibrary(EMAIL, lib)).state).toBe("updated");
    expect(
      readFileSync(join(libraryDir("st0"), "modules/amp.yaml"), "utf8"),
    ).toBe("gain: 2\n");
  });

  it("never updates over work not yet published, and says what it kept", async () => {
    await syncLibrary(EMAIL, lib);
    writeFileSync(join(libraryDir("st0"), "modules/amp.yaml"), "gain: 9\n");
    publishElsewhere("modules/cab.yaml", "size: 2\n");
    const r = await syncLibrary(EMAIL, lib);
    expect(r.state).toBe("kept");
    expect(r.note).toMatch(/not published/);
    expect(
      readFileSync(join(libraryDir("st0"), "modules/amp.yaml"), "utf8"),
    ).toBe("gain: 9\n");
  });

  it("reports a remote nobody can clone as a failure, and leaves nothing behind", async () => {
    const r = await syncLibrary(EMAIL, {
      name: "gone",
      uri: "git@example.test:studio/gone.git",
    });
    expect(r.state).toBe("failed");
    expect(existsSync(libraryDir("gone"))).toBe(false);
  });
});

describe("commitLibrary — the builder's Save", () => {
  it("commits what changed and pushes it where everybody else fetches", async () => {
    await syncLibrary(EMAIL, { name: "st0", uri: URI });
    writeFileSync(join(libraryDir("st0"), "modules/amp.yaml"), "gain: 3\n");
    const r = await commitLibrary(EMAIL, "st0", "louder amp");
    expect(r).toMatchObject({ committed: true, pushed: true });
    expect(git(origin, "show", "main:modules/amp.yaml")).toBe("gain: 3");
    expect(git(origin, "log", "-1", "--format=%ae %s")).toBe(
      `${EMAIL} louder amp`,
    );
  });

  it("says so when there is nothing to publish", async () => {
    await syncLibrary(EMAIL, { name: "st0", uri: URI });
    const r = await commitLibrary(EMAIL, "st0", "nothing");
    expect(r).toMatchObject({ committed: false, pushed: false });
  });

  it("refuses a library the account does not have", async () => {
    await expect(commitLibrary(EMAIL, "nope", "x")).rejects.toThrow(
      /no library/,
    );
  });
});

describe("pruneLibraries", () => {
  it("removes the clone of a library the list dropped, but never one holding work", async () => {
    await syncLibrary(EMAIL, { name: "st0", uri: URI });
    await syncLibrary(EMAIL, { name: "old", uri: URI });
    writeFileSync(join(libraryDir("old"), "modules/amp.yaml"), "gain: 7\n");
    await syncLibrary(EMAIL, { name: "gone", uri: URI });
    setLibrarySettings([{ name: "st0", uri: URI }]);

    const notes = await pruneLibraries(EMAIL);
    expect(existsSync(libraryDir("gone"))).toBe(false);
    expect(existsSync(libraryDir("old"))).toBe(true);
    expect(notes).toEqual([
      expect.objectContaining({ name: "old", state: "kept" }),
    ]);
  });
});

describe("retireWorkspaceLibraries — what a workspace held before", () => {
  let ws: string;
  beforeEach(() => {
    ws = join(tmp, "workspace");
    mkdirSync(ws, { recursive: true });
  });

  it("has nothing to do in a workspace that never held one", async () => {
    expect(await retireWorkspaceLibraries(EMAIL, ws)).toBeNull();
  });

  it("removes a SUBMODULE in one path-limited commit, and nothing else of the workspace", async () => {
    git(ws, "init", "-q", "--initial-branch=main");
    writeFileSync(join(ws, "readme.md"), "a workspace\n");
    git(ws, "add", "-A");
    git(ws, "commit", "-q", "-m", "first");
    git(ws, "submodule", "add", "-q", "--", URI, "_libraries");
    git(ws, "commit", "-q", "-m", "les bibliotheques");
    // Work in flight elsewhere in the workspace, which the retirement must not sweep up.
    writeFileSync(join(ws, "readme.md"), "edited\n");

    const r = await retireWorkspaceLibraries(EMAIL, ws);
    expect(r).toMatchObject({ retired: true });
    expect(existsSync(join(ws, "_libraries"))).toBe(false);
    expect(existsSync(join(ws, ".gitmodules"))).toBe(false);
    expect(git(ws, "log", "-1", "--format=%s")).toMatch(
      /no longer a submodule/,
    );
    expect(git(ws, "ls-files", "--", "_libraries", ".gitmodules")).toBe("");
    expect(git(ws, "status", "--porcelain")).toBe("M readme.md");
  });

  it("keeps a submodule holding edits nobody published, and says what they are", async () => {
    git(ws, "init", "-q", "--initial-branch=main");
    git(ws, "commit", "-q", "--allow-empty", "-m", "first");
    git(ws, "submodule", "add", "-q", "--", URI, "_libraries");
    git(ws, "commit", "-q", "-m", "les bibliotheques");
    writeFileSync(join(ws, "_libraries", "modules/amp.yaml"), "gain: 5\n");

    const r = await retireWorkspaceLibraries(EMAIL, ws);
    expect(r).toMatchObject({ retired: false });
    expect(r?.note).toMatch(/not published/);
    expect(
      readFileSync(join(ws, "_libraries", "modules/amp.yaml"), "utf8"),
    ).toBe("gain: 5\n");
  });

  it("deletes a plain clone in a workspace that is no repository", async () => {
    git(tmp, "clone", "-q", URI, join(ws, "_libraries"));
    const r = await retireWorkspaceLibraries(EMAIL, ws);
    expect(r).toMatchObject({ retired: true });
    expect(existsSync(join(ws, "_libraries"))).toBe(false);
  });

  it("keeps a folder git cannot account for — cannot tell is never nothing to lose", async () => {
    mkdirSync(join(ws, "_libraries", "modules"), { recursive: true });
    writeFileSync(join(ws, "_libraries", "modules", "mine.yaml"), "x: 1\n");
    const r = await retireWorkspaceLibraries(EMAIL, ws);
    expect(r).toMatchObject({ retired: false });
    expect(existsSync(join(ws, "_libraries", "modules", "mine.yaml"))).toBe(
      true,
    );
  });
});
