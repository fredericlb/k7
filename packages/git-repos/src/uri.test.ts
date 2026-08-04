import { describe, expect, it } from "vitest";
import {
  assertSshGitUri,
  isSshGitUri,
  normalizeGitUri,
  repoName,
} from "./uri.ts";

describe("assertSshGitUri", () => {
  it("accepts both SSH spellings", () => {
    expect(() => assertSshGitUri("git@github.com:me/repo.git")).not.toThrow();
    expect(() =>
      assertSshGitUri("ssh://git@github.com/me/repo.git"),
    ).not.toThrow();
    expect(() => assertSshGitUri("ssh://host:2222/me/repo")).not.toThrow();
  });

  it("refuses https, which would sidestep the deploy key", () => {
    expect(() => assertSshGitUri("https://github.com/me/repo.git")).toThrow();
  });

  it("refuses anything that could reach git looking like an option", () => {
    for (const bad of [
      "--upload-pack=touch /tmp/x",
      "-c core.sshCommand=evil",
      "ext::sh -c whoami",
      "",
    ])
      expect(() => assertSshGitUri(bad), bad).toThrow();
  });

  it("isSshGitUri answers without throwing", () => {
    expect(isSshGitUri("git@h:p")).toBe(true);
    expect(isSshGitUri("https://h/p")).toBe(false);
  });
});

describe("normalizeGitUri", () => {
  // The whole point: st0 sees what was pasted, the file service sees remote.origin.url.
  it("folds the two spellings of one repository together", () => {
    const want = "github.com/me/repo";
    for (const uri of [
      "git@github.com:me/repo.git",
      "git@github.com:me/repo",
      "ssh://git@github.com/me/repo.git",
      "ssh://github.com/me/repo",
      "ssh://git@github.com:22/me/repo.git",
      "git@GitHub.com:me/repo.git",
    ])
      expect(normalizeGitUri(uri), uri).toBe(want);
  });

  it("keeps a non-default port, which is a different server", () => {
    expect(normalizeGitUri("ssh://git@host:2222/me/repo")).toBe(
      "host:2222/me/repo",
    );
  });

  it("keeps repositories apart", () => {
    expect(normalizeGitUri("git@host:me/a.git")).not.toBe(
      normalizeGitUri("git@host:me/b.git"),
    );
  });

  it("refuses what assertSshGitUri refuses", () => {
    expect(() => normalizeGitUri("https://github.com/me/repo")).toThrow();
  });
});

describe("repoName", () => {
  it("is the last segment, without .git", () => {
    expect(repoName("git@github.com:me/my-songs.git")).toBe("my-songs");
    expect(repoName("ssh://host/deep/nested/thing")).toBe("thing");
  });
});
