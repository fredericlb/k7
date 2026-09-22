import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLayout, NotWritableError, PathEscapesError } from "./layout.ts";
import { familyRevision } from "./revision.ts";
import { putFile, removeFile } from "./write.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mediatek-w-"));
  process.env.STUDIO_MEDIATEK = root;
  ensureLayout();
});
afterEach(() => {
  delete process.env.STUDIO_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
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
