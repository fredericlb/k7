import { describe, expect, it } from "vitest";
import { isNewerTag, parseStamp, RELEASE, releaseLabel } from "./release.ts";
import { buildUrl, checkDue, feedUrl, newerBuild } from "./updateCheck.ts";

const PAGE = "https://k7.rocks/app_downloads";

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
  it("asks each channel's own build, and nothing for a checkout run", () => {
    expect(buildUrl("v1.4.0", "https://x/d")).toBe("https://x/d/release.json");
    expect(buildUrl("snapshot-9f2c1ab", "https://x/d")).toBe(
      "https://x/d/snapshot.json",
    );
    expect(buildUrl("dev")).toBeNull();
    expect(feedUrl("snapshot-9f2c1ab")).toBe(
      "https://k7.rocks/app_downloads/snapshot",
    );
    expect(feedUrl("dev")).toBeNull();
  });

  it("tells of a later tag, never of the same or an older one", () => {
    expect(newerBuild("v1.4.0", { stamp: "v1.5.0" })).toEqual({
      name: "1.5.0",
      stamp: "v1.5.0",
      url: PAGE,
    });
    expect(newerBuild("v1.5.0", { stamp: "v1.5.0" })).toBeNull();
    expect(newerBuild("v1.6.0", { stamp: "v1.5.0" })).toBeNull();
  });

  it("tells a snapshot of another commit, not of its own", () => {
    expect(
      newerBuild("snapshot-0123456", { stamp: "snapshot-0123456" }),
    ).toBeNull();
    expect(
      newerBuild("snapshot-fedcba9", { stamp: "snapshot-0123456" })?.name,
    ).toBe("snapshot-0123456");
  });

  it("never crosses channels, nor reads an unreadable answer", () => {
    expect(newerBuild("snapshot-fedcba9", { stamp: "v9.0.0" })).toBeNull();
    expect(newerBuild("v1.4.0", { stamp: "snapshot-0123456" })).toBeNull();
    expect(newerBuild("v1.4.0", { stamp: 2 })).toBeNull();
    expect(newerBuild("v1.4.0", {})).toBeNull();
    expect(newerBuild("dev", { stamp: "v1.5.0" })).toBeNull();
  });

  it("opens the downloads page it was given, never one from the answer", () => {
    expect(newerBuild("v1.4.0", { stamp: "v1.5.0" }, "https://x/d")?.url).toBe(
      "https://x/d",
    );
  });

  it("is due every six hours, and again if the clock went back", () => {
    const every = 6 * 3600_000;
    expect(checkDue(undefined, 1000)).toBe(true);
    expect(checkDue(1000, 1000 + every - 1)).toBe(false);
    expect(checkDue(1000, 1000 + every)).toBe(true);
    expect(checkDue(5000, 1000)).toBe(true);
  });
});
