import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hasSharedModules,
  moduleLibraryDirs,
  moduleNamespaceOf,
} from "./sharedFolders";

// A project sees `_modules` and `_libraries/modules` by WHERE they sit, not by any declaration.
describe("sharedFolders", () => {
  let ws: string;
  let project: string;
  let libraries: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "td-shared-"));
    project = join(ws, "song");
    mkdirSync(project, { recursive: true });
    writeFileSync(
      join(project, "project.yaml"),
      "project:\n  name: song\n",
      "utf8",
    );
    // The library submodule is IN the workspace, so there is no machine-wide folder to restore.
    libraries = join(ws, "_libraries");
  });
  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
  });

  const addModules = () => mkdirSync(join(ws, "_modules"), { recursive: true });
  const addMediatek = (kind: "modules" | "chains") =>
    mkdirSync(join(libraries, kind), { recursive: true });

  it("sees nothing when the folder is not there", () => {
    // A working state: the project still has its own `modules/` and the engine's catalogue.
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
    expect(moduleLibraryDirs(project)).toEqual([join(libraries, "modules")]);
  });

  it("puts the workspace's own first — order is precedence", () => {
    // What sits beside the song beats what the account's library brings along.
    addModules();
    addMediatek("modules");
    expect(moduleLibraryDirs(project)).toEqual([
      join(ws, "_modules"),
      join(libraries, "modules"),
    ]);
  });

  it("ignores a project header that still declares the old fields", () => {
    // Every song already written carries them: the schema accepts them and nothing reads them.
    addModules();
    writeFileSync(
      join(project, "project.yaml"),
      "project:\n  name: song\n  modules_from: [ ../vendor ]\n  libraries_from: [ ../other ]\n",
      "utf8",
    );
    expect(moduleLibraryDirs(project)).toEqual([join(ws, "_modules")]);
  });

  it("needs no project file at all to answer", () => {
    // Found by location, so an unparseable header costs the compile and not the vocabulary.
    addModules();
    rmSync(join(project, "project.yaml"));
    expect(moduleLibraryDirs(project)).toEqual([join(ws, "_modules")]);
  });

  it("survives a declaration naming a folder that is gone", () => {
    // A declaration naming a deleted `_modules` must not throw and take the whole song down.
    addMediatek("modules");
    writeFileSync(
      join(project, "project.yaml"),
      "project:\n  name: song\n  modules_from:\n    - ../_modules\n",
      "utf8",
    );
    expect(moduleLibraryDirs(project)).toEqual([join(libraries, "modules")]);
  });

  it("names each root by where it sits", () => {
    addModules();
    addMediatek("modules");
    expect(moduleNamespaceOf(join(ws, "_modules"))).toBe("workspace");
    // `st0` names the app that serves the library, not the folder it sits in.
    expect(moduleNamespaceOf(join(libraries, "modules"))).toBe("st0");
  });
});

// A chain template inside the library saw NO catalogue, so every node drew as a missing plugin.
describe("a folder INSIDE the library repository", () => {
  it("reaches the library's own modules", () => {
    const ws = mkdtempSync(join(tmpdir(), "inside-"));
    try {
      mkdirSync(join(ws, "_libraries", "modules", "audio"), {
        recursive: true,
      });
      const chain = join(ws, "_libraries", "chains", "process", "normalize");
      mkdirSync(chain, { recursive: true });
      expect(moduleLibraryDirs(chain)).toEqual([
        join(ws, "_libraries", "modules"),
      ]);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("is not a search — a folder with no `_libraries` on its path finds nothing", () => {
    // These are FIXED locations: the segment is on the path or it is not, and nothing hunts.
    const bare = mkdtempSync(join(tmpdir(), "bare-"));
    try {
      expect(moduleLibraryDirs(bare)).toEqual([]);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
