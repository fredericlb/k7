import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLayout, PathEscapesError, safePath } from "./layout.ts";
import { diff, manifest } from "./manifest.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mediatek-mf-"));
  process.env.LANES_MEDIATEK = root;
  ensureLayout();
});
afterEach(() => {
  delete process.env.LANES_MEDIATEK;
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
    write("modules/instruments/synth/module.yaml", "plugin: {}\n");
    expect(manifest("samples")).toHaveLength(1);
    // …and modules also carries the library's own config.yaml, which ensureLayout writes
    // and which declares the namespace every ref is keyed by. It is a real file the cache
    // must receive — a modules root without one is a hard error in the loader.
    expect(manifest("modules").map((e) => e.path)).toEqual([
      "modules/config.yaml",
      "modules/instruments/synth/module.yaml",
    ]);
  });
});

describe("diffing a cache against the owner", () => {
  // Both sides are the OWNER's description. A downloaded file has its own mtime, so
  // comparing a fresh local stat would report every file as changed, every time — which
  // is precisely why the cache remembers what the server said instead.
  const owner = [
    { path: "modules/a.yaml", bytes: 10, mtime: 1000 },
    { path: "modules/b.yaml", bytes: 20, mtime: 2000 },
  ];

  it("fetches what is missing", () => {
    expect(diff([owner[0]], owner).fetch.map((e) => e.path)).toEqual([
      "modules/b.yaml",
    ]);
  });

  it("fetches what changed size or time", () => {
    const stale = [owner[0], { ...owner[1], mtime: 1 }];
    expect(diff(stale, owner).fetch.map((e) => e.path)).toEqual([
      "modules/b.yaml",
    ]);
    const resized = [{ ...owner[0], bytes: 9 }, owner[1]];
    expect(diff(resized, owner).fetch.map((e) => e.path)).toEqual([
      "modules/a.yaml",
    ]);
  });

  it("drops what the owner no longer has", () => {
    const extra = [...owner, { path: "modules/gone.yaml", bytes: 1, mtime: 1 }];
    const d = diff(extra, owner);
    expect(d.fetch).toEqual([]);
    expect(d.drop).toEqual(["modules/gone.yaml"]);
  });

  it("asks for nothing when the two agree", () => {
    expect(diff(owner, owner)).toEqual({ fetch: [], drop: [] });
  });
});

describe("the path guard", () => {
  // The local library never needed one: the file service's own safePath confined to the
  // workspace, putting the mediatek out of reach. A hosted one has no such wall.
  it("resolves a path inside the library", () => {
    expect(safePath("modules/a.yaml")).toBe(join(root, "modules", "a.yaml"));
  });

  it("refuses to climb out", () => {
    expect(() => safePath("../secrets")).toThrow(PathEscapesError);
    expect(() => safePath("modules/../../secrets")).toThrow(PathEscapesError);
    expect(() => safePath("/etc/passwd")).toThrow(PathEscapesError);
  });

  it("leaves a sibling folder whose name merely starts the same alone", () => {
    // The check is on the separator, so `<root>-other` is outside even though the string
    // starts with the root.
    expect(() => safePath(join("..", `${join(root, "x")}-other`))).toThrow(
      PathEscapesError,
    );
  });
});
