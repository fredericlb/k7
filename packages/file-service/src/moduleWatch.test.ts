// The watcher's whole job is answering one question — "have the module folders moved?" — and
// the only answer that can hurt is a wrong `true`. So every test here is about when it says
// false: before it knows anything, after an event, and when the ceiling runs out.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadModules, withModuleStamp } from "@studio/song/loader";
import { setFoldersStill } from "@studio/song/moduleCache";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeModuleWatch,
  moduleFoldersStill,
  WALK_ANYWAY_MS,
  watchModuleFolders,
} from "./moduleWatch.ts";

let root = "";
let dir = "";

const module_ = (name: string): void => {
  mkdirSync(join(dir, "modules", "audio", name), { recursive: true });
  writeFileSync(
    join(dir, "modules", "audio", name, "module.yaml"),
    `# ${name}\nplugin:\n  type: internal\n  name: Mixer\n`,
    "utf8",
  );
};

// fs.watch delivers on its own schedule; a fixed sleep is what a real event needs.
const settle = (ms = 250): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "module-watch-"));
  dir = join(root, "song.l8");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "project.yaml"), "project:\n  name: t\n", "utf8");
  module_("reverb");
});
afterEach(() => {
  closeModuleWatch();
  setFoldersStill(null); // never leave the oracle installed for the next file
  rmSync(root, { recursive: true, force: true });
});

describe("moduleFoldersStill", () => {
  it("says no for a project nobody is watching", () => {
    expect(moduleFoldersStill(dir)).toBe(false);
  });

  // The first ask after starting is a NO: the watcher has seen no events, but neither has it
  // seen the folders, and the walk it forces is what gives every later answer something to be
  // measured against.
  it("says no once, then yes while nothing happens", () => {
    watchModuleFolders(dir);
    expect(moduleFoldersStill(dir)).toBe(false);
    expect(moduleFoldersStill(dir)).toBe(true);
    expect(moduleFoldersStill(dir)).toBe(true);
  });

  it("says no again after a module appears", async () => {
    watchModuleFolders(dir);
    moduleFoldersStill(dir); // the first, forced no
    expect(moduleFoldersStill(dir)).toBe(true);
    module_("delay");
    await settle();
    expect(moduleFoldersStill(dir)).toBe(false);
    expect(moduleFoldersStill(dir)).toBe(true); // …and settles again
  });

  it("says no again after a module file is edited", async () => {
    watchModuleFolders(dir);
    moduleFoldersStill(dir);
    expect(moduleFoldersStill(dir)).toBe(true);
    writeFileSync(
      join(dir, "modules", "audio", "reverb", "module.yaml"),
      "# reverb\nplugin:\n  type: internal\n  name: Mixer\nparams:\n  Volume: 3\n",
      "utf8",
    );
    await settle();
    expect(moduleFoldersStill(dir)).toBe(false);
  });

  it("stops claiming anything once closed", () => {
    watchModuleFolders(dir);
    moduleFoldersStill(dir);
    expect(moduleFoldersStill(dir)).toBe(true);
    closeModuleWatch(dir);
    expect(moduleFoldersStill(dir)).toBe(false);
  });

  // The ceiling is what makes a MISSED event a delay rather than a permanent lie, so it is
  // stated as a number this test can read rather than left implicit.
  it("keeps a ceiling on how long it may be believed", () => {
    expect(WALK_ANYWAY_MS).toBeGreaterThan(0);
    expect(WALK_ANYWAY_MS).toBeLessThanOrEqual(60_000);
  });
});

// The point of the whole file: what `@studio/song` does with the answer. A held stamp must not
// outlive a change to the folders, whatever the watcher's opinion.
describe("the vocabulary the oracle governs", () => {
  it("still sees a module added while it is installed", async () => {
    watchModuleFolders(dir);
    setFoldersStill(moduleFoldersStill);
    expect(Object.keys(loadModules(dir))).toEqual(["reverb"]);
    module_("delay");
    await settle();
    expect(Object.keys(loadModules(dir)).sort()).toEqual(["delay", "reverb"]);
  });

  // …and the scope still wins inside itself: a derivation is a still frame either way.
  it("holds one answer for the length of a scope", () => {
    watchModuleFolders(dir);
    setFoldersStill(moduleFoldersStill);
    loadModules(dir);
    const seen = withModuleStamp(dir, () => {
      const before = Object.keys(loadModules(dir));
      module_("delay");
      return { before, after: Object.keys(loadModules(dir)) };
    });
    expect(seen.after).toEqual(seen.before);
  });
});
