import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLayout, PathEscapesError, safePath } from "./layout.ts";
import { manifest, manifestAt } from "./manifest.ts";
import { bumped } from "./revision.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mediatek-mf-"));
  process.env.STUDIO_MEDIATEK = root;
  ensureLayout();
});
afterEach(() => {
  delete process.env.STUDIO_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
});

const write = (rel: string, body = "x"): void => {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body, "utf8");
};

describe("the manifest", () => {
  it("lists a family's files with their size, sorted", async () => {
    write("samples/audio/kicks/bd01.wav", "1234");
    write("samples/audio/kicks/aa.wav", "1");
    const m = await manifest("samples");
    expect(m.map((e) => e.path)).toEqual([
      "samples/audio/kicks/aa.wav",
      "samples/audio/kicks/bd01.wav",
    ]);
    expect(m[1].bytes).toBe(4);
  });

  it("skips the derived cache", async () => {
    write("samples/.cache/x.json", "{}");
    write("samples/audio/a.wav");
    expect((await manifest("samples")).map((e) => e.path)).toEqual([
      "samples/audio/a.wav",
    ]);
  });

  it("stays within its family", async () => {
    write("samples/audio/a.wav");
    write("songs/Nirvana/Nevermind/Lithium/original.wav");
    expect((await manifest("samples")).map((e) => e.path)).toEqual([
      "samples/audio/a.wav",
    ]);
    expect((await manifest("songs")).map((e) => e.path)).toEqual([
      "songs/Nirvana/Nevermind/Lithium/original.wav",
    ]);
  });
});

describe("the held manifest", () => {
  it("walks once per revision and again once the family moves", async () => {
    write("samples/audio/a.wav");
    const first = manifestAt("samples");
    expect(manifestAt("samples").files).toBe(first.files);
    expect((await first.files).map((e) => e.path)).toEqual([
      "samples/audio/a.wav",
    ]);
    write("samples/audio/b.wav");
    bumped("samples");
    const second = manifestAt("samples");
    expect(second.rev).not.toBe(first.rev);
    expect((await second.files).map((e) => e.path)).toEqual([
      "samples/audio/a.wav",
      "samples/audio/b.wav",
    ]);
  });
});

describe("the path guard", () => {
  // The local library never needed one; a hosted one has no wall around it (docs/index.md).
  it("resolves a path inside the library", () => {
    expect(safePath("samples/a.yaml")).toBe(join(root, "samples", "a.yaml"));
  });

  it("refuses to climb out", () => {
    expect(() => safePath("../secrets")).toThrow(PathEscapesError);
    expect(() => safePath("samples/../../secrets")).toThrow(PathEscapesError);
    expect(() => safePath("/etc/passwd")).toThrow(PathEscapesError);
  });

  it("leaves a sibling folder whose name merely starts the same alone", () => {
    // The check is on the separator, so `<root>-other` is outside despite the shared prefix.
    expect(() => safePath(join("..", `${join(root, "x")}-other`))).toThrow(
      PathEscapesError,
    );
  });

  it("does not care how the ROOT was spelled", () => {
    // THE bug this test exists for: `startsWith` compared SPELLINGS — see docs/index.md.
    process.env.STUDIO_MEDIATEK = root.split(sep).join("/");
    expect(safePath("samples/audio")).toBe(join(root, "samples", "audio"));
    // …and a real escape is still refused, whatever the spelling.
    expect(() => safePath("../secrets")).toThrow(PathEscapesError);
  });
});
