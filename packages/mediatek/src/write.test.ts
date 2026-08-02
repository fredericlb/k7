import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLayout, NotWritableError, PathEscapesError } from "./layout.ts";
import { familyRevision } from "./revision.ts";
import { putFile, removeFile } from "./write.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mediatek-w-"));
  process.env.LANES_MEDIATEK = root;
  ensureLayout();
});
afterEach(() => {
  delete process.env.LANES_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
});

describe("putting a file in", () => {
  it("writes it, making its folder", () => {
    putFile("modules/audio/reverb/module.yaml", "plugin: {}\n");
    expect(
      readFileSync(join(root, "modules/audio/reverb/module.yaml"), "utf8"),
    ).toBe("plugin: {}\n");
  });

  it("leaves no .part behind", () => {
    // Written beside and renamed: the moteur may be reading this tree, and a half-written
    // module.yaml is a project that won't compile.
    putFile("modules/a/module.yaml", "a\n");
    expect(existsSync(join(root, "modules/a/module.yaml.part"))).toBe(false);
  });

  it("moves the family's token, which the walk alone could not see", () => {
    putFile("modules/a/module.yaml", "a\n");
    const before = familyRevision("modules");
    putFile("modules/a/module.yaml", "b\n"); // same count, same tick, different bytes
    expect(familyRevision("modules")).not.toBe(before);
  });

  it("files a panel under the modules it draws", () => {
    // `ui/` is not a family of its own; a surface listing modules wants to know when one
    // changed its face.
    const before = familyRevision("modules");
    putFile("ui/audio/reverb.yaml", "ref: audio/reverb\n");
    expect(familyRevision("modules")).not.toBe(before);
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
    expect(() => putFile(".cache/manifest/modules.json", "[]")).toThrow(
      NotWritableError,
    );
  });
});

describe("taking a file out", () => {
  it("removes it and moves the token", () => {
    putFile("modules/a/module.yaml", "a\n");
    const before = familyRevision("modules");
    removeFile("modules/a/module.yaml");
    expect(existsSync(join(root, "modules/a/module.yaml"))).toBe(false);
    expect(familyRevision("modules")).not.toBe(before);
  });

  it("treats absent as done — the caller wanted it gone", () => {
    expect(() => removeFile("modules/never/there.yaml")).not.toThrow();
  });

  it("refuses the same paths a write does", () => {
    expect(() => removeFile("../evil.yaml")).toThrow(PathEscapesError);
    expect(() => removeFile(".cache/index.json")).toThrow(NotWritableError);
  });
});
