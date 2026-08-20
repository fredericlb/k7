// Where a named base lands. A short operation, but one that takes a name a person typed and turns
// it into a path on disk — so what it must refuse matters more than what it creates.
// See packages/song/docs/userPresets.md for what a base IS.

import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeYaml } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

let root: string;
let ws: Workspace;
const MODULE = "song.st0/modules/audio/wurli/module.yaml";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-base-"));
  const proj = join(root, "song.st0");
  mkdirSync(join(proj, "modules", "audio", "wurli"), { recursive: true });
  writeYaml(join(proj, "project.yaml"), { project: { name: "song" } });
  writeYaml(join(proj, "modules", "audio", "wurli", "module.yaml"), {
    extends: "@engine/wurli-v2",
  });
  ws = new Workspace(root);
  ws.setActiveProject("song.st0");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("Workspace.baseSnapshotPath", () => {
  it("puts it in the module's own base/ folder, and creates that folder", () => {
    const { path } = ws.baseSnapshotPath(MODULE, "warm");
    expect(path).toBe("song.st0/modules/audio/wurli/base/warm.vstpreset");
    // Created here rather than by the engine: the engine writes where it is told, and being told
    // a path whose parent does not exist is not something it should have to recover from.
    expect(existsSync(join(root, "song.st0/modules/audio/wurli/base"))).toBe(
      true,
    );
  });

  it("spells the extension once, whether or not it was typed", () => {
    // Two files for one base is the surprise this avoids — `warm` and `warm.vstpreset` name the
    // same thing to anybody typing either.
    expect(ws.baseSnapshotPath(MODULE, "warm.vstpreset").path).toBe(
      ws.baseSnapshotPath(MODULE, "warm").path,
    );
  });

  it("answers an absolute path too — the engine is a different process", () => {
    const { abs, path } = ws.baseSnapshotPath(MODULE, "warm");
    expect(abs.endsWith(join("base", "warm.vstpreset"))).toBe(true);
    // The relative one is the browser's: it has no idea where the workspace lives.
    expect(path.startsWith("song.st0/")).toBe(true);
  });

  it("cannot climb out of the module, however the name is spelt", () => {
    // The property is CONTAINMENT, not a pretty name. A separator-laden name is flattened rather
    // than refused — `renameEntry` has the same rule, and for the same reason: the name only ever
    // names a file in one folder, so a separator in it is a typo, not an instruction. What it must
    // never do is produce a second path segment, which is what would let it leave `base/`.
    for (const evil of [
      "../../../../etc/passwd",
      "....windowssystem32cfg",
      "sub/warm",
      "%2e%2e/warm",
    ]) {
      const { path } = ws.baseSnapshotPath(MODULE, evil);
      const inside = "song.st0/modules/audio/wurli/base/";
      expect(path.startsWith(inside)).toBe(true);
      // One segment past `base/` — no separator survived to make a second.
      expect(path.slice(inside.length)).not.toContain("/");
    }
  });

  it("refuses a name that is nothing at all", () => {
    for (const empty of ["", "   ", ".", "..", "/", "//"])
      expect(() => ws.baseSnapshotPath(MODULE, empty)).toThrow(/invalid name/);
  });
});
