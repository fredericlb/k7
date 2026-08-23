import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLayout, PathEscapesError, safePath } from "./layout.ts";
import { diff, manifest } from "./manifest.ts";

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
  it("lists a family's files with their size, sorted", () => {
    write("samples/audio/kicks/bd01.wav", "1234");
    write("samples/audio/kicks/aa.wav", "1");
    const m = manifest("samples");
    expect(m.map((e) => e.path)).toEqual([
      "samples/audio/kicks/aa.wav",
      "samples/audio/kicks/bd01.wav",
    ]);
    expect(m[1].bytes).toBe(4);
  });

  it("skips the derived cache", () => {
    write("samples/.cache/x.json", "{}");
    write("samples/audio/a.wav");
    expect(manifest("samples").map((e) => e.path)).toEqual([
      "samples/audio/a.wav",
    ]);
  });

  it("stays within its family", () => {
    write("samples/audio/a.wav");
    write("songs/Nirvana/Nevermind/Lithium/original.wav");
    expect(manifest("samples").map((e) => e.path)).toEqual([
      "samples/audio/a.wav",
    ]);
    expect(manifest("songs").map((e) => e.path)).toEqual([
      "songs/Nirvana/Nevermind/Lithium/original.wav",
    ]);
  });
});

describe("diffing a cache against the owner", () => {
  // Both sides are the OWNER's description, never a local stat — see docs/sync.md.
  const owner = [
    { path: "samples/a.yaml", bytes: 10, mtime: 1000 },
    { path: "samples/b.yaml", bytes: 20, mtime: 2000 },
  ];

  it("fetches what is missing", () => {
    expect(diff([owner[0]], owner).fetch.map((e) => e.path)).toEqual([
      "samples/b.yaml",
    ]);
  });

  it("fetches what changed size or time", () => {
    const stale = [owner[0], { ...owner[1], mtime: 1 }];
    expect(diff(stale, owner).fetch.map((e) => e.path)).toEqual([
      "samples/b.yaml",
    ]);
    const resized = [{ ...owner[0], bytes: 9 }, owner[1]];
    expect(diff(resized, owner).fetch.map((e) => e.path)).toEqual([
      "samples/a.yaml",
    ]);
  });

  it("drops what the owner no longer has", () => {
    const extra = [...owner, { path: "samples/gone.yaml", bytes: 1, mtime: 1 }];
    const d = diff(extra, owner);
    expect(d.fetch).toEqual([]);
    expect(d.drop).toEqual(["samples/gone.yaml"]);
  });

  it("asks for nothing when the two agree", () => {
    expect(diff(owner, owner)).toEqual({ fetch: [], drop: [] });
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
