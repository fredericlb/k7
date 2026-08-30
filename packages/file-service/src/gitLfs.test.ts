// The rules file a workspace is created with. A pattern that misses is a wav committed whole
// into the repository, which nobody notices until the clone takes an hour.

import { AUDIO_EXT, VIDEO_EXT } from "@studio/mediatek/media";
import { describe, expect, it } from "vitest";
import { GITATTRIBUTES } from "./gitLfs.ts";

const lines = (): string[] =>
  GITATTRIBUTES.split("\n").filter((l) => l && !l.startsWith("#"));

describe("the LFS rules", () => {
  it("routes audio and video through the filter", () => {
    expect(GITATTRIBUTES).toContain(
      "*.[Ww][Aa][Vv] filter=lfs diff=lfs merge=lfs -text",
    );
    expect(GITATTRIBUTES).toContain(
      "*.[Mm][Pp]4 filter=lfs diff=lfs merge=lfs -text",
    );
  });

  it("matches whatever case a library hands over", () => {
    // git compares an attribute pattern case-sensitively, and `.FLAC` is a real filename.
    expect(GITATTRIBUTES).toContain("*.[Ff][Ll][Aa][Cc] ");
  });

  it("names every media extension the library knows, once", () => {
    const both = new Set([...AUDIO_EXT, ...VIDEO_EXT]);
    // `.webm` is audio AND video: two identical rules would be a duplicate git never needs.
    expect(lines()).toHaveLength(both.size);
    expect(lines().filter((l) => l.includes("[Ww][Ee][Bb][Mm]"))).toHaveLength(
      1,
    );
  });

  it("marks every one of them binary", () => {
    // Without `-text` git may rewrite line endings inside a wav on checkout.
    for (const line of lines()) expect(line.endsWith(" -text")).toBe(true);
  });
});
