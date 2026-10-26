// A song's facts live in its master's tags: what is written reads back, a write never edits the
// file in place, and a file TagLib cannot open reads as no tags rather than as an error.

import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TagLib } from "taglib-wasm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readMasterTags,
  readOtherTags,
  TAGLIB_WASM,
  UntaggableError,
  writeMasterTags,
} from "./tags.ts";
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

  it("lists the file's other tags apart from the five, whatever tool wrote them", async () => {
    await writeMasterTags(wav, { title: "T", key: "A minor" });
    // Another tool's frames, written the way it would: straight through TagLib.
    const lib = await TagLib.initialize({
      wasmBinary: readFileSync(
        join(import.meta.dirname, "../../..", TAGLIB_WASM),
      ),
      forceWasmType: "emscripten",
    });
    await lib.edit(wav, (f) => {
      f.setProperty("GENRE", "Jazz");
      f.setProperty("DATE", "1959");
    });
    const others = await readOtherTags(wav);
    expect(others).toMatchObject({ genre: ["Jazz"], date: ["1959"] });
    expect(Object.keys(others).map((k) => k.toLowerCase())).not.toContain(
      "title",
    );
    expect(Object.keys(others)).not.toContain("INITIALKEY");
  });

  it("reads a track as its position, `3/12` being track 3, and no longer lists it among the others", async () => {
    const lib = await TagLib.initialize({
      wasmBinary: readFileSync(
        join(import.meta.dirname, "../../..", TAGLIB_WASM),
      ),
      forceWasmType: "emscripten",
    });
    await lib.edit(wav, (f) => f.setProperty("TRACKNUMBER", "3/12"));
    expect((await readMasterTags(wav)).track).toBe(3);
    expect(
      Object.keys(await readOtherTags(wav)).map((k) => k.toLowerCase()),
    ).not.toContain("tracknumber");
    // Written back as a plain position, and cleared by an empty value.
    expect((await writeMasterTags(wav, { track: 4 })).track).toBe(4);
    expect((await writeMasterTags(wav, { track: "" })).track).toBeUndefined();
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
