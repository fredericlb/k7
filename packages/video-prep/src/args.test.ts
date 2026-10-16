// args.test.ts — an uploaded video is opened through the protocol whitelist, by the probe and by every copy.

import { input } from "@studio/ffmpeg";
import { describe, expect, it } from "vitest";
import { probeArgs } from "./probe";
import { type CopyKind, copyArgs } from "./transcode";

const opensSafely = (args: string[], source: string): boolean =>
  args.join("\0").includes(input(source).join("\0"));

describe("the whitelist on an uploaded video", () => {
  it("is on the probe", () => {
    expect(opensSafely(probeArgs("/up/clip.mov"), "/up/clip.mov")).toBe(true);
  });

  it("is on every copy", () => {
    for (const k of ["remux", "transcode", "proxy"] as CopyKind[])
      expect(
        opensSafely(copyArgs(k, "/up/clip.mov", "/o.mp4"), "/up/clip.mov"),
      ).toBe(true);
  });
});
