// The rules file a workspace is created with, and the proof that its media arrived. A pattern
// that misses is a wav committed whole; a pointer that stays is a song that plays as silence.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AUDIO_EXT, VIDEO_EXT } from "@studio/mediatek/media";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GITATTRIBUTES, isPointer, lfsPending } from "./gitLfs.ts";

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

describe("telling a pointer from audio", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fs-lfs-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const at = (name: string, body: Buffer | string): string => {
    const path = join(dir, name);
    writeFileSync(path, body);
    return path;
  };

  it("recognises what git checks out when the media never arrived", () => {
    // Verbatim from a real workspace: this is the 130 bytes that plays as silence.
    const pointer =
      "version https://git-lfs.github.com/spec/v1\n" +
      "oid sha256:4f1d6673216bdb682e6a1ccb2428c0521dfa49865c0eed3a4f9dca51abbb94f4\n" +
      "size 105884\n";
    expect(isPointer(at("kick.wav", pointer))).toBe(true);
  });

  it("passes real audio, however short", () => {
    // A wav header and nothing else: smaller than a pointer, and still not one.
    expect(isPointer(at("tiny.wav", Buffer.from("RIFF$\0\0\0WAVEfmt ")))).toBe(
      false,
    );
  });

  it("passes a file too short to hold the spec line", () => {
    expect(isPointer(at("stub.wav", "version"))).toBe(false);
  });

  it("says no rather than throwing when the file is not there", () => {
    // A missing sample is a real problem, but a different one — it must not read as unfetched.
    expect(isPointer(join(dir, "absent.wav"))).toBe(false);
  });
});

describe("lfsPending", () => {
  it("costs one existsSync when nothing is owed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fs-lfs-"));
    // No marker and no .git at all: the answer must not depend on git being reachable.
    expect(await lfsPending(dir, process.env)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
