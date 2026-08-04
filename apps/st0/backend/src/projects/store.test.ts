import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dir: string;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "st0-projects-"));
  process.env.STUDIO_PROJECTS_DIR = dir;
});
afterEach(() => {
  delete process.env.STUDIO_PROJECTS_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const load = async () => await import("./store.ts");

describe("repoIdFor", () => {
  it("is the same id for the two spellings of one repository", async () => {
    const { repoIdFor } = await load();
    expect(repoIdFor("git@github.com:me/repo.git")).toBe(
      repoIdFor("ssh://git@github.com/me/repo"),
    );
  });

  it("differs between repositories", async () => {
    const { repoIdFor } = await load();
    expect(repoIdFor("git@h:me/a.git")).not.toBe(repoIdFor("git@h:me/b.git"));
  });

  it("refuses a uri git must never be handed", async () => {
    const { repoIdFor } = await load();
    expect(() => repoIdFor("https://github.com/me/repo")).toThrow();
  });
});

describe("the repository list", () => {
  it("reads as empty for someone who has never added one", async () => {
    const { listRepos } = await load();
    expect(listRepos("sub-1")).toEqual([]);
  });

  it("round-trips an addition", async () => {
    const { addRepo, listRepos, findRepo } = await load();
    const { repo, added } = addRepo("sub-1", "git@github.com:me/songs.git");
    expect(added).toBe(true);
    expect(repo.label).toBe("songs"); // defaulted from the uri
    expect(listRepos("sub-1")).toHaveLength(1);
    expect(findRepo("sub-1", repo.id)?.uri).toBe("git@github.com:me/songs.git");
  });

  it("is idempotent across spellings — adding twice gives the one that is there", async () => {
    const { addRepo, listRepos } = await load();
    const first = addRepo("sub-1", "git@github.com:me/songs.git");
    const again = addRepo("sub-1", "ssh://git@github.com/me/songs");
    expect(again.added).toBe(false);
    expect(again.repo.id).toBe(first.repo.id);
    expect(listRepos("sub-1")).toHaveLength(1);
  });

  it("keeps two users apart", async () => {
    const { addRepo, listRepos } = await load();
    addRepo("sub-1", "git@h:me/a.git");
    addRepo("sub-2", "git@h:me/b.git");
    expect(listRepos("sub-1")).toHaveLength(1);
    expect(listRepos("sub-2")[0].label).toBe("b");
  });

  it("removes, and says so when there was nothing to remove", async () => {
    const { addRepo, removeRepo, listRepos } = await load();
    const { repo } = addRepo("sub-1", "git@h:me/a.git");
    expect(removeRepo("sub-1", repo.id)).toBe(true);
    expect(removeRepo("sub-1", repo.id)).toBe(false);
    expect(listRepos("sub-1")).toEqual([]);
  });
});

describe("revision", () => {
  it("moves on every write, including two inside one clock tick", async () => {
    const { addRepo, revision, bump } = await load();
    const before = revision("sub-1");
    addRepo("sub-1", "git@h:me/a.git");
    const afterAdd = revision("sub-1");
    expect(afterAdd).not.toBe(before);
    // A finished mirror fetch moves nothing on disk but changes what /tree would answer.
    bump();
    expect(revision("sub-1")).not.toBe(afterAdd);
  });

  it("is per user", async () => {
    const { addRepo, revision } = await load();
    const other = revision("sub-2");
    addRepo("sub-1", "git@h:me/a.git");
    // sub-2 gained no repository, so its count and stamp are unchanged.
    expect(revision("sub-2").split(":").slice(1)).toEqual(
      other.split(":").slice(1),
    );
  });
});

describe("paths", () => {
  it("keeps every user's key and mirrors in their own directory", async () => {
    const { keyDirFor, mirrorDirFor } = await load();
    expect(keyDirFor("sub-1")).not.toBe(keyDirFor("sub-2"));
    expect(mirrorDirFor("sub-1", "abc")).not.toBe(mirrorDirFor("sub-2", "abc"));
    expect(mirrorDirFor("sub-1", "abc").endsWith("abc.git")).toBe(true);
  });

  it("never lets an OIDC subject become a path segment as-is", async () => {
    const { keyDirFor } = await load();
    // A `sub` is an opaque string the IdP chooses; it can contain separators.
    expect(keyDirFor("../../etc/passwd")).not.toContain("..");
  });
});
