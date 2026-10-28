import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLayout, NotWritableError, PathEscapesError } from "./layout.ts";
import { familyRevision } from "./revision.ts";
import { removeLibrary } from "./testLibrary.ts";
import { putFile, removeFile, removeTree } from "./write.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mediatek-w-"));
  process.env.STUDIO_MEDIATEK = root;
  ensureLayout();
});
afterEach(async () => {
  delete process.env.STUDIO_MEDIATEK;
  await removeLibrary(root);
});

/** Any `.part` leftover in a folder — the temp name carries a random suffix, so a literal
 * `<file>.part` check would pass vacuously even if a stray temp file were left behind. */
const partFiles = (inDir: string): string[] =>
  readdirSync(inDir).filter((f) => f.endsWith(".part"));

describe("putting a file in", () => {
  it("writes it, making its folder", () => {
    putFile("samples/audio/reverb/module.yaml", "plugin: {}\n");
    expect(
      readFileSync(join(root, "samples/audio/reverb/module.yaml"), "utf8"),
    ).toBe("plugin: {}\n");
  });

  it("leaves no .part behind", () => {
    // Written beside and renamed, because the moteur may be reading this tree (docs/index.md).
    const abs = join(root, "samples/a/module.yaml");
    putFile("samples/a/module.yaml", "a\n");
    expect(partFiles(dirname(abs))).toEqual([]);
  });

  it("moves the family's token, which the walk alone could not see", () => {
    putFile("samples/a/module.yaml", "a\n");
    const before = familyRevision("samples");
    putFile("samples/a/module.yaml", "b\n"); // same count, same tick, different bytes
    expect(familyRevision("samples")).not.toBe(before);
  });
});

describe("putting in a file a server already has on disk", () => {
  it("moves it into place, so the upload is gone and never copied through memory", () => {
    const upload = join(root, ".uploads-test");
    writeFileSync(upload, "bytes");
    putFile("samples/a.wav", { file: upload });
    expect(readFileSync(join(root, "samples/a.wav"), "utf8")).toBe("bytes");
    expect(existsSync(upload)).toBe(false);
    expect(partFiles(join(root, "samples"))).toEqual([]);
  });
});

describe("what may not be written", () => {
  it("refuses to climb out of the library", () => {
    expect(() => putFile("../evil.yaml", "x")).toThrow(PathEscapesError);
  });

  it("refuses the marker that says what this folder IS", () => {
    expect(() => putFile("mediatek.yaml", "version: 99\n")).toThrow(
      NotWritableError,
    );
  });

  it("refuses derived state", () => {
    // Otherwise a caller could forge an index, or a cache's record of what it holds.
    expect(() => putFile(".cache/index.json", "{}")).toThrow(NotWritableError);
    expect(() => putFile(".cache/manifest/samples.json", "[]")).toThrow(
      NotWritableError,
    );
  });
});

describe("taking a file out", () => {
  it("removes it and moves the token", () => {
    putFile("samples/a/module.yaml", "a\n");
    const before = familyRevision("samples");
    removeFile("samples/a/module.yaml");
    expect(existsSync(join(root, "samples/a/module.yaml"))).toBe(false);
    expect(familyRevision("samples")).not.toBe(before);
  });

  it("treats absent as done — the caller wanted it gone", () => {
    expect(() => removeFile("samples/never/there.yaml")).not.toThrow();
  });

  it("refuses the same paths a write does", () => {
    expect(() => removeFile("../evil.yaml")).toThrow(PathEscapesError);
    expect(() => removeFile(".cache/index.json")).toThrow(NotWritableError);
  });
});

describe("taking a whole subtree out", () => {
  it("removes every file underneath and moves the token once", () => {
    putFile("songs/Nirvana/Nevermind/Lithium/original.mp3", "a\n");
    putFile("songs/Nirvana/Nevermind/Breed/original.mp3", "b\n");
    const before = familyRevision("songs");
    removeTree("songs/Nirvana");
    expect(existsSync(join(root, "songs/Nirvana"))).toBe(false);
    expect(familyRevision("songs")).not.toBe(before);
  });

  it("treats absent as done — the caller wanted it gone", () => {
    expect(() => removeTree("songs/never/there")).not.toThrow();
  });

  it("refuses the same paths a write does", () => {
    expect(() => removeTree("../evil")).toThrow(PathEscapesError);
    expect(() => removeTree(".cache")).toThrow(NotWritableError);
  });
});
