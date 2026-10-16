// decodeArgs.test.ts — the probe and the decode of a file open it through the protocol whitelist.

import { PROTOCOLS } from "@studio/ffmpeg";
import { describe, expect, it } from "vitest";
import { decodeArgs, probeArgs } from "./decode.ts";

const whitelisted = (args: string[], source: string): boolean => {
  const at = args.indexOf(source);
  return (
    args[at - 1] === "-i" &&
    args.slice(at - 3, at - 1).join(" ") === PROTOCOLS.join(" ")
  );
};

describe("decode's arguments", () => {
  it("whitelist the input of ffprobe and of ffmpeg", () => {
    expect(whitelisted(probeArgs("/up/x.mp3"), "/up/x.mp3")).toBe(true);
    expect(whitelisted(decodeArgs("/up/x.mp3"), "/up/x.mp3")).toBe(true);
  });
});
