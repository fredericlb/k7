// The libraries as an account's service holds them, over REAL git: the clone an admin's bench
// edits — made from the server's remote, read in place of the server's own, committed and pushed
// from, thrown away — and taking a workspace's OLD `_libraries` (submodule or clone) out of it.
// A mocked git would prove the opposite of what is claimed. See docs/libraries.md.

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
import {
  libraryOverlay,
  libraryRoot,
  setLibraryOverlay,
} from "@studio/song/sharedFolders";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retireWorkspaceLibraries } from "./libraries.ts";
import {
  commitLibraryBench,
  discardLibraryBench,
  libraryBenchStatus,
  openLibraryBench,
} from "./libraryBench.ts";
import { slugify } from "./slug.ts";

// Every fixture drives REAL git — a dozen subprocesses per test, well past vitest's 5 s default.
vi.setConfig({ testTimeout: 30_000 });

const EMAIL = "someone@example.test";
/** What the list says: an SSH URI, which is all the service accepts… */
const URI = "git@example.test:studio/st0.git";
/** …rewritten by git, through the environment, to a bare repository on disk. */
let origin: string;

let tmp: string;
const saved: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "STUDIO_HOME",
  "STUDIO_LIBRARIES_HOME",
  "STUDIO_HUB_URL",
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

/** The server's clone of `name`, as the hub would have made it — from the URI, so it records it. */
const serverClone = (name: string): string => {
  const at = join(tmp, "shared", name);
  git(tmp, "clone", "-q", URI, at);
  return at;
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "fs-libs-"));
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.STUDIO_HOME = join(tmp, "home");
  process.env.STUDIO_LIBRARIES_HOME = join(tmp, "shared");
  // No hub: a push asks nobody to pull, and that is not what these tests are about.
  delete process.env.STUDIO_HUB_URL;
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
  setLibraryOverlay(null);
  for (const k of ENV_KEYS)
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  rmSync(tmp, { recursive: true, force: true });
});

describe("the bench's clone of a library", () => {
  const benchClone = (name: string) =>
    join(tmp, "home", "bench-libraries", name);

  it("is cloned from the server's remote, and read in place of the server's clone", async () => {
    const shared = serverClone("st0");
    expect(libraryRoot("st0")).toBe(shared);
    await openLibraryBench(EMAIL, "st0");
    expect(libraryOverlay()?.name).toBe("st0");
    expect(libraryRoot("st0")).toBe(benchClone("st0"));
    expect(
      readFileSync(join(benchClone("st0"), "modules/amp.yaml"), "utf8"),
    ).toBe("gain: 1\n");
  });

  it("counts what it holds, and a commit pushes it where everybody fetches", async () => {
    serverClone("st0");
    await openLibraryBench(EMAIL, "st0");
    writeFileSync(join(benchClone("st0"), "modules/amp.yaml"), "gain: 3\n");
    expect(await libraryBenchStatus(EMAIL)).toEqual({
      library: "st0",
      changed: 1,
      ahead: 0,
    });
    const r = await commitLibraryBench(EMAIL, "louder amp");
    expect(r.pushed).toBe(true);
    expect(git(origin, "show", "main:modules/amp.yaml")).toBe("gain: 3");
    expect(git(origin, "log", "-1", "--format=%ae %s")).toBe(
      `${EMAIL} louder amp`,
    );
    expect(await libraryBenchStatus(EMAIL)).toMatchObject({
      changed: 0,
      ahead: 0,
    });
  });

  it("is made what is pushed again by a discard", async () => {
    serverClone("st0");
    await openLibraryBench(EMAIL, "st0");
    writeFileSync(join(benchClone("st0"), "modules/amp.yaml"), "gain: 9\n");
    writeFileSync(join(benchClone("st0"), "modules/new.yaml"), "x: 1\n");
    await discardLibraryBench(EMAIL);
    expect(
      readFileSync(join(benchClone("st0"), "modules/amp.yaml"), "utf8"),
    ).toBe("gain: 1\n");
    expect(existsSync(join(benchClone("st0"), "modules/new.yaml"))).toBe(false);
  });

  it("keeps work not pushed across benches, and removes a clean clone it left", async () => {
    serverClone("st0");
    serverClone("drums");
    await openLibraryBench(EMAIL, "st0");
    writeFileSync(join(benchClone("st0"), "modules/amp.yaml"), "gain: 4\n");
    await openLibraryBench(EMAIL, "drums");
    expect(libraryOverlay()?.name).toBe("drums");
    expect(existsSync(benchClone("st0"))).toBe(true);
    // Back on st0, its work is still there; drums, clean, is gone.
    await openLibraryBench(EMAIL, "st0");
    expect(
      readFileSync(join(benchClone("st0"), "modules/amp.yaml"), "utf8"),
    ).toBe("gain: 4\n");
    expect(existsSync(benchClone("drums"))).toBe(false);
  });

  it("refuses a library the server holds no clone of", async () => {
    await expect(openLibraryBench(EMAIL, "nope")).rejects.toThrow(/no clone/);
    expect(libraryOverlay()).toBeNull();
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
