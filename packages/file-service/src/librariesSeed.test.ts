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

const { seedIfEmpty } = await import("./libraries.ts");

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
