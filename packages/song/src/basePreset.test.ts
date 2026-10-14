// Which .vstpreset a module loads once bases exist, and what a chosen base may NOT disturb.
// See docs/userPresets.md for what a base is and why it is not a preset.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  basePresetIn,
  basesIn,
  isSurgePatch,
  moduleBaseChoices,
  presetFor,
} from "./basePreset";

let root: string;
const touch = (...p: string[]) => {
  const f = join(root, ...p);
  mkdirSync(join(f, ".."), { recursive: true });
  writeFileSync(f, "VST3", "utf8");
  return f;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-basepreset-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("basesIn", () => {
  it("names them without the extension, sorted, and ignores everything else", () => {
    touch("m", "base", "warm.vstpreset");
    touch("m", "base", "bright.vstpreset");
    touch("m", "base", "notes.txt");
    expect(basesIn(join(root, "m"))).toEqual(["bright", "warm"]);
  });

  it("is empty — never a throw — for a module with no base/ folder", () => {
    mkdirSync(join(root, "m"), { recursive: true });
    expect(basesIn(join(root, "m"))).toEqual([]);
    expect(basesIn(undefined)).toEqual([]);
  });
});

describe("a Surge XT patch as a base", () => {
  it("lists .fxp files beside .vstpreset ones, a category folder named into the base", () => {
    touch("m", "base", "Pads", "Bell Pad.fxp");
    touch("m", "base", "Basses", "Bass 2.fxp");
    touch("m", "base", "warm.vstpreset");
    expect(basesIn(join(root, "m"))).toEqual([
      "Basses/Bass 2",
      "Pads/Bell Pad",
      "warm",
    ]);
  });

  it("resolves a nested base to its .fxp, which the compile sends as a patch", () => {
    const file = touch("m", "base", "Pads", "Bell Pad.fxp");
    expect(basePresetIn(join(root, "m"), "Pads/Bell Pad")).toBe(file);
    expect(isSurgePatch(file)).toBe(true);
    expect(isSurgePatch(touch("m", "base", "warm.vstpreset"))).toBe(false);
  });

  it("refuses a base name that climbs out of base/", () => {
    touch("m", "secret.fxp");
    expect(basePresetIn(join(root, "m"), "../secret")).toBeUndefined();
  });
});

describe("presetFor", () => {
  it("prefers the CHOSEN base over both defaults", () => {
    const folder = join(root, "m");
    touch("m", "base", "warm.vstpreset");
    touch("m", "lead.vstpreset"); // the node's own
    touch("m", "m.vstpreset"); // the module's default
    expect(presetFor(folder, "m", "lead", "warm")).toBe(
      join(folder, "base", "warm.vstpreset"),
    );
  });

  it("falls back to the node's own, then the module's, when nothing was chosen", () => {
    const folder = join(root, "m");
    touch("m", "lead.vstpreset");
    touch("m", "m.vstpreset");
    expect(presetFor(folder, "m", "lead", undefined)).toBe(
      join(folder, "lead.vstpreset"),
    );
    expect(presetFor(folder, "m", "other", undefined)).toBe(
      join(folder, "m.vstpreset"),
    );
  });

  it("falls back rather than loading nothing when the base has gone missing", () => {
    // A `base:` naming a missing file must leave the module on its DEFAULT state.
    const folder = join(root, "m");
    touch("m", "m.vstpreset");
    expect(presetFor(folder, "m", undefined, "gone")).toBe(
      join(folder, "m.vstpreset"),
    );
  });

  it("is undefined when the module has no state at all", () => {
    mkdirSync(join(root, "m"), { recursive: true });
    expect(
      presetFor(join(root, "m"), "m", undefined, undefined),
    ).toBeUndefined();
  });
});

describe("moduleBaseChoices", () => {
  it("offers its own and its ancestors', nearest first", () => {
    touch("local", "base", "mine.vstpreset");
    touch("shared", "base", "warm.vstpreset");
    touch("deep", "base", "old.vstpreset");
    const refs = {
      "@k7-core/audio/shared": {
        folderAbs: join(root, "shared"),
        extends: "@k7-core/audio/deep",
      },
      "@k7-core/audio/deep": { folderAbs: join(root, "deep") },
    };
    const local = {
      folderAbs: join(root, "local"),
      extends: "@k7-core/audio/shared",
    };
    expect(moduleBaseChoices(local, refs)).toEqual(["mine", "warm", "old"]);
  });

  it("offers the ancestor's on a thin local module that carries none", () => {
    // Bases sit on the SHARED module, so listing only the local folder offers nothing.
    touch("shared", "base", "warm.vstpreset");
    mkdirSync(join(root, "local"), { recursive: true });
    const refs = {
      "@k7-core/audio/shared": { folderAbs: join(root, "shared") },
    };
    expect(
      moduleBaseChoices(
        { folderAbs: join(root, "local"), extends: "@k7-core/audio/shared" },
        refs,
      ),
    ).toEqual(["warm"]);
  });

  it("survives a cycle in extends", () => {
    touch("a", "base", "one.vstpreset");
    const refs: Record<string, { folderAbs?: string; extends?: string }> = {
      "@k7-core/a": { folderAbs: join(root, "a"), extends: "@k7-core/b" },
      "@k7-core/b": { folderAbs: join(root, "a"), extends: "@k7-core/a" },
    };
    expect(moduleBaseChoices(refs["@k7-core/a"], refs)).toEqual(["one"]);
  });
});
