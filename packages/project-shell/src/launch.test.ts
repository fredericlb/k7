// The pure halves of launch.ts. The capture-at-import itself is three lines and needs a DOM
// this repo's suites deliberately do not have (nothing here mounts a component); it is
// verified in the browser instead — see docs/launch.md for what to check.

import { describe, expect, it } from "vitest";
import { launchUrl, parseLaunch, projectsUrl } from "./launch";

describe("parseLaunch", () => {
  it("is null when nothing points here", () => {
    expect(parseLaunch("")).toBe(null);
    expect(parseLaunch("?panel=mixer")).toBe(null);
  });

  it("reads repo and project out of the address", () => {
    expect(
      parseLaunch(
        "?repo=git%40github.com%3Ame%2Fsongs.git&project=songs%2Ffirst",
      ),
    ).toEqual({
      repo: "git@github.com:me/songs.git",
      project: "songs/first",
    });
  });

  it("treats a repo with no project as the repository itself", () => {
    expect(parseLaunch("?repo=git%40h%3Ame%2Fr.git")?.project).toBe(".");
    // An empty one means the same thing, and must not become a path of "".
    expect(parseLaunch("?repo=git%40h%3Ame%2Fr.git&project=")?.project).toBe(
      ".",
    );
  });

  it("ignores the router's own parameters sitting beside it", () => {
    expect(parseLaunch("?panel=mixer&repo=git%40h%3Ar&project=a")).toEqual({
      repo: "git@h:r",
      project: "a",
    });
  });
});

describe("launchUrl", () => {
  it("names one project in one repository, escaped", () => {
    expect(
      launchUrl(
        "https://studio.test",
        "git@github.com:me/songs.git",
        "a/b.l8",
        "l8",
      ),
    ).toBe(
      "https://studio.test/l8/?repo=git%40github.com%3Ame%2Fsongs.git&project=a%2Fb.l8",
    );
  });

  it("sends an m9 project to m9", () => {
    expect(
      launchUrl("https://studio.test", "git@h:r", "set.m9", "m9"),
    ).toContain("studio.test/m9/?");
  });

  it("keeps only the origin, whatever URL it is handed", () => {
    expect(
      launchUrl("https://studio.test/projects/abc", "git@h:r", ".", "l8"),
    ).toContain("studio.test/l8/?");
  });

  // The round trip is the property that matters: st0 writes these, l8 and m9 read them back.
  it("round-trips through parseLaunch", () => {
    const repo = "ssh://git@host:2222/deep/path/repo.git";
    const project = "songs/a b/c.l8";
    const url = new URL(launchUrl("https://studio.test", repo, project, "l8"));
    expect(parseLaunch(url.search)).toEqual({ repo, project });
  });
});

describe("projectsUrl", () => {
  it("is st0's Projets section, which answers the origin root", () => {
    expect(projectsUrl("https://studio.test/l8/")).toBe(
      "https://studio.test/projects",
    );
  });
});
