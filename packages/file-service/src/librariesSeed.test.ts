// Filling a brand-new library repository with the catalogue st0 already holds. This is the
// MIGRATION: every `@st0/…` ref in every song already written names something that lives in the
// hosted médiathèque, so a library repository that started empty would break all of them at
// once. It runs on the first machine to mount one, exactly once, and never again — a repository
// with a `modules/` folder is not empty any more. See packages/song/docs/sharedFolders.md.

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

/** The hosted library: a manifest and bytes, with no server. */
let library: Record<string, string> = {};
let listed: string[] = [];
/** A family the listing REFUSES, to prove one failure does not lose the other. */
let refuse = "";
vi.mock("@studio/mediatek/remote", () => ({
  remoteLibrary: () => ({
    revisions: async () => ({}),
    manifest: async (family: string) => {
      listed.push(family);
      if (family === refuse) throw new Error(`${family} is unavailable`);
      return Object.keys(library)
        .filter((p) => p.startsWith(`${family}/`))
        .map((path) => ({ path, bytes: library[path].length, mtime: 1 }));
    },
    download: async (path: string, dest: string) => {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, library[path], "utf8");
    },
  }),
}));

const { commitLibraries, excludeFromProjectRepo, seedIfEmpty } = await import(
  "./libraries.ts"
);

let tmp: string;
let origin: string;
let lib: string;
let prevUrl: string | undefined;
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

  prevUrl = process.env.MEDIATEK_URL;
  realHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
  process.env.MEDIATEK_URL = "http://library.test";
  library = {
    "modules/config.yaml": "namespace: st0\n",
    "modules/audio/reverb/module.yaml": "plugin: {type: vst3}\n",
    "modules/audio/reverb/ui.yaml": "cols: 2\n",
    "chains/live/vocals/chains.yaml": 'modules:\n  "@in": [ "@out" ]\n',
  };
  listed = [];
  refuse = "";
});

afterEach(() => {
  if (prevUrl === undefined) delete process.env.MEDIATEK_URL;
  else process.env.MEDIATEK_URL = prevUrl;
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

describe("seeding a new library repository", () => {
  it("copies both families in, commits them, and pushes", async () => {
    expect(await seedIfEmpty(lib)).toBe("seeded");
    expect(existsSync(join(lib, "modules/audio/reverb/module.yaml"))).toBe(
      true,
    );
    expect(existsSync(join(lib, "chains/live/vocals/chains.yaml"))).toBe(true);
    // On the remote, not merely committed here: a gitlink is a promise that a commit is
    // fetchable, and the caller only records one once this has happened.
    expect(pushed()).toEqual(
      expect.arrayContaining([
        "modules/config.yaml",
        "modules/audio/reverb/module.yaml",
        "modules/audio/reverb/ui.yaml",
        "chains/live/vocals/chains.yaml",
      ]),
    );
  });

  it("copies the bytes, not just the paths", async () => {
    await seedIfEmpty(lib);
    expect(
      readFileSync(join(lib, "modules/audio/reverb/module.yaml"), "utf8"),
    ).toBe("plugin: {type: vst3}\n");
  });

  it("does nothing at all the second time", async () => {
    await seedIfEmpty(lib);
    listed = [];
    // The whole safety of this: "already filled" is a question about the checkout, not a flag
    // somebody has to keep. A repository with a `modules/` folder has been here before.
    expect(await seedIfEmpty(lib)).toBe("filled");
    expect(listed).toEqual([]);
  });

  it("leaves a library somebody has already filled alone", async () => {
    // Not "no files at all": a repository made through a web UI usually arrives with a README,
    // and refusing to seed over one would leave a new account with an empty catalogue.
    writeFileSync(join(lib, "README.md"), "# les bibliotheques\n", "utf8");
    expect(await seedIfEmpty(lib)).toBe("seeded");

    const other = join(tmp, "other");
    mkdirSync(join(other, "modules"), { recursive: true });
    expect(await seedIfEmpty(other)).toBe("filled");
  });

  it("keeps one family when the other will not list", async () => {
    // A catalogue with modules and no chains is a working library; an empty one is not.
    refuse = "chains";
    expect(await seedIfEmpty(lib)).toBe("seeded");
    expect(existsSync(join(lib, "modules/audio/reverb/module.yaml"))).toBe(
      true,
    );
    expect(existsSync(join(lib, "chains"))).toBe(false);
  });

  it("says so, and commits nothing, when there is no médiathèque to copy from", async () => {
    delete process.env.MEDIATEK_URL;
    expect(await seedIfEmpty(lib)).toBe("empty");
    expect(git(lib, "status", "--porcelain")).toBe("");
  });

  it("says so when the catalogue is itself empty", async () => {
    library = {};
    expect(await seedIfEmpty(lib)).toBe("empty");
    expect(git(lib, "status", "--porcelain")).toBe("");
  });

  it("writes to the LIBRARY repository and never to the project one", async () => {
    // The rule, stated as a test: seeding fills the library. A song repository is somebody's
    // work, and nothing here has any business committing to it.
    const project = join(tmp, "ws");
    mkdirSync(join(project, "song.l8"), { recursive: true });
    git(project, "init", "--initial-branch=main");
    writeFileSync(join(project, "song.l8", "project.yaml"), "a: 1\n", "utf8");
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
    const before = git(project, "rev-parse", "HEAD").trim();

    const inside = join(project, "_libraries");
    mkdirSync(inside, { recursive: true });
    git(inside, "init", "--initial-branch=main");
    git(inside, "remote", "add", "origin", origin);
    expect(await seedIfEmpty(inside)).toBe("seeded");

    // Not one commit, and not one staged path, in the repository that holds the song.
    expect(git(project, "rev-parse", "HEAD").trim()).toBe(before);
    expect(git(project, "diff", "--cached", "--name-only")).toBe("");
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

    // Seeded and pushed FIRST, adopted second — a repository with no commits has nothing for a
    // gitlink to point at, which is the order `ensureLibraries` takes for the same reason.
    const inside = join(project, "_libraries");
    mkdirSync(inside, { recursive: true });
    git(inside, "init", "--initial-branch=main");
    git(inside, "remote", "add", "origin", origin);
    await seedIfEmpty(inside);
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
    await seedIfEmpty(lib);
    const project = dirname(lib);
    expect(await commitLibraries("me@example.test", project, "again")).toEqual({
      committed: false,
      pushed: false,
      note: "nothing to commit",
    });
  });

  it("keeps the work and says so when the push is refused", async () => {
    await seedIfEmpty(lib);
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

  it("reports a push it could not make, rather than claiming the seed landed", async () => {
    // The race: two machines mounting the same new repository at once. The loser's push is
    // rejected — and its caller must then NOT record a gitlink, or the workspace would point
    // at a commit nobody else can fetch.
    git(lib, "remote", "set-url", "origin", join(tmp, "nowhere.git"));
    expect(await seedIfEmpty(lib)).toBe("unpushed");
    // Still committed locally: the bytes are not thrown away, and the next open retries.
    expect(existsSync(join(lib, "modules/audio/reverb/module.yaml"))).toBe(
      true,
    );
  });
});
