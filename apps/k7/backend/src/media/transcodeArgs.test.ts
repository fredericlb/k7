// transcodeArgs.test.ts — an uploaded FLAC is opened through the protocol whitelist when its MP3 is made.

import { input } from "@studio/ffmpeg";
import { describe, expect, it } from "vitest";
import { mp3Args } from "./transcode.ts";

describe("mp3Args", () => {
  it("whitelists the FLAC's input", () => {
    const args = mp3Args("/lib/a.flac", "/lib/.a.mp3.part");
    expect(args.join("\0")).toContain(input("/lib/a.flac").join("\0"));
  });
});
