import { describe, expect, it } from "vitest";
import { isNewerTag, parseStamp, RELEASE, releaseLabel } from "./release.ts";
import { checkDue, newerRelease, releaseApiUrl } from "./updateCheck.ts";

const PAGE = "https://github.com/fredericlb/k7/releases/tag/v1.5.0";

describe("the release stamp", () => {
  it("is dev when nothing inlined one", () => {
    expect(RELEASE).toBe("dev");
  });

  it("reads the two CI shapes and nothing else", () => {
    expect(parseStamp("v1.4.0")).toEqual({
      kind: "release",
      version: [1, 4, 0],
    });
    expect(parseStamp("snapshot-9f2c1ab")).toEqual({
      kind: "snapshot",
      commit: "9f2c1ab",
    });
    expect(parseStamp("dev")).toBeNull();
    expect(parseStamp("1.4.0")).toBeNull();
    expect(parseStamp("v1.4")).toBeNull();
  });

  it("compares tags by number, not by text", () => {
    expect(isNewerTag("v1.9.0", "v1.10.0")).toBe(true);
    expect(isNewerTag("v1.10.0", "v1.9.0")).toBe(false);
    expect(isNewerTag("v1.4.0", "v1.4.0")).toBe(false);
    expect(isNewerTag("v1.4.0", "v2.0.0")).toBe(true);
    expect(isNewerTag("v1.4.0", "snapshot-abcdef0")).toBe(false);
  });

  it("labels a release by its number and a snapshot by its stamp", () => {
    expect(releaseLabel("v1.4.0")).toBe("1.4.0");
    expect(releaseLabel("snapshot-9f2c1ab")).toBe("snapshot-9f2c1ab");
  });
});

describe("the update check", () => {
  it("asks each channel's own release, and nothing for a checkout run", () => {
    expect(releaseApiUrl("v1.4.0", "o/r")).toBe(
      "https://api.github.com/repos/o/r/releases/latest",
    );
    expect(releaseApiUrl("snapshot-9f2c1ab", "o/r")).toBe(
      "https://api.github.com/repos/o/r/releases/tags/snapshot",
    );
    expect(releaseApiUrl("dev")).toBeNull();
  });

  it("tells of a later tag, never of the same or an older one", () => {
    expect(
      newerRelease("v1.4.0", { tag_name: "v1.5.0", html_url: PAGE }),
    ).toEqual({
      name: "1.5.0",
      url: PAGE,
    });
    expect(
      newerRelease("v1.5.0", { tag_name: "v1.5.0", html_url: PAGE }),
    ).toBeNull();
    expect(
      newerRelease("v1.6.0", { tag_name: "v1.5.0", html_url: PAGE }),
    ).toBeNull();
  });

  it("tells a snapshot of another commit, not of its own", () => {
    const r = {
      html_url: PAGE,
      target_commitish: "0123456789abcdef0123456789abcdef01234567",
    };
    expect(newerRelease("snapshot-0123456", r)).toBeNull();
    expect(newerRelease("snapshot-fedcba9", r)?.name).toBe("snapshot-0123456");
    expect(
      newerRelease("snapshot-fedcba9", { ...r, target_commitish: "main" }),
    ).toBeNull();
  });

  it("opens only a github.com page", () => {
    expect(
      newerRelease("v1.4.0", {
        tag_name: "v1.5.0",
        html_url: "https://evil.example/x",
      }),
    ).toBeNull();
    expect(newerRelease("v1.4.0", { tag_name: "v1.5.0" })).toBeNull();
  });

  it("is due once a day, and again if the clock went back", () => {
    const day = 24 * 3600_000;
    expect(checkDue(undefined, 1000)).toBe(true);
    expect(checkDue(1000, 1000 + day - 1)).toBe(false);
    expect(checkDue(1000, 1000 + day)).toBe(true);
    expect(checkDue(5000, 1000)).toBe(true);
  });
});
