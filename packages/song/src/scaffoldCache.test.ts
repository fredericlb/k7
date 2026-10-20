import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setFoldersStill } from "./moduleCache";
import { loadModules } from "./moduleTree";
import { scaffold } from "./scaffold";

// A file service's watcher can vouch for a folder the scaffold is writing: the scaffold must read the disk anyway.

let ws: string;
let dir: string;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "td-scaffold-cache-"));
  dir = join(ws, "song.k7");
});
afterEach(() => {
  setFoldersStill(null);
  rmSync(ws, { recursive: true, force: true });
});

describe("a scaffold under a watcher that says nothing moved", () => {
  it("still names its lanes, read from what it just wrote", () => {
    // The folder read once before it existed, as an engine poll does on a project about to be made.
    expect(loadModules(dir)).toEqual({});
    setFoldersStill(() => true);
    scaffold(dir, "demo");
    expect(readdirSync(join(dir, "tracks")).sort()).toEqual([
      "kit.k7x",
      "live.k7x",
      "melody.k7x",
      "pad.k7x",
    ]);
    expect(readdirSync(join(dir, "chains")).sort()).toEqual([
      "kit.k7x",
      "live.k7x",
      "master.k7x",
      "melody.k7x",
      "pad.k7x",
    ]);
  });

  it("leaves no stale read behind for the next reader", () => {
    expect(loadModules(dir)).toEqual({});
    setFoldersStill(() => true);
    scaffold(dir, "demo");
    expect(Object.keys(loadModules(dir))).toEqual(
      expect.arrayContaining(["melody", "pad", "kit", "live"]),
    );
  });
});
