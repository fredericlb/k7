// A song's facts live in its master's tags: what is written reads back, a write never edits the
// file in place, and a file TagLib cannot open reads as no tags rather than as an error.

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readMasterTags, UntaggableError, writeMasterTags } from "./tags.ts";
import { tinyWav } from "./testWav.ts";

let dir: string;
let wav: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mt-tags-"));
  wav = join(dir, "original.wav");
  writeFileSync(wav, tinyWav());
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("master tags", () => {
  it("reads back what was written, accents and sharps included", async () => {
    const tags = await writeMasterTags(wav, {
      title: "Café « été »",
      artist: "AC/DC",
      album: "Live",
      bpm: 127.98,
      key: "C# minor",
    });
    expect(tags).toEqual({
      title: "Café « été »",
      artist: "AC/DC",
      album: "Live",
      bpm: 127.98,
      key: "C# minor",
    });
    expect(await readMasterTags(wav)).toEqual(tags);
  });

  it("leaves a field the patch does not name, and clears one it names empty", async () => {
    await writeMasterTags(wav, { title: "T", artist: "A", bpm: 90 });
    const tags = await writeMasterTags(wav, { artist: "", bpm: undefined });
    expect(tags).toEqual({ title: "T" });
  });

  it("leaves no temporary file beside the master", async () => {
    await writeMasterTags(wav, { title: "T" });
    expect(readdirSync(dir)).toEqual(["original.wav"]);
  });

  it("reads a key in another tool's spelling as no key", async () => {
    await writeMasterTags(wav, { key: "8A" });
    expect((await readMasterTags(wav)).key).toBeUndefined();
  });

  it("reads a file it cannot open as no tags, and refuses to write into it", async () => {
    const bad = join(dir, "x.mp3");
    writeFileSync(bad, "not audio");
    expect(await readMasterTags(bad)).toEqual({});
    await expect(writeMasterTags(bad, { title: "T" })).rejects.toBeInstanceOf(
      UntaggableError,
    );
    expect(readdirSync(dir).sort()).toEqual(["original.wav", "x.mp3"]);
  });
});
