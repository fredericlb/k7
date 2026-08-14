import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hasSharedModules,
  moduleLibraryDirs,
  moduleNamespaceOf,
} from "./sharedFolders";

// A workspace is projects side by side with the shared modules they all draw from:
//
//   ws/_modules/   the shared modules  (@workspace)
//   ws/song/       a project
//
// There is no shared ASSET folder any more: a file a plugin loads lives in the `assets/` of the
// module that names it, so the module travels whole (see moduleAssets.test.ts).
//
// A project sees the modules because of WHERE they are. `modules_from`/`libraries_from` used to
// declare them and are gone: the list could only ever name these two places plus the
// médiathèque, so it decided nothing while giving every project a way to be wrong about it —
// a project older than the line saw no médiathèque, and a folder deleted from the workspace
// left a declaration behind that took the whole song down.
describe("sharedFolders", () => {
  let ws: string;
  let project: string;
  let media: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "td-shared-"));
    project = join(ws, "song");
    mkdirSync(project, { recursive: true });
    writeFileSync(
      join(project, "project.yaml"),
      "project:\n  name: song\n",
      "utf8",
    );
    media = mkdtempSync(join(tmpdir(), "td-media-"));
    process.env.STUDIO_MEDIATEK = media;
  });
  afterEach(() => {
    delete process.env.STUDIO_MEDIATEK;
    rmSync(ws, { recursive: true, force: true });
    rmSync(media, { recursive: true, force: true });
  });

  const addModules = () => mkdirSync(join(ws, "_modules"), { recursive: true });
  const addMediatek = (kind: "modules" | "library") =>
    mkdirSync(join(media, kind), { recursive: true });

  it("sees nothing when the folder is not there", () => {
    // And that is a working state, not a failure: a project with no shared folder has its
    // own `modules/` and the engine's catalogue, which is a whole song's worth of vocabulary.
    expect(hasSharedModules(project)).toBe(false);
    expect(moduleLibraryDirs(project)).toEqual([]);
  });

  it("finds the workspace's folder on the strength of the folder alone", () => {
    // No config, no declaration: a root is `@workspace` for WHERE it sits.
    addModules();
    expect(moduleLibraryDirs(project)).toEqual([join(ws, "_modules")]);
  });

  it("finds the médiathèque with nothing said anywhere", () => {
    addMediatek("modules");
    expect(moduleLibraryDirs(project)).toEqual([join(media, "modules")]);
  });

  it("puts the workspace's own first — order is precedence", () => {
    // What sits beside the song beats what is global to the machine. loadUiLibrary reads the
    // list in this order.
    addModules();
    addMediatek("modules");
    expect(moduleLibraryDirs(project)).toEqual([
      join(ws, "_modules"),
      join(media, "modules"),
    ]);
  });

  it("ignores a project header that still declares the old fields", () => {
    // Every song already written carries them. They are accepted by the schema and read by
    // nothing — `deadProjectFields` is what says so out loud, rather than leaving it silent.
    addModules();
    writeFileSync(
      join(project, "project.yaml"),
      "project:\n  name: song\n  modules_from: [ ../vendor ]\n  libraries_from: [ ../other ]\n",
      "utf8",
    );
    expect(moduleLibraryDirs(project)).toEqual([join(ws, "_modules")]);
  });

  it("needs no project file at all to answer", () => {
    // The folders are found by location, so there is no header to read first — which is what
    // makes a missing or unparseable one cost the compile and not the vocabulary.
    addModules();
    rmSync(join(project, "project.yaml"));
    expect(moduleLibraryDirs(project)).toEqual([join(ws, "_modules")]);
  });

  it("survives a declaration naming a folder that is gone", () => {
    // The failure this removes: a `_modules` deleted from the workspace left its line behind,
    // `loadModuleRefs` threw on a root it could not resolve, and the whole song went dark for
    // one stale line. Now the line is ignored and the médiathèque still answers.
    addMediatek("modules");
    writeFileSync(
      join(project, "project.yaml"),
      "project:\n  name: song\n  modules_from:\n    - ../_modules\n",
      "utf8",
    );
    expect(moduleLibraryDirs(project)).toEqual([join(media, "modules")]);
  });

  it("names each root by where it sits", () => {
    addModules();
    addMediatek("modules");
    expect(moduleNamespaceOf(join(ws, "_modules"))).toBe("workspace");
    // `st0`, after the app that serves the library — NOT after `~/.studio/mediatek`, the
    // folder it is cached in. The two used to be one word and the folder kept it.
    expect(moduleNamespaceOf(join(media, "modules"))).toBe("st0");
  });
});
