// Mounting the account's library repository into a workspace: giving a brand-new one its
// first commit, keeping it out of the song repo's `git add -A` until it is registered,
// adopting it as a submodule, and publishing an edit back. It used to SEED the new repository
// from the hosted catalogue; that catalogue no longer holds modules or chains, so what is left
// is the commit a gitlink needs. See packages/song/docs/sharedFolders.md.

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
import { dirname, join } from "node:path";
// `lib` sits directly under `tmp`, so `dirname(lib)` is the "workspace" commitLibraries takes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  commitLibraries,
  excludeFromProjectRepo,
  registerSubmodule,
  initIfEmpty,
} = await import("./libraries.ts");

/** git refuses a file:// submodule by default (CVE-2022-39253); the real thing is SSH. */
const ALLOW_FILE = { ...process.env, GIT_ALLOW_PROTOCOL: "file:ssh" };

// Every fixture here drives REAL git — a bare origin, a checkout, commits, pushes and a
// submodule adoption — because what is being proved is that a commit leaves this machine, and a
// mocked git would prove the opposite. That is a dozen subprocesses per test, well past vitest's
// 5 s default on a loaded machine. `scaffoldSet.test.ts` buys the same room for the same reason.
vi.setConfig({ testTimeout: 30_000 });

let tmp: string;
let origin: string;
let lib: string;
/** A scratch HOME, because "no médiathèque configured" also means "none ADVERTISED on this
 *  machine" — `mediatekBase()` falls back to `~/.studio/web-endpoints/st0.json`, and the
 *  developer running this has one. Both variables: `homedir()` reads one or the other. */
let realHome: { HOME?: string; USERPROFILE?: string };

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "fs-seed-"));
  origin = join(tmp, "origin.git");
  lib = join(tmp, "_libraries");
  mkdirSync(origin, { recursive: true });
  mkdirSync(lib, { recursive: true });
  // A real remote and a real checkout: what is being proved is that a commit LEAVES this
  // machine, and a mocked git would prove the opposite of that.
  git(origin, "init", "--bare", "--initial-branch=main");
  git(lib, "init", "--initial-branch=main");
  git(lib, "remote", "add", "origin", origin);

  realHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
});

afterEach(() => {
  for (const [k, v] of Object.entries(realHome))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  rmSync(tmp, { recursive: true, force: true });
});

/** What the ORIGIN ended up holding — the only proof that matters. */
const pushed = (): string[] =>
  git(origin, "ls-tree", "-r", "--name-only", "main")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

describe("a brand-new library repository", () => {
  it("gets a first commit, and pushes it", async () => {
    expect(await initIfEmpty(lib)).toBe("initialised");
    // On the REMOTE, not merely committed here: a gitlink is a promise that a commit is
    // fetchable, and the caller only records one once this has happened.
    expect(git(origin, "rev-parse", "main").trim()).toHaveLength(40);
    // Empty on purpose. There is nothing to put in it: l8 is what writes a module, and it
    // commits through `commitLibraries` below.
    expect(pushed()).toEqual([]);
  });

  it("does nothing at all the second time", async () => {
    await initIfEmpty(lib);
    const head = git(lib, "rev-parse", "HEAD").trim();
    // The whole safety of this: "already started" is a question about the CHECKOUT, not a
    // flag somebody has to keep. A repository with a commit has been here before.
    expect(await initIfEmpty(lib)).toBe("filled");
    expect(git(lib, "rev-parse", "HEAD").trim()).toBe(head);
  });

  it("leaves a repository somebody has already committed to alone", async () => {
    // Not "no files at all": a repository made through a web UI usually arrives with a README
    // and a commit, and committing over one would be writing in somebody's history.
    writeFileSync(join(lib, "README.md"), "# les bibliotheques\n", "utf8");
    git(lib, "add", "-A");
    git(
      lib,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-m",
      "readme",
    );
    expect(await initIfEmpty(lib)).toBe("filled");
  });

  it("keeps an unregistered library out of the project repo's `git add -A`", async () => {
    // The leak: until `submodule add` has run, `_libraries` is an untracked folder inside a
    // song repository — and `project commit` adds the whole tree. Git would commit the
    // catalogue into the song, or record a gitlink with no `.gitmodules` beside it.
    const project = join(tmp, "ws2");
    mkdirSync(project, { recursive: true });
    git(project, "init", "--initial-branch=main");

    const inside = join(project, "_libraries");
    mkdirSync(join(inside, "modules", "audio", "reverb"), { recursive: true });
    writeFileSync(
      join(inside, "modules", "audio", "reverb", "module.yaml"),
      "plugin: {}\n",
      "utf8",
    );
    await excludeFromProjectRepo(project);

    writeFileSync(join(project, "song.yaml"), "a: 1\n", "utf8");
    git(project, "add", "-A");
    const staged = git(project, "diff", "--cached", "--name-only");
    expect(staged).toContain("song.yaml");
    expect(staged).not.toContain("_libraries");
  });

  it("registers the submodule even though the exclusion is in the way", async () => {
    // The bug this pins, found in a real workspace and not here: `excludeFromProjectRepo`
    // writes `/_libraries/` into `.git/info/exclude`, and `git submodule add` REFUSES an
    // ignored path. Every first mount therefore left the library seeded, pushed and
    // unregistered — the very half-state the exclusion exists to make survivable. The test
    // that should have caught it built its fixture with `-f` already.
    //
    // The two are not in conflict: the exclusion guards the untracked window, and this is the
    // act that closes it.
    const project = join(tmp, "ws7");
    mkdirSync(project, { recursive: true });
    git(project, "init", "--initial-branch=main");
    writeFileSync(join(project, "song.yaml"), "a: 1\n", "utf8");
    git(project, "add", "-A");
    git(
      project,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-m",
      "the song",
    );

    const inside = join(project, "_libraries");
    mkdirSync(inside, { recursive: true });
    git(inside, "init", "--initial-branch=main");
    git(inside, "remote", "add", "origin", origin);
    await initIfEmpty(inside);

    await excludeFromProjectRepo(project);
    expect(git(project, "check-ignore", "-v", "_libraries")).toContain(
      "_libraries",
    );

    await registerSubmodule(project, origin, ALLOW_FILE);
    // Staged, not committed: publishing is somebody's decision.
    expect(git(project, "diff", "--cached", "--name-only").split("\n")).toEqual(
      expect.arrayContaining([".gitmodules", "_libraries"]),
    );
    expect(readFileSync(join(project, ".gitmodules"), "utf8")).toContain(
      "_libraries",
    );
  });

  it("adds the exclusion once, however often it runs", async () => {
    const project = join(tmp, "ws3");
    mkdirSync(project, { recursive: true });
    git(project, "init", "--initial-branch=main");
    await excludeFromProjectRepo(project);
    await excludeFromProjectRepo(project);
    const text = readFileSync(join(project, ".git", "info", "exclude"), "utf8");
    expect(text.split("/_libraries/").length - 1).toBe(1);
  });

  /** A song repository with the library mounted inside it as a real submodule. */
  async function songWithLibrary(name: string): Promise<string> {
    const project = join(tmp, name);
    mkdirSync(project, { recursive: true });
    git(project, "init", "--initial-branch=main");
    writeFileSync(join(project, "song.yaml"), "a: 1\n", "utf8");
    git(project, "add", "-A");
    const who = ["-c", "user.name=t", "-c", "user.email=t@t"];
    git(project, ...who, "commit", "-m", "the song");

    // Committed and pushed FIRST, adopted second — a repository with no commits has nothing for
    // a gitlink to point at, which is the order `ensureLibraries` takes for the same reason.
    const inside = join(project, "_libraries");
    mkdirSync(inside, { recursive: true });
    git(inside, "init", "--initial-branch=main");
    git(inside, "remote", "add", "origin", origin);
    await initIfEmpty(inside);
    // A module for the publish tests below to EDIT. Written here by hand: l8 is what puts one in
    // a library, and this fixture stands in for a library somebody has already used.
    mkdirSync(join(inside, "modules", "audio", "reverb"), { recursive: true });
    writeFileSync(
      join(inside, "modules", "audio", "reverb", "module.yaml"),
      "plugin: {type: vst3}\n",
      "utf8",
    );
    git(inside, "add", "-A");
    git(inside, ...who, "commit", "-m", "un module");
    git(inside, "push", "origin", "HEAD");
    // `protocol.file.allow`: git refuses a file:// submodule by default (CVE-2022-39253). The
    // real thing is SSH; this is a local bare repo standing in for one.
    git(
      project,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "--force",
      "--",
      origin,
      "_libraries",
    );
    git(project, ...who, "commit", "-m", "mount the libraries");
    return project;
  }

  it("publishes the edit and records the new version in the project", async () => {
    const project = await songWithLibrary("ws4");
    const songHead = git(project, "rev-parse", "HEAD").trim();

    writeFileSync(
      join(project, "_libraries", "modules", "audio", "reverb", "module.yaml"),
      "plugin: {type: vst3}\nparams:\n  Mix: 0.5\n",
      "utf8",
    );
    const out = await commitLibraries(
      "me@example.test",
      project,
      "@st0/audio/reverb",
    );
    expect(out).toMatchObject({ committed: true, pushed: true });

    // On the remote, so everybody else has it.
    expect(
      git(origin, "show", "main:modules/audio/reverb/module.yaml"),
    ).toContain("Mix: 0.5");
    // …and the song now SAYS it uses that version: one new commit, moving the gitlink.
    expect(out.recorded).toBeTruthy();
    expect(git(project, "rev-parse", "HEAD").trim()).not.toBe(songHead);
    expect(
      git(project, "show", "--name-only", "--format=", "HEAD").trim(),
    ).toBe("_libraries");
    expect(git(project, "log", "-1", "--format=%s")).toContain("libraries:");
  });

  it("leaves everything else in the song alone, staged or not", async () => {
    // The rule that makes this safe to do automatically: a commit ABOUT a module must not carry
    // half a song with it. Path-limited, so what is in flight stays in flight.
    const project = await songWithLibrary("ws5");
    writeFileSync(join(project, "wip.yaml"), "unfinished: true\n", "utf8");
    writeFileSync(join(project, "staged.yaml"), "half: true\n", "utf8");
    git(project, "add", "--", "staged.yaml");

    writeFileSync(
      join(project, "_libraries", "modules", "audio", "reverb", "ui.yaml"),
      "cols: 4\n",
      "utf8",
    );
    await commitLibraries("me@example.test", project, "@st0/audio/reverb");

    expect(
      git(project, "show", "--name-only", "--format=", "HEAD").trim(),
    ).toBe("_libraries");
    // The half-finished work is exactly where it was: one staged, one not.
    expect(git(project, "diff", "--cached", "--name-only").trim()).toBe(
      "staged.yaml",
    );
    expect(git(project, "status", "--porcelain")).toContain("wip.yaml");
  });

  it("records nothing when the library could not be pushed", async () => {
    // A gitlink promises the commit is fetchable. Pointing one at a commit that never left this
    // machine breaks the song for everybody who clones it.
    const project = await songWithLibrary("ws6");
    const songHead = git(project, "rev-parse", "HEAD").trim();
    git(
      join(project, "_libraries"),
      "remote",
      "set-url",
      "origin",
      join(tmp, "nowhere.git"),
    );

    writeFileSync(
      join(project, "_libraries", "modules", "audio", "reverb", "ui.yaml"),
      "cols: 8\n",
      "utf8",
    );
    const out = await commitLibraries("me@example.test", project, "a module");
    expect(out).toMatchObject({ committed: true, pushed: false });
    expect(out.recorded).toBeUndefined();
    expect(git(project, "rev-parse", "HEAD").trim()).toBe(songHead);
  });

  it("says there was nothing to commit rather than making an empty one", async () => {
    await initIfEmpty(lib);
    const project = dirname(lib);
    expect(await commitLibraries("me@example.test", project, "again")).toEqual({
      committed: false,
      pushed: false,
      note: "nothing to commit",
    });
  });

  it("keeps the work and says so when the push is refused", async () => {
    await initIfEmpty(lib);
    mkdirSync(join(lib, "modules"), { recursive: true });
    writeFileSync(join(lib, "modules", "new.yaml"), "a: 1\n", "utf8");
    git(lib, "remote", "set-url", "origin", join(tmp, "nowhere.git"));
    const out = await commitLibraries(
      "me@example.test",
      dirname(lib),
      "a module",
    );
    expect(out.committed).toBe(true);
    expect(out.pushed).toBe(false);
    // Committed locally, so the next Save pushes both — the work is never the thing that is lost.
    expect(git(lib, "log", "--oneline")).toContain("a module");
  });

  it("reports a push it could not make, rather than claiming it landed", async () => {
    // The race: two machines mounting the same new repository at once. The loser's push is
    // rejected — and its caller must then NOT record a gitlink, or the workspace would point
    // at a commit nobody else can fetch.
    git(lib, "remote", "set-url", "origin", join(tmp, "nowhere.git"));
    expect(await initIfEmpty(lib)).toBe("unpushed");
    // Still committed locally, so the next open has something to push rather than starting over.
    expect(git(lib, "log", "--oneline")).toContain("premier commit");
  });
});
